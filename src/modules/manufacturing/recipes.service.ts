import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo, withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { paginate } from '../../lib/pagination';
import { today } from '../../lib/validation';
import { auditService } from '../audit/audit.service';
import { productsRepository } from '../products/products.repository';
import { materialsRepository } from './materials.service';
import {
  type CreateRecipeInput,
  type RecipeListQuery,
  type UpdateRecipeInput,
} from './manufacturing.schemas';
import { ProductRecipe, RecipeItem } from './product-recipe.entity';

const recipesRepository = branchScopedRepository(ProductRecipe, 'r');

const detailed = (branchId: string, manager?: EntityManager) =>
  recipesRepository
    .query(branchId, manager)
    .leftJoinAndSelect('r.product', 'product')
    .leftJoinAndSelect('r.items', 'item')
    .leftJoinAndSelect('item.material', 'material');

function toRecipeDto(recipe: ProductRecipe) {
  const { product, items, ...rest } = withoutInternals(recipe);
  return {
    ...rest,
    product: product ? { id: product.id, name: product.name } : null,
    items: (items ?? [])
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((i) => ({ materialId: i.materialId, materialName: i.material?.name ?? null, qty: i.qty })),
  };
}

async function getRecipe(branchId: string, id: string, manager?: EntityManager) {
  const recipe = await detailed(branchId, manager).andWhere('r.id = :id', { id }).getOne();
  if (!recipe) throw AppError.notFound('Recipe');
  return recipe;
}

async function assertProduct(branchId: string, productId: string, manager: EntityManager) {
  if (!(await productsRepository.findById(branchId, productId, manager))) {
    throw AppError.badRequest('The selected product does not exist in this branch');
  }
}

async function replaceItems(
  branchId: string,
  recipeId: string,
  items: CreateRecipeInput['items'],
  manager: EntityManager,
) {
  const ids = items.map((i) => i.materialId);
  if ((await materialsRepository.findByIds(branchId, ids, manager)).length !== ids.length) {
    throw AppError.badRequest('One or more materials do not exist in this branch');
  }
  const itemsRepo = repo(RecipeItem, manager);
  await itemsRepo.delete({ recipeId });
  await itemsRepo.save(
    items.map((i) => itemsRepo.create({ recipeId, materialId: i.materialId, qty: (i.qty ?? null) as never })),
  );
}

export const recipesService = {
  async list(branchId: string, query: RecipeListQuery) {
    const qb = recipesRepository.query(branchId).leftJoinAndSelect('r.product', 'product');
    if (query.productId) qb.andWhere('r.productId = :productId', { productId: query.productId });
    const page = await paginate(qb, query, {
      searchColumns: ['product.name', 'r.note'],
      sortMap: { date: 'r.date', createdAt: 'r.createdAt' },
    });
    const ids = page.items.map((r) => r.id);
    const full = ids.length ? await detailed(branchId).andWhere('r.id IN (:...ids)', { ids }).getMany() : [];
    const byId = new Map(full.map((r) => [r.id, r]));
    return { items: page.items.map((r) => toRecipeDto(byId.get(r.id) ?? r)), meta: page.meta };
  },

  async options(branchId: string) {
    const recipes = await recipesRepository
      .query(branchId)
      .leftJoinAndSelect('r.product', 'product')
      .orderBy('product.name', 'ASC')
      .getMany();
    return recipes.map((r) => ({ id: r.id, productId: r.productId, productName: r.product?.name ?? '' }));
  },

  async get(branchId: string, id: string) {
    return toRecipeDto(await getRecipe(branchId, id));
  },

  async create(actor: Actor, branchId: string, input: CreateRecipeInput) {
    return withTransaction(async (em) => {
      await assertProduct(branchId, input.productId, em);
      const recipe = await recipesRepository.create(
        branchId,
        actor.userId,
        { productId: input.productId, date: input.date ?? today(), note: input.note ?? null },
        em,
      );
      await replaceItems(branchId, recipe.id, input.items, em);
      const dto = toRecipeDto(await getRecipe(branchId, recipe.id, em));
      await auditService.record(
        { actor, branchId, action: 'create', entity: 'recipe', entityId: recipe.id, after: dto },
        em,
      );
      return dto;
    });
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateRecipeInput) {
    return withTransaction(async (em) => {
      const recipe = await getRecipe(branchId, id, em);
      const before = toRecipeDto(recipe);
      if (input.productId) await assertProduct(branchId, input.productId, em);
      if (input.items) await replaceItems(branchId, id, input.items, em);
      const { items: _items, ...fields } = input;
      Object.assign(recipe, fields, { updatedBy: actor.userId });
      delete recipe.items;
      delete recipe.product;
      await recipesRepository.save(recipe, em);
      const after = toRecipeDto(await getRecipe(branchId, id, em));
      await auditService.record(
        { actor, branchId, action: 'update', entity: 'recipe', entityId: id, before, after },
        em,
      );
      return after;
    });
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const recipe = await getRecipe(branchId, id, em);
      await recipesRepository.softDelete(recipe, actor.userId, em);
      await auditService.record(
        { actor, branchId, action: 'delete', entity: 'recipe', entityId: id, before: toRecipeDto(recipe) },
        em,
      );
    });
  },
};
