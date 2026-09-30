import Decimal from 'decimal.js';
import { type EntityManager } from 'typeorm';
import { AppError } from '../../lib/errors';
import { Material } from './material.entity';
import {
  MaterialMovement,
  type MaterialLocation,
  type MaterialMovementType,
} from './material-movement.entity';

export interface MaterialMovementInput {
  materialId: string;
  location: MaterialLocation;
  type: MaterialMovementType;
  qty: Decimal.Value;
  date: string;
  note?: string | null;
}

export interface MaterialReference {
  branchId: string;
  referenceType: string;
  referenceId: string;
  actorId: string;
}

const keyOf = (materialId: string, location: MaterialLocation) => `${materialId}:${location}`;

async function lockMaterials(manager: EntityManager, branchId: string, materialIds: string[]) {
  return manager
    .getRepository(Material)
    .createQueryBuilder('mat')
    .setLock('pessimistic_write')
    .where('mat.branchId = :branchId', { branchId })
    .andWhere('mat.id IN (:...materialIds)', { materialIds })
    .orderBy('mat.id')
    .getMany();
}

async function balances(manager: EntityManager, branchId: string, materialIds: string[]) {
  const rows: { materialId: string; location: MaterialLocation; quantity: string }[] = await manager
    .getRepository(MaterialMovement)
    .createQueryBuilder('m')
    .select('m.materialId', 'materialId')
    .addSelect('m.location', 'location')
    .addSelect('COALESCE(SUM(m.qty), 0)', 'quantity')
    .where('m.branchId = :branchId', { branchId })
    .andWhere('m.materialId IN (:...materialIds)', { materialIds })
    .groupBy('m.materialId')
    .addGroupBy('m.location')
    .getRawMany();
  return new Map(rows.map((r) => [keyOf(r.materialId, r.location), new Decimal(r.quantity)]));
}

async function assertNoNegative(
  manager: EntityManager,
  branchId: string,
  movements: { materialId: string; location: MaterialLocation; qty: Decimal.Value }[],
) {
  const net = new Map<string, { materialId: string; location: MaterialLocation; qty: Decimal }>();
  for (const m of movements) {
    const key = keyOf(m.materialId, m.location);
    const current = net.get(key);
    net.set(key, {
      materialId: m.materialId,
      location: m.location,
      qty: (current?.qty ?? new Decimal(0)).plus(m.qty),
    });
  }
  const materialIds = [...new Set(movements.map((m) => m.materialId))];
  const materials = await lockMaterials(manager, branchId, materialIds);
  if (materials.length !== materialIds.length)
    throw AppError.badRequest('One or more materials do not exist');

  const available = await balances(manager, branchId, materialIds);
  const shortages = [...net.entries()]
    .filter(([key, change]) => (available.get(key) ?? new Decimal(0)).plus(change.qty).isNegative())
    .map(([key, change]) => ({
      materialId: change.materialId,
      materialName: materials.find((m) => m.id === change.materialId)?.name ?? change.materialId,
      location: change.location,
      available: (available.get(key) ?? new Decimal(0)).toString(),
      required: change.qty.negated().toString(),
    }));
  if (shortages.length > 0)
    throw AppError.unprocessable('Not enough material for this change', { shortages });
}

async function unreversed(manager: EntityManager, ref: MaterialReference) {
  return manager
    .getRepository(MaterialMovement)
    .createQueryBuilder('m')
    .where('m.branchId = :branchId', { branchId: ref.branchId })
    .andWhere('m.referenceType = :referenceType', { referenceType: ref.referenceType })
    .andWhere('m.referenceId = :referenceId', { referenceId: ref.referenceId })
    .andWhere('m.reversalOfId IS NULL')
    .andWhere('NOT EXISTS (SELECT 1 FROM material_movements r WHERE r.reversal_of_id = m.id)')
    .getMany();
}

async function write(
  manager: EntityManager,
  ref: MaterialReference,
  movements: MaterialMovementInput[],
  reverseExisting: boolean,
  reversalNote?: string,
) {
  const existing = reverseExisting ? await unreversed(manager, ref) : [];
  const all = [
    ...existing.map((m) => ({
      materialId: m.materialId,
      location: m.location,
      type: m.type,
      qty: m.qty.negated(),
      date: m.date,
      note: reversalNote ?? `Reversal of ${m.type}`,
      reversalOfId: m.id as string | null,
    })),
    ...movements.map((m) => ({ ...m, note: m.note ?? null, reversalOfId: null as string | null })),
  ].filter((m) => !new Decimal(m.qty).isZero());
  if (all.length === 0) return [];
  await assertNoNegative(manager, ref.branchId, all);

  const repository = manager.getRepository(MaterialMovement);
  return repository.save(
    all.map((m) =>
      repository.create({
        branchId: ref.branchId,
        materialId: m.materialId,
        location: m.location,
        type: m.type,
        qty: new Decimal(m.qty),
        referenceType: ref.referenceType,
        referenceId: ref.referenceId,
        reversalOfId: m.reversalOfId,
        date: m.date,
        note: m.note,
        createdBy: ref.actorId,
      }),
    ),
  );
}

export const materialLedger = {
  apply: (manager: EntityManager, ref: MaterialReference, movements: MaterialMovementInput[]) =>
    write(manager, ref, movements, false),

  replace: (manager: EntityManager, ref: MaterialReference, movements: MaterialMovementInput[]) =>
    write(manager, ref, movements, true),

  reverse: (manager: EntityManager, ref: MaterialReference, note: string) =>
    write(manager, ref, [], true, note),

  balances,
};
