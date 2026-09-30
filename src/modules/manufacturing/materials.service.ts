import Decimal from 'decimal.js';
import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { AppDataSource } from '../../database/data-source';
import { withTransaction } from '../../database/transaction';
import { toQuantity } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { paginate, type ListQuery } from '../../lib/pagination';
import { auditService } from '../audit/audit.service';
import { MaterialCategory } from './material-category.entity';
import { materialLedger } from './material-ledger';
import { MaterialReceipt } from './material-receipt.entity';
import { Material } from './material.entity';
import {
  type CreateMaterialCategoryInput,
  type CreateMaterialInput,
  type CreateReceiptInput,
  type MaterialListQuery,
  type UpdateMaterialCategoryInput,
  type UpdateMaterialInput,
  type UpdateReceiptInput,
} from './manufacturing.schemas';

export const materialCategoriesRepository = branchScopedRepository(MaterialCategory, 'mc');
export const materialsRepository = branchScopedRepository(Material, 'mat');
const receiptsRepository = branchScopedRepository(MaterialReceipt, 'mr');

const RECEIPT_REFERENCE = 'material_receipt';

async function getCategory(branchId: string, id: string, manager?: EntityManager) {
  const category = await materialCategoriesRepository.findById(branchId, id, manager);
  if (!category) throw AppError.notFound('Material category');
  return category;
}

async function assertCategoryNameAvailable(branchId: string, name: string, excludeId?: string) {
  const existing = await materialCategoriesRepository
    .query(branchId)
    .andWhere('lower(mc.name) = lower(:name)', { name })
    .getOne();
  if (existing && existing.id !== excludeId)
    throw AppError.conflict(`Material category "${name}" is already added`);
}

export const materialCategoriesService = {
  async list(branchId: string, query: ListQuery) {
    const { items, meta } = await paginate(materialCategoriesRepository.query(branchId), query, {
      searchColumns: ['mc.name'],
      sortMap: { name: 'mc.name', createdAt: 'mc.createdAt' },
    });
    return { items: items.map(withoutInternals), meta };
  },

  options: (branchId: string) =>
    materialCategoriesRepository
      .query(branchId)
      .select(['mc.id', 'mc.name'])
      .orderBy('mc.name', 'ASC')
      .getMany(),

  async get(branchId: string, id: string) {
    return withoutInternals(await getCategory(branchId, id));
  },

  async create(actor: Actor, branchId: string, input: CreateMaterialCategoryInput) {
    await assertCategoryNameAvailable(branchId, input.name);
    return withoutInternals(await materialCategoriesRepository.create(branchId, actor.userId, input));
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateMaterialCategoryInput) {
    const category = await getCategory(branchId, id);
    if (input.name) await assertCategoryNameAvailable(branchId, input.name, id);
    Object.assign(category, input, { updatedBy: actor.userId });
    return withoutInternals(await materialCategoriesRepository.save(category));
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const category = await getCategory(branchId, id, em);
      if ((await materialsRepository.count(branchId, { categoryId: id }, em)) > 0) {
        throw AppError.conflict('Materials still use this category. Move or remove them first.');
      }
      await materialCategoriesRepository.softDelete(category, actor.userId, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'delete',
          entity: 'material_category',
          entityId: id,
          before: withoutInternals(category),
        },
        em,
      );
    });
  },
};

async function balancesByMaterial(branchId: string, ids: string[], manager?: EntityManager) {
  if (ids.length === 0) return new Map<string, Decimal>();
  return materialLedger.balances(manager ?? AppDataSource.manager, branchId, ids);
}

function toMaterialDto(material: Material, balances: Map<string, Decimal>) {
  const { category, ...rest } = withoutInternals(material);
  return {
    ...rest,
    category: category ? { id: category.id, name: category.name } : null,
    storeQuantity: toQuantity(balances.get(`${material.id}:store`) ?? 0),
    labQuantity: toQuantity(balances.get(`${material.id}:lab`) ?? 0),
  };
}

function toReceiptDto(receipt: MaterialReceipt) {
  return {
    id: receipt.id,
    materialId: receipt.materialId,
    date: receipt.date,
    quantity: receipt.quantity,
    place: receipt.place,
    note: receipt.note,
    createdAt: receipt.createdAt,
  };
}

async function getMaterial(branchId: string, id: string, manager?: EntityManager) {
  const material = await materialsRepository
    .query(branchId, manager)
    .leftJoinAndSelect('mat.category', 'category')
    .andWhere('mat.id = :id', { id })
    .getOne();
  if (!material) throw AppError.notFound('Material');
  return material;
}

async function materialDto(branchId: string, id: string, manager?: EntityManager) {
  const material = await getMaterial(branchId, id, manager);
  return toMaterialDto(material, await balancesByMaterial(branchId, [id], manager));
}

async function getReceipt(branchId: string, materialId: string, id: string, manager?: EntityManager) {
  const receipt = await receiptsRepository.findOneBy(branchId, { id, materialId }, manager);
  if (!receipt) throw AppError.notFound('Material receipt');
  return receipt;
}

function receiptMovement(receipt: MaterialReceipt) {
  return {
    materialId: receipt.materialId,
    location: 'store' as const,
    type: 'material_in' as const,
    qty: receipt.quantity,
    date: receipt.date,
    note: receipt.note,
  };
}

const receiptRef = (actor: Actor, receipt: MaterialReceipt) => ({
  branchId: receipt.branchId,
  referenceType: RECEIPT_REFERENCE,
  referenceId: receipt.id,
  actorId: actor.userId,
});

