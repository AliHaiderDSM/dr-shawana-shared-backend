import Decimal from 'decimal.js';
import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo, withTransaction } from '../../database/transaction';
import { toQuantity } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { paginate } from '../../lib/pagination';
import { auditService } from '../audit/audit.service';
import { stockLedger } from '../inventory/stock-ledger';
import { productsRepository } from '../products/products.repository';
import { MaterialBatch, MaterialBatchItem, type BatchStage } from './material-batch.entity';
import { materialLedger } from './material-ledger';
import { materialsRepository } from './materials.service';
import {
  type BatchListQuery,
  type CreateLabTransferInput,
  type CreateProductionInput,
} from './manufacturing.schemas';

const batchesRepository = branchScopedRepository(MaterialBatch, 'mb');

const REFERENCE: Record<BatchStage, string> = {
  pharmacy_lab: 'lab_transfer',
  finished_product: 'production',
};

const LABEL: Record<BatchStage, string> = {
  pharmacy_lab: 'Lab transfer',
  finished_product: 'Production batch',
};

const detailed = (branchId: string, manager?: EntityManager) =>
  batchesRepository
    .query(branchId, manager)
    .leftJoinAndSelect('mb.items', 'item')
    .leftJoinAndSelect('item.material', 'material')
    .leftJoinAndSelect('mb.product', 'product');

function toBatchDto(batch: MaterialBatch) {
  const { items, product, labBatch: _labBatch, ...rest } = withoutInternals(batch);
  const rows = (items ?? []).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return {
    ...rest,
    product: product ? { id: product.id, name: product.name } : null,
    totalQty: toQuantity(rows.reduce((sum, i) => sum.plus(i.qty), new Decimal(0))),
    items: rows.map((i) => ({
      materialId: i.materialId,
      materialName: i.material?.name ?? null,
      qty: i.qty,
    })),
  };
}

async function getBatch(branchId: string, stage: BatchStage, id: string, manager?: EntityManager) {
  const batch = await detailed(branchId, manager)
    .andWhere('mb.id = :id AND mb.stage = :stage', { id, stage })
    .getOne();
  if (!batch) throw AppError.notFound(LABEL[stage]);
  return batch;
}

async function assertMaterials(branchId: string, items: { materialId: string }[], manager: EntityManager) {
  const ids = items.map((i) => i.materialId);
  if ((await materialsRepository.findByIds(branchId, ids, manager)).length !== ids.length) {
    throw AppError.badRequest('One or more materials do not exist in this branch');
  }
}

async function insertBatch(
  manager: EntityManager,
  actor: Actor,
  branchId: string,
  data: Partial<MaterialBatch>,
  items: { materialId: string; qty: string }[],
) {
  const batch = await batchesRepository.create(branchId, actor.userId, data, manager);
  const itemsRepo = repo(MaterialBatchItem, manager);
  await itemsRepo.save(
    items.map((i) => itemsRepo.create({ batchId: batch.id, materialId: i.materialId, qty: i.qty as never })),
  );
  return batch;
}

const ref = (actor: Actor, branchId: string, stage: BatchStage, id: string) => ({
  branchId,
  referenceType: REFERENCE[stage],
  referenceId: id,
  actorId: actor.userId,
});

function listService(stage: BatchStage) {
  return {
    async list(branchId: string, query: BatchListQuery) {
      const qb = batchesRepository.query(branchId).andWhere('mb.stage = :stage', { stage });
      if (query.from) qb.andWhere('mb.date >= :from', { from: query.from });
      if (query.to) qb.andWhere('mb.date <= :to', { to: query.to });
      const page = await paginate(qb, query, {
        searchColumns: ['mb.batchNo', 'mb.note'],
        sortMap: { date: 'mb.date', createdAt: 'mb.createdAt', batchNo: 'mb.batchNo' },
      });
      const ids = page.items.map((b) => b.id);
      const full = ids.length
        ? await detailed(branchId).andWhere('mb.id IN (:...ids)', { ids }).getMany()
        : [];
      const byId = new Map(full.map((b) => [b.id, b]));
      return { items: page.items.map((b) => toBatchDto(byId.get(b.id) ?? b)), meta: page.meta };
    },

    async get(branchId: string, id: string) {
      return toBatchDto(await getBatch(branchId, stage, id));
    },
  };
}

