import Decimal from 'decimal.js';
import { type EntityManager } from 'typeorm';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { type ListQuery } from '../../lib/pagination';
import { BUCKETS, publicUrl, replaceFile } from '../../lib/storage';
import { auditService } from '../audit/audit.service';
import { categoriesRepository } from '../categories/categories.repository';
import { stockLedger } from '../inventory/stock-ledger';
import { suppliersRepository } from '../suppliers/suppliers.repository';
import { type ProductPurchaseEntry } from './product-purchase-entry.entity';
import { type Product } from './product.entity';
import { productsRepository, purchaseEntriesRepository } from './products.repository';
import {
  type CreateProductInput,
  type CreatePurchaseInput,
  type ProductListQuery,
  type UpdateProductInput,
  type UpdatePurchaseInput,
} from './products.schemas';

const PURCHASE_REFERENCE = 'product_purchase';

export function toProductDto(product: Product) {
  const { category, ...rest } = withoutInternals(product);
  return {
    ...rest,
    category: category ? { id: category.id, name: category.name } : null,
    imageUrl: publicUrl(BUCKETS.productImages, product.imagePath),
  };
}

export function toPurchaseDto(entry: ProductPurchaseEntry) {
  return {
    id: entry.id,
    productId: entry.productId,
    supplierId: entry.supplierId,
    supplier: entry.supplier ? { id: entry.supplier.id, name: entry.supplier.name } : null,
    date: entry.date,
    quantity: entry.quantity,
    unitPrice: entry.unitPrice,
    note: entry.note,
    createdAt: entry.createdAt,
  };
}

async function getProduct(branchId: string, id: string, manager?: EntityManager) {
  const product = await productsRepository.findWithCategory(branchId, id, manager);
  if (!product) throw AppError.notFound('Product');
  return product;
}

async function getEntry(branchId: string, productId: string, id: string, manager?: EntityManager) {
  const entry = await purchaseEntriesRepository.findForProduct(branchId, productId, id, manager);
  if (!entry) throw AppError.notFound('Purchase entry');
  return entry;
}

async function assertCategory(branchId: string, categoryId: string, manager?: EntityManager) {
  if (!(await categoriesRepository.findById(branchId, categoryId, manager))) {
    throw AppError.badRequest('The selected category does not exist in this branch');
  }
}

async function assertSupplier(
  branchId: string,
  supplierId: string | null | undefined,
  manager?: EntityManager,
) {
  if (supplierId && !(await suppliersRepository.findById(branchId, supplierId, manager))) {
    throw AppError.badRequest('The selected supplier does not exist in this branch');
  }
}

async function assertSkuAvailable(branchId: string, sku: string | null | undefined, excludeId?: string) {
  if (sku && (await productsRepository.findSkuConflict(branchId, sku, excludeId))) {
    throw AppError.conflict(`SKU ${sku} is already used by another product`);
  }
}

async function assertBarcodeAvailable(
  branchId: string,
  barcode: string | null | undefined,
  excludeId?: string,
) {
  const owner = barcode ? await productsRepository.findBarcodeConflict(branchId, barcode, excludeId) : null;
  if (owner) throw AppError.conflict(`Barcode ${barcode} is already used by ${owner.name}`);
}

async function syncSalePriceWithLatestEntry(branchId: string, product: Product, manager: EntityManager) {
  const latest = await purchaseEntriesRepository.latestForProduct(branchId, product.id, manager);
  if (latest && !new Decimal(latest.unitPrice).equals(product.salePrice)) {
    product.salePrice = latest.unitPrice;
    await productsRepository.save(product, manager);
  }
}

function postPurchase(
  manager: EntityManager,
  actor: Actor,
  entry: ProductPurchaseEntry,
  mode: 'apply' | 'replace',
) {
  const ref = {
    branchId: entry.branchId,
    referenceType: PURCHASE_REFERENCE,
    referenceId: entry.id,
    actorId: actor.userId,
  };
  const movement = {
    productId: entry.productId,
    type: 'purchase_in' as const,
    qty: entry.quantity,
    unitCost: entry.unitPrice,
    date: entry.date,
    note: entry.note,
  };
  return mode === 'apply'
    ? stockLedger.apply(manager, ref, [movement])
    : stockLedger.replace(manager, ref, [movement]);
}

async function insertPurchase(
  manager: EntityManager,
  actor: Actor,
  branchId: string,
  product: Product,
  input: CreatePurchaseInput,
) {
  await assertSupplier(branchId, input.supplierId, manager);
  const entry = await purchaseEntriesRepository.create(
    branchId,
    actor.userId,
    {
      productId: product.id,
      supplierId: input.supplierId ?? null,
      date: input.date,
      quantity: input.quantity as never,
      unitPrice: input.unitPrice as never,
      note: input.note ?? null,
    },
    manager,
  );
  await postPurchase(manager, actor, entry, 'apply');
  await syncSalePriceWithLatestEntry(branchId, product, manager);
  await auditService.record(
    {
      actor,
      branchId,
      action: 'create',
      entity: 'product_purchase',
      entityId: entry.id,
      after: toPurchaseDto(entry),
    },
    manager,
  );
  return entry;
}

