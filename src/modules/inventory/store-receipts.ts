import Decimal from 'decimal.js';
import { Router } from 'express';
import { z } from 'zod';
import { AppDataSource } from '../../database/data-source';
import { repo, withTransaction } from '../../database/transaction';
import { toQuantity } from '../../database/transformers';
import { type Actor, actorFrom } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { branchQuerySchema, dataEnvelope, errorResponses, jsonContent, sendOk } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { branchIdOf } from '../../lib/request';
import { dateInput, optionalText, quantityInput, today } from '../../lib/validation';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import { auditService } from '../audit/audit.service';
import { inventoryItemsService, normalizeSerials } from './inventory-items.service';
import { serialsInput } from './inventory-items.schemas';
import { StockIn } from './stock-in.entity';
import { stockLedger } from './stock-ledger';

const listQuerySchema = z.object({
  status: z.enum(['pending', 'confirmed']).optional(),
  grnNo: z.string().trim().max(30).optional(),
  branchId: z.uuid().optional(),
});
const grnParamsSchema = z.object({ grnNo: z.string().trim().min(3).max(30) });
const confirmSchema = registry.register(
  'ConfirmStoreReceipt',
  z.object({
    date: dateInput.optional(),
    note: optionalText(1000),
    lines: z
      .array(
        z.object({
          id: z.uuid(),
          receivedQty: quantityInput,
          note: optionalText(500),
          missingSerials: serialsInput.optional(),
        }),
      )
      .max(200)
      .optional()
      .openapi({ description: 'Lines that did not arrive in full. Lines left out arrived in full.' }),
  }),
);

const person = z.object({ id: z.uuid(), name: z.string(), role: z.string() }).nullable();
const receiptSchema = registry.register(
  'StoreReceipt',
  z.object({
    grnNo: z.string(),
    date: z.iso.date(),
    createdAt: z.string(),
    status: z.enum(['pending', 'confirmed']),
    supplier: z.string().nullable(),
    note: z.string().nullable(),
    enteredBy: person,
    confirmedBy: person,
    confirmedAt: z.string().nullable(),
    lines: z.array(
      z.object({
        id: z.uuid(),
        productId: z.uuid(),
        productName: z.string(),
        unit: z.string(),
        qty: z.string(),
        receivedQty: z.string().nullable(),
        batch: z.string().nullable(),
        expiryDate: z.string().nullable(),
        labels: z.number().int(),
        receiptNote: z.string().nullable(),
      }),
    ),
  }),
);

const docs = securedDocs('Store receipts');
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/stock-receipts',
  summary:
    'Stock In entries of the Super Admin stock by GRN number. A Lab Officer entry waits until the Warehouse Keeper counts and confirms it; a Super Admin entry is stock at once.',
  request: { query: listQuerySchema },
  responses: {
    200: { description: 'Receipts', ...jsonContent(dataEnvelope(z.array(receiptSchema))) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/stock-receipts/{grnNo}/confirm',
  summary:
    'Warehouse Keeper confirms what arrived. Short lines keep the received quantity and a note; missing labels are written off.',
  request: {
    params: grnParamsSchema,
    query: branchQuerySchema,
    body: { content: { 'application/json': { schema: confirmSchema } } },
  },
  responses: {
    200: { description: 'Confirmed', ...jsonContent(dataEnvelope(receiptSchema)) },
    ...errorResponses,
  },
});

const PERSON = (alias: string) =>
  `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE json_build_object('id', ${alias}.id,
     'name', TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), 'role', ${alias}.role) END`;

