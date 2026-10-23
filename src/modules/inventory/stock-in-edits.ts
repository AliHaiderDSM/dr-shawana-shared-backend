import Decimal from 'decimal.js';
import { Router } from 'express';
import { type EntityManager } from 'typeorm';
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
import { dateInput, moneyInput, optionalText, positiveQuantityInput } from '../../lib/validation';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import { auditService } from '../audit/audit.service';
import { createStockInSchema } from './stock-documents.schemas';
import { stockInService } from './stock-documents.routes';
import { StockIn } from './stock-in.entity';
import { storeReceiptsService } from './store-receipts';

const addItems = (createStockInSchema as unknown as z.ZodObject<{ items: z.ZodType }>).shape.items;

const lineChange = z.object({
  id: z.uuid(),
  qty: positiveQuantityInput.optional(),
  batch: z.string().trim().max(100).nullable().optional(),
  manufacturingDate: dateInput.nullable().optional(),
  expiryDate: dateInput.nullable().optional(),
  unitCost: moneyInput.nullable().optional(),
});

export const editGrnSchema = registry.register(
  'EditStoreReceipt',
  z
    .object({
      note: optionalText(500),
      update: z.array(lineChange).max(50).default([]),
      add: addItems.optional(),
      remove: z.array(z.uuid()).max(50).default([]),
    })
    .refine((v) => v.update.length + v.remove.length + ((v.add as unknown[] | undefined)?.length ?? 0) > 0, {
      message: 'Change, add or remove at least one line',
    }),
);

type EditGrnInput = z.output<typeof editGrnSchema>;
type Changes = Omit<EditGrnInput, 'note'>;
type AddItem = Record<string, unknown> & { productId: string; qty: unknown };

const grnParamsSchema = z.object({ grnNo: z.string().trim().min(3).max(30) });
const requestParamsSchema = z.object({ id: z.uuid() });
const decideSchema = z.object({ note: optionalText(500) });
const requestListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  branchId: z.uuid().optional(),
});

class DryRun extends Error {}

const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null);

async function grnLines(em: EntityManager, branchId: string, grnNo: string) {
  const rows = await repo(StockIn, em)
    .createQueryBuilder('si')
    .setLock('pessimistic_write')
    .where('si.grnNo = :grnNo AND si.branchId = :branchId AND si.deletedAt IS NULL', { grnNo, branchId })
    .getMany();
  if (rows.length === 0) throw AppError.notFound('GRN');
  return rows;
}

async function snapshot(em: EntityManager, rows: StockIn[]) {
  const names = (await em.query(`SELECT id, name FROM products WHERE id = ANY($1::uuid[])`, [
    rows.map((r) => r.productId),
  ])) as { id: string; name: string }[];
  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    productName: names.find((n) => n.id === r.productId)?.name ?? 'Product',
    qty: toQuantity(r.qty).toFixed(3),
    batch: r.batch,
    manufacturingDate: r.manufacturingDate,
    expiryDate: r.expiryDate,
    unitCost: r.unitCost === null ? null : new Decimal(r.unitCost).toFixed(2),
  }));
}

async function labelCount(em: EntityManager, id: string) {
  const [row] = (await em.query(
    `SELECT COUNT(*)::int AS n FROM inventory_items WHERE source_type = 'stock_in' AND source_id = $1 AND deleted_at IS NULL`,
    [id],
  )) as { n: number }[];
  return row?.n ?? 0;
}

async function apply(em: EntityManager, actor: Actor, branchId: string, grnNo: string, changes: Changes) {
  const rows = await grnLines(em, branchId, grnNo);
  const status = rows.every((r) => r.receiptStatus === 'confirmed') ? 'confirmed' : 'pending';
  const first = rows[0]!;
  const ids = new Set(rows.map((r) => r.id));
  for (const id of [...changes.remove, ...changes.update.map((u) => u.id)]) {
    if (!ids.has(id)) throw AppError.badRequest('A line is not on this GRN');
  }
  if (changes.update.some((u) => changes.remove.includes(u.id))) {
    throw AppError.badRequest('A line cannot be changed and removed together');
  }
  const adds = (changes.add ?? []) as AddItem[];
  if (changes.remove.length === rows.length && adds.length === 0) {
    throw AppError.badRequest('A GRN needs at least one line. Add a line or delete the GRN instead.');
  }
  const create = (items: AddItem[]) =>
    stockInService.create(
      actor,
      branchId,
      { supplierId: first.supplierId, date: first.date, note: first.note, items } as never,
      [],
      { grnNo, receipt: status, manager: em },
    );
  for (const id of changes.remove) await stockInService.remove(actor, branchId, id, em);
  for (const change of changes.update) {
    const row = rows.find((r) => r.id === change.id)!;
    const short = row.receivedQty !== null && !new Decimal(row.receivedQty).equals(row.qty);
    const stockChange =
      short ||
      (change.qty !== undefined && !new Decimal(change.qty).equals(row.qty)) ||
      (change.batch !== undefined && !sameText(change.batch, row.batch));
    if (!stockChange) {
      const { id, qty: _qty, batch: _batch, ...fields } = change;
      if (Object.keys(fields).length > 0)
        await stockInService.update(actor, branchId, id, fields as never, em);
      continue;
    }
    const labelled = (await labelCount(em, row.id)) > 0;
    await stockInService.remove(actor, branchId, row.id, em);
    await create([
      {
        productId: row.productId,
        qty: change.qty ?? (short ? row.receivedQty : row.qty),
        batch: change.batch !== undefined ? change.batch : row.batch,
        manufacturingDate:
          change.manufacturingDate !== undefined ? change.manufacturingDate : row.manufacturingDate,
        expiryDate: change.expiryDate !== undefined ? change.expiryDate : row.expiryDate,
        unitCost: change.unitCost !== undefined ? change.unitCost : row.unitCost,
        labels: labelled ? 'generate' : 'none',
      },
    ]);
  }
  if (adds.length) await create(adds);
}

