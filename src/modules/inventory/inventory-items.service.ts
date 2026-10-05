import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { type EntityManager } from 'typeorm';
import { AppDataSource } from '../../database/data-source';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { escapeLike, pageMeta } from '../../lib/pagination';
import { today } from '../../lib/validation';
import { auditService } from '../audit/audit.service';
import { type ItemEventType } from './inventory-item-event.entity';
import { type ItemSource, type ItemStatus } from './inventory-item.entity';
import { type InventoryItemListQuery, type RegisterLabelsInput } from './inventory-items.schemas';
import { type StockMovementInput } from './stock-ledger';
import { type StockMovementType } from './stock-movement.entity';

export const SERIAL_PREFIX = 'DSM-';
export const SERIAL_DIGITS = 6;
export const MAX_SERIALS_PER_LINE = 5000;
const SERIAL_PATTERN = /^DSM-(\d{1,12})$/;

export interface ItemReference {
  type: string;
  id: string;
  label?: string | null;
}

export interface TakenItem {
  id: string;
  serial: string;
  productId: string;
  batchId: string | null;
}

interface LockedItem extends TakenItem {
  branchId: string;
  status: ItemStatus;
  expiryDate: string | null;
  productName: string;
  saleId: string | null;
}

export interface SerialProblem {
  serial: string;
  problem: string;
}

export function formatSerial(n: Decimal.Value) {
  return `${SERIAL_PREFIX}${new Decimal(n).toFixed(0).padStart(SERIAL_DIGITS, '0')}`;
}

export function parseSerial(serial: string) {
  const match = SERIAL_PATTERN.exec(serial.trim().toUpperCase());
  return match ? new Decimal(match[1]!) : null;
}

export function normalizeSerials(serials: string[]) {
  const normalized = serials.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const seen = new Set<string>();
  const duplicates = normalized.filter((s) => (seen.has(s) ? true : (seen.add(s), false)));
  if (duplicates.length > 0) {
    throw AppError.badRequest(`The same label was scanned twice: ${[...new Set(duplicates)].join(', ')}`);
  }
  return normalized;
}

function wholeCount(qty: Decimal.Value, what: string) {
  const value = new Decimal(qty);
  if (!value.isInteger() || value.lte(0)) {
    throw AppError.badRequest(`${what}: labelled products are counted in whole pieces`);
  }
  if (value.gt(MAX_SERIALS_PER_LINE)) {
    throw AppError.badRequest(`${what}: at most ${MAX_SERIALS_PER_LINE} labels per line`);
  }
  return value.toNumber();
}

async function recordEvents(
  manager: EntityManager,
  actor: Actor,
  itemIds: string[],
  type: ItemEventType,
  ref: ItemReference | null,
  note?: string | null,
) {
  if (itemIds.length === 0) return;
  await manager.query(
    `INSERT INTO inventory_item_events (item_id, branch_id, type, reference_type, reference_id, reference_label, note, created_by, created_at)
     SELECT i.id, i.branch_id, $2, $3, $4, $5, $6, $7, clock_timestamp() FROM inventory_items i WHERE i.id = ANY($1)`,
    [itemIds, type, ref?.type ?? null, ref?.id ?? null, ref?.label ?? null, note ?? null, actor.userId],
  );
}

async function markTracked(manager: EntityManager, productId: string) {
  await manager.query('UPDATE products SET track_serials = true WHERE id = $1 AND NOT track_serials', [
    productId,
  ]);
}

async function lockBySerials(manager: EntityManager, serials: string[]) {
  if (serials.length === 0) return [];
  return (await manager.query(
    `SELECT i.id, i.serial, i.product_id AS "productId", i.batch_id AS "batchId", i.branch_id AS "branchId",
            i.status, i.sale_id AS "saleId", to_char(b.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
            p.name AS "productName"
       FROM inventory_items i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN product_batches b ON b.id = i.batch_id
      WHERE i.serial = ANY($1) AND i.deleted_at IS NULL
      ORDER BY i.serial
        FOR UPDATE OF i`,
    [serials],
  )) as LockedItem[];
}

function failOn(problems: SerialProblem[]) {
  if (problems.length > 0) {
    throw AppError.unprocessable(
      problems.length === 1
        ? `${problems[0]!.serial}: ${problems[0]!.problem}`
        : 'Some labels cannot be used',
      { serials: problems },
    );
  }
}

