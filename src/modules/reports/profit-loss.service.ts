import { AppDataSource } from '../../database/data-source';
import { Decimal, toMoney, toQuantity } from '../../database/transformers';

type Row = Record<string, string | null>;

const many = (sql: string, params: unknown[]) => AppDataSource.query(sql, params) as Promise<Row[]>;

const PRODUCT_NAME = 'COALESCE(root.name, p.name)';
const PRODUCT_JOIN =
  'JOIN products p ON p.id = m.product_id LEFT JOIN products root ON root.id = p.origin_product_id';

const COST_SELECT = `
  SELECT m.reference_id AS "refId", ${PRODUCT_NAME} AS product,
         SUM(ABS(m.qty))::text AS qty,
         SUM(ABS(m.qty) * COALESCE(bt.unit_cost, m.unit_cost, last.cost, 0))::text AS cost,
         SUM(CASE WHEN COALESCE(bt.unit_cost, m.unit_cost) IS NULL AND last.cost IS NOT NULL THEN ABS(m.qty) ELSE 0 END)::text AS estimated,
         SUM(CASE WHEN COALESCE(bt.unit_cost, m.unit_cost, last.cost) IS NULL THEN ABS(m.qty) ELSE 0 END)::text AS unknown
    FROM stock_movements m
    ${PRODUCT_JOIN}
    LEFT JOIN product_batches bt ON bt.id = m.batch_id
    LEFT JOIN LATERAL (
      SELECT pb.unit_cost AS cost FROM product_batches pb JOIN products pp ON pp.id = pb.product_id
       WHERE pb.unit_cost IS NOT NULL AND pb.deleted_at IS NULL
         AND COALESCE(pp.origin_product_id, pp.id) = COALESCE(p.origin_product_id, p.id)
       ORDER BY pb.created_at DESC LIMIT 1
    ) last ON TRUE`;

interface Totals {
  invoiced: Decimal;
  received: Decimal;
  refunds: Decimal;
  saleCost: Decimal;
  returnedCost: Decimal;
}

interface ProductTotals extends Totals {
  qtySold: Decimal;
  qtyReturned: Decimal;
  estimatedQty: Decimal;
  unknownQty: Decimal;
}

const zero = (): Totals => ({
  invoiced: new Decimal(0),
  received: new Decimal(0),
  refunds: new Decimal(0),
  saleCost: new Decimal(0),
  returnedCost: new Decimal(0),
});

const zeroProduct = (): ProductTotals => ({
  ...zero(),
  qtySold: new Decimal(0),
  qtyReturned: new Decimal(0),
  estimatedQty: new Decimal(0),
  unknownQty: new Decimal(0),
});

function figures(t: Totals) {
  const revenue = t.received.minus(t.refunds);
  const cost = t.saleCost.minus(t.returnedCost);
  const profit = revenue.minus(cost);
  return {
    invoiced: toMoney(t.invoiced).toFixed(2),
    received: toMoney(t.received).toFixed(2),
    notReceived: toMoney(Decimal.max(0, t.invoiced.minus(t.received))).toFixed(2),
    refunds: toMoney(t.refunds).toFixed(2),
    revenue: toMoney(revenue).toFixed(2),
    cost: toMoney(cost).toFixed(2),
    profit: toMoney(profit).toFixed(2),
    margin: revenue.gt(0) ? profit.div(revenue).times(100).toDecimalPlaces(1).toFixed(1) : null,
  };
}

