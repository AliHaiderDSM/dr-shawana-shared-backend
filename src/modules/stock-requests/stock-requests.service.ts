import Decimal from 'decimal.js';
import { type EntityManager } from 'typeorm';
import { AppDataSource } from '../../database/data-source';
import { repo, withTransaction } from '../../database/transaction';
import { toQuantity } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { escapeLike } from '../../lib/pagination';
import { today } from '../../lib/validation';
import { auditService } from '../audit/audit.service';
import { transfersService } from '../inventory/transfers.service';
import { StockOut } from '../inventory/stock-out.entity';
import { nextSequence } from '../sequences/sequences';
import { StockRequest, StockRequestItem, type StockRequestStatus } from './stock-request.entity';
import {
  type CreateStockRequestInput,
  type DecideStockRequestInput,
  type IncomingStockQuery,
  type StockRequestListQuery,
} from './stock-requests.schemas';

async function warehouseId(manager: EntityManager) {
  const [row] = (await manager.query(
    `SELECT id FROM branches WHERE kind::text = 'warehouse' AND deleted_at IS NULL LIMIT 1`,
  )) as { id: string }[];
  if (!row) throw AppError.conflict('There is no Super Admin stock to ask from');
  return row.id;
}

const SELLABLE = `COALESCE((SELECT SUM(m.qty) FROM stock_movements m LEFT JOIN product_batches b ON b.id = m.batch_id
                    WHERE m.product_id = p.id AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)), 0)`;

const person = (alias: string) =>
  `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE json_build_object('id', ${alias}.id,
     'name', TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), 'role', ${alias}.role) END`;

const SELECT = `
  SELECT r.id, r.request_no AS "requestNo", r.status, r.note, r.decision_note AS "decisionNote",
         r.decided_at AS "decidedAt", r.sent_at AS "sentAt", r.received_at AS "receivedAt", r.created_at AS "createdAt",
         json_build_object('id', b.id, 'name', b.name, 'code', b.code, 'kind', b.kind) AS branch,
         ${person('rq')} AS "requestedBy", ${person('dc')} AS "decidedBy", ${person('rc')} AS "receivedBy",
         COALESCE((SELECT json_agg(json_build_object(
                    'id', it.id, 'productId', it.product_id, 'productName', p.name, 'unit', p.unit,
                    'qty', it.qty::text, 'approvedQty', it.approved_qty::text, 'note', it.note,
                    'available', ${SELLABLE}::text,
                    'sentQty', COALESCE((SELECT SUM(o.qty) FROM stock_outs o WHERE o.stock_request_id = r.id
                                AND o.product_id = it.product_id AND o.deleted_at IS NULL), 0)::text,
                    'receivedQty', COALESCE((SELECT SUM(o.qty) FROM stock_outs o WHERE o.stock_request_id = r.id
                                AND o.product_id = it.product_id AND o.deleted_at IS NULL AND o.received_at IS NOT NULL), 0)::text
                  ) ORDER BY p.name)
                    FROM stock_request_items it JOIN products p ON p.id = it.product_id
                   WHERE it.request_id = r.id), '[]') AS items,
         COALESCE((SELECT array_agg(DISTINCT o.transfer_no) FROM stock_outs o
                    WHERE o.stock_request_id = r.id AND o.deleted_at IS NULL AND o.transfer_no IS NOT NULL), '{}') AS "transferNos"
    FROM stock_requests r
    JOIN branches b ON b.id = r.branch_id
    LEFT JOIN staff_profiles rq ON rq.id = r.created_by
    LEFT JOIN staff_profiles dc ON dc.id = r.decided_by
    LEFT JOIN staff_profiles rc ON rc.id = r.received_by
   WHERE r.deleted_at IS NULL`;

interface ItemRow {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  qty: string;
  approvedQty: string | null;
  note: string | null;
  available: string;
  sentQty: string;
  receivedQty: string;
}

function toDto(row: Record<string, unknown> & { items: ItemRow[] }) {
  return {
    ...row,
    items: row.items.map((i) => ({
      ...i,
      qty: toQuantity(i.qty),
      approvedQty: i.approvedQty === null ? null : toQuantity(i.approvedQty),
      available: toQuantity(i.available),
      sentQty: toQuantity(i.sentQty),
      receivedQty: toQuantity(i.receivedQty),
    })),
  };
}

