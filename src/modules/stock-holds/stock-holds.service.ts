import { randomUUID } from 'node:crypto';
import { type EntityManager } from 'typeorm';
import { AppDataSource } from '../../database/data-source';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { escapeLike } from '../../lib/pagination';
import { type Role } from '../../lib/permissions';
import { CLINIC_TIME_ZONE, today } from '../../lib/validation';
import { auditService } from '../audit/audit.service';
import { type ItemStatus } from '../inventory/inventory-item.entity';
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
  missing: 'missing',
};

const WRITE_OFF_REASON: Record<StockHoldReason, 'expired' | 'damaged' | 'lost' | 'adjustment'> = {
  damaged: 'damaged',
  expired: 'expired',
  label_issue: 'adjustment',
  other: 'adjustment',
  missing: 'lost',
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
         h.transfer_no AS "transferNo", h.created_at AS "createdAt"
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
  if (hold.status !== 'open') return false;
  if (viewer.isSuperAdmin || viewer.role === 'warehouse_keeper') return true;
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

const withActions = (viewer: HoldViewer, row: HoldRow) => {
  const decide = canDecide(viewer, row);
  return { ...row, canDecide: decide, canSendBack: decide && row.branch.kind !== 'warehouse' };
};

export async function createHold(
  manager: EntityManager,
  actor: Actor,
  input: {
    branchId: string;
    serial: string;
    from: ItemStatus[];
    reason: StockHoldReason;
    note?: string | null;
    saleId?: string | null;
    stockRequestId?: string | null;
    transferNo?: string | null;
    source?: string | null;
  },
) {
  const [item] = (await manager.query(
    `SELECT i.id, i.product_id AS "productId", i.batch_id AS "batchId"
       FROM inventory_items i WHERE i.serial = $1 AND i.branch_id = $2 AND i.deleted_at IS NULL`,
    [input.serial, input.branchId],
  )) as { id: string; productId: string; batchId: string | null }[];
  if (!item) throw AppError.unprocessable(`${input.serial} is not a label of this branch`);
  const id = randomUUID();
  const [branch] = (await manager.query('SELECT code FROM branches WHERE id = $1', [input.branchId])) as {
    code: string;
  }[];
  const holdNo = `${branch?.code ?? 'UO'}-UO-${String(await nextSequence(manager, input.branchId, 'stock_hold')).padStart(6, '0')}`;
  await inventoryItemsService.take(manager, actor, {
    branchId: input.branchId,
    serials: [input.serial],
    from: input.from,
    to: 'quarantined',
    event: 'quarantined',
    ref: { type: REFERENCE, id, label: `${holdNo} under observation` },
    date: today(),
    note: [`${REASON_TEXT[input.reason]}${input.source ? ` on ${input.source}` : ''}`, input.note]
      .filter(Boolean)
      .join(': '),
  });
  await manager.query(
    `INSERT INTO stock_holds (id, hold_no, branch_id, item_id, product_id, batch_id, reason, note, sale_id,
                              stock_request_id, transfer_no, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
    [
      id,
      holdNo,
      input.branchId,
      item.id,
      item.productId,
      item.batchId,
      input.reason,
      input.note ?? null,
      input.saleId ?? null,
      input.stockRequestId ?? null,
      input.transferNo ?? null,
      actor.userId,
    ],
  );
  await auditService.record(
    {
      actor,
      branchId: input.branchId,
      action: 'stock_hold',
      entity: 'stock_hold',
      entityId: id,
      after: {
        holdNo,
        serial: input.serial,
        reason: input.reason,
        note: input.note ?? null,
        source: input.source,
      },
    },
    manager,
  );
  return id;
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

async function sendBackToWarehouse(
  manager: EntityManager,
  actor: Actor,
  hold: {
    id: string;
    holdNo: string;
    branchId: string;
    productId: string;
    batchId: string | null;
    serial: string;
  },
  note: string,
) {
  const [warehouse] = (await manager.query(
    `SELECT id FROM branches WHERE kind = 'warehouse' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
  )) as { id: string }[];
  if (!warehouse) throw AppError.conflict('There is no Super Admin stock to send this back to');
  const [target] = (await manager.query(
    `SELECT wp.id AS "productId", wb.id AS "batchId"
       FROM products bp
       JOIN products wp ON wp.id = COALESCE(bp.origin_product_id, bp.id) AND wp.branch_id = $2
       LEFT JOIN product_batches bb ON bb.id = $3
       LEFT JOIN product_batches wb ON wb.product_id = wp.id AND wb.batch_no = bb.batch_no AND wb.deleted_at IS NULL
      WHERE bp.id = $1`,
    [hold.productId, warehouse.id, hold.batchId],
  )) as { productId: string; batchId: string | null }[];
  if (!target) throw AppError.conflict('This product is not in the Super Admin stock');
  const date = today();
  const pieces = await inventoryItemsService.take(manager, actor, {
    branchId: hold.branchId,
    serials: [hold.serial],
    from: ['quarantined'],
    to: 'dispatched',
    event: 'dispatched',
    ref: { type: REFERENCE, id: hold.id, label: `${hold.holdNo} sent back to the Super Admin stock` },
    date,
    note,
  });
  await stockLedger.apply(
    manager,
    { branchId: hold.branchId, referenceType: REFERENCE, referenceId: hold.id, actorId: actor.userId },
    inventoryItemsService.movements(pieces, -1, {
      type: 'stock_out',
      date,
      note: `${hold.holdNo}: sent back to the Super Admin stock: ${note}`,
    }),
  );
  await stockLedger.apply(
    manager,
    { branchId: warehouse.id, referenceType: REFERENCE, referenceId: hold.id, actorId: actor.userId },
    [
      {
        productId: target.productId,
        batchId: target.batchId,
        type: 'stock_in',
        qty: 1,
        date,
        note: `${hold.holdNo}: back from the branch: ${note}`,
      },
    ],
  );
  await manager.query(
    `UPDATE inventory_items SET branch_id = $2, product_id = $3, batch_id = $4, status = 'in_stock',
            updated_by = $5, updated_at = now()
      WHERE id = ANY($1)`,
    [pieces.map((p) => p.id), warehouse.id, target.productId, target.batchId, actor.userId],
  );
  await manager.query(
    `INSERT INTO inventory_item_events (item_id, branch_id, type, reference_type, reference_id, reference_label, created_by, created_at)
     SELECT id, branch_id, 'received', $2, $3, $4, $5, clock_timestamp() FROM inventory_items WHERE id = ANY($1)`,
    [
      pieces.map((p) => p.id),
      REFERENCE,
      hold.id,
      `${hold.holdNo} back in the Super Admin stock`,
      actor.userId,
    ],
  );
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
    if (query.reason) add('h.reason = ?', query.reason);
    if (query.productId) {
      add(
        'COALESCE(p.origin_product_id, p.id) = (SELECT COALESCE(x.origin_product_id, x.id) FROM products x WHERE x.id = ?)',
        query.productId,
      );
    }
    if (query.from) add(`(h.created_at AT TIME ZONE '${CLINIC_TIME_ZONE}')::date >= ?`, query.from);
    if (query.to) add(`(h.created_at AT TIME ZONE '${CLINIC_TIME_ZONE}')::date <= ?`, query.to);
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
    return rows.map((r) => withActions(viewer, r));
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
      const serials = normalizeSerials(input.serials);
      const items = (await em.query(
        `SELECT i.serial, i.product_id AS "productId", p.name
           FROM inventory_items i JOIN products p ON p.id = i.product_id
          WHERE i.serial = ANY($1) AND i.branch_id = $2 AND i.deleted_at IS NULL`,
        [serials, branchId],
      )) as { serial: string; productId: string; name: string }[];
      const unknown = serials.filter((serial) => !items.some((i) => i.serial === serial));
      if (unknown.length) throw AppError.unprocessable(`Not a label of this branch: ${unknown.join(', ')}`);

      let saleLabel: string | null = null;
      if (input.saleId) {
        const [sale] = (await em.query(
          `SELECT invoice_no AS "invoiceNo" FROM sales
            WHERE id = $1 AND deleted_at IS NULL AND sale_type = 'online' AND delivery_status = 'pending'
              AND COALESCE(fulfillment_branch_id, branch_id) = $2`,
          [input.saleId, branchId],
        )) as { invoiceNo: string }[];
        if (!sale) throw AppError.unprocessable('This order is not waiting for dispatch here');
        for (const item of items) {
          if (!(await sameProductOn(em, 'sale_items', 'sale_id', input.saleId, item.productId))) {
            throw AppError.unprocessable(`${item.serial} is ${item.name}, which is not on this order`);
          }
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
        for (const item of items) {
          if (
            !(await sameProductOn(
              em,
              'stock_request_items',
              'request_id',
              input.stockRequestId,
              item.productId,
            ))
          ) {
            throw AppError.unprocessable(`${item.serial} is ${item.name}, which is not on this request`);
          }
        }
        requestLabel = request.requestNo;
      }

      const ids: string[] = [];
      for (const serial of serials) {
        ids.push(
          await createHold(em, actor, {
            branchId,
            serial,
            from: ['in_stock'],
            reason: input.reason,
            note: input.note,
            saleId: input.saleId,
            stockRequestId: input.stockRequestId,
            source: saleLabel ?? requestLabel,
          }),
        );
      }
      const rows = [];
      for (const id of ids) rows.push(withActions(actor, await fetchOne(em, id)));
      return rows;
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
        throw AppError.forbidden(
          'Only the Super Admin, the Warehouse Keeper and the Dispatch Department admin decide this',
        );
      }
      if (hold.status !== 'open') throw AppError.conflict(`${hold.holdNo} is already decided`);
      if (input.decision === 'send_back' && hold.kind === 'warehouse') {
        throw AppError.badRequest('This piece is already in the Super Admin stock; release it instead');
      }

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
          reason: WRITE_OFF_REASON[hold.reason],
          note: `${hold.holdNo}: ${input.note}`,
        });
        writeOffId = record.id;
        status = 'written_off';
      } else if (input.decision === 'send_back') {
        await sendBackToWarehouse(em, actor, hold, input.note);
        status = 'sent_back';
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
      return withActions(actor, await fetchOne(em, hold.id));
    });
  },
};
