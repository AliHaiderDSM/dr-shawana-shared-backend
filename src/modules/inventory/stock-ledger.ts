import Decimal from 'decimal.js';
import { In, type EntityManager } from 'typeorm';
import { AppError } from '../../lib/errors';
import { Product } from '../products/product.entity';
import { StockMovement, type StockMovementType } from './stock-movement.entity';

export interface StockMovementInput {
  productId: string;
  type: StockMovementType;
  qty: Decimal.Value;
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
}

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

function netChangeByProduct(movements: { productId: string; qty: Decimal.Value }[]) {
  const net = new Map<string, Decimal>();
  for (const m of movements) net.set(m.productId, (net.get(m.productId) ?? new Decimal(0)).plus(m.qty));
  return net;
}

async function assertNoNegativeStock(
  manager: EntityManager,
  branchId: string,
  movements: { productId: string; qty: Decimal.Value }[],
) {
  const net = netChangeByProduct(movements);
  const productIds = [...net.keys()];
  const products = await lockProducts(manager, branchId, productIds);
  if (products.length !== productIds.length) throw AppError.badRequest('One or more products do not exist');

  const decreasing = productIds.filter((id) => net.get(id)!.isNegative());
  const balances = await balancesOf(manager, branchId, decreasing);
  const shortages: StockShortage[] = [];
  for (const productId of decreasing) {
    const available = balances.get(productId)!;
    if (available.plus(net.get(productId)!).isNegative()) {
      shortages.push({
        productId,
        productName: products.find((p) => p.id === productId)?.name ?? productId,
        available: available.toString(),
        required: net.get(productId)!.negated().toString(),
      });
    }
  }
  if (shortages.length > 0) {
    throw AppError.unprocessable('Not enough stock for this change', { shortages });
  }
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
      unitCost: m.unitCost,
      date: m.date,
      note: options.reversalNote ?? `Reversal of ${m.type}`,
      reversalOfId: m.id,
    }));

    const all = [...reversals, ...movements.map((m) => ({ ...m, reversalOfId: null }))].filter(
      (m) => !new Decimal(m.qty).isZero(),
    );
    if (all.length === 0) return [];
    await assertNoNegativeStock(manager, ref.branchId, all);

    const repository = manager.getRepository(StockMovement);
    return repository.save(
      all.map((m) =>
        repository.create({
          branchId: ref.branchId,
          productId: m.productId,
          type: m.type,
          qty: new Decimal(m.qty),
          unitCost: m.unitCost === undefined || m.unitCost === null ? null : new Decimal(m.unitCost),
          referenceType: ref.referenceType,
          referenceId: ref.referenceId,
          reversalOfId: m.reversalOfId,
          date: m.date,
          note: m.note ?? null,
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
};