async function findOne(id: string, branchId: string | null, manager?: EntityManager) {
  const params: unknown[] = [id];
  let where = ' AND r.id = $1';
  if (branchId) {
    params.push(branchId);
    where += ' AND r.branch_id = $2';
  }
  const [row] = (await (manager ?? AppDataSource.manager).query(`${SELECT}${where}`, params)) as (Record<
    string,
    unknown
  > & { items: ItemRow[] })[];
  if (!row) throw AppError.notFound('Stock request');
  return toDto(row);
}

async function lock(manager: EntityManager, id: string) {
  const request = await repo(StockRequest, manager)
    .createQueryBuilder('r')
    .setLock('pessimistic_write')
    .where('r.id = :id AND r.deletedAt IS NULL', { id })
    .getOne();
  if (!request) throw AppError.notFound('Stock request');
  return request;
}

async function record(
  manager: EntityManager,
  actor: Actor,
  request: StockRequest,
  action: string,
  before: object | null,
) {
  await auditService.record(
    {
      actor,
      branchId: request.branchId,
      action,
      entity: 'stock_request',
      entityId: request.id,
      before,
      after: { requestNo: request.requestNo, status: request.status },
    },
    manager,
  );
}

export const stockRequestsService = {
  async catalog(search?: string) {
    const manager = AppDataSource.manager;
    const source = await warehouseId(manager);
    const params: unknown[] = [source];
    let filter = '';
    if (search) {
      params.push(`%${escapeLike(search)}%`);
      filter = ` AND (p.name ILIKE $2 OR p.sku ILIKE $2 OR p.barcode ILIKE $2 OR p.batch_no ILIKE $2)`;
    }
    const rows = (await manager.query(
      `SELECT p.id, p.name, p.unit, p.batch_no AS "batchNo", c.name AS "categoryName", ${SELLABLE}::text AS available
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.branch_id = $1 AND p.deleted_at IS NULL AND p.status = 'active'${filter}
        ORDER BY p.name LIMIT 300`,
      params,
    )) as { available: string }[];
    return rows.map((r) => ({ ...r, available: toQuantity(r.available) }));
  },

  async list(branchId: string | null, query: StockRequestListQuery) {
    const params: unknown[] = [];
    let where = '';
    if (branchId) {
      params.push(branchId);
      where += ` AND r.branch_id = $${params.length}`;
    }
    if (query.status) {
      params.push(query.status);
      where += ` AND r.status = $${params.length}`;
    }
    const rows = (await AppDataSource.query(
      `${SELECT}${where} ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 300`,
      params,
    )) as (Record<string, unknown> & { items: ItemRow[] })[];
    return rows.map(toDto);
  },

  async pendingCount() {
    const [row] = (await AppDataSource.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'approved')::int AS "toSend"
         FROM stock_requests WHERE deleted_at IS NULL`,
    )) as { pending: number; toSend: number }[];
    return { pending: row?.pending ?? 0, toSend: row?.toSend ?? 0 };
  },

  get: (branchId: string | null, id: string) => findOne(id, branchId),

  async create(actor: Actor, branchId: string, input: CreateStockRequestInput) {
    return withTransaction(async (em) => {
      const [branch] = (await em.query('SELECT code, kind FROM branches WHERE id = $1', [branchId])) as {
        code: string;
        kind: string;
      }[];
      if (!branch || (branch.kind !== 'branch' && branch.kind !== 'dispatch')) {
        throw AppError.conflict('Only a branch or the Dispatch Department asks the Super Admin for stock');
      }
      const source = await warehouseId(em);
      const ids = [...new Set(input.items.map((i) => i.productId))];
      if (ids.length !== input.items.length) throw AppError.badRequest('Each product can be asked once');
      const found = (await em.query(
        `SELECT id FROM products WHERE id = ANY($1::uuid[]) AND branch_id = $2 AND deleted_at IS NULL`,
        [ids, source],
      )) as { id: string }[];
      if (found.length !== ids.length) {
        throw AppError.badRequest('Ask only for products of the Super Admin stock');
      }
      const seq = await nextSequence(em, branchId, 'stock_request');
      const requests = repo(StockRequest, em);
      const saved = await requests.save(
        requests.create({
          branchId,
          requestNo: `${branch.code}-SR-${String(seq).padStart(6, '0')}`,
          status: 'pending',
          note: input.note ?? null,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        }),
      );
      const items = repo(StockRequestItem, em);
      await items.save(
        input.items.map((i) =>
          items.create({
            requestId: saved.id,
            productId: i.productId,
            qty: toQuantity(i.qty),
            approvedQty: null,
            note: i.note ?? null,
          }),
        ),
      );
      await record(em, actor, saved, 'create', null);
      return findOne(saved.id, branchId, em);
    });
  },

  async cancel(actor: Actor, branchId: string, id: string) {
    return withTransaction(async (em) => {
      const request = await lock(em, id);
      if (request.branchId !== branchId) throw AppError.notFound('Stock request');
      if (request.status !== 'pending') throw AppError.conflict(`This request is already ${request.status}`);
      request.status = 'cancelled';
      request.updatedBy = actor.userId;
      await repo(StockRequest, em).save(request);
      await record(em, actor, request, 'cancel', { status: 'pending' });
      return findOne(id, branchId, em);
    });
  },

  async decide(actor: Actor, id: string, approve: boolean, input: DecideStockRequestInput) {
    return withTransaction(async (em) => {
      const request = await lock(em, id);
      if (request.status !== 'pending') throw AppError.conflict(`This request is already ${request.status}`);
      const items = await repo(StockRequestItem, em).findBy({ requestId: id });
      if (approve) {
        const given = new Map((input.items ?? []).map((i) => [i.id, i.approvedQty]));
        for (const id of given.keys()) {
          if (!items.some((i) => i.id === id)) throw AppError.badRequest('An item is not on this request');
        }
        for (const item of items) {
          item.approvedQty = toQuantity(given.get(item.id) ?? item.qty);
        }
        if (items.every((i) => new Decimal(i.approvedQty ?? 0).isZero())) {
          throw AppError.badRequest('Approve at least one product, or reject the request');
        }
        await repo(StockRequestItem, em).save(items);
      }
      Object.assign(request, {
        status: approve ? 'approved' : 'rejected',
        decidedBy: actor.userId,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
        updatedBy: actor.userId,
      });
      await repo(StockRequest, em).save(request);
      await record(em, actor, request, approve ? 'approve' : 'reject', { status: 'pending' });
      return findOne(id, null, em);
    });
  },

  async assertSendable(manager: EntityManager, requestId: string, toBranchId: string) {
    const request = await lock(manager, requestId);
    if (request.branchId !== toBranchId) {
      throw AppError.badRequest(`${request.requestNo} was asked by another branch`);
    }
    if (request.status !== 'approved' && request.status !== 'sent') {
      throw AppError.conflict(`${request.requestNo} is ${request.status}. Approve it before sending stock.`);
    }
    return request;
  },

  async refresh(manager: EntityManager, actor: Actor, requestId: string | null) {
    if (!requestId) return;
    const [row] = (await manager.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE received_at IS NOT NULL)::int AS received,
              MAX(received_at) AS "receivedAt"
         FROM stock_outs WHERE stock_request_id = $1 AND deleted_at IS NULL`,
      [requestId],
    )) as { total: number; received: number; receivedAt: Date | null }[];
    const request = await repo(StockRequest, manager).findOneBy({ id: requestId });
    if (!request || request.status === 'cancelled' || request.status === 'rejected') return;
    const status: StockRequestStatus =
      !row || row.total === 0 ? 'approved' : row.received === row.total ? 'received' : 'sent';
    if (status === request.status) return;
    const before = { status: request.status };
    Object.assign(request, {
      status,
      sentAt: status === 'approved' ? null : (request.sentAt ?? new Date()),
      receivedAt: status === 'received' ? (row?.receivedAt ?? new Date()) : null,
      receivedBy: status === 'received' ? actor.userId : null,
      updatedBy: actor.userId,
    });
    await repo(StockRequest, manager).save(request);
    await record(manager, actor, request, status, before);
  },

  async incoming(branchId: string | null, query: IncomingStockQuery) {
    const params: unknown[] = [];
    const where = ['o.deleted_at IS NULL', 'o.to_branch_id IS NOT NULL', 'o.transfer_no IS NOT NULL'];
    if (branchId) {
      params.push(branchId);
      where.push(`o.to_branch_id = $${params.length}`);
    }
    const having =
      query.status === 'waiting'
        ? 'HAVING bool_or(o.received_at IS NULL)'
        : query.status === 'received'
          ? 'HAVING bool_and(o.received_at IS NOT NULL)'
          : '';
    const rows = (await AppDataSource.query(
      `SELECT o.transfer_no AS "transferNo", to_char(MIN(o.date), 'YYYY-MM-DD') AS date,
              MIN(o.created_at) AS "sentAt", bool_and(o.received_at IS NOT NULL) AS received,
              MAX(o.received_at) AS "receivedAt",
              (SELECT ${person('rc')} FROM staff_profiles rc WHERE rc.id = (array_agg(o.received_by))[1]) AS "receivedBy",
              (SELECT ${person('sd')} FROM staff_profiles sd WHERE sd.id = (array_agg(o.created_by))[1]) AS "sentBy",
              json_build_object('id', tb.id, 'name', tb.name, 'code', tb.code) AS "toBranch",
              (SELECT json_build_object('id', sr.id, 'requestNo', sr.request_no) FROM stock_requests sr
                WHERE sr.id = (array_agg(o.stock_request_id))[1]) AS request,
              MAX(o.note) AS note,
              json_agg(json_build_object('id', o.id, 'productId', o.product_id, 'productName', p.name, 'unit', p.unit,
                       'qty', o.qty::text, 'received', o.received_at IS NOT NULL,
                       'labels', (SELECT COUNT(*) FROM inventory_items i WHERE i.stock_out_id = o.id)::int)
                       ORDER BY p.name) AS items
         FROM stock_outs o
         JOIN products p ON p.id = o.product_id
         JOIN branches tb ON tb.id = o.to_branch_id
        WHERE ${where.join(' AND ')}
        GROUP BY o.transfer_no, tb.id
        ${having}
        ORDER BY bool_and(o.received_at IS NOT NULL) ASC, MIN(o.created_at) DESC
        LIMIT 300`,
      params,
    )) as (Record<string, unknown> & { transferNo: string; items: { qty: string }[] })[];
    return rows.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i, qty: toQuantity(i.qty) })) }));
  },

  async receive(actor: Actor, branchId: string, transferNo: string, date?: string) {
    await withTransaction(async (em) => {
      const outs = await repo(StockOut, em)
        .createQueryBuilder('o')
        .setLock('pessimistic_write')
        .where('o.transferNo = :transferNo AND o.toBranchId = :branchId AND o.deletedAt IS NULL', {
          transferNo,
          branchId,
        })
        .getMany();
      if (outs.length === 0) throw AppError.notFound('Transfer');
      const waiting = outs.filter((o) => !o.receivedAt);
      if (waiting.length === 0) throw AppError.conflict(`${transferNo} is already received`);
      const [toBranch] = (await em.query('SELECT id, name FROM branches WHERE id = $1', [branchId])) as {
        id: string;
        name: string;
      }[];
      const day = date ?? today();
      for (const out of waiting) {
        if (day < out.date) throw AppError.badRequest('The receiving date cannot be before the sending date');
        const pieces = (await em.query(
          `SELECT id, serial, product_id AS "productId", batch_id AS "batchId"
             FROM inventory_items WHERE stock_out_id = $1`,
          [out.id],
        )) as { id: string; serial: string; productId: string; batchId: string | null }[];
        await transfersService.receive(
          em,
          actor,
          Object.assign(new StockOut(), out, { date: day }),
          toBranch!,
          pieces,
        );
        await repo(StockOut, em).update({ id: out.id }, { receivedAt: new Date(), receivedBy: actor.userId });
      }
      await auditService.record(
        {
          actor,
          branchId,
          action: 'receive',
          entity: 'stock_transfer',
          entityId: waiting[0]!.id,
          after: { transferNo, items: waiting.map((o) => ({ productId: o.productId, qty: o.qty })) },
        },
        em,
      );
      for (const requestId of new Set(outs.map((o) => o.stockRequestId))) {
        await this.refresh(em, actor, requestId);
      }
    });
    const all = await this.incoming(branchId, {});
    return all.find((t) => t.transferNo === transferNo) ?? null;
  },
};
