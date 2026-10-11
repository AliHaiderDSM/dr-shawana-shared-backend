import { type EntityManager } from 'typeorm';
import { AppError } from '../../lib/errors';

export interface FulfilledSale {
  branchId: string;
  fulfillmentBranchId: string | null;
}

export const stockBranchOf = (sale: FulfilledSale) => sale.fulfillmentBranchId ?? sale.branchId;

export async function dispatchDepartment(manager: EntityManager) {
  const [row] = (await manager.query(
    `SELECT id, name, status FROM branches WHERE kind::text = 'dispatch' AND deleted_at IS NULL LIMIT 1`,
  )) as { id: string; name: string; status: string }[];
  return row ?? null;
}

export async function isDispatchBranch(manager: EntityManager, branchId: string) {
  const [row] = (await manager.query(`SELECT kind FROM branches WHERE id = $1`, [branchId])) as {
    kind: string;
  }[];
  return row?.kind === 'dispatch';
}

export async function stockProducts(
  manager: EntityManager,
  sale: FulfilledSale,
  productIds: string[],
  strict = true,
): Promise<Map<string, string>> {
  const ids = [...new Set(productIds)];
  if (!sale.fulfillmentBranchId || sale.fulfillmentBranchId === sale.branchId) {
    return new Map(ids.map((id) => [id, id]));
  }
  if (ids.length === 0) return new Map();
  const rows: { saleProductId: string; stockProductId: string | null; name: string }[] = await manager.query(
    `SELECT sp.id AS "saleProductId", sp.name,
            CASE WHEN sp.branch_id = $1 THEN sp.id ELSE
            (SELECT dp.id FROM products dp
              WHERE dp.branch_id = $1 AND dp.deleted_at IS NULL AND sp.origin_product_id IS NOT NULL
                AND dp.origin_product_id = sp.origin_product_id
              ORDER BY dp.created_at LIMIT 1) END AS "stockProductId"
       FROM products sp WHERE sp.id = ANY($2)`,
    [sale.fulfillmentBranchId, ids],
  );
  const missing = rows.filter((r) => !r.stockProductId);
  if (!strict) return new Map(rows.map((r) => [r.saleProductId, r.stockProductId ?? r.saleProductId]));
  if (missing.length) {
    throw AppError.unprocessable(
      `${missing.map((m) => m.name).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not stocked at the Dispatch Department. Transfer it from the Main Warehouse first.`,
      { products: missing.map((m) => ({ productId: m.saleProductId, productName: m.name })) },
    );
  }
  return new Map(rows.map((r) => [r.saleProductId, r.stockProductId as string]));
}

export function mapQuantities<T>(wanted: Map<string, T>, map: Map<string, string>, add: (a: T, b: T) => T) {
  const out = new Map<string, T>();
  for (const [productId, qty] of wanted) {
    const target = map.get(productId) ?? productId;
    const current = out.get(target);
    out.set(target, current === undefined ? qty : add(current, qty));
  }
  return out;
}

export const reverseMap = (map: Map<string, string>) => new Map([...map].map(([from, to]) => [to, from]));
