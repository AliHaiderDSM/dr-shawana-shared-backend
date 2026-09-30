import { type EntityManager } from 'typeorm';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { type ListQuery } from '../../lib/pagination';
import { BUCKETS, publicUrl, replaceFile } from '../../lib/storage';
import { auditService } from '../audit/audit.service';
import { productsRepository } from '../products/products.repository';
import { type Category } from './category.entity';
import { categoriesRepository } from './categories.repository';
import { type CreateCategoryInput, type UpdateCategoryInput } from './categories.schemas';

export function toCategoryDto(category: Category) {
  return { ...withoutInternals(category), imageUrl: publicUrl(BUCKETS.productImages, category.imagePath) };
}

async function getCategory(branchId: string, id: string, manager?: EntityManager) {
  const category = await categoriesRepository.findById(branchId, id, manager);
  if (!category) throw AppError.notFound('Category');
  return category;
}

async function assertNameAvailable(branchId: string, name: string, excludeId?: string) {
  const existing = await categoriesRepository.findByName(branchId, name);
  if (existing && existing.id !== excludeId) throw AppError.conflict(`Category "${name}" is already added`);
}

export const categoriesService = {
  async list(branchId: string, query: ListQuery) {
    const { items, meta } = await categoriesRepository.list(branchId, query);
    return { items: items.map(toCategoryDto), meta };
  },

  options(branchId: string) {
    return categoriesRepository.options(branchId);
  },

  async get(branchId: string, id: string) {
    return toCategoryDto(await getCategory(branchId, id));
  },

  async create(actor: Actor, branchId: string, input: CreateCategoryInput) {
    await assertNameAvailable(branchId, input.name);
    return toCategoryDto(await categoriesRepository.create(branchId, actor.userId, input));
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateCategoryInput) {
    const category = await getCategory(branchId, id);
    if (input.name) await assertNameAvailable(branchId, input.name, id);
    Object.assign(category, input, { updatedBy: actor.userId });
    return toCategoryDto(await categoriesRepository.save(category));
  },

  async uploadImage(actor: Actor, branchId: string, id: string, file: Express.Multer.File) {
    const category = await getCategory(branchId, id);
    const { path } = await replaceFile(
      {
        bucket: BUCKETS.productImages,
        prefix: `${branchId}/categories/${id}`,
        originalName: file.originalname,
        buffer: file.buffer,
        contentType: file.mimetype,
      },
      category.imagePath,
    );
    category.imagePath = path;
    category.updatedBy = actor.userId;
    return toCategoryDto(await categoriesRepository.save(category));
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const category = await getCategory(branchId, id, em);
      if ((await productsRepository.count(branchId, { categoryId: id }, em)) > 0) {
        throw AppError.conflict('Products still use this category. Move or remove them first.');
      }
      await categoriesRepository.softDelete(category, actor.userId, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'delete',
          entity: 'category',
          entityId: id,
          before: toCategoryDto(category),
        },
        em,
      );
    });
  },
};
