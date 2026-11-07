import { randomUUID } from 'node:crypto';
import { type EntityManager } from 'typeorm';
import { AppDataSource } from '../../database/data-source';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { escapeLike } from '../../lib/pagination';
import { type Role } from '../../lib/permissions';
import { today } from '../../lib/validation';
import { auditService } from '../audit/audit.service';
import { inventoryItemsService, normalizeSerials } from '../inventory/inventory-items.service';
import { writeOffHeldPieces } from '../inventory/product-batches.service';
import { stockLedger } from '../inventory/stock-ledger';
import { nextSequence } from '../sequences/sequences';
import {
  type DecideStockHoldInput,
  type ReportStockHoldInput,
  type StockHoldListQuery,
  type StockHoldReason,
  type StockHoldStatus,
} from './stock-holds.schemas';

const REFERENCE = 'stock_hold';

const REPORTERS: Record<string, readonly Role[]> = {
  warehouse: ['warehouse_keeper'],
  dispatch: ['branch_admin', 'store_keeper', 'dispatcher'],
};

const REASON_TEXT: Record<StockHoldReason, string> = {
  damaged: 'damaged',
  expired: 'expired',
  label_issue: 'label issue',
  other: 'other',
};

export interface HoldViewer {
  isSuperAdmin: boolean;
  role: Role;
  branchId: string | null;
}

async function branchKind(manager: EntityManager, branchId: string | null) {
  if (!branchId) return null;
  const [row] = (await manager.query('SELECT kind::text AS kind FROM branches WHERE id = $1', [
    branchId,
  ])) as {
    kind: string;
  }[];
  return row?.kind ?? null;
}

const person = (alias: string) =>
  `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE json_build_object('id', ${alias}.id,
     'name', TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), 'role', ${alias}.role) END`;

const SELECT = `
  SELECT h.id, h.hold_no AS "holdNo", h.status, h.reason, h.note, i.serial, i.status AS "itemStatus",
         json_build_object('id', p.id, 'name', p.name) AS product,
         b.batch_no AS "batchNo", to_char(b.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
         json_build_object('id', br.id, 'name', br.name, 'code', br.code, 'kind', br.kind) AS branch,
         CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object('id', s.id, 'invoiceNo', s.invoice_no) END AS sale,
         CASE WHEN r.id IS NULL THEN NULL ELSE json_build_object('id', r.id, 'requestNo', r.request_no,
           'branchName', rb.name) END AS "stockRequest",
         ${person('rp')} AS "reportedBy", ${person('dc')} AS "decidedBy",
         h.decided_at AS "decidedAt", h.decision_note AS "decisionNote", w.write_off_no AS "writeOffNo",
         h.created_at AS "createdAt"
    FROM stock_holds h
    JOIN inventory_items i ON i.id = h.item_id
    JOIN products p ON p.id = h.product_id
    JOIN branches br ON br.id = h.branch_id
    LEFT JOIN product_batches b ON b.id = h.batch_id
    LEFT JOIN sales s ON s.id = h.sale_id
    LEFT JOIN stock_requests r ON r.id = h.stock_request_id
    LEFT JOIN branches rb ON rb.id = r.branch_id
    LEFT JOIN staff_profiles rp ON rp.id = h.created_by
    LEFT JOIN staff_profiles dc ON dc.id = h.decided_by
    LEFT JOIN stock_write_offs w ON w.id = h.write_off_id`;

interface HoldRow {
  id: string;
  status: StockHoldStatus;
  branch: { id: string; kind: string };
  [key: string]: unknown;
}

function canDecide(viewer: HoldViewer, hold: { status: string; branch: { id: string; kind: string } }) {
  if (hold.status !== 'open' || viewer.isSuperAdmin) return false;
  if (viewer.role === 'warehouse_keeper') return true;
  return (
    viewer.role === 'branch_admin' && hold.branch.kind === 'dispatch' && hold.branch.id === viewer.branchId
  );
}

async function scopeOf(viewer: HoldViewer, manager: EntityManager = AppDataSource.manager) {
  if (viewer.isSuperAdmin) return { kind: 'all' as const };
  const kind = await branchKind(manager, viewer.branchId);
  if (kind === 'warehouse') return { kind: 'all' as const };
  if (kind === 'dispatch') return { kind: 'branch' as const, branchId: viewer.branchId as string };
  return { kind: 'requests' as const, branchId: viewer.branchId as string };
}

async function fetchOne(manager: EntityManager, id: string) {
  const [row] = (await manager.query(`${SELECT} WHERE h.id = $1`, [id])) as HoldRow[];
  if (!row) throw AppError.notFound('Piece under observation');
  return row;
}

async function sameProductOn(
  manager: EntityManager,
  table: 'sale_items' | 'stock_request_items',
  column: 'sale_id' | 'request_id',
  parentId: string,
  productId: string,
) {
  const [row] = (await manager.query(
    `SELECT 1 AS ok FROM ${table} x
       JOIN products xp ON xp.id = x.product_id
       JOIN products lp ON lp.id = $2
      WHERE x.${column} = $1 AND COALESCE(xp.origin_product_id, xp.id) = COALESCE(lp.origin_product_id, lp.id)
      LIMIT 1`,
    [parentId, productId],
  )) as { ok: number }[];
  return Boolean(row);
}