async function list(branchId: string, status?: 'pending' | 'confirmed', grnNo?: string) {
  const params: unknown[] = [branchId];
  const having: string[] = [];
  if (status === 'pending') having.push(`bool_or(si.receipt_status = 'pending')`);
  if (status === 'confirmed') having.push(`bool_and(si.receipt_status = 'confirmed')`);
  let where = '';
  if (grnNo) {
    params.push(grnNo);
    where = ` AND si.grn_no = $${params.length}`;
  }
  const rows = (await AppDataSource.query(
    `SELECT si.grn_no AS "grnNo", to_char(MIN(si.date), 'YYYY-MM-DD') AS date, MIN(si.created_at) AS "createdAt",
            CASE WHEN bool_and(si.receipt_status = 'confirmed') THEN 'confirmed' ELSE 'pending' END AS status,
            MAX(sp.name) AS supplier, MAX(si.note) AS note,
            (SELECT ${PERSON('u')} FROM staff_profiles u WHERE u.id = (array_agg(si.created_by))[1]) AS "enteredBy",
            (SELECT ${PERSON('c')} FROM staff_profiles c
              WHERE c.id = (array_agg(si.confirmed_by) FILTER (WHERE si.confirmed_by IS NOT NULL))[1]) AS "confirmedBy",
            MAX(si.confirmed_at) AS "confirmedAt",
            json_agg(json_build_object(
              'id', si.id, 'productId', si.product_id, 'productName', p.name, 'unit', p.unit,
              'qty', si.qty::text, 'receivedQty', si.received_qty::text, 'batch', si.batch,
              'expiryDate', to_char(si.expiry_date, 'YYYY-MM-DD'), 'receiptNote', si.receipt_note,
              'labels', (SELECT COUNT(*) FROM inventory_items i WHERE i.source_type = 'stock_in' AND i.source_id = si.id)::int
            ) ORDER BY p.name) AS lines
       FROM stock_ins si
       JOIN products p ON p.id = si.product_id
       LEFT JOIN suppliers sp ON sp.id = si.supplier_id
      WHERE si.branch_id = $1 AND si.deleted_at IS NULL AND si.grn_no IS NOT NULL${where}
      GROUP BY si.grn_no
      ${having.length ? `HAVING ${having.join(' AND ')}` : ''}
      ORDER BY (bool_and(si.receipt_status = 'confirmed')) ASC, MIN(si.created_at) DESC
      LIMIT 300`,
    params,
  )) as (Record<string, unknown> & { lines: { qty: string; receivedQty: string | null }[] })[];
  return rows.map((r) => ({
    ...r,
    lines: r.lines.map((l) => ({
      ...l,
      qty: new Decimal(l.qty).toFixed(3),
      receivedQty: l.receivedQty === null ? null : new Decimal(l.receivedQty).toFixed(3),
    })),
  }));
}