const STATUS_TEXT: Record<ItemStatus, string> = {
  in_stock: 'is in stock',
  sold: 'is already sold',
  returned: 'is waiting for return inspection',
  quarantined: 'is in quarantine',
  damaged: 'was written off as damaged',
  expired: 'was written off as expired',
  supplier_returned: 'was sent back to the supplier',
  dispatched: 'was already sent out',
  written_off: 'was written off',
};

export const inventoryItemsService = {
  async trackedProducts(manager: EntityManager, branchId: string, productIds: string[]) {
    if (productIds.length === 0) return new Set<string>();
    const rows: { id: string }[] = await manager.query(
      'SELECT id FROM products WHERE branch_id = $1 AND id = ANY($2) AND track_serials',
      [branchId, productIds],
    );
    return new Set(rows.map((r) => r.id));
  },

  async generate(
    manager: EntityManager,
    actor: Actor,
    input: {
      branchId: string;
      productId: string;
      batchId: string | null;
      qty: Decimal.Value;
      date: string;
      source: ItemSource;
      ref: ItemReference;
      event: ItemEventType;
    },
  ) {
    const count = wholeCount(input.qty, 'Labels');
    const rows: { id: string; serial: string }[] = await manager.query(
      `INSERT INTO inventory_items (branch_id, product_id, batch_id, serial_no, serial, status, source_type, source_id, received_on, created_by)
       SELECT $1, $2, $3, n, $4 || lpad(n::text, GREATEST($5, length(n::text)), '0'), 'in_stock', $6, $7, $8, $9
         FROM (SELECT nextval('inventory_item_serial_seq') AS n FROM generate_series(1, $10)) g
       RETURNING id, serial`,
      [
        input.branchId,
        input.productId,
        input.batchId,
        SERIAL_PREFIX,
        SERIAL_DIGITS,
        input.source,
        input.ref.id,
        input.date,
        actor.userId,
        count,
      ],
    );
    await recordEvents(
      manager,
      actor,
      rows.map((r) => r.id),
      input.event,
      input.ref,
    );
    await markTracked(manager, input.productId);
    return rows;
  },

  async register(
    manager: EntityManager,
    actor: Actor,
    input: {
      branchId: string;
      productId: string;
      batchId: string | null;
      firstSerial: string;
      qty: Decimal.Value;
      date: string;
      source: ItemSource;
      ref: ItemReference;
      event: ItemEventType;
    },
  ) {
    const count = wholeCount(input.qty, 'Labels');
    const first = parseSerial(input.firstSerial);
    if (!first || first.lte(0)) {
      throw AppError.badRequest(`"${input.firstSerial}" is not a label number like ${formatSerial(1)}`);
    }
    const last = first.plus(count - 1);
    const rows: { id: string; serial: string }[] = await manager.query(
      `INSERT INTO inventory_items (branch_id, product_id, batch_id, serial_no, serial, status, source_type, source_id, received_on, created_by)
       SELECT $1, $2, $3, n, $4 || lpad(n::text, GREATEST($5, length(n::text)), '0'), 'in_stock', $6, $7, $8, $9
         FROM generate_series($10::bigint, $11::bigint) n
       ON CONFLICT DO NOTHING
       RETURNING id, serial`,
      [
        input.branchId,
        input.productId,
        input.batchId,
        SERIAL_PREFIX,
        SERIAL_DIGITS,
        input.source,
        input.ref.id,
        input.date,
        actor.userId,
        first.toFixed(0),
        last.toFixed(0),
      ],
    );
    if (rows.length < count) {
      const taken: { serial: string }[] = await manager.query(
        `SELECT serial FROM inventory_items WHERE serial_no BETWEEN $1 AND $2 ORDER BY serial_no LIMIT 10`,
        [first.toFixed(0), last.toFixed(0)],
      );
      const created = new Set(rows.map((r) => r.serial));
      const clash = taken.map((t) => t.serial).filter((s) => !created.has(s));
      throw AppError.conflict(
        `Labels ${formatSerial(first)} to ${formatSerial(last)} overlap labels already in use (${clash.join(', ')})`,
        { serials: clash },
      );
    }
    await manager.query(
      `SELECT setval('inventory_item_serial_seq', GREATEST($1::bigint, (SELECT last_value FROM inventory_item_serial_seq)))`,
      [last.toFixed(0)],
    );
    await recordEvents(
      manager,
      actor,
      rows.map((r) => r.id),
      input.event,
      input.ref,
    );
    await markTracked(manager, input.productId);
    return rows;
  },

  async take(
    manager: EntityManager,
    actor: Actor,
    input: {
      branchId: string;
      serials: string[];
      from: ItemStatus[];
      to: ItemStatus;
      event: ItemEventType;
      ref: ItemReference;
      date: string;
      sellableOnly?: boolean;
      saleId?: string;
      productIds?: Set<string>;
      batchId?: string;
      note?: string | null;
    },
  ): Promise<TakenItem[]> {
    const serials = normalizeSerials(input.serials);
    const items = await lockBySerials(manager, serials);
    const found = new Map(items.map((i) => [i.serial, i]));
    const problems: SerialProblem[] = [];
    for (const serial of serials) {
      const item = found.get(serial);
      if (!item || item.branchId !== input.branchId) {
        problems.push({ serial, problem: 'is not a label of this branch' });
      } else if (input.productIds && !input.productIds.has(item.productId)) {
        problems.push({ serial, problem: `is ${item.productName}, which is not on this entry` });
      } else if (input.batchId && item.batchId !== input.batchId) {
        problems.push({ serial, problem: 'belongs to another batch' });
      } else if (input.saleId && item.saleId !== input.saleId) {
        problems.push({ serial, problem: 'was not sold on this sale' });
      } else if (!input.from.includes(item.status)) {
        problems.push({ serial, problem: STATUS_TEXT[item.status] });
      } else if (input.sellableOnly && item.expiryDate && item.expiryDate < input.date) {
        problems.push({ serial, problem: `expired on ${item.expiryDate}` });
      }
    }
    failOn(problems);
    const ids = items.map((i) => i.id);
    const sets: string[] = ['status = $2', 'updated_by = $3', 'updated_at = now()'];
    const params: unknown[] = [ids, input.to, actor.userId];
    if (input.to === 'sold') {
      params.push(input.ref.id, input.date);
      sets.push(`sale_id = $${params.length - 1}`, `sold_on = $${params.length}`);
    }
    if (input.to === 'dispatched') {
      params.push(input.ref.id);
      sets.push(`stock_out_id = $${params.length}`);
    }
    if (ids.length > 0)
      await manager.query(`UPDATE inventory_items SET ${sets.join(', ')} WHERE id = ANY($1)`, params);
    await recordEvents(manager, actor, ids, input.event, input.ref, input.note);
    return items.map(({ id, serial, productId, batchId }) => ({ id, serial, productId, batchId }));
  },

  async release(
    manager: EntityManager,
    actor: Actor,
    input: {
      where: { saleId?: string; stockOutId?: string; saleReturnItemId?: string; ids?: string[] };
      from: ItemStatus[];
      to: ItemStatus;
      event: ItemEventType;
      ref: ItemReference;
      clear: ('sale' | 'stockOut' | 'saleReturnItem')[];
    },
  ): Promise<TakenItem[]> {
    const filters: string[] = ['status = ANY($1)', 'deleted_at IS NULL'];
    const params: unknown[] = [input.from];
    if (input.where.saleId) {
      params.push(input.where.saleId);
      filters.push(`sale_id = $${params.length}`);
    }
    if (input.where.stockOutId) {
      params.push(input.where.stockOutId);
      filters.push(`stock_out_id = $${params.length}`);
    }
    if (input.where.saleReturnItemId) {
      params.push(input.where.saleReturnItemId);
      filters.push(`sale_return_item_id = $${params.length}`);
    }
    if (input.where.ids) {
      params.push(input.where.ids);
      filters.push(`id = ANY($${params.length})`);
    }
    const sets = [
      'status = $' + (params.length + 1),
      'updated_by = $' + (params.length + 2),
      'updated_at = now()',
    ];
    if (input.clear.includes('sale')) sets.push('sale_id = NULL', 'sold_on = NULL');
    if (input.clear.includes('stockOut')) sets.push('stock_out_id = NULL');
    if (input.clear.includes('saleReturnItem')) sets.push('sale_return_item_id = NULL');
    const [rows] = (await manager.query(
      `UPDATE inventory_items SET ${sets.join(', ')} WHERE ${filters.join(' AND ')}
       RETURNING id, serial, product_id AS "productId", batch_id AS "batchId"`,
      [...params, input.to, actor.userId],
    )) as [TakenItem[], number];
    await recordEvents(
      manager,
      actor,
      rows.map((r) => r.id),
      input.event,
      input.ref,
    );
    return rows;
  },

  async setStatus(
    manager: EntityManager,
    actor: Actor,
    input: { ids: string[]; to: ItemStatus; event: ItemEventType; ref: ItemReference; note?: string | null },
  ) {
    if (input.ids.length === 0) return;
    await manager.query(
      'UPDATE inventory_items SET status = $2, updated_by = $3, updated_at = now() WHERE id = ANY($1)',
      [input.ids, input.to, actor.userId],
    );
    await recordEvents(manager, actor, input.ids, input.event, input.ref, input.note);
  },

  async linkReturnItem(manager: EntityManager, itemId: string, returnItemId: string) {
    await manager.query('UPDATE inventory_items SET sale_return_item_id = $2 WHERE id = $1', [
      itemId,
      returnItemId,
    ]);
  },

  async itemsOf(manager: EntityManager, where: { saleId?: string; saleReturnItemIds?: string[] }) {
    if (where.saleReturnItemIds) {
      if (where.saleReturnItemIds.length === 0) return [];
      return (await manager.query(
        `SELECT i.id, i.serial, i.product_id AS "productId", i.batch_id AS "batchId", i.status,
                i.sale_return_item_id AS "saleReturnItemId"
           FROM inventory_items i WHERE i.sale_return_item_id = ANY($1) ORDER BY i.serial_no`,
        [where.saleReturnItemIds],
      )) as (TakenItem & { status: ItemStatus; saleReturnItemId: string })[];
    }
    return (await manager.query(
      `SELECT i.id, i.serial, i.product_id AS "productId", i.batch_id AS "batchId", i.status,
              i.sale_return_item_id AS "saleReturnItemId"
         FROM inventory_items i WHERE i.sale_id = $1 ORDER BY i.serial_no`,
      [where.saleId],
    )) as (TakenItem & { status: ItemStatus; saleReturnItemId: string | null })[];
  },

  async removeUntouched(manager: EntityManager, branchId: string, source: ItemSource, sourceId: string) {
    const rows: { id: string; moved: boolean }[] = await manager.query(
      `SELECT i.id, (i.status <> 'in_stock' OR EXISTS (
                SELECT 1 FROM inventory_item_events e
                 WHERE e.item_id = i.id AND e.type NOT IN ('received', 'produced', 'labelled'))) AS moved
         FROM inventory_items i
        WHERE i.branch_id = $1 AND i.source_type = $2 AND i.source_id = $3 AND i.deleted_at IS NULL
          FOR UPDATE OF i`,
      [branchId, source, sourceId],
    );
    if (rows.some((r) => r.moved)) {
      throw AppError.conflict('Some of its labelled pieces were already sold, sent out or returned');
    }
    if (rows.length > 0)
      await manager.query('DELETE FROM inventory_items WHERE id = ANY($1)', [rows.map((r) => r.id)]);
    return rows.length;
  },

  async countFromSource(manager: EntityManager, source: ItemSource, sourceId: string) {
    const [row] = (await manager.query(
      'SELECT COUNT(*)::int AS n FROM inventory_items WHERE source_type = $1 AND source_id = $2',
      [source, sourceId],
    )) as [{ n: number }];
    return row.n;
  },

  async unlabelled(manager: EntityManager, branchId: string, productId: string, batchId: string | null) {
    const [row] = (await manager.query(
      `SELECT (COALESCE((SELECT SUM(qty) FROM stock_movements
                          WHERE branch_id = $1 AND product_id = $2 AND batch_id IS NOT DISTINCT FROM $3), 0)
             - (SELECT COUNT(*) FROM inventory_items
                 WHERE branch_id = $1 AND product_id = $2 AND batch_id IS NOT DISTINCT FROM $3
                   AND status = 'in_stock' AND deleted_at IS NULL))::text AS n`,
      [branchId, productId, batchId],
    )) as [{ n: string }];
    return new Decimal(row.n);
  },

  movements(
    items: TakenItem[],
    sign: 1 | -1,
    base: { type: StockMovementType; date: string; note?: string | null },
  ) {
    const grouped = new Map<string, { productId: string; batchId: string | null; qty: number }>();
    for (const item of items) {
      const key = `${item.productId}:${item.batchId ?? ''}`;
      const entry = grouped.get(key) ?? { productId: item.productId, batchId: item.batchId, qty: 0 };
      entry.qty += 1;
      grouped.set(key, entry);
    }
    return [...grouped.values()].map((g): StockMovementInput => ({
      productId: g.productId,
      batchId: g.batchId,
      type: base.type,
      qty: new Decimal(g.qty * sign),
      date: base.date,
      note: base.note ?? null,
    }));
  },

  countByProduct(items: TakenItem[]) {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.productId, (counts.get(item.productId) ?? 0) + 1);
    return counts;
  },

  async list(branchId: string, query: InventoryItemListQuery) {
    const params: unknown[] = [branchId];
    const where = ['i.branch_id = $1', 'i.deleted_at IS NULL'];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (query.productId) add('i.product_id = ?', query.productId);
    if (query.batchId) add('i.batch_id = ?', query.batchId);
    if (query.status) add('i.status = ?', query.status);
    if (query.saleId) add('i.sale_id = ?', query.saleId);
    if (query.source && query.sourceId) {
      add('i.source_type = ?', query.source);
      add('i.source_id = ?', query.sourceId);
    }
    if (query.from) add('i.serial_no >= ?', parseSerial(query.from)?.toFixed(0) ?? '0');
    if (query.to) add('i.serial_no <= ?', parseSerial(query.to)?.toFixed(0) ?? '0');
    if (query.search) {
      params.push(`%${escapeLike(query.search)}%`);
      where.push(`(i.serial ILIKE $${params.length} OR p.name ILIKE $${params.length})`);
    }
    const from = `FROM inventory_items i
      JOIN products p ON p.id = i.product_id
      LEFT JOIN product_batches b ON b.id = i.batch_id
      LEFT JOIN sales s ON s.id = i.sale_id
     WHERE ${where.join(' AND ')}`;
    const [{ total }] = (await AppDataSource.query(`SELECT COUNT(*)::int AS total ${from}`, params)) as [
      { total: number },
    ];
    const rows = await AppDataSource.query(
      `SELECT i.id, i.serial, i.status, i.product_id AS "productId", p.name AS "productName",
              i.batch_id AS "batchId", b.batch_no AS "batchNo",
              to_char(b.manufacturing_date, 'YYYY-MM-DD') AS "manufacturingDate",
              to_char(b.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
              to_char(i.received_on, 'YYYY-MM-DD') AS "receivedOn",
              i.sale_id AS "saleId", s.invoice_no AS "invoiceNo", to_char(i.sold_on, 'YYYY-MM-DD') AS "soldOn"
         ${from}
        ORDER BY i.serial_no ${query.sort === '-serial' ? 'DESC' : 'ASC'}
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      params,
    );
    return { items: rows, meta: pageMeta(query, total) };
  },

  async get(branchId: string, ref: { id?: string; serial?: string }) {
    const [item] = (await AppDataSource.query(
      `SELECT i.id, i.serial, i.status, i.branch_id AS "branchId", br.name AS "branchName",
              i.product_id AS "productId", p.name AS "productName", p.sale_price::text AS "salePrice",
              i.batch_id AS "batchId", b.batch_no AS "batchNo",
              to_char(b.manufacturing_date, 'YYYY-MM-DD') AS "manufacturingDate",
              to_char(b.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
              to_char(i.received_on, 'YYYY-MM-DD') AS "receivedOn",
              i.sale_id AS "saleId", s.invoice_no AS "invoiceNo", to_char(i.sold_on, 'YYYY-MM-DD') AS "soldOn",
              pt.id AS "patientId", pt.name AS "patientName"
         FROM inventory_items i
         JOIN branches br ON br.id = i.branch_id
         JOIN products p ON p.id = i.product_id
         LEFT JOIN product_batches b ON b.id = i.batch_id
         LEFT JOIN sales s ON s.id = i.sale_id
         LEFT JOIN patients pt ON pt.id = s.patient_id
        WHERE i.branch_id = $1 AND i.deleted_at IS NULL AND ${ref.id ? 'i.id = $2' : 'i.serial = $2'}`,
      [branchId, ref.id ?? ref.serial?.trim().toUpperCase()],
    )) as Record<string, unknown>[];
    if (!item) throw AppError.notFound('Label');
    const history = await AppDataSource.query(
      `SELECT e.id, e.type, e.reference_type AS "referenceType", e.reference_id AS "referenceId",
              e.reference_label AS "referenceLabel", e.note, e.created_at AS "createdAt",
              br.name AS "branchName", NULLIF(TRIM(CONCAT(sp.first_name, ' ', sp.last_name)), '') AS "by"
         FROM inventory_item_events e
         JOIN branches br ON br.id = e.branch_id
         LEFT JOIN staff_profiles sp ON sp.id = e.created_by
        WHERE e.item_id = $1
        ORDER BY e.created_at ASC`,
      [item.id],
    );
    return { ...item, history };
  },

  async registerExisting(actor: Actor, branchId: string, input: RegisterLabelsInput) {
    return withTransaction(async (em) => {
      const [product] = (await em.query(
        'SELECT id, name FROM products WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL FOR NO KEY UPDATE',
        [input.productId, branchId],
      )) as { id: string; name: string }[];
      if (!product) throw AppError.notFound('Product');
      const batchId = input.batchId ?? null;
      if (batchId) {
        const [batch] = (await em.query(
          'SELECT id FROM product_batches WHERE id = $1 AND product_id = $2 AND branch_id = $3',
          [batchId, input.productId, branchId],
        )) as { id: string }[];
        if (!batch) throw AppError.badRequest('The batch does not belong to this product');
      }
      const unlabelled = await this.unlabelled(em, branchId, input.productId, batchId);
      if (unlabelled.lt(input.qty)) {
        throw AppError.unprocessable(
          `Only ${unlabelled.toFixed(0)} of ${product.name} in this batch have no label yet`,
          { unlabelled: unlabelled.toFixed(0), requested: String(input.qty) },
        );
      }
      const id = randomUUID();
      const rows = await this.register(em, actor, {
        branchId,
        productId: input.productId,
        batchId,
        firstSerial: input.firstSerial,
        qty: input.qty,
        date: input.date ?? today(),
        source: 'labelled',
        ref: { type: 'labelled', id, label: input.note ?? null },
        event: 'labelled',
      });
      const result = { count: rows.length, firstSerial: rows[0]!.serial, lastSerial: rows.at(-1)!.serial };
      await auditService.record(
        {
          actor,
          branchId,
          action: 'register_labels',
          entity: 'product',
          entityId: input.productId,
          after: result,
        },
        em,
      );
      return result;
    });
  },

  async summary(branchId: string, productId: string) {
    const counts: { status: ItemStatus; n: number }[] = await AppDataSource.query(
      `SELECT status, COUNT(*)::int AS n FROM inventory_items
        WHERE branch_id = $1 AND product_id = $2 AND deleted_at IS NULL GROUP BY status`,
      [branchId, productId],
    );
    const unlabelled: { batchId: string | null; batchNo: string | null; qty: string }[] =
      await AppDataSource.query(
        `SELECT m.batch_id AS "batchId", b.batch_no AS "batchNo",
              (SUM(m.qty) - COALESCE((SELECT COUNT(*) FROM inventory_items i
                                       WHERE i.branch_id = $1 AND i.product_id = $2 AND i.status = 'in_stock'
                                         AND i.deleted_at IS NULL
                                         AND i.batch_id IS NOT DISTINCT FROM m.batch_id), 0))::text AS qty
         FROM stock_movements m
         LEFT JOIN product_batches b ON b.id = m.batch_id
        WHERE m.branch_id = $1 AND m.product_id = $2
        GROUP BY m.batch_id, b.batch_no
       HAVING SUM(m.qty) - COALESCE((SELECT COUNT(*) FROM inventory_items i
                                      WHERE i.branch_id = $1 AND i.product_id = $2 AND i.status = 'in_stock'
                                        AND i.deleted_at IS NULL
                                        AND i.batch_id IS NOT DISTINCT FROM m.batch_id), 0) > 0`,
        [branchId, productId],
      );
    const [product] = (await AppDataSource.query(
      'SELECT track_serials AS "trackSerials" FROM products WHERE id = $1 AND branch_id = $2',
      [productId, branchId],
    )) as { trackSerials: boolean }[];
    if (!product) throw AppError.notFound('Product');
    return {
      productId,
      trackSerials: product.trackSerials,
      byStatus: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      unlabelled: unlabelled.map((u) => ({ ...u, qty: new Decimal(u.qty).toFixed(3) })),
    };
  },
};
