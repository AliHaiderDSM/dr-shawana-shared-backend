import Decimal from 'decimal.js';
import { In, type EntityManager } from 'typeorm';
import { AppError } from '../../lib/errors';
import { Product } from '../products/product.entity';
import { StockMovement, type StockMovementType } from './stock-movement.entity';

export interface StockSource {
  referenceType: string;
  referenceIds: string[];
}

export interface StockMovementInput {
  productId: string;
  type: StockMovementType;
  qty: Decimal.Value;
  batchId?: string | null;
  restoreFrom?: StockSource[];
  unitCost?: Decimal.Value | null;
  date: string;
  note?: string | null;
}

export interface StockReference {
  branchId: string;
  referenceType: string;
  referenceId: string;
  actorId: string;
}

export interface StockShortage {
  productId: string;
  productName: string;
  available: string;
  required: string;
  expired?: string;
}

interface Lot {
  batchId: string | null;
  qty: Decimal;
  expiryDate: string | null;
  createdAt: string;
}

interface Posting {
  productId: string;
  type: StockMovementType;
  qty: Decimal;
  batchId: string | null;
  unitCost: Decimal.Value | null;
  date: string;
  note: string | null;
  reversalOfId: string | null;
}

const SELLABLE_ONLY: StockMovementType[] = ['sale', 'sale_edit_adjust', 'stock_out'];

const lotRank = (lot: Lot) => (lot.expiryDate ? 0 : lot.batchId === null ? 1 : 2);