async function removeBatch(actor: Actor, branchId: string, stage: BatchStage, id: string) {
  await withTransaction(async (em) => {
    const batch = await getBatch(branchId, stage, id, em);
    if (stage === 'pharmacy_lab') {
      const used = await batchesRepository.count(branchId, { labBatchId: id }, em);
      if (used > 0)
        throw AppError.conflict('Production batches already use this lab batch. Remove them first.');
    }
    const reference = ref(actor, branchId, stage, id);
    await materialLedger.reverse(em, reference, `${LABEL[stage]} removed`);
    if (stage === 'finished_product') await stockLedger.reverse(em, reference, 'Production batch removed');
    await batchesRepository.softDelete(batch, actor.userId, em);
    await auditService.record(
      {
        actor,
        branchId,
        action: 'delete',
        entity: REFERENCE[stage],
        entityId: id,
        before: toBatchDto(batch),
      },
      em,
    );
  });
}

export const labTransfersService = {
  ...listService('pharmacy_lab'),

  async options(branchId: string) {
    return batchesRepository
      .query(branchId)
      .select(['mb.id', 'mb.batchNo', 'mb.date'])
      .andWhere("mb.stage = 'pharmacy_lab'")
      .orderBy('mb.date', 'DESC')
      .getMany();
  },

  async create(actor: Actor, branchId: string, input: CreateLabTransferInput) {
    return withTransaction(async (em) => {
      await assertMaterials(branchId, input.items, em);
      const existing = await batchesRepository.findOneBy(
        branchId,
        { batchNo: input.batchNo, stage: 'pharmacy_lab' },
        em,
      );
      if (existing) throw AppError.conflict(`Batch ${input.batchNo} already exists`);
      const batch = await insertBatch(
        em,
        actor,
        branchId,
        { batchNo: input.batchNo, stage: 'pharmacy_lab', date: input.date, note: input.note ?? null },
        input.items,
      );
      await materialLedger.apply(
        em,
        ref(actor, branchId, 'pharmacy_lab', batch.id),
        input.items.flatMap((i) => [
          {
            materialId: i.materialId,
            location: 'store' as const,
            type: 'material_out_to_lab' as const,
            qty: new Decimal(i.qty).negated(),
            date: input.date,
          },
          {
            materialId: i.materialId,
            location: 'lab' as const,
            type: 'material_out_to_lab' as const,
            qty: i.qty,
            date: input.date,
          },
        ]),
      );
      const dto = toBatchDto(await getBatch(branchId, 'pharmacy_lab', batch.id, em));
      await auditService.record(
        { actor, branchId, action: 'create', entity: 'lab_transfer', entityId: batch.id, after: dto },
        em,
      );
      return dto;
    });
  },

  remove: (actor: Actor, branchId: string, id: string) => removeBatch(actor, branchId, 'pharmacy_lab', id),
};

export const productionsService = {
  ...listService('finished_product'),

  async create(actor: Actor, branchId: string, input: CreateProductionInput) {
    return withTransaction(async (em) => {
      const labBatch = await getBatch(branchId, 'pharmacy_lab', input.labBatchId, em);
      await assertMaterials(branchId, input.items, em);
      if (input.productId && !(await productsRepository.findById(branchId, input.productId, em))) {
        throw AppError.badRequest('The selected product does not exist in this branch');
      }
      const batch = await insertBatch(
        em,
        actor,
        branchId,
        {
          batchNo: labBatch.batchNo,
          stage: 'finished_product',
          date: input.date,
          note: input.note ?? null,
          labBatchId: labBatch.id,
          productId: input.productId ?? null,
          producedQty: (input.producedQty ?? null) as never,
        },
        input.items,
      );
      const reference = ref(actor, branchId, 'finished_product', batch.id);
      await materialLedger.apply(
        em,
        reference,
        input.items.map((i) => ({
          materialId: i.materialId,
          location: 'lab' as const,
          type: 'used_in_production' as const,
          qty: new Decimal(i.qty).negated(),
          date: input.date,
        })),
      );
      if (input.productId && input.producedQty) {
        await stockLedger.apply(em, reference, [
          {
            productId: input.productId,
            type: 'manufacturing_in',
            qty: input.producedQty,
            date: input.date,
            note: `Production batch ${labBatch.batchNo}`,
          },
        ]);
      }
      const dto = toBatchDto(await getBatch(branchId, 'finished_product', batch.id, em));
      await auditService.record(
        { actor, branchId, action: 'create', entity: 'production', entityId: batch.id, after: dto },
        em,
      );
      return dto;
    });
  },

  remove: (actor: Actor, branchId: string, id: string) =>
    removeBatch(actor, branchId, 'finished_product', id),
};
