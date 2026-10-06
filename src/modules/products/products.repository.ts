import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { paginate, type ListQuery } from '../../lib/pagination';
import { ProductPurchaseEntry } from './product-purchase-entry.entity';
import { Product } from './product.entity';
import { type ProductListQuery } from './products.schemas';

const base = branchScopedRepository(Product, 'p');
const purchasesBase = branchScopedRepository(ProductPurchaseEntry, 'pe');

export const productsRepository = {
  ...base,

  findWithCategory(branchId: string, id: string, manager?: EntityManager) {
    return base
      .query(branchId, manager)
      .leftJoinAndSelect('p.category', 'category')
      .andWhere('p.id = :id', { id })
      .getOne();
  },

  list(branchId: string, query: ProductListQuery, manager?: EntityManager) {
    const qb = base.query(branchId, manager).leftJoinAndSelect('p.category', 'category');
    if (query.categoryId) qb.andWhere('p.categoryId = :categoryId', { categoryId: query.categoryId });
    if (query.status) qb.andWhere('p.status = :status', { status: query.status });
    if (query.supplierId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM product_purchase_entries e
          WHERE e.product_id = p.id AND e.supplier_id = :supplierId AND e.deleted_at IS NULL)`,
        { supplierId: query.supplierId },
      );
    }
    return paginate(qb, query, {
      searchColumns: ['p.name', 'p.batchNo', 'p.sku', 'p.barcode'],
      sortMap: { name: 'p.name', createdAt: 'p.createdAt', salePrice: 'p.salePrice' },
    });
  },

  options(branchId: string, manager?: EntityManager) {
    return base
      .query(branchId, manager)
      .select(['p.id', 'p.name', 'p.salePrice', 'p.batchNo', 'p.barcode', 'p.trackSerials'])
      .andWhere("p.status = 'active'")
      .orderBy('p.name', 'ASC')
      .getMany();
  },

  findByBarcode(branchId: string, barcode: string, manager?: EntityManager) {
    return base
      .query(branchId, manager)
      .leftJoinAndSelect('p.category', 'category')
      .andWhere('p.barcode = :barcode', { barcode })
      .getOne();
  },

  findBarcodeConflict(branchId: string, barcode: string, excludeId?: string, manager?: EntityManager) {
    const qb = base.query(branchId, manager).andWhere('p.barcode = :barcode', { barcode });
    if (excludeId) qb.andWhere('p.id <> :excludeId', { excludeId });
    return qb.getOne();
  },

  findSkuConflict(branchId: string, sku: string, excludeId?: string, manager?: EntityManager) {
    const qb = base.query(branchId, manager).andWhere('lower(p.sku) = lower(:sku)', { sku });
    if (excludeId) qb.andWhere('p.id <> :excludeId', { excludeId });
    return qb.getOne();
  },
};

export const purchaseEntriesRepository = {
  ...purchasesBase,

  findForProduct(branchId: string, productId: string, id: string, manager?: EntityManager) {
    return purchasesBase
      .query(branchId, manager)
      .leftJoinAndSelect('pe.supplier', 'supplier')
      .andWhere('pe.productId = :productId AND pe.id = :id', { productId, id })
      .getOne();
  },

  listForProduct(branchId: string, productId: string, query: ListQuery, manager?: EntityManager) {
    const qb = purchasesBase
      .query(branchId, manager)
      .leftJoinAndSelect('pe.supplier', 'supplier')
      .andWhere('pe.productId = :productId', { productId });
    return paginate(qb, query, {
      searchColumns: ['pe.note', 'supplier.name'],
      sortMap: { createdAt: 'pe.createdAt', date: 'pe.date' },
    });
  },

  latestForProduct(branchId: string, productId: string, manager?: EntityManager) {
    return purchasesBase
      .query(branchId, manager)
      .andWhere('pe.productId = :productId', { productId })
      .orderBy('pe.createdAt', 'DESC')
      .getOne();
  },
};