async function confirm(actor: Actor, branchId: string, grnNo: string, input: z.output<typeof confirmSchema>) {
  if (actor.role !== 'warehouse_keeper') {
    throw AppError.forbidden('Only the Warehouse Keeper confirms what arrived at the store');
  }
  await withTransaction(async (em) => {
    const rows = await repo(StockIn, em)
      .createQueryBuilder('si')
      .setLock('pessimistic_write')
      .where('si.grnNo = :grnNo AND si.branchId = :branchId AND si.deletedAt IS NULL', { grnNo, branchId })
      .getMany();
    if (rows.length === 0) throw AppError.notFound('Stock In');
    const pending = rows.filter((r) => r.receiptStatus === 'pending');
    if (pending.length === 0) throw AppError.conflict(`${grnNo} is already confirmed`);
    const date = input.date ?? today();
    const given = new Map((input.lines ?? []).map((l) => [l.id, l]));
    for (const id of given.keys()) {
      if (!pending.some((r) => r.id === id)) throw AppError.badRequest('A line is not waiting on this GRN');
    }
    for (const row of pending) {
      if (date < row.date) throw AppError.badRequest('The confirm date cannot be before the Stock In date');
      const line = given.get(row.id);
      const received = new Decimal(line?.receivedQty ?? row.qty);
      if (received.isNegative() || received.gt(row.qty)) {
        throw AppError.unprocessable('Received quantity must be between 0 and the entered quantity');
      }
      const pieces = (await em.query(
        `SELECT id, serial FROM inventory_items
          WHERE source_type = 'stock_in' AND source_id = $1 AND status = 'quarantined' AND deleted_at IS NULL`,
        [row.id],
      )) as { id: string; serial: string }[];
      const ref = { type: 'stock_in', id: row.id, label: grnNo };
      if (pieces.length > 0) {
        const missing = new Set(normalizeSerials(line?.missingSerials ?? []));
        const short = new Decimal(row.qty).minus(received);
        if (!short.equals(missing.size)) {
          throw AppError.unprocessable(
            `Scan the ${short.toString()} missing label(s) of ${grnNo} (${missing.size} scanned)`,
          );
        }
        const unknown = [...missing].filter((s) => !pieces.some((p) => p.serial === s));
        if (unknown.length)
          throw AppError.unprocessable(`${unknown.join(', ')} is not a label of this entry`);
        const lost = pieces.filter((p) => missing.has(p.serial)).map((p) => p.id);
        const arrived = pieces.filter((p) => !missing.has(p.serial)).map((p) => p.id);
        if (arrived.length) {
          await em.query(
            `UPDATE inventory_items SET status = 'in_stock', updated_by = $2, updated_at = now() WHERE id = ANY($1)`,
            [arrived, actor.userId],
          );
        }
        await inventoryItemsService.setStatus(em, actor, {
          ids: lost,
          to: 'written_off',
          event: 'written_off',
          ref,
          note: line?.note ?? 'Did not arrive at the store',
        });
      }
      if (received.gt(0)) {
        await stockLedger.apply(
          em,
          { branchId, referenceType: 'stock_in', referenceId: row.id, actorId: actor.userId },
          [
            {
              productId: row.productId,
              type: 'stock_in',
              qty: received,
              date,
              note: [`${grnNo} confirmed`, row.note].filter(Boolean).join(' · '),
              batchId: row.batchId,
              unitCost: row.unitCost,
            },
          ],
        );
      }
      await repo(StockIn, em).update(
        { id: row.id },
        {
          receiptStatus: 'confirmed',
          receivedQty: toQuantity(received),
          receiptNote: line?.note ?? input.note ?? null,
          confirmedBy: actor.userId,
          confirmedAt: new Date(),
          updatedBy: actor.userId,
        },
      );
    }
    await auditService.record(
      {
        actor,
        branchId,
        action: 'confirm_receipt',
        entity: 'stock_in',
        entityId: pending[0]!.id,
        after: {
          grnNo,
          lines: pending.map((r) => ({
            productId: r.productId,
            qty: r.qty,
            received: given.get(r.id)?.receivedQty ?? r.qty,
          })),
        },
      },
      em,
    );
  });
  return (await list(branchId, undefined, grnNo))[0] ?? null;
}

export async function pendingReceipts(branchId: string | null) {
  const [row] = (await AppDataSource.query(
    `SELECT COUNT(DISTINCT grn_no)::int AS n FROM stock_ins
      WHERE receipt_status = 'pending' AND deleted_at IS NULL${branchId ? ' AND branch_id = $1' : ''}`,
    branchId ? [branchId] : [],
  )) as { n: number }[];
  return row?.n ?? 0;
}

export const storeReceiptsRouter = Router();

storeReceiptsRouter.get(
  '/branch/stock-receipts',
  authenticate,
  branchScope(),
  requirePermission('stock.view'),
  validate({ query: listQuerySchema }),
  async (req, res) => {
    const query = validQuery(req, listQuerySchema);
    sendOk(res, await list(branchIdOf(req), query.status, query.grnNo?.toUpperCase()));
  },
);

storeReceiptsRouter.post(
  '/branch/stock-receipts/:grnNo/confirm',
  authenticate,
  branchScope(),
  validate({ params: grnParamsSchema, body: confirmSchema }),
  async (req, res) => {
    sendOk(
      res,
      await confirm(
        actorFrom(req),
        branchIdOf(req),
        validParams(req, grnParamsSchema).grnNo,
        validBody(req, confirmSchema),
      ),
    );
  },
);
