import Decimal from 'decimal.js';
import { AppDataSource } from '../../database/data-source';
import { toQuantity } from '../../database/transformers';
import { AppError } from '../../lib/errors';
import { escapeLike, pageMeta } from '../../lib/pagination';
import { today } from '../../lib/validation';
import { productsRepository } from '../products/products.repository';
import {
  type ExpiryAlertsQuery,
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
  expiredQuantity: string;
  reservedQuantity: string;
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
  'branchSold',
  'inBranch',
  'branchReturned',
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
  if (query.productId) {
    params.push(query.productId);
    where.push(`b.product_id = $${params.length}`);
  }
  return { where: where.join(' AND '), params };
}

function movementDetail(m: {
  referenceType: string;
  fromTransfer: boolean | null;
  refName: string | null;
  refParty: string | null;
}) {
  const withParty = (text: string, joiner = ' · ') => (m.refParty ? `${text}${joiner}${m.refParty}` : text);
  switch (m.referenceType) {
    case 'stock_in':
      if (m.fromTransfer) return 'From Super Admin Stock';
      return m.refName ? `From ${m.refName}` : 'Stock in';
    case 'stock_out':
      return m.refName ? withParty(`To ${m.refName}`, ' · by ') : 'Stock out';
    case 'sale':
      return m.refName ? withParty(`Invoice ${m.refName}`) : 'Sale';
    case 'sale_return':
      return m.refName ? `Return ${m.refName}` : 'Return';
    case 'product_purchase':
      return m.refName ? `Purchase from ${m.refName}` : 'Purchase';
    case 'production':
      return m.refName ? `Production batch ${m.refName}` : 'Production';
    default:
      return null;
  }
}

async function branchBreakdown(params: unknown[], filters: string[]) {
  const rows: {
    productId: string;
    branchId: string;
    branchName: string;
    sent: string;
    sold: string;
    returned: string;
    inBranch: string;
  }[] = await AppDataSource.query(
    `SELECT p.id AS "productId", b.id AS "branchId", b.name AS "branchName",
            COALESCE((SELECT -SUM(m.qty) FROM stock_movements m JOIN stock_outs so ON so.id = m.reference_id
                       WHERE m.product_id = p.id AND m.type = 'stock_out' AND so.to_branch_id = b.id
                         AND m.date BETWEEN $2 AND $3), 0)::text AS sent,
            COALESCE((SELECT -SUM(bm.qty) FROM stock_movements bm JOIN products bp ON bp.id = bm.product_id
                       WHERE bp.branch_id = b.id AND bp.origin_product_id = p.id
                         AND bm.type IN ('sale', 'sale_edit_adjust') AND bm.date BETWEEN $2 AND $3), 0)::text AS sold,
            COALESCE((SELECT SUM(bm.qty) FROM stock_movements bm JOIN products bp ON bp.id = bm.product_id
                       WHERE bp.branch_id = b.id AND bp.origin_product_id = p.id
                         AND bm.type = 'sale_return' AND bm.date BETWEEN $2 AND $3), 0)::text AS returned,
            COALESCE((SELECT SUM(bm.qty) FROM stock_movements bm JOIN products bp ON bp.id = bm.product_id
                       WHERE bp.branch_id = b.id AND bp.origin_product_id = p.id AND bm.date <= $3), 0)::text AS "inBranch"
       FROM products p
       CROSS JOIN branches b
      WHERE p.branch_id = $1 AND p.deleted_at IS NULL AND b.kind = 'branch' AND b.deleted_at IS NULL
        ${filters.map((f) => `AND ${f}`).join(' ')}
      ORDER BY b.name`,
    params.slice(0, 3 + filters.length),
  );
  const byProduct = new Map<string, typeof rows>();
  for (const row of rows) {
    if ([row.sent, row.sold, row.returned, row.inBranch].every((v) => Number(v) === 0)) continue;
    byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row]);
  }
  return byProduct;
}