function fefo(a: Lot, b: Lot) {
  return (
    lotRank(a) - lotRank(b) ||
    (a.expiryDate ?? '').localeCompare(b.expiryDate ?? '') ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

const isExpired = (lot: Lot, date: string) => lot.expiryDate !== null && lot.expiryDate < date;

async function lockProducts(manager: EntityManager, branchId: string, productIds: string[]) {
  if (productIds.length === 0) return [];
  return manager
    .getRepository(Product)
    .createQueryBuilder('p')
    .setLock('pessimistic_write')
    .where('p.branchId = :branchId', { branchId })
    .andWhere('p.id IN (:...productIds)', { productIds })
    .orderBy('p.id')
    .getMany();
}

async function balancesOf(manager: EntityManager, branchId: string, productIds: string[]) {
  const balances = new Map<string, Decimal>(productIds.map((id) => [id, new Decimal(0)]));
  if (productIds.length === 0) return balances;
  const rows: { productId: string; quantity: string }[] = await manager
    .getRepository(StockMovement)
    .createQueryBuilder('m')
    .select('m.productId', 'productId')
    .addSelect('COALESCE(SUM(m.qty), 0)', 'quantity')
    .where('m.branchId = :branchId', { branchId })
    .andWhere('m.productId IN (:...productIds)', { productIds })
    .groupBy('m.productId')
    .getRawMany();
  for (const row of rows) balances.set(row.productId, new Decimal(row.quantity));
  return balances;
}

class LotPool {
  private readonly lots = new Map<string, Lot[]>();

  static async load(manager: EntityManager, branchId: string, productIds: string[], batchIds: string[]) {
    const pool = new LotPool();
    if (productIds.length === 0) return pool;
    const rows: {
      productId: string;
      batchId: string | null;
      qty: string;
      expiryDate: string | null;
      createdAt: string;
    }[] = await manager.query(
      `SELECT m.product_id AS "productId", m.batch_id AS "batchId", SUM(m.qty)::text AS qty,
              to_char(b.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
              COALESCE(to_char(b.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US'), '') AS "createdAt"
         FROM stock_movements m
         LEFT JOIN product_batches b ON b.id = m.batch_id
        WHERE m.branch_id = $1 AND m.product_id = ANY($2)
        GROUP BY m.product_id, m.batch_id, b.expiry_date, b.created_at`,
      [branchId, productIds],
    );
    for (const row of rows) pool.add(row.productId, { ...row, qty: new Decimal(row.qty) });

    const known = new Set(rows.map((r) => r.batchId));
    const missing = batchIds.filter((id) => !known.has(id));
    if (missing.length > 0) {
      const batches: { id: string; productId: string; expiryDate: string | null; createdAt: string }[] =
        await manager.query(
          `SELECT id, product_id AS "productId", to_char(expiry_date, 'YYYY-MM-DD') AS "expiryDate",
                  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "createdAt"
             FROM product_batches WHERE branch_id = $1 AND id = ANY($2)`,
          [branchId, missing],
        );
      for (const b of batches) pool.add(b.productId, { batchId: b.id, qty: new Decimal(0), ...b });
    }
    return pool;
  }

  private add(productId: string, lot: Lot) {
    this.lots.set(productId, [...(this.lots.get(productId) ?? []), lot]);
  }

  lotsOf(productId: string) {
    return [...(this.lots.get(productId) ?? [])].sort(fefo);
  }

  lot(productId: string, batchId: string | null) {
    let lot = this.lots.get(productId)?.find((l) => l.batchId === batchId);
    if (!lot) {
      lot = { batchId, qty: new Decimal(0), expiryDate: null, createdAt: '' };
      this.add(productId, lot);
    }
    return lot;
  }

  post(productId: string, batchId: string | null, qty: Decimal) {
    const lot = this.lot(productId, batchId);
    lot.qty = lot.qty.plus(qty);
  }

  overdrawn(changes: Posting[]) {
    const delta = new Map<string, Decimal>();
    const key = (productId: string, batchId: string | null) => `${productId}:${batchId ?? ''}`;
    for (const c of changes) {
      delta.set(
        key(c.productId, c.batchId),
        (delta.get(key(c.productId, c.batchId)) ?? new Decimal(0)).plus(c.qty),
      );
    }
    const result = new Set<string>();
    for (const [productId, lots] of this.lots) {
      for (const lot of lots) {
        if (lot.qty.isNegative() && delta.get(key(productId, lot.batchId))?.isNegative())
          result.add(productId);
      }
    }
    return [...result];
  }
}

async function restoreCapacity(
  manager: EntityManager,
  branchId: string,
  productId: string,
  sources: StockSource[],
) {
  const capacity = new Map<string | null, Decimal>();
  for (const source of sources) {
    if (source.referenceIds.length === 0) continue;
    const rows: { batchId: string | null; qty: string }[] = await manager.query(
      `SELECT batch_id AS "batchId", SUM(qty)::text AS qty FROM stock_movements
        WHERE branch_id = $1 AND product_id = $2 AND reference_type = $3 AND reference_id = ANY($4)
        GROUP BY batch_id`,
      [branchId, productId, source.referenceType, source.referenceIds],
    );
    for (const row of rows) {
      capacity.set(row.batchId, (capacity.get(row.batchId) ?? new Decimal(0)).minus(row.qty));
    }
  }
  return capacity;
}

function splitAcross(qty: Decimal, lots: { batchId: string | null; room: Decimal }[]) {
  const parts: { batchId: string | null; qty: Decimal }[] = [];
  let left = qty;
  for (const lot of lots) {
    if (left.isZero()) break;
    if (!lot.room.gt(0)) continue;
    const take = Decimal.min(left, lot.room);
    parts.push({ batchId: lot.batchId, qty: take });
    left = left.minus(take);
  }
  return { parts, left };
}

async function resolvePostings(
  manager: EntityManager,
  branchId: string,
  postings: (Omit<Posting, 'batchId'> & { batchId?: string | null; restoreFrom?: StockSource[] })[],
) {
  const productIds = [...new Set(postings.map((p) => p.productId))];
  const products = await lockProducts(manager, branchId, productIds);
  if (products.length !== productIds.length) throw AppError.badRequest('One or more products do not exist');
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? id;

  const explicitBatches = postings.flatMap((p) => (p.batchId ? [p.batchId] : []));
  const pool = await LotPool.load(manager, branchId, productIds, explicitBatches);
  const resolved: Posting[] = [];
  const shortages = new Map<string, StockShortage>();

  const place = (p: (typeof postings)[number], batchId: string | null, qty: Decimal) => {
    pool.post(p.productId, batchId, qty);
    resolved.push({ ...p, batchId, qty });
  };

  for (const p of postings.filter((p) => p.batchId !== undefined)) place(p, p.batchId ?? null, p.qty);

  for (const p of postings.filter((p) => p.batchId === undefined && p.qty.gt(0))) {
    if (!p.restoreFrom?.length) {
      place(p, null, p.qty);
      continue;
    }
    const capacity = await restoreCapacity(manager, branchId, p.productId, p.restoreFrom);
    const lots = pool.lotsOf(p.productId).map((l) => ({
      batchId: l.batchId,
      room: capacity.get(l.batchId) ?? new Decimal(0),
    }));
    const { parts, left } = splitAcross(p.qty, lots);
    for (const part of parts) place(p, part.batchId, part.qty);
    if (left.gt(0)) place(p, null, left);
  }

  for (const p of postings.filter((p) => p.batchId === undefined && p.qty.isNegative())) {
    const sellableOnly = SELLABLE_ONLY.includes(p.type);
    const lots = pool.lotsOf(p.productId);
    const usable = lots.filter((l) => !(sellableOnly && isExpired(l, p.date)));
    const wanted = p.qty.negated();
    const { parts, left } = splitAcross(
      wanted,
      usable.map((l) => ({ batchId: l.batchId, room: l.qty })),
    );
    if (left.gt(0)) {
      const available = usable.reduce((sum, l) => sum.plus(Decimal.max(l.qty, 0)), new Decimal(0));
      const expired = lots
        .filter((l) => !usable.includes(l))
        .reduce((sum, l) => sum.plus(Decimal.max(l.qty, 0)), new Decimal(0));
      const previous = shortages.get(p.productId);
      shortages.set(p.productId, {
        productId: p.productId,
        productName: nameOf(p.productId),
        available: available.toString(),
        required: wanted.plus(previous?.required ?? 0).toString(),
        ...(expired.gt(0) ? { expired: expired.toString() } : {}),
      });
      continue;
    }
    for (const part of parts) place(p, part.batchId, part.qty.negated());
  }

  for (const productId of pool.overdrawn(resolved)) {
    if (shortages.has(productId)) continue;
    const lots = pool.lotsOf(productId);
    const total = lots.reduce((sum, l) => sum.plus(l.qty), new Decimal(0));
    const change = resolved
      .filter((r) => r.productId === productId)
      .reduce((sum, r) => sum.plus(r.qty), new Decimal(0));
    shortages.set(productId, {
      productId,
      productName: nameOf(productId),
      available: Decimal.max(total.minus(change), 0).toString(),
      required: Decimal.max(change.negated(), 0).toString(),
    });
  }

  if (shortages.size > 0) {
    throw AppError.unprocessable('Not enough stock for this change', { shortages: [...shortages.values()] });
  }
  return resolved;
}

async function unreversedMovements(manager: EntityManager, ref: StockReference) {
  return manager
    .getRepository(StockMovement)
    .createQueryBuilder('m')
    .where('m.branchId = :branchId', { branchId: ref.branchId })
    .andWhere('m.referenceType = :referenceType', { referenceType: ref.referenceType })
    .andWhere('m.referenceId = :referenceId', { referenceId: ref.referenceId })
    .andWhere('m.reversalOfId IS NULL')
    .andWhere('NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.reversal_of_id = m.id)')
    .getMany();
}

export const stockLedger = {
  balancesOf,

  async apply(manager: EntityManager, ref: StockReference, movements: StockMovementInput[]) {
    return this.replace(manager, ref, movements, { reverseExisting: false });
  },

  async reverse(manager: EntityManager, ref: StockReference, note: string) {
    return this.replace(manager, ref, [], { reverseExisting: true, reversalNote: note });
  },

  async replace(
    manager: EntityManager,
    ref: StockReference,
    movements: StockMovementInput[],
    options: { reverseExisting?: boolean; reversalNote?: string } = {
      reverseExisting: true,
    },
  ) {
    const existing = options.reverseExisting === false ? [] : await unreversedMovements(manager, ref);
    const reversals = existing.map((m) => ({
      productId: m.productId,
      type: m.type,
      qty: m.qty.negated(),
      batchId: m.batchId,
      unitCost: m.unitCost,
      date: m.date,
      note: options.reversalNote ?? `Reversal of ${m.type}`,
      reversalOfId: m.id,
    }));

    const all = [
      ...reversals,
      ...movements.map((m) => ({
        ...m,
        qty: new Decimal(m.qty),
        unitCost: m.unitCost ?? null,
        note: m.note ?? null,
        reversalOfId: null,
      })),
    ].filter((m) => !m.qty.isZero());
    if (all.length === 0) return [];
    const postings = await resolvePostings(manager, ref.branchId, all);

    const repository = manager.getRepository(StockMovement);
    return repository.save(
      postings.map((m) =>
        repository.create({
          branchId: ref.branchId,
          productId: m.productId,
          batchId: m.batchId,
          type: m.type,
          qty: m.qty,
          unitCost: m.unitCost === null ? null : new Decimal(m.unitCost),
          referenceType: ref.referenceType,
          referenceId: ref.referenceId,
          reversalOfId: m.reversalOfId,
          date: m.date,
          note: m.note,
          createdBy: ref.actorId,
        }),
      ),
    );
  },

  async movementsFor(
    manager: EntityManager,
    branchId: string,
    referenceType: string,
    referenceIds: string[],
  ) {
    if (referenceIds.length === 0) return [];
    return manager.getRepository(StockMovement).find({
      where: { branchId, referenceType, referenceId: In(referenceIds) },
      order: { createdAt: 'ASC' },
    });
  },

  async batchesFor(manager: EntityManager, branchId: string, sources: StockSource[]) {
    const refs = sources.filter((s) => s.referenceIds.length > 0);
    if (refs.length === 0) return [];
    const params: unknown[] = [branchId];
    const clauses = refs.map((s) => {
      params.push(s.referenceType, s.referenceIds);
      return `(m.reference_type = $${params.length - 1} AND m.reference_id = ANY($${params.length}))`;
    });
    const rows: {
      productId: string;
      batchId: string | null;
      batchNo: string | null;
      manufacturingDate: string | null;
      expiryDate: string | null;
      qty: string;
    }[] = await manager.query(
      `SELECT m.product_id AS "productId", m.batch_id AS "batchId", b.batch_no AS "batchNo",
              to_char(b.manufacturing_date, 'YYYY-MM-DD') AS "manufacturingDate",
              to_char(b.expiry_date, 'YYYY-MM-DD') AS "expiryDate", SUM(m.qty)::text AS qty
         FROM stock_movements m
         LEFT JOIN product_batches b ON b.id = m.batch_id
        WHERE m.branch_id = $1 AND (${clauses.join(' OR ')})
        GROUP BY m.product_id, m.batch_id, b.batch_no, b.manufacturing_date, b.expiry_date
       HAVING SUM(m.qty) <> 0
        ORDER BY b.expiry_date NULLS LAST, b.batch_no`,
      params,
    );
    return rows.map((r) => ({ ...r, qty: new Decimal(r.qty) }));
  },
};