export const stockHoldsService = {
  async list(viewer: HoldViewer, query: StockHoldListQuery) {
    const scope = await scopeOf(viewer);
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (scope.kind === 'branch') add('h.branch_id = ?', scope.branchId);
    if (scope.kind === 'requests') add('r.branch_id = ?', scope.branchId);
    if (scope.kind === 'all' && viewer.isSuperAdmin && query.branchId) add('h.branch_id = ?', query.branchId);
    if (query.status) add('h.status = ?', query.status);
    if (query.saleId) add('h.sale_id = ?', query.saleId);
    if (query.stockRequestId) add('h.stock_request_id = ?', query.stockRequestId);
    if (query.search) {
      params.push(`%${escapeLike(query.search)}%`);
      const n = `$${params.length}`;
      where.push(
        `(i.serial ILIKE ${n} OR p.name ILIKE ${n} OR h.hold_no ILIKE ${n} OR s.invoice_no ILIKE ${n} OR r.request_no ILIKE ${n})`,
      );
    }
    const rows = (await AppDataSource.query(
      `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY (h.status = 'open') DESC, h.created_at DESC LIMIT 500`,
      params,
    )) as HoldRow[];
    return rows.map((r) => ({ ...r, canDecide: canDecide(viewer, r) }));
  },

  async openCount(viewer: HoldViewer) {
    const scope = await scopeOf(viewer);
    if (scope.kind === 'requests') return { open: 0 };
    const [row] = (await AppDataSource.query(
      `SELECT COUNT(*)::int AS n FROM stock_holds WHERE status = 'open' AND ($1::uuid IS NULL OR branch_id = $1)`,
      [scope.kind === 'branch' ? scope.branchId : null],
    )) as { n: number }[];
    return { open: row?.n ?? 0 };
  },

  async report(actor: Actor, branchId: string, input: ReportStockHoldInput) {
    return withTransaction(async (em) => {
      if (actor.isSuperAdmin) {
        throw AppError.forbidden('The Super Admin only sees the pieces under observation');
      }
      const kind = await branchKind(em, branchId);
      if (!kind || !REPORTERS[kind]?.includes(actor.role)) {
        throw AppError.forbidden(
          'Only the Warehouse Keeper and the Dispatch Department put pieces under observation',
        );
      }
      const [serial] = normalizeSerials([input.serial]);
      const [item] = (await em.query(
        `SELECT i.id, i.product_id AS "productId", i.batch_id AS "batchId", i.status, p.name
           FROM inventory_items i JOIN products p ON p.id = i.product_id
          WHERE i.serial = $1 AND i.branch_id = $2 AND i.deleted_at IS NULL`,
        [serial, branchId],
      )) as { id: string; productId: string; batchId: string | null; status: string; name: string }[];
      if (!item) throw AppError.unprocessable(`${serial} is not a label of this branch`);

      let saleLabel: string | null = null;
      if (input.saleId) {
        const [sale] = (await em.query(
          `SELECT invoice_no AS "invoiceNo" FROM sales
            WHERE id = $1 AND deleted_at IS NULL AND sale_type = 'online' AND delivery_status = 'pending'
              AND COALESCE(fulfillment_branch_id, branch_id) = $2`,
          [input.saleId, branchId],
        )) as { invoiceNo: string }[];
        if (!sale) throw AppError.unprocessable('This order is not waiting for dispatch here');
        if (!(await sameProductOn(em, 'sale_items', 'sale_id', input.saleId, item.productId))) {
          throw AppError.unprocessable(`${serial} is ${item.name}, which is not on this order`);
        }
        saleLabel = sale.invoiceNo;
      }
      let requestLabel: string | null = null;
      if (input.stockRequestId) {
        if (kind !== 'warehouse')
          throw AppError.forbidden('Stock requests are sent from the Super Admin stock');
        const [request] = (await em.query(
          `SELECT request_no AS "requestNo", status FROM stock_requests WHERE id = $1 AND deleted_at IS NULL`,
          [input.stockRequestId],
        )) as { requestNo: string; status: string }[];
        if (!request) throw AppError.notFound('Stock request');
        if (request.status !== 'approved' && request.status !== 'sent') {
          throw AppError.conflict(`${request.requestNo} is ${request.status}, not waiting to be sent`);
        }
        if (
          !(await sameProductOn(
            em,
            'stock_request_items',
            'request_id',
            input.stockRequestId,
            item.productId,
          ))
        ) {
          throw AppError.unprocessable(`${serial} is ${item.name}, which is not on this request`);
        }
        requestLabel = request.requestNo;
      }

      const id = randomUUID();
      const [branch] = (await em.query('SELECT code FROM branches WHERE id = $1', [branchId])) as {
        code: string;
      }[];
      const holdNo = `${branch?.code ?? 'UO'}-UO-${String(await nextSequence(em, branchId, 'stock_hold')).padStart(6, '0')}`;
      const source = saleLabel ?? requestLabel;
      await inventoryItemsService.take(em, actor, {
        branchId,
        serials: [serial!],
        from: ['in_stock'],
        to: 'quarantined',
        event: 'quarantined',
        ref: { type: REFERENCE, id, label: `${holdNo} under observation` },
        date: today(),
        note: [`${REASON_TEXT[input.reason]}${source ? ` on ${source}` : ''}`, input.note]
          .filter(Boolean)
          .join(': '),
      });
      await em.query(
        `INSERT INTO stock_holds (id, hold_no, branch_id, item_id, product_id, batch_id, reason, note, sale_id,
                                  stock_request_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
        [
          id,
          holdNo,
          branchId,
          item.id,
          item.productId,
          item.batchId,
          input.reason,
          input.note ?? null,
          input.saleId ?? null,
          input.stockRequestId ?? null,
          actor.userId,
        ],
      );
      await auditService.record(
        {
          actor,
          branchId,
          action: 'stock_hold',
          entity: 'stock_hold',
          entityId: id,
          after: { holdNo, serial, reason: input.reason, note: input.note ?? null, source },
        },
        em,
      );
      const row = await fetchOne(em, id);
      return { ...row, canDecide: canDecide(actor, row) };
    });
  },

  async decide(actor: Actor, id: string, input: DecideStockHoldInput) {
    return withTransaction(async (em) => {
      const [hold] = (await em.query(
        `SELECT h.id, h.hold_no AS "holdNo", h.branch_id AS "branchId", h.product_id AS "productId",
                h.batch_id AS "batchId", h.reason, h.status, i.serial, br.kind::text AS kind
           FROM stock_holds h
           JOIN inventory_items i ON i.id = h.item_id
           JOIN branches br ON br.id = h.branch_id
          WHERE h.id = $1
            FOR UPDATE OF h`,
        [id],
      )) as {
        id: string;
        holdNo: string;
        branchId: string;
        productId: string;
        batchId: string | null;
        reason: StockHoldReason;
        status: StockHoldStatus;
        serial: string;
        kind: string;
      }[];
      if (!hold) throw AppError.notFound('Piece under observation');
      if (!canDecide(actor, { status: 'open', branch: { id: hold.branchId, kind: hold.kind } })) {
        throw AppError.forbidden('Only the Warehouse Keeper and the Dispatch Department admin decide this');
      }
      if (hold.status !== 'open') throw AppError.conflict(`${hold.holdNo} is already decided`);

      const date = today();
      let status: StockHoldStatus;
      let writeOffId: string | null = null;
      if (input.decision === 'release') {
        await inventoryItemsService.take(em, actor, {
          branchId: hold.branchId,
          serials: [hold.serial],
          from: ['quarantined'],
          to: 'in_stock',
          event: 'restocked',
          ref: { type: REFERENCE, id: hold.id, label: `${hold.holdNo} released` },
          date,
          note: input.note,
        });
        status = 'released';
      } else if (input.decision === 'write_off') {
        const record = await writeOffHeldPieces(em, actor, {
          branchId: hold.branchId,
          productId: hold.productId,
          batchId: hold.batchId,
          serials: [hold.serial],
          reason:
            hold.reason === 'expired' ? 'expired' : hold.reason === 'damaged' ? 'damaged' : 'adjustment',
          note: `${hold.holdNo}: ${input.note}`,
        });
        writeOffId = record.id;
        status = 'written_off';
      } else {
        const pieces = await inventoryItemsService.take(em, actor, {
          branchId: hold.branchId,
          serials: [hold.serial],
          from: ['quarantined'],
          to: 'supplier_returned',
          event: 'supplier_returned',
          ref: { type: REFERENCE, id: hold.id, label: `${hold.holdNo} returned to the supplier` },
          date,
          note: input.note,
        });
        await stockLedger.apply(
          em,
          { branchId: hold.branchId, referenceType: REFERENCE, referenceId: hold.id, actorId: actor.userId },
          inventoryItemsService.movements(pieces, -1, {
            type: 'adjustment',
            date,
            note: `${hold.holdNo}: returned to the supplier: ${input.note}`,
          }),
        );
        status = 'supplier_returned';
      }
      await em.query(
        `UPDATE stock_holds SET status = $2, decision_note = $3, decided_by = $4, decided_at = now(),
                write_off_id = $5, updated_by = $4, updated_at = now()
          WHERE id = $1`,
        [hold.id, status, input.note, actor.userId, writeOffId],
      );
      await auditService.record(
        {
          actor,
          branchId: hold.branchId,
          action: `stock_hold:${input.decision}`,
          entity: 'stock_hold',
          entityId: hold.id,
          before: { status: 'open' },
          after: { holdNo: hold.holdNo, status, note: input.note },
        },
        em,
      );
      const row = await fetchOne(em, hold.id);
      return { ...row, canDecide: false };
    });
  },
};