async function insertReceipt(
  manager: EntityManager,
  actor: Actor,
  branchId: string,
  materialId: string,
  input: CreateReceiptInput,
) {
  const receipt = await receiptsRepository.create(
    branchId,
    actor.userId,
    {
      materialId,
      date: input.date,
      quantity: input.quantity as never,
      place: input.place ?? 'falcon',
      note: input.note ?? null,
    },
    manager,
  );
  await materialLedger.apply(manager, receiptRef(actor, receipt), [receiptMovement(receipt)]);
  await auditService.record(
    {
      actor,
      branchId,
      action: 'create',
      entity: 'material_receipt',
      entityId: receipt.id,
      after: toReceiptDto(receipt),
    },
    manager,
  );
  return receipt;
}

async function assertMaterialCategory(branchId: string, categoryId: string, manager?: EntityManager) {
  if (!(await materialCategoriesRepository.findById(branchId, categoryId, manager))) {
    throw AppError.badRequest('The selected material category does not exist in this branch');
  }
}

export const materialsService = {
  async list(branchId: string, query: MaterialListQuery) {
    const qb = materialsRepository.query(branchId).leftJoinAndSelect('mat.category', 'category');
    if (query.categoryId) qb.andWhere('mat.categoryId = :categoryId', { categoryId: query.categoryId });
    const { items, meta } = await paginate(qb, query, {
      searchColumns: ['mat.name', 'category.name'],
      sortMap: { name: 'mat.name', createdAt: 'mat.createdAt' },
    });
    const balances = await balancesByMaterial(
      branchId,
      items.map((m) => m.id),
    );
    return { items: items.map((m) => toMaterialDto(m, balances)), meta };
  },

  options: (branchId: string) =>
    materialsRepository
      .query(branchId)
      .select(['mat.id', 'mat.name', 'mat.unit'])
      .orderBy('mat.name', 'ASC')
      .getMany(),

  get: (branchId: string, id: string) => materialDto(branchId, id),

  async create(actor: Actor, branchId: string, input: CreateMaterialInput) {
    const { initialReceipt, ...fields } = input;
    return withTransaction(async (em) => {
      await assertMaterialCategory(branchId, fields.categoryId, em);
      const material = await materialsRepository.create(
        branchId,
        actor.userId,
        fields as Partial<Material>,
        em,
      );
      if (initialReceipt) await insertReceipt(em, actor, branchId, material.id, initialReceipt);
      const dto = await materialDto(branchId, material.id, em);
      await auditService.record(
        { actor, branchId, action: 'create', entity: 'material', entityId: material.id, after: dto },
        em,
      );
      return dto;
    });
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateMaterialInput) {
    return withTransaction(async (em) => {
      const material = await getMaterial(branchId, id, em);
      if (input.categoryId) await assertMaterialCategory(branchId, input.categoryId, em);
      const before = await materialDto(branchId, id, em);
      Object.assign(material, input, { updatedBy: actor.userId });
      delete material.category;
      if (new Decimal(material.bareMinimum).greaterThan(material.minimum)) {
        throw AppError.badRequest('Bare minimum cannot be above minimum');
      }
      await materialsRepository.save(material, em);
      const after = await materialDto(branchId, id, em);
      await auditService.record(
        { actor, branchId, action: 'update', entity: 'material', entityId: id, before, after },
        em,
      );
      return after;
    });
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const before = await materialDto(branchId, id, em);
      const material = await getMaterial(branchId, id, em);
      await materialsRepository.softDelete(material, actor.userId, em);
      await auditService.record(
        { actor, branchId, action: 'delete', entity: 'material', entityId: id, before },
        em,
      );
    });
  },

  async listReceipts(branchId: string, materialId: string, query: ListQuery) {
    await getMaterial(branchId, materialId);
    const qb = receiptsRepository.query(branchId).andWhere('mr.materialId = :materialId', { materialId });
    const { items, meta } = await paginate(qb, query, {
      searchColumns: ['mr.note'],
      sortMap: { date: 'mr.date', createdAt: 'mr.createdAt' },
    });
    return { items: items.map(toReceiptDto), meta };
  },

  async addReceipt(actor: Actor, branchId: string, materialId: string, input: CreateReceiptInput) {
    return withTransaction(async (em) => {
      await getMaterial(branchId, materialId, em);
      return toReceiptDto(await insertReceipt(em, actor, branchId, materialId, input));
    });
  },

  async updateReceipt(
    actor: Actor,
    branchId: string,
    materialId: string,
    id: string,
    input: UpdateReceiptInput,
  ) {
    return withTransaction(async (em) => {
      const receipt = await getReceipt(branchId, materialId, id, em);
      const before = toReceiptDto(receipt);
      Object.assign(receipt, input, { updatedBy: actor.userId });
      const saved = await receiptsRepository.save(receipt, em);
      await materialLedger.replace(em, receiptRef(actor, saved), [receiptMovement(saved)]);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'update',
          entity: 'material_receipt',
          entityId: id,
          before,
          after: toReceiptDto(saved),
        },
        em,
      );
      return toReceiptDto(saved);
    });
  },

  async removeReceipt(actor: Actor, branchId: string, materialId: string, id: string) {
    await withTransaction(async (em) => {
      const receipt = await getReceipt(branchId, materialId, id, em);
      await materialLedger.reverse(em, receiptRef(actor, receipt), 'Material receipt removed');
      await receiptsRepository.softDelete(receipt, actor.userId, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'delete',
          entity: 'material_receipt',
          entityId: id,
          before: toReceiptDto(receipt),
        },
        em,
      );
    });
  },
};