export const productsService = {
  async list(branchId: string, query: ProductListQuery) {
    const { items, meta } = await productsRepository.list(branchId, query);
    return { items: items.map(toProductDto), meta };
  },

  options: (branchId: string) => productsRepository.options(branchId),

  async findByBarcode(branchId: string, barcode: string) {
    const product = await productsRepository.findByBarcode(branchId, barcode);
    if (!product) throw AppError.notFound(`No product has barcode ${barcode}`);
    return toProductDto(product);
  },

  async get(branchId: string, id: string) {
    return toProductDto(await getProduct(branchId, id));
  },

  async create(actor: Actor, branchId: string, input: CreateProductInput) {
    const { initialPurchase, ...fields } = input;
    await assertSkuAvailable(branchId, fields.sku);
    await assertBarcodeAvailable(branchId, fields.barcode);
    return withTransaction(async (em) => {
      await assertCategory(branchId, fields.categoryId, em);
      const created = await productsRepository.create(branchId, actor.userId, fields as Partial<Product>, em);
      if (initialPurchase) await insertPurchase(em, actor, branchId, created, initialPurchase);
      const product = await getProduct(branchId, created.id, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'create',
          entity: 'product',
          entityId: product.id,
          after: toProductDto(product),
        },
        em,
      );
      return toProductDto(product);
    });
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateProductInput) {
    if (input.sku) await assertSkuAvailable(branchId, input.sku, id);
    if (input.barcode) await assertBarcodeAvailable(branchId, input.barcode, id);
    return withTransaction(async (em) => {
      const product = await getProduct(branchId, id, em);
      if (input.categoryId) await assertCategory(branchId, input.categoryId, em);
      const before = toProductDto(product);
      Object.assign(product, input, { updatedBy: actor.userId });
      if (input.categoryId) delete product.category;
      await productsRepository.save(product, em);
      const saved = await getProduct(branchId, id, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'update',
          entity: 'product',
          entityId: id,
          before,
          after: toProductDto(saved),
        },
        em,
      );
      return toProductDto(saved);
    });
  },

  async uploadImage(actor: Actor, branchId: string, id: string, file: Express.Multer.File) {
    const product = await getProduct(branchId, id);
    const { path } = await replaceFile(
      {
        bucket: BUCKETS.productImages,
        prefix: `${branchId}/${id}`,
        originalName: file.originalname,
        buffer: file.buffer,
        contentType: file.mimetype,
      },
      product.imagePath,
    );
    product.imagePath = path;
    product.updatedBy = actor.userId;
    return toProductDto(await productsRepository.save(product));
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const product = await getProduct(branchId, id, em);
      await productsRepository.softDelete(product, actor.userId, em);
      await auditService.record(
        { actor, branchId, action: 'delete', entity: 'product', entityId: id, before: toProductDto(product) },
        em,
      );
    });
  },

  async listPurchases(branchId: string, productId: string, query: ListQuery) {
    await getProduct(branchId, productId);
    const { items, meta } = await purchaseEntriesRepository.listForProduct(branchId, productId, query);
    return { items: items.map(toPurchaseDto), meta };
  },

  async addPurchase(actor: Actor, branchId: string, productId: string, input: CreatePurchaseInput) {
    return withTransaction(async (em) => {
      const product = await getProduct(branchId, productId, em);
      const entry = await insertPurchase(em, actor, branchId, product, input);
      return toPurchaseDto(await getEntry(branchId, productId, entry.id, em));
    });
  },

  async updatePurchase(
    actor: Actor,
    branchId: string,
    productId: string,
    id: string,
    input: UpdatePurchaseInput,
  ) {
    return withTransaction(async (em) => {
      const product = await getProduct(branchId, productId, em);
      const entry = await getEntry(branchId, productId, id, em);
      await assertSupplier(branchId, input.supplierId, em);
      const before = toPurchaseDto(entry);
      Object.assign(entry, input, { updatedBy: actor.userId });
      delete entry.supplier;
      await purchaseEntriesRepository.save(entry, em);
      await postPurchase(em, actor, entry, 'replace');
      await syncSalePriceWithLatestEntry(branchId, product, em);
      const saved = await getEntry(branchId, productId, id, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'update',
          entity: 'product_purchase',
          entityId: id,
          before,
          after: toPurchaseDto(saved),
        },
        em,
      );
      return toPurchaseDto(saved);
    });
  },

  async removePurchase(actor: Actor, branchId: string, productId: string, id: string) {
    await withTransaction(async (em) => {
      const product = await getProduct(branchId, productId, em);
      const entry = await getEntry(branchId, productId, id, em);
      await stockLedger.reverse(
        em,
        { branchId, referenceType: PURCHASE_REFERENCE, referenceId: id, actorId: actor.userId },
        'Purchase entry removed',
      );
      await purchaseEntriesRepository.softDelete(entry, actor.userId, em);
      await syncSalePriceWithLatestEntry(branchId, product, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'delete',
          entity: 'product_purchase',
          entityId: id,
          before: toPurchaseDto(entry),
        },
        em,
      );
    });
  },
};
