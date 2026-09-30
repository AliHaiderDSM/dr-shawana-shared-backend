import Decimal from 'decimal.js';
import { AppDataSource } from '../../database/data-source';
import { toQuantity } from '../../database/transformers';
import { AppError } from '../../lib/errors';
import { escapeLike, pageMeta } from '../../lib/pagination';
import { today } from '../../lib/validation';
import { productsRepository } from '../products/products.repository';
import {
  type InventoryReportQuery,
  type ProductLedgerQuery,
  type StockBalanceQuery,
} from './inventory.schemas';
import { type StockMovementType } from './stock-movement.entity';

interface BalanceRow {
  productId: string;
  name: string;
  batchNo: string | null;
  categoryId: string;
  categoryName: string | null;
  unit: string;
  quantity: string;
  lowStockThreshold: string;
  isLowStock: boolean;
}

const REPORT_COLUMNS = [
  'opening',
  'purchased',
  'stockIn',
  'manufactured',
  'stockOut',
  'sold',
  'returned',
  'adjusted',
  'closing',
] as const;
type ReportColumn = (typeof REPORT_COLUMNS)[number];

const firstDayOfMonth = () => `${today().slice(0, 7)}-01`;

async function openingBalance(branchId: string, productId: string, before: string): Promise<string> {
  const [row] = (await AppDataSource.query(
    `SELECT COALESCE(SUM(qty), 0)::text AS opening FROM stock_movements
      WHERE branch_id = $1 AND product_id = $2 AND date < $3`,
    [branchId, productId, before],
  )) as [{ opening: string }];
  return row.opening;
}

function balanceFilters(branchId: string, query: StockBalanceQuery) {
  const params: unknown[] = [branchId];
  const where = ['b.branch_id = $1'];
  if (query.categoryId) {
    params.push(query.categoryId);
    where.push(`b.category_id = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${escapeLike(query.search)}%`);
    where.push(`(b.name ILIKE $${params.length} OR b.batch_no ILIKE $${params.length})`);
  }
  if (query.lowStockOnly) where.push('b.is_low_stock');
  return { where: where.join(' AND '), params };
}

