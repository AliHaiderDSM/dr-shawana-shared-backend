import { Router } from 'express';
import { z } from 'zod';
import { AppDataSource } from '../../database/data-source';
import { toQuantity } from '../../database/transformers';
import { dataEnvelope, errorResponses, jsonContent, sendOk } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { dateInput } from '../../lib/validation';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validQuery } from '../../middleware/validate';

const querySchema = z.object({
  from: dateInput.optional(),
  to: dateInput.optional(),
  toBranchId: z.uuid().optional(),
  status: z.enum(['received', 'on_the_way']).optional(),
  branchId: z.uuid().optional(),
});
type Query = z.infer<typeof querySchema>;

const transferSchema = registry.register(
  'StockOutTransfer',
  z.object({
    transferNo: z.string(),
    date: z.iso.date(),
    sentAt: z.string(),
    from: z.object({ name: z.string(), code: z.string() }),
    to: z.object({ id: z.uuid(), name: z.string(), code: z.string() }).nullable(),
    requestNo: z.string().nullable(),
    sentBy: z.object({ name: z.string(), role: z.string() }).nullable(),
    receivedAt: z.string().nullable(),
    receivedBy: z.string().nullable(),
    products: z.number().int(),
    qty: z.string(),
    serials: z.number().int(),
    items: z.array(z.object({ product: z.string(), qty: z.string(), serials: z.array(z.string()) })),
  }),
);

registry.registerPath({
  ...securedDocs('Inventory'),
  method: 'get',
  path: '/branch/inventory/stock-out-report',
  summary:
    'One line per transfer sent from stock: transfer and request numbers, destination, products with the scanned labels, who sent it and who received it. The Super Admin sees every branch without ?branchId=; a branch sees what it sent or got.',
  request: { query: querySchema },
  responses: {
    200: { description: 'Transfers', ...jsonContent(dataEnvelope(z.array(transferSchema))) },
    ...errorResponses,
  },
});

interface Row {
  transferNo: string;
  date: string;
  sentAt: Date;
  fromName: string;
  fromCode: string;
  toId: string | null;
  toName: string | null;
  toCode: string | null;
  requestNo: string | null;
  sentByName: string | null;
  sentByRole: string | null;
  receivedAt: Date | null;
  receivedBy: string | null;
  qty: string;
  items: { product: string; qty: string; serials: string[] | null }[];
}

async function report(viewer: string | null, query: Query) {
  const params: unknown[] = [];
  const where: string[] = ['so.deleted_at IS NULL', 'so.transfer_no IS NOT NULL'];
  const add = (sql: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(sql(params.length));
  };
  if (viewer) add((n) => `(so.branch_id = $${n} OR so.to_branch_id = $${n})`, viewer);
  if (query.from) add((n) => `so.date >= $${n}`, query.from);
  if (query.to) add((n) => `so.date <= $${n}`, query.to);
  if (query.toBranchId) add((n) => `so.to_branch_id = $${n}`, query.toBranchId);
  if (query.status === 'received') where.push('so.received_at IS NOT NULL');
  if (query.status === 'on_the_way') where.push('so.received_at IS NULL');

  const rows = (await AppDataSource.query(
    `WITH lines AS (
       SELECT so.transfer_no, so.branch_id, so.to_branch_id, so.stock_request_id, so.received_at, so.received_by,
              so.created_by, so.created_at, so.date, so.product_id, so.qty,
              (SELECT array_agg(ii.serial ORDER BY ii.serial_no) FROM inventory_items ii WHERE ii.stock_out_id = so.id) AS serials
         FROM stock_outs so
        WHERE ${where.join(' AND ')}
     )
     SELECT l.transfer_no AS "transferNo", MIN(l.date)::text AS date, MIN(l.created_at) AS "sentAt",
            fb.name AS "fromName", fb.code AS "fromCode", tb.id AS "toId", tb.name AS "toName", tb.code AS "toCode",
            sr.request_no AS "requestNo",
            NULLIF(TRIM(CONCAT(cb.first_name, ' ', cb.last_name)), '') AS "sentByName", cb.role::text AS "sentByRole",
            MAX(l.received_at) AS "receivedAt",
            NULLIF(TRIM(CONCAT(rb.first_name, ' ', rb.last_name)), '') AS "receivedBy",
            SUM(l.qty)::text AS qty,
            json_agg(json_build_object('product', p.name, 'qty', l.qty::text, 'serials', l.serials) ORDER BY p.name) AS items
       FROM lines l
       JOIN branches fb ON fb.id = l.branch_id
       JOIN products p ON p.id = l.product_id
       LEFT JOIN branches tb ON tb.id = l.to_branch_id
       LEFT JOIN stock_requests sr ON sr.id = l.stock_request_id
       LEFT JOIN staff_profiles cb ON cb.id = l.created_by
       LEFT JOIN staff_profiles rb ON rb.id = l.received_by
      GROUP BY l.transfer_no, fb.name, fb.code, tb.id, tb.name, tb.code, sr.request_no,
               cb.first_name, cb.last_name, cb.role, rb.first_name, rb.last_name
      ORDER BY MIN(l.created_at) DESC
      LIMIT 1000`,
    params,
  )) as Row[];

  return rows.map((r) => {
    const items = r.items.map((i) => ({
      product: i.product,
      qty: toQuantity(i.qty),
      serials: i.serials ?? [],
    }));
    return {
      transferNo: r.transferNo,
      date: r.date,
      sentAt: r.sentAt.toISOString(),
      from: { name: r.fromName, code: r.fromCode },
      to: r.toId ? { id: r.toId, name: r.toName ?? '', code: r.toCode ?? '' } : null,
      requestNo: r.requestNo,
      sentBy: r.sentByName ? { name: r.sentByName, role: r.sentByRole ?? '' } : null,
      receivedAt: r.receivedAt?.toISOString() ?? null,
      receivedBy: r.receivedBy,
      products: new Set(items.map((i) => i.product)).size,
      qty: toQuantity(r.qty),
      serials: items.reduce((sum, i) => sum + i.serials.length, 0),
      items,
    };
  });
}

export const stockOutReportRouter = Router();

stockOutReportRouter.get(
  '/branch/inventory/stock-out-report',
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  requirePermission('stock.view', 'inventoryReport.view'),
  validate({ query: querySchema }),
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    sendOk(res, await report(req.branchId ?? null, validQuery(req, querySchema)));
  },
);
