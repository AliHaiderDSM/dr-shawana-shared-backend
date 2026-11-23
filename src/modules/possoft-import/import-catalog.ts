import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { Decimal } from '../../database/transformers';
import type { DumpTables } from './dump-reader';
import {
  byId,
  insertMany,
  isActive,
  latestPrices,
  mainWarehouseId,
  money,
  text,
  timestampOf,
} from './possoft-values';

export const POSSOFT_CATALOG_TABLES = ['categories', 'products', 'product_details'];

export const FALLBACK_CATEGORY = 'posSoft products';

export interface CatalogResult {
  warehouseId: string;
  productIds: Map<string, string>;
  categoriesAdded: number;
  productsAdded: number;
  productsReused: number;
}

export async function importPossoftCatalog(em: EntityManager, dump: DumpTables): Promise<CatalogResult> {
  const warehouseId = await mainWarehouseId(em);
  const categories = byId(dump.get('categories') ?? [], 'cat_id');
  const prices = latestPrices(dump.get('product_details') ?? []);

  const existingCategories = (await em.query(
    `SELECT id, lower(name) AS key FROM categories WHERE branch_id = $1 AND deleted_at IS NULL`,
    [warehouseId],
  )) as { id: string; key: string }[];
  const categoryByName = new Map(existingCategories.map((c) => [c.key, c.id]));
  const existingProducts = (await em.query(
    `SELECT DISTINCT ON (lower(name)) id, lower(name) AS key FROM products WHERE branch_id = $1
      ORDER BY lower(name), deleted_at NULLS FIRST, created_at`,
    [warehouseId],
  )) as { id: string; key: string }[];
  const productByName = new Map(existingProducts.map((p) => [p.key, p.id]));

  const categoryRows: unknown[][] = [];
  const productRows: unknown[][] = [];
  const productIds = new Map<string, string>();
  let productsReused = 0;

  const categoryFor = (catId: string) => {
    const name = (text(categories.get(catId)?.cat_name) || FALLBACK_CATEGORY).slice(0, 150);
    const known = categoryByName.get(name.toLowerCase());
    if (known) return known;
    const id = randomUUID();
    categoryRows.push([
      id,
      warehouseId,
      name,
      timestampOf(categories.get(catId)?.crt_date) ?? new Date().toISOString(),
    ]);
    categoryByName.set(name.toLowerCase(), id);
    return id;
  };

  for (const category of categories.values()) {
    if (isActive(category)) categoryFor(text(category.cat_id));
  }

  for (const product of dump.get('products') ?? []) {
    const prodId = text(product.prod_id);
    const name = (text(product.prod_name) || `posSoft product ${prodId}`).slice(0, 200);
    const known = productByName.get(name.toLowerCase());
    if (known) {
      productIds.set(prodId, known);
      productsReused += 1;
      continue;
    }
    const id = randomUUID();
    productRows.push([
      id,
      warehouseId,
      name,
      categoryFor(text(product.prod_cat_id)),
      text(product.prod_batch_no).slice(0, 100) || null,
      money(prices.get(prodId) ?? new Decimal(0)),
      text(product.status) === '0' ? 'inactive' : 'active',
      timestampOf(product.crt_date) ?? new Date().toISOString(),
      isActive(product) ? null : (timestampOf(product.del_date) ?? new Date().toISOString()),
    ]);
    productByName.set(name.toLowerCase(), id);
    productIds.set(prodId, id);
  }

  await insertMany(em, 'categories', ['id', 'branch_id', 'name', 'created_at'], categoryRows);
  await insertMany(
    em,
    'products',
    [
      'id',
      'branch_id',
      'name',
      'category_id',
      'batch_no',
      'sale_price',
      'status',
      'created_at',
      'deleted_at',
    ],
    productRows,
  );

  return {
    warehouseId,
    productIds,
    categoriesAdded: categoryRows.length,
    productsAdded: productRows.length,
    productsReused,
  };
}

export async function linkBranchProductsToWarehouse(em: EntityManager, warehouseId: string): Promise<number> {
  const rows = (await em.query(
    `UPDATE products p SET origin_product_id = w.id, updated_at = now()
       FROM products w
      WHERE w.branch_id = $1 AND p.branch_id <> $1 AND lower(p.name) = lower(w.name)
        AND p.origin_product_id IS DISTINCT FROM w.id
        AND w.id = (SELECT x.id FROM products x WHERE x.branch_id = $1 AND lower(x.name) = lower(w.name)
                     ORDER BY x.deleted_at NULLS FIRST, x.created_at LIMIT 1)
      RETURNING p.id`,
    [warehouseId],
  )) as unknown[];
  return Array.isArray(rows[0]) ? (rows[0] as unknown[]).length : rows.length;
}