export const inventoryService = {
  async expiryAlerts(branchId: string | null, query: ExpiryAlertsQuery) {
    const params: unknown[] = [query.days];
    if (branchId) params.push(branchId);
    const rows: (Record<string, unknown> & { quantity: string; daysLeft: number })[] =
      await AppDataSource.query(
        `SELECT b.id AS "batchId", b.branch_id AS "branchId", br.name AS "branchName", br.kind AS "branchKind",
              b.product_id AS "productId", p.name AS "productName", p.unit, b.batch_no AS "batchNo",
              to_char(b.expiry_date, 'YYYY-MM-DD') AS "expiryDate", (b.expiry_date - CURRENT_DATE)::int AS "daysLeft",
              SUM(m.qty)::text AS quantity
         FROM product_batches b
         JOIN branches br ON br.id = b.branch_id AND br.deleted_at IS NULL
         JOIN products p ON p.id = b.product_id AND p.deleted_at IS NULL
         JOIN stock_movements m ON m.batch_id = b.id
        WHERE b.deleted_at IS NULL AND b.expiry_date <= CURRENT_DATE + $1::int
          ${branchId ? 'AND b.branch_id = $2' : ''}
        GROUP BY b.id, br.name, br.kind, p.name, p.unit
       HAVING SUM(m.qty) > 0
        ORDER BY b.expiry_date ASC, br.name ASC, p.name ASC`,
        params,
      );
    return rows.map((r) => ({ ...r, quantity: toQuantity(r.quantity) }));
  },

  async stock(branchId: string, query: StockBalanceQuery) {
    const { where, params } = balanceFilters(branchId, query);
    const [{ total }] = (await AppDataSource.query(
      `SELECT COUNT(*)::int AS total FROM product_stock_balances b WHERE ${where}`,
      params,
    )) as [{ total: number }];
    const rows: BalanceRow[] = await AppDataSource.query(
      `SELECT b.product_id AS "productId", b.name, b.batch_no AS "batchNo", b.category_id AS "categoryId",
              c.name AS "categoryName", b.unit, b.quantity::text AS quantity,
              b.expired_quantity::text AS "expiredQuantity",
              COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                         WHERE si.product_id = b.product_id AND si.deleted_at IS NULL AND s.deleted_at IS NULL
                           AND s.sale_type = 'online' AND s.delivery_status = 'pending'), 0)::numeric(12,3)::text AS "reservedQuantity",
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
    const inRange = (types: StockMovementType[], extra = '') =>
      `m.date BETWEEN $2 AND $3 AND m.type IN (${types.map((t) => `'${t}'`).join(', ')})${extra}`;
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const supplier = query.supplierId ? param(query.supplierId) : null;
    const dispatcher = query.dispatcherId ? param(query.dispatcherId) : null;
    const target = query.toBranchId ? param(query.toBranchId) : null;
    const fromSupplier = (table: string) =>
      supplier
        ? ` AND EXISTS (SELECT 1 FROM ${table} d WHERE d.id = m.reference_id AND d.supplier_id = ${supplier})`
        : '';
    const outFilter = [
      dispatcher ? `so.dispatcher_id = ${dispatcher}` : null,
      target ? `so.to_branch_id = ${target}` : null,
    ].filter(Boolean);
    const toWhere = outFilter.length
      ? ` AND EXISTS (SELECT 1 FROM stock_outs so WHERE so.id = m.reference_id AND ${outFilter.join(' AND ')})`
      : '';
    const branchProducts = target
      ? `SELECT bp.id FROM products bp WHERE bp.branch_id = ${target} AND (bp.origin_product_id = p.id OR bp.id = p.id)`
      : null;
    const branchSold = branchProducts
      ? `COALESCE((SELECT -SUM(bm.qty) FROM stock_movements bm WHERE bm.product_id IN (${branchProducts})
            AND bm.type IN ('sale', 'sale_edit_adjust') AND bm.date BETWEEN $2 AND $3), 0)`
      : '0';
    const branchReturned = branchProducts
      ? `COALESCE((SELECT SUM(bm.qty) FROM stock_movements bm WHERE bm.product_id IN (${branchProducts})
            AND bm.type = 'sale_return' AND bm.date BETWEEN $2 AND $3), 0)`
      : '0';
    const inBranch = branchProducts
      ? `COALESCE((SELECT SUM(bm.qty) FROM stock_movements bm WHERE bm.product_id IN (${branchProducts})
            AND bm.date <= $3), 0)`
      : '0';

    const rows: (Record<ReportColumn, string> & {
      productId: string;
      name: string;
      categoryName: string | null;
    })[] = await AppDataSource.query(
      `SELECT p.id AS "productId", p.name, c.name AS "categoryName",
                COALESCE(SUM(m.qty) FILTER (WHERE m.date < $2), 0)::text AS opening,
                COALESCE(SUM(m.qty) FILTER (WHERE ${inRange(['purchase_in'], fromSupplier('product_purchase_entries'))}), 0)::text AS purchased,
                COALESCE(SUM(m.qty) FILTER (WHERE ${inRange(['stock_in'], fromSupplier('stock_ins'))}), 0)::text AS "stockIn",
                COALESCE(SUM(m.qty) FILTER (WHERE ${inRange(['manufacturing_in'])}), 0)::text AS manufactured,
                COALESCE(-SUM(m.qty) FILTER (WHERE ${inRange(['stock_out'], toWhere)}), 0)::text AS "stockOut",
                (${branchSold})::text AS "branchSold",
                (${inBranch})::text AS "inBranch",
                (${branchReturned})::text AS "branchReturned",
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

    const [kind] = (await AppDataSource.query('SELECT kind FROM branches WHERE id = $1', [branchId])) as {
      kind: string;
    }[];
    const perBranch = kind?.kind === 'warehouse' && !target ? await branchBreakdown(params, filters) : null;
    if (perBranch) {
      for (const row of rows) {
        const list = perBranch.get(row.productId) ?? [];
        row.branchSold = list.reduce((sum, b) => sum.plus(b.sold), new Decimal(0)).toString();
        row.inBranch = list.reduce((sum, b) => sum.plus(b.inBranch), new Decimal(0)).toString();
        row.branchReturned = list.reduce((sum, b) => sum.plus(b.returned), new Decimal(0)).toString();
      }
    }

    const totals = Object.fromEntries(
      REPORT_COLUMNS.map((col) => [
        col,
        toQuantity(rows.reduce((sum, r) => sum.plus(r[col]), new Decimal(0))),
      ]),
    ) as Record<ReportColumn, Decimal>;

    return {
      from,
      to,
      perBranch: Boolean(perBranch),
      rows: rows.map((r) => ({
        ...r,
        ...Object.fromEntries(REPORT_COLUMNS.map((col) => [col, toQuantity(r[col])])),
        branches: (perBranch?.get(r.productId) ?? []).map((b) => ({
          branchId: b.branchId,
          branchName: b.branchName,
          sent: toQuantity(b.sent),
          sold: toQuantity(b.sold),
          returned: toQuantity(b.returned),
          inBranch: toQuantity(b.inBranch),
        })),
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
      batchNo: string | null;
      manufacturingDate: string | null;
      expiryDate: string | null;
      fromTransfer: boolean | null;
      refName: string | null;
      refParty: string | null;
      note: string | null;
    }[] = await AppDataSource.query(
      `SELECT m.id, to_char(m.date, 'YYYY-MM-DD') AS date, m.type, m.qty::text AS qty, b.batch_no AS "batchNo",
              to_char(b.manufacturing_date, 'YYYY-MM-DD') AS "manufacturingDate",
              to_char(b.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
              m.reference_type AS "referenceType", m.reference_id AS "referenceId",
              m.reversal_of_id AS "reversalOfId", m.note,
              si.transfer_out_id IS NOT NULL AS "fromTransfer",
              COALESCE(sis.name, so.destination, s.invoice_no, r.return_no, pps.name, mb.batch_no) AS "refName",
              COALESCE(sod.name, sp.name) AS "refParty"
         FROM stock_movements m
         LEFT JOIN product_batches b ON b.id = m.batch_id
         LEFT JOIN stock_ins si ON m.reference_type = 'stock_in' AND si.id = m.reference_id
         LEFT JOIN suppliers sis ON sis.id = si.supplier_id
         LEFT JOIN stock_outs so ON m.reference_type = 'stock_out' AND so.id = m.reference_id
         LEFT JOIN suppliers sod ON sod.id = so.dispatcher_id
         LEFT JOIN sales s ON m.reference_type = 'sale' AND s.id = m.reference_id
         LEFT JOIN patients sp ON sp.id = s.patient_id
         LEFT JOIN sale_returns r ON m.reference_type = 'sale_return' AND r.id = m.reference_id
         LEFT JOIN product_purchase_entries pp ON m.reference_type = 'product_purchase' AND pp.id = m.reference_id
         LEFT JOIN suppliers pps ON pps.id = pp.supplier_id
         LEFT JOIN material_batches mb ON m.reference_type = 'production' AND mb.id = m.reference_id
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
        batchNo: m.batchNo,
        manufacturingDate: m.manufacturingDate,
        expiryDate: m.expiryDate,
        detail: movementDetail(m),
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