const receipt = (branchId: string, grnNo: string) => storeReceiptsService.one(branchId, grnNo);

async function edit(actor: Actor, branchId: string, grnNo: string, input: EditGrnInput) {
  if (actor.role !== 'lab_officer' && !actor.isSuperAdmin) {
    throw AppError.forbidden('Only the Lab Officer or the Super Admin edits a GRN');
  }
  const { note, ...changes } = input;
  const current = await withTransaction(async (em) => grnLines(em, branchId, grnNo));
  const confirmed = current.every((r) => r.receiptStatus === 'confirmed');
  if (!confirmed || actor.isSuperAdmin) {
    await withTransaction(async (em) => {
      const before = await snapshot(em, await grnLines(em, branchId, grnNo));
      await apply(em, actor, branchId, grnNo, changes);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'edit_grn',
          entity: 'stock_in',
          entityId: current[0]!.id,
          before: { grnNo, lines: before },
          after: { grnNo, changes, note: note ?? null },
        },
        em,
      );
    });
    return { applied: true, request: null, receipt: await receipt(branchId, grnNo) };
  }
  const [open] = (await AppDataSource.query(
    `SELECT id FROM stock_in_edit_requests WHERE branch_id = $1 AND grn_no = $2 AND status = 'pending'`,
    [branchId, grnNo],
  )) as { id: string }[];
  if (open) throw AppError.conflict(`${grnNo} already has an edit waiting for the Super Admin`);
  try {
    await withTransaction(async (em) => {
      await apply(em, actor, branchId, grnNo, changes);
      throw new DryRun();
    });
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
  }
  const id = await withTransaction(async (em) => {
    const before = await snapshot(em, await grnLines(em, branchId, grnNo));
    const [row] = (await em.query(
      `INSERT INTO stock_in_edit_requests (branch_id, grn_no, changes, before, note, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [branchId, grnNo, JSON.stringify(changes), JSON.stringify(before), note ?? null, actor.userId],
    )) as { id: string }[];
    await auditService.record(
      {
        actor,
        branchId,
        action: 'request_grn_edit',
        entity: 'stock_in',
        entityId: current[0]!.id,
        after: { grnNo, changes, note: note ?? null },
      },
      em,
    );
    return row!.id;
  });
  return { applied: false, request: (await requests(branchId, undefined, id))[0] ?? null, receipt: null };
}

const PERSON = (alias: string) =>
  `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE json_build_object('id', ${alias}.id,
     'name', TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), 'role', ${alias}.role) END`;

async function requests(branchId: string | null, status?: string, id?: string) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (branchId) {
    params.push(branchId);
    where.push(`r.branch_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`r.status = $${params.length}`);
  }
  if (id) {
    params.push(id);
    where.push(`r.id = $${params.length}`);
  }
  const rows = (await AppDataSource.query(
    `SELECT r.id, r.grn_no AS "grnNo", r.status, r.changes, r.before, r.note,
            r.decision_note AS "decisionNote", r.created_at AS "createdAt", r.decided_at AS "decidedAt",
            b.name AS "branchName", ${PERSON('q')} AS "requestedBy", ${PERSON('d')} AS "decidedBy"
       FROM stock_in_edit_requests r
       JOIN branches b ON b.id = r.branch_id
       LEFT JOIN staff_profiles q ON q.id = r.requested_by
       LEFT JOIN staff_profiles d ON d.id = r.decided_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (r.status = 'pending') DESC, r.created_at DESC
      LIMIT 200`,
    params,
  )) as (Record<string, unknown> & { changes: Changes })[];
  const productIds = [
    ...new Set(rows.flatMap((r) => ((r.changes.add ?? []) as AddItem[]).map((a) => a.productId))),
  ];
  const names = productIds.length
    ? ((await AppDataSource.query(`SELECT id, name FROM products WHERE id = ANY($1::uuid[])`, [
        productIds,
      ])) as {
        id: string;
        name: string;
      }[])
    : [];
  return rows.map((r) => ({
    ...r,
    changes: {
      ...r.changes,
      add: ((r.changes.add ?? []) as AddItem[]).map((a) => ({
        ...a,
        productName: names.find((n) => n.id === a.productId)?.name ?? 'Product',
      })),
    },
  }));
}

