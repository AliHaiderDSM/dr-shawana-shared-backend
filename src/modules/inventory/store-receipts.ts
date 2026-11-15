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
import { RECEIVE_ISSUE_REASONS } from '../stock-holds/stock-holds.schemas';
import { createHold } from '../stock-holds/stock-holds.service';
import { normalizeSerials } from './inventory-items.service';
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
        }),
      )
      .max(200)
      .optional()
      .openapi({
        description:
          'Unlabelled lines that did not arrive in full. Lines left out arrived in full. Labelled lines use issues.',
      }),
    issues: z
      .array(
        z.object({
          serial: z.string().trim().min(1).max(30),
          reason: z.enum(RECEIVE_ISSUE_REASONS),
          note: z.string().trim().max(500).nullish(),
        }),
      )
      .max(500)
      .default([])
      .openapi({
        description:
          'Labels that did not arrive (missing) or arrived broken (damaged). They go under observation for the Super Admin.',
      }),
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
    pendingEdit: z.object({ id: z.uuid(), createdAt: z.string() }).nullable(),
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
        manufacturingDate: z.string().nullable(),
        unitCost: z.string().nullable(),
        labels: z.number().int(),
        serials: z.array(z.string()),
        issues: z.array(
          z.object({ serial: z.string(), reason: z.string(), status: z.string(), holdNo: z.string() }),
        ),
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
    'Warehouse Keeper confirms what arrived. Labelled pieces that are missing or damaged go under observation for the Super Admin; an unlabelled short line keeps the received quantity and a note.',
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
            (SELECT json_build_object('id', r.id, 'createdAt', r.created_at) FROM stock_in_edit_requests r
              WHERE r.branch_id = $1 AND r.grn_no = si.grn_no AND r.status = 'pending' LIMIT 1) AS "pendingEdit",
            (SELECT ${PERSON('u')} FROM staff_profiles u WHERE u.id = (array_agg(si.created_by))[1]) AS "enteredBy",
            (SELECT ${PERSON('c')} FROM staff_profiles c
              WHERE c.id = (array_agg(si.confirmed_by) FILTER (WHERE si.confirmed_by IS NOT NULL))[1]) AS "confirmedBy",
            MAX(si.confirmed_at) AS "confirmedAt",
            json_agg(json_build_object(
              'id', si.id, 'productId', si.product_id, 'productName', p.name, 'unit', p.unit,
              'qty', si.qty::text, 'receivedQty', si.received_qty::text, 'batch', si.batch,
              'expiryDate', to_char(si.expiry_date, 'YYYY-MM-DD'), 'receiptNote', si.receipt_note,
              'manufacturingDate', to_char(si.manufacturing_date, 'YYYY-MM-DD'), 'unitCost', si.unit_cost::text,
              'labels', (SELECT COUNT(*) FROM inventory_items i WHERE i.source_type = 'stock_in' AND i.source_id = si.id)::int,
              'serials', COALESCE((SELECT json_agg(i.serial ORDER BY i.serial) FROM inventory_items i
                                    WHERE i.source_type = 'stock_in' AND i.source_id = si.id AND i.deleted_at IS NULL), '[]'::json),
              'issues', COALESCE((SELECT json_agg(json_build_object('serial', i.serial, 'reason', h.reason,
                                           'status', h.status, 'holdNo', h.hold_no) ORDER BY i.serial)
                                    FROM stock_holds h JOIN inventory_items i ON i.id = h.item_id
                                   WHERE h.transfer_no = si.grn_no AND i.source_type = 'stock_in' AND i.source_id = si.id), '[]'::json)
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
    const issues = new Map(
      normalizeSerials(input.issues.map((i) => i.serial)).map((serial, index) => [
        serial,
        input.issues[index]!,
      ]),
    );
    const known = new Set<string>();
    for (const id of given.keys()) {
      if (!pending.some((r) => r.id === id)) throw AppError.badRequest('A line is not waiting on this GRN');
    }
    for (const row of pending) {
      if (date < row.date) throw AppError.badRequest('The confirm date cannot be before the Stock In date');
      const line = given.get(row.id);
      let received = new Decimal(line?.receivedQty ?? row.qty);
      if (received.isNegative() || received.gt(row.qty)) {
        throw AppError.unprocessable('Received quantity must be between 0 and the entered quantity');
      }
      const pieces = (await em.query(
        `SELECT id, serial FROM inventory_items
          WHERE source_type = 'stock_in' AND source_id = $1 AND status = 'quarantined' AND deleted_at IS NULL`,
        [row.id],
      )) as { id: string; serial: string }[];
      const held: { serial: string; reason: 'missing' | 'damaged'; note: string | null }[] = [];
      if (pieces.length > 0) {
        for (const p of pieces) {
          known.add(p.serial);
          const issue = issues.get(p.serial);
          if (issue) held.push({ serial: p.serial, reason: issue.reason, note: issue.note ?? null });
        }
        received = new Decimal(row.qty);
        await em.query(
          `UPDATE inventory_items SET status = 'in_stock', updated_by = $2, updated_at = now() WHERE id = ANY($1)`,
          [pieces.map((p) => p.id), actor.userId],
        );
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
      for (const issue of held) {
        await createHold(em, actor, {
          branchId,
          serial: issue.serial,
          from: ['in_stock'],
          reason: issue.reason,
          note: issue.note,
          transferNo: grnNo,
          source: grnNo,
        });
      }
      const missing = held.filter((h) => h.reason === 'missing').length;
      await repo(StockIn, em).update(
        { id: row.id },
        {
          receiptStatus: 'confirmed',
          receivedQty: toQuantity(received.minus(missing)),
          receiptNote: line?.note ?? input.note ?? null,
          confirmedBy: actor.userId,
          confirmedAt: new Date(),
          updatedBy: actor.userId,
        },
      );
    }
    const strangers = [...issues.keys()].filter((serial) => !known.has(serial));
    if (strangers.length) throw AppError.unprocessable(`Not on ${grnNo}: ${strangers.join(', ')}`);
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

export const storeReceiptsService = {
  one: async (branchId: string, grnNo: string) => (await list(branchId, undefined, grnNo))[0] ?? null,
};

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
