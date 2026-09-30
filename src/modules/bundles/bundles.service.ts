import Decimal from 'decimal.js';
import { type EntityManager } from 'typeorm';
import { withTransaction } from '../../database/transaction';
import { toMoney } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { type ListQuery } from '../../lib/pagination';
import { BUCKETS, publicUrl, replaceFile } from '../../lib/storage';
import { auditService } from '../audit/audit.service';
import { productsRepository } from '../products/products.repository';
import { type Bundle } from './bundle.entity';
import { bundlesRepository } from './bundles.repository';
import { type BundleItemInput, type CreateBundleInput, type UpdateBundleInput } from './bundles.schemas';

export function toBundleDto(bundle: Bundle) {
  const { items, ...rest } = withoutInternals(bundle);
  return {
    ...rest,
    imageUrl: publicUrl(BUCKETS.productImages, bundle.imagePath),
    items: (items ?? [])
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product?.name ?? null,
        qty: item.qty,
        price: item.price,
      })),
  };
}

async function getBundle(branchId: string, id: string, manager?: EntityManager) {
  const bundle = await bundlesRepository.findWithItems(branchId, id, manager);
  if (!bundle) throw AppError.notFound('Bundle');
  return bundle;
}

async function prepareItems(branchId: string, items: BundleItemInput[], manager: EntityManager) {
  const productIds = items.map((i) => i.productId);
  const products = await productsRepository.findByIds(branchId, productIds, manager);
  if (products.length !== productIds.length) {
    throw AppError.badRequest('One or more products do not exist in this branch');
  }
  const rows = items.map((i) => ({
    productId: i.productId,
    qty: new Decimal(i.qty ?? '1'),
    price: toMoney(i.price),
  }));
  const totalPrice = toMoney(rows.reduce((sum, r) => sum.plus(r.price.times(r.qty)), new Decimal(0)));
  return { rows, totalPrice };
}

export const bundlesService = {
  async list(branchId: string, query: ListQuery) {
    const { items, meta } = await bundlesRepository.list(branchId, query);
    return { items: items.map(toBundleDto), meta };
  },

  options: (branchId: string) => bundlesRepository.options(branchId),

  async get(branchId: string, id: string) {
    return toBundleDto(await getBundle(branchId, id));
  },

  async create(actor: Actor, branchId: string, input: CreateBundleInput) {
    return withTransaction(async (em) => {
      const { rows, totalPrice } = await prepareItems(branchId, input.items, em);
      const bundle = await bundlesRepository.create(
        branchId,
        actor.userId,
        { name: input.name, totalPrice },
        em,
      );
      await bundlesRepository.replaceItems(bundle.id, rows, em);
      const saved = await getBundle(branchId, bundle.id, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'create',
          entity: 'bundle',
          entityId: bundle.id,
          after: toBundleDto(saved),
        },
        em,
      );
      return toBundleDto(saved);
    });
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateBundleInput) {
    return withTransaction(async (em) => {
      const bundle = await getBundle(branchId, id, em);
      const before = toBundleDto(bundle);
      if (input.name) bundle.name = input.name;
      if (input.items) {
        const { rows, totalPrice } = await prepareItems(branchId, input.items, em);
        await bundlesRepository.replaceItems(id, rows, em);
        bundle.totalPrice = totalPrice;
      }
      bundle.updatedBy = actor.userId;
      delete bundle.items;
      await bundlesRepository.save(bundle, em);
      const saved = await getBundle(branchId, id, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'update',
          entity: 'bundle',
          entityId: id,
          before,
          after: toBundleDto(saved),
        },
        em,
      );
      return toBundleDto(saved);
    });
  },

  async uploadImage(actor: Actor, branchId: string, id: string, file: Express.Multer.File) {
    const bundle = await getBundle(branchId, id);
    const { path } = await replaceFile(
      {
        bucket: BUCKETS.productImages,
        prefix: `${branchId}/bundles/${id}`,
        originalName: file.originalname,
        buffer: file.buffer,
        contentType: file.mimetype,
      },
      bundle.imagePath,
    );
    bundle.imagePath = path;
    bundle.updatedBy = actor.userId;
    delete bundle.items;
    await bundlesRepository.save(bundle);
    return toBundleDto(await getBundle(branchId, id));
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const bundle = await getBundle(branchId, id, em);
      await bundlesRepository.softDelete(bundle, actor.userId, em);
      await auditService.record(
        { actor, branchId, action: 'delete', entity: 'bundle', entityId: id, before: toBundleDto(bundle) },
        em,
      );
    });
  },
};