const add = (target: Totals, part: Partial<Totals>) => {
  for (const [key, value] of Object.entries(part) as [keyof Totals, Decimal][]) {
    target[key] = target[key].plus(value);
  }
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const profitLossService = {
  async report(year: number, month: number | null, branchId: string | null) {
    const yearFrom = `${year}-01-01`;
    const yearTo = `${year}-12-31`;
    const periodFrom = month ? `${year}-${String(month).padStart(2, '0')}-01` : yearFrom;
    const periodTo = month ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) : yearTo;
    const inPeriod = (day: string) => day >= periodFrom && day <= periodTo;

    const sales = await many(
      `SELECT s.id, b.code AS "branchCode", b.name AS "branchName",
              (CASE WHEN s.sale_type = 'online' THEN s.dispatched_on ELSE s.date END)::text AS day,
              s.subtotal::text AS subtotal, s.total::text AS total,
              COALESCE((SELECT SUM(y.amount) FROM sale_payments y
                         WHERE y.sale_id = s.id AND y.deleted_at IS NULL AND y.approved_at IS NOT NULL), 0)::text AS received
         FROM sales s JOIN branches b ON b.id = s.branch_id
        WHERE s.deleted_at IS NULL AND ($3::uuid IS NULL OR s.branch_id = $3::uuid)
          AND ((s.sale_type = 'office' AND s.date BETWEEN $1 AND $2)
            OR (s.sale_type = 'online' AND s.dispatched_on BETWEEN $1 AND $2))`,
      [yearFrom, yearTo, branchId],
    );
    const returns = await many(
      `SELECT r.id, r.sale_id AS "saleId", b.code AS "branchCode", b.name AS "branchName", r.date::text AS day,
              r.refund_amount::text AS refund
         FROM sale_returns r JOIN branches b ON b.id = r.branch_id
        WHERE r.deleted_at IS NULL AND ($3::uuid IS NULL OR r.branch_id = $3::uuid) AND r.date BETWEEN $1 AND $2`,
      [yearFrom, yearTo, branchId],
    );
    const saleIds = sales.map((s) => s.id);
    const returnIds = returns.map((r) => r.id);

    const [lines, saleCosts, returnItems, returnCosts] = await Promise.all([
      many(
        `SELECT si.sale_id AS "refId", COALESCE(root.name, p.name) AS product,
                SUM(si.qty)::text AS qty, SUM(si.line_total)::text AS "lineTotal"
           FROM sale_items si JOIN products p ON p.id = si.product_id
           LEFT JOIN products root ON root.id = p.origin_product_id
          WHERE si.sale_id = ANY($1::uuid[]) AND si.deleted_at IS NULL
          GROUP BY 1, 2`,
        [saleIds],
      ),
      many(
        `${COST_SELECT}
          WHERE m.reference_type = 'sale' AND m.reference_id = ANY($1::uuid[]) AND m.type IN ('sale', 'sale_edit_adjust')
          GROUP BY 1, 2`,
        [saleIds],
      ),
      many(
        `SELECT ri.sale_return_id AS "refId", COALESCE(root.name, p.name) AS product, SUM(ri.qty)::text AS qty,
                SUM(ri.qty * COALESCE((SELECT SUM(si.line_total) / NULLIF(SUM(si.qty), 0) FROM sale_items si
                                        WHERE si.sale_id = r.sale_id AND si.product_id = ri.product_id
                                          AND si.deleted_at IS NULL), 0))::text AS value
           FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.sale_return_id
           JOIN products p ON p.id = ri.product_id LEFT JOIN products root ON root.id = p.origin_product_id
          WHERE ri.sale_return_id = ANY($1::uuid[]) AND ri.deleted_at IS NULL
          GROUP BY 1, 2`,
        [returnIds],
      ),
      many(
        `${COST_SELECT}
          WHERE m.reference_type = 'sale_return' AND m.reference_id = ANY($1::uuid[]) AND m.type = 'sale_return'
          GROUP BY 1, 2`,
        [returnIds],
      ),
    ]);

    const byRef = <T extends Row>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) map.set(row.refId as string, [...(map.get(row.refId as string) ?? []), row]);
      return map;
    };
    const linesOf = byRef(lines);
    const saleCostsOf = byRef(saleCosts);
    const returnItemsOf = byRef(returnItems);
    const returnCostsOf = byRef(returnCosts);

    const months = Array.from({ length: 12 }, zero);
    const period = zero();
    const products = new Map<string, ProductTotals>();
    const branches = new Map<string, Totals & { name: string }>();
    const productOf = (name: string) => {
      if (!products.has(name)) products.set(name, zeroProduct());
      return products.get(name)!;
    };
    const branchOf = (code: string, name: string) => {
      if (!branches.has(code)) branches.set(code, { ...zero(), name });
      return branches.get(code)!;
    };

    for (const sale of sales) {
      const day = sale.day as string;
      const subtotal = new Decimal(sale.subtotal ?? 0);
      const total = new Decimal(sale.total ?? 0);
      const received = Decimal.min(new Decimal(sale.received ?? 0), total);
      const costs = saleCostsOf.get(sale.id as string) ?? [];
      const saleCost = costs.reduce((sum, c) => sum.plus(c.cost ?? 0), new Decimal(0));
      const part = { invoiced: total, received, saleCost };
      add(months[Number(day.slice(5, 7)) - 1]!, part);
      if (!inPeriod(day)) continue;
      add(period, part);
      add(branchOf(sale.branchCode as string, sale.branchName as string), part);
      const share = subtotal.gt(0) ? received.div(subtotal) : new Decimal(0);
      const invoiceShare = subtotal.gt(0) ? total.div(subtotal) : new Decimal(0);
      for (const line of linesOf.get(sale.id as string) ?? []) {
        const product = productOf(line.product as string);
        product.qtySold = product.qtySold.plus(line.qty ?? 0);
        product.received = product.received.plus(new Decimal(line.lineTotal ?? 0).times(share));
        product.invoiced = product.invoiced.plus(new Decimal(line.lineTotal ?? 0).times(invoiceShare));
      }
      for (const c of costs) {
        const product = productOf(c.product as string);
        product.saleCost = product.saleCost.plus(c.cost ?? 0);
        product.estimatedQty = product.estimatedQty.plus(c.estimated ?? 0);
        product.unknownQty = product.unknownQty.plus(c.unknown ?? 0);
      }
    }

    for (const ret of returns) {
      const day = ret.day as string;
      const refund = new Decimal(ret.refund ?? 0);
      const costs = returnCostsOf.get(ret.id as string) ?? [];
      const returnedCost = costs.reduce((sum, c) => sum.plus(c.cost ?? 0), new Decimal(0));
      const part = { refunds: refund, returnedCost };
      add(months[Number(day.slice(5, 7)) - 1]!, part);
      if (!inPeriod(day)) continue;
      add(period, part);
      add(branchOf(ret.branchCode as string, ret.branchName as string), part);
      const items = returnItemsOf.get(ret.id as string) ?? [];
      const value = items.reduce((sum, i) => sum.plus(i.value ?? 0), new Decimal(0));
      for (const item of items) {
        const product = productOf(item.product as string);
        product.qtyReturned = product.qtyReturned.plus(item.qty ?? 0);
        const portion = value.gt(0)
          ? new Decimal(item.value ?? 0).div(value)
          : new Decimal(1).div(items.length || 1);
        product.refunds = product.refunds.plus(refund.times(portion));
      }
      for (const c of costs) {
        const product = productOf(c.product as string);
        product.returnedCost = product.returnedCost.plus(c.cost ?? 0);
      }
    }

    const names = [...products.keys()];
    const [prices, lastCosts] = await Promise.all([
      many(
        `SELECT DISTINCT ON (name) name, sale_price::text AS price FROM products
          WHERE deleted_at IS NULL AND name = ANY($1::text[])
          ORDER BY name, (origin_product_id IS NULL) DESC, updated_at DESC`,
        [names],
      ),
      many(
        `SELECT DISTINCT ON (COALESCE(root.name, p.name)) COALESCE(root.name, p.name) AS name, pb.unit_cost::text AS cost
           FROM product_batches pb JOIN products p ON p.id = pb.product_id
           LEFT JOIN products root ON root.id = p.origin_product_id
          WHERE pb.unit_cost IS NOT NULL AND pb.deleted_at IS NULL AND COALESCE(root.name, p.name) = ANY($1::text[])
          ORDER BY COALESCE(root.name, p.name), pb.created_at DESC`,
        [names],
      ),
    ]);
    const priceOf = new Map(prices.map((r) => [r.name as string, r.price]));
    const lastCostOf = new Map(lastCosts.map((r) => [r.name as string, r.cost]));

    const productRows = [...products.entries()]
      .map(([name, t]) => {
        const sold = t.qtySold;
        return {
          product: name,
          qtySold: toQuantity(sold).toFixed(3),
          qtyReturned: toQuantity(t.qtyReturned).toFixed(3),
          listPrice: priceOf.get(name) ? toMoney(priceOf.get(name)!).toFixed(2) : null,
          lastCost: lastCostOf.get(name) ? toMoney(lastCostOf.get(name)!).toFixed(2) : null,
          avgSalePrice: sold.gt(0) ? toMoney(t.invoiced.div(sold)).toFixed(2) : null,
          avgCost: sold.gt(0) ? toMoney(t.saleCost.div(sold)).toFixed(2) : null,
          estimatedQty: toQuantity(t.estimatedQty).toFixed(3),
          unknownQty: toQuantity(t.unknownQty).toFixed(3),
          ...figures(t),
        };
      })
      .sort((a, b) => Number(b.profit) - Number(a.profit) || a.product.localeCompare(b.product));

    const estimatedQty = productRows.reduce((sum, r) => sum + Number(r.estimatedQty), 0);
    const unknownQty = productRows.reduce((sum, r) => sum + Number(r.unknownQty), 0);

    return {
      year,
      month,
      period: { from: periodFrom, to: periodTo },
      branchId,
      summary: {
        ...figures(period),
        sales: sales.filter((s) => inPeriod(s.day as string)).length,
        estimatedCostUnits: toQuantity(estimatedQty).toFixed(3),
        unknownCostUnits: toQuantity(unknownQty).toFixed(3),
      },
      months: months.map((t, i) => ({
        month: `${year}-${String(i + 1).padStart(2, '0')}`,
        label: MONTHS[i],
        ...figures(t),
      })),
      products: productRows,
      branches: branchId
        ? []
        : [...branches.entries()]
            .map(([code, t]) => ({ code, name: t.name, ...figures(t) }))
            .sort((a, b) => a.code.localeCompare(b.code)),
    };
  },
};