export const inventoryService = {
  async stock(branchId: string, query: StockBalanceQuery) {
    const { where, params } = balanceFilters(branchId, query);
    const [{ total }] = (await AppDataSource.query(
      `SELECT COUNT(*)::int AS total FROM product_stock_balances b WHERE ${where}`,
      params,
    )) as [{ total: number }];
    const rows: BalanceRow[] = await AppDataSource.query(
      `SELECT b.product_id AS "productId", b.name, b.batch_no AS "batchNo", b.category_id AS "categoryId",
              c.name AS "categoryName", b.unit, b.quantity::text AS quantity,
              b.low_stock_threshold::text AS "lowStockThreshold", b.is_low_stock AS "isLowStock"
         FROM product_stock_balances b
         LEFT JOIN categories c ON c.id = b.category_id
        WHERE ${where}
        ORDER BY b.is_low_stock DESC, b.name ASC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      params,
    );
    return { items: rows, meta: pageMeta(query, total) };
  },

  async report(branchId: string, query: InventoryReportQuery) {
    const from = query.from ?? firstDayOfMonth();
    const to = query.to ?? today();
    const params: unknown[] = [branchId, from, to];
    const filters: string[] = [];
    if (query.categoryId) {
      params.push(query.categoryId);
      filters.push(`p.category_id = $${params.length}`);
    }
    if (query.productId) {
      params.push(query.productId);
      filters.push(`p.id = $${params.length}`);
    }
    const inRange = (types: StockMovementType[]) =>
      `m.date BETWEEN $2 AND $3 AND m.type IN (${types.map((t) => `'${t}'`).join(', ')})`;

    const rows: (Record<ReportColumn, string> & {
      productId: string;
      name: string;
      categoryName: string | null;
    })[] = await AppDataSource.query(
      `SELECT p.id AS "productId", p.name, c.name AS "categoryName",
                COALESCE(SUM(m.qty) FILTER (WHERE m.date < $2), 0)::text AS opening,
                COALESCE(SUM(m.qty) FILTER (WHERE ${inRange(['purchase_in'])}), 0)::text AS purchased,
                COALESCE(SUM(m.qty) FILTER (WHERE ${inRange(['stock_in'])}), 0)::text AS "stockIn",
                COALESCE(SUM(m.qty) FILTER (WHERE ${inRange(['manufacturing_in'])}), 0)::text AS manufactured,
                COALESCE(-SUM(m.qty) FILTER (WHERE ${inRange(['stock_out'])}), 0)::text AS "stockOut",
                COALESCE(-SUM(m.qty) FILTER (WHERE ${inRange(['sale'])}), 0)::text AS sold,
                COALESCE(SUM(m.qty) FILTER (WHERE ${inRange(['sale_return'])}), 0)::text AS returned,
                COALESCE(SUM(m.qty) FILTER (WHERE ${inRange(['sale_edit_adjust', 'adjustment'])}), 0)::text AS adjusted,
                COALESCE(SUM(m.qty) FILTER (WHERE m.date <= $3), 0)::text AS closing
           FROM products p
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN stock_movements m ON m.product_id = p.id AND m.branch_id = p.branch_id
          WHERE p.branch_id = $1 AND p.deleted_at IS NULL ${filters.map((f) => `AND ${f}`).join(' ')}
          GROUP BY p.id, p.name, c.name
          ORDER BY p.name ASC`,
      params,
    );

    const totals = Object.fromEntries(
      REPORT_COLUMNS.map((col) => [
        col,
        toQuantity(rows.reduce((sum, r) => sum.plus(r[col]), new Decimal(0))),
      ]),
    ) as Record<ReportColumn, Decimal>;

    return {
      from,
      to,
      rows: rows.map((r) => ({
        ...r,
        ...Object.fromEntries(REPORT_COLUMNS.map((col) => [col, toQuantity(r[col])])),
      })),
      totals,
    };
  },

  async productLedger(branchId: string, productId: string, query: ProductLedgerQuery) {
    if (!(await productsRepository.findById(branchId, productId))) throw AppError.notFound('Product');
    const params: unknown[] = [branchId, productId];
    const range: string[] = [];
    if (query.from) {
      params.push(query.from);
      range.push(`m.date >= $${params.length}`);
    }
    if (query.to) {
      params.push(query.to);
      range.push(`m.date <= $${params.length}`);
    }

    const opening = query.from ? await openingBalance(branchId, productId, query.from) : '0';

    const movements: {
      id: string;
      date: string;
      type: StockMovementType;
      qty: string;
      referenceType: string;
      referenceId: string;
      reversalOfId: string | null;
      note: string | null;
    }[] = await AppDataSource.query(
      `SELECT m.id, to_char(m.date, 'YYYY-MM-DD') AS date, m.type, m.qty::text AS qty,
              m.reference_type AS "referenceType", m.reference_id AS "referenceId",
              m.reversal_of_id AS "reversalOfId", m.note
         FROM stock_movements m
        WHERE m.branch_id = $1 AND m.product_id = $2 ${range.map((r) => `AND ${r}`).join(' ')}
        ORDER BY m.date ASC, m.created_at ASC`,
      params,
    );

    let balance = new Decimal(opening);
    let totalIn = new Decimal(0);
    let totalOut = new Decimal(0);
    const rows = movements.map((m) => {
      const qty = new Decimal(m.qty);
      balance = balance.plus(qty);
      if (qty.isPositive()) totalIn = totalIn.plus(qty);
      else totalOut = totalOut.plus(qty.negated());
      return {
        id: m.id,
        date: m.date,
        type: m.type,
        in: toQuantity(qty.isPositive() ? qty : 0),
        out: toQuantity(qty.isNegative() ? qty.negated() : 0),
        balance: toQuantity(balance),
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        isReversal: m.reversalOfId !== null,
        note: m.note,
      };
    });

    return {
      productId,
      from: query.from ?? null,
      to: query.to ?? null,
      opening: toQuantity(opening),
      closing: toQuantity(balance),
      totalIn: toQuantity(totalIn),
      totalOut: toQuantity(totalOut),
      movements: rows,
    };
  },
};