async function decide(actor: Actor, id: string, approve: boolean, note: string | null | undefined) {
  if (!actor.isSuperAdmin) throw AppError.forbidden('Only the Super Admin approves a GRN edit');
  const result = await withTransaction(async (em) => {
    const [request] = (await em.query(
      `SELECT id, branch_id AS "branchId", grn_no AS "grnNo", status, changes FROM stock_in_edit_requests
        WHERE id = $1 FOR UPDATE`,
      [id],
    )) as { id: string; branchId: string; grnNo: string; status: string; changes: Changes }[];
    if (!request) throw AppError.notFound('Edit request');
    if (request.status !== 'pending') throw AppError.conflict(`This edit is already ${request.status}`);
    if (approve) await apply(em, actor, request.branchId, request.grnNo, request.changes);
    await em.query(
      `UPDATE stock_in_edit_requests
          SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, updated_at = now()
        WHERE id = $1`,
      [id, approve ? 'approved' : 'rejected', actor.userId, note ?? null],
    );
    await auditService.record(
      {
        actor,
        branchId: request.branchId,
        action: approve ? 'approve_grn_edit' : 'reject_grn_edit',
        entity: 'stock_in',
        entityId: id,
        after: { grnNo: request.grnNo, note: note ?? null },
      },
      em,
    );
    return request;
  });
  return (await requests(result.branchId, undefined, id))[0] ?? null;
}

export async function pendingGrnEdits() {
  const [row] = (await AppDataSource.query(
    `SELECT COUNT(*)::int AS n FROM stock_in_edit_requests WHERE status = 'pending'`,
  )) as { n: number }[];
  return row?.n ?? 0;
}

export const stockInEditsRouter = Router();

stockInEditsRouter.get(
  '/branch/stock-receipts/edit-requests',
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  validate({ query: requestListQuerySchema }),
  async (req, res) => {
    const auth = req.auth!;
    if (!auth.isSuperAdmin && auth.role !== 'lab_officer' && auth.role !== 'warehouse_keeper') {
      throw AppError.forbidden('GRN edits are for the store team and the Super Admin');
    }
    sendOk(res, await requests(req.branchId ?? null, validQuery(req, requestListQuerySchema).status));
  },
);

stockInEditsRouter.put(
  '/branch/stock-receipts/:grnNo/lines',
  authenticate,
  branchScope(),
  validate({ params: grnParamsSchema, body: editGrnSchema }),
  async (req, res) => {
    sendOk(
      res,
      await edit(
        actorFrom(req),
        branchIdOf(req),
        validParams(req, grnParamsSchema).grnNo.toUpperCase(),
        validBody(req, editGrnSchema),
      ),
    );
  },
);

for (const action of ['approve', 'reject'] as const) {
  stockInEditsRouter.post(
    `/admin/stock-receipts/edit-requests/:id/${action}`,
    authenticate,
    validate({ params: requestParamsSchema, body: decideSchema }),
    async (req, res) => {
      sendOk(
        res,
        await decide(
          actorFrom(req),
          validParams(req, requestParamsSchema).id,
          action === 'approve',
          validBody(req, decideSchema).note,
        ),
      );
    },
  );
}

const docs = securedDocs('Store receipts');
registry.registerPath({
  ...docs,
  method: 'put',
  path: '/branch/stock-receipts/{grnNo}/lines',
  summary:
    'Lab Officer or Super Admin edits a GRN: change, add or remove lines. While the GRN waits for the Warehouse Keeper it changes at once; once confirmed, a Lab Officer edit waits for the Super Admin (applied: false).',
  request: {
    params: grnParamsSchema,
    query: branchQuerySchema,
    body: { content: { 'application/json': { schema: editGrnSchema } } },
  },
  responses: {
    200: { description: 'Edited or sent for approval', ...jsonContent(dataEnvelope(z.unknown())) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/stock-receipts/edit-requests',
  summary: 'GRN edits waiting for or decided by the Super Admin, with the lines before the edit',
  request: { query: requestListQuerySchema },
  responses: {
    200: { description: 'Edit requests', ...jsonContent(dataEnvelope(z.array(z.unknown()))) },
    ...errorResponses,
  },
});
for (const action of ['approve', 'reject'] as const) {
  registry.registerPath({
    ...docs,
    method: 'post',
    path: `/admin/stock-receipts/edit-requests/{id}/${action}`,
    summary:
      action === 'approve'
        ? 'Super Admin approves a GRN edit; the stock changes now'
        : 'Super Admin rejects a GRN edit; nothing changes',
    request: {
      params: requestParamsSchema,
      body: { content: { 'application/json': { schema: decideSchema } } },
    },
    responses: {
      200: {
        description: action === 'approve' ? 'Approved' : 'Rejected',
        ...jsonContent(dataEnvelope(z.unknown())),
      },
      ...errorResponses,
    },
  });
}
