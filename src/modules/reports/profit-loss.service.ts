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
  gross: Decimal;
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
  gross: new Decimal(0),
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

function periodOf(year: number, month: number | null) {
  const from = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`;
  const to = month ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) : `${year}-12-31`;
  return { from, to };
}

const SALE_DAY = `(CASE WHEN s.sale_type = 'online' THEN s.dispatched_on ELSE s.date END)`;
const RECEIVED = `COALESCE((SELECT SUM(y.amount) FROM sale_payments y
                   WHERE y.sale_id = s.id AND y.deleted_at IS NULL AND y.approved_at IS NOT NULL), 0)`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const profitLossService = {
  async report(year: number, month: number | null, branchId: string | null, only: string | null = null) {
    const yearFrom = `${year}-01-01`;
    const yearTo = `${year}-12-31`;
    const { from: periodFrom, to: periodTo } = periodOf(year, month);
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
                SUM(si.qty)::text AS qty, SUM(si.line_total)::text AS "lineTotal",
                SUM(si.qty * si.unit_price)::text AS gross
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

    const wanted = (name: unknown) => !only || name === only;
    const soldNames = new Set<string>();

    for (const sale of sales) {
      const day = sale.day as string;
      const subtotal = new Decimal(sale.subtotal ?? 0);
      const total = new Decimal(sale.total ?? 0);
      const received = Decimal.min(new Decimal(sale.received ?? 0), total);
      const share = subtotal.gt(0) ? received.div(subtotal) : new Decimal(0);
      const invoiceShare = subtotal.gt(0) ? total.div(subtotal) : new Decimal(0);
      const saleLines = linesOf.get(sale.id as string) ?? [];
      const costs = saleCostsOf.get(sale.id as string) ?? [];
      for (const line of saleLines) soldNames.add(line.product as string);
      const myLines = saleLines.filter((l) => wanted(l.product));
      const myCosts = costs.filter((c) => wanted(c.product));
      if (only && myLines.length === 0 && myCosts.length === 0) continue;
      const lineSum = myLines.reduce((sum, l) => sum.plus(l.lineTotal ?? 0), new Decimal(0));
      const part = {
        invoiced: only ? lineSum.times(invoiceShare) : total,
        received: only ? lineSum.times(share) : received,
        saleCost: myCosts.reduce((sum, c) => sum.plus(c.cost ?? 0), new Decimal(0)),
      };
      add(months[Number(day.slice(5, 7)) - 1]!, part);
      if (!inPeriod(day)) continue;
      add(period, part);
      add(branchOf(sale.branchCode as string, sale.branchName as string), part);
      for (const line of myLines) {
        const product = productOf(line.product as string);
        product.qtySold = product.qtySold.plus(line.qty ?? 0);
        product.gross = product.gross.plus(line.gross ?? 0);
        product.received = product.received.plus(new Decimal(line.lineTotal ?? 0).times(share));
        product.invoiced = product.invoiced.plus(new Decimal(line.lineTotal ?? 0).times(invoiceShare));
      }
      for (const c of myCosts) {
        const product = productOf(c.product as string);
        product.saleCost = product.saleCost.plus(c.cost ?? 0);
        product.estimatedQty = product.estimatedQty.plus(c.estimated ?? 0);
        product.unknownQty = product.unknownQty.plus(c.unknown ?? 0);
      }
    }

    for (const ret of returns) {
      const day = ret.day as string;
      const refund = new Decimal(ret.refund ?? 0);
      const items = returnItemsOf.get(ret.id as string) ?? [];
      const costs = returnCostsOf.get(ret.id as string) ?? [];
      const value = items.reduce((sum, i) => sum.plus(i.value ?? 0), new Decimal(0));
      const portionOf = (item: Row) =>
        value.gt(0) ? new Decimal(item.value ?? 0).div(value) : new Decimal(1).div(items.length || 1);
      const myItems = items.filter((i) => wanted(i.product));
      const myCosts = costs.filter((c) => wanted(c.product));
      if (only && myItems.length === 0 && myCosts.length === 0) continue;
      const part = {
        refunds: only
          ? myItems.reduce((sum, i) => sum.plus(refund.times(portionOf(i))), new Decimal(0))
          : refund,
        returnedCost: myCosts.reduce((sum, c) => sum.plus(c.cost ?? 0), new Decimal(0)),
      };
      add(months[Number(day.slice(5, 7)) - 1]!, part);
      if (!inPeriod(day)) continue;
      add(period, part);
      add(branchOf(ret.branchCode as string, ret.branchName as string), part);
      for (const item of myItems) {
        const product = productOf(item.product as string);
        product.qtyReturned = product.qtyReturned.plus(item.qty ?? 0);
        product.refunds = product.refunds.plus(refund.times(portionOf(item)));
      }
      for (const c of myCosts) {
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
          avgSalePrice: sold.gt(0) ? toMoney(t.gross.div(sold)).toFixed(2) : null,
          gross: toMoney(t.gross).toFixed(2),
          discount: toMoney(Decimal.max(0, t.gross.minus(t.invoiced))).toFixed(2),
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
      product: only,
      productNames: [...soldNames].sort((a, b) => a.localeCompare(b)),
      summary: {
        ...figures(period),
        sales: sales.filter(
          (s) =>
            inPeriod(s.day as string) &&
            (!only || (linesOf.get(s.id as string) ?? []).some((l) => l.product === only)),
        ).length,
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

  async productSales(year: number, month: number | null, branchId: string | null, product: string) {
    const { from, to } = periodOf(year, month);
    const sales = await many(
      `SELECT s.id, s.invoice_no AS "invoiceNo", s.sale_type::text AS "saleType", ${SALE_DAY}::text AS day,
              b.code AS "branchCode", b.name AS "branchName", pt.name AS patient,
              s.subtotal::text AS subtotal, s.total::text AS total, ${RECEIVED}::text AS received,
              l.qty::text AS qty, l.gross::text AS gross, l.line_total::text AS "lineTotal"
         FROM sales s
         JOIN branches b ON b.id = s.branch_id
         LEFT JOIN patients pt ON pt.id = s.patient_id
         JOIN LATERAL (
           SELECT SUM(si.qty) AS qty, SUM(si.qty * si.unit_price) AS gross, SUM(si.line_total) AS line_total
             FROM sale_items si JOIN products p ON p.id = si.product_id
             LEFT JOIN products root ON root.id = p.origin_product_id
            WHERE si.sale_id = s.id AND si.deleted_at IS NULL AND ${PRODUCT_NAME} = $4
         ) l ON l.qty IS NOT NULL
        WHERE s.deleted_at IS NULL AND ($3::uuid IS NULL OR s.branch_id = $3::uuid)
          AND ((s.sale_type = 'office' AND s.date BETWEEN $1 AND $2)
            OR (s.sale_type = 'online' AND s.dispatched_on BETWEEN $1 AND $2))
        ORDER BY day DESC, s.invoice_no DESC`,
      [from, to, branchId, product],
    );
    const returns = await many(
      `SELECT r.id, r.return_no AS "returnNo", s.invoice_no AS "invoiceNo", r.date::text AS day,
              b.code AS "branchCode", b.name AS "branchName", pt.name AS patient, r.refund_amount::text AS refund
         FROM sale_returns r
         JOIN sales s ON s.id = r.sale_id
         JOIN branches b ON b.id = r.branch_id
         LEFT JOIN patients pt ON pt.id = s.patient_id
        WHERE r.deleted_at IS NULL AND ($3::uuid IS NULL OR r.branch_id = $3::uuid) AND r.date BETWEEN $1 AND $2
          AND EXISTS (SELECT 1 FROM sale_return_items ri JOIN products p ON p.id = ri.product_id
                       LEFT JOIN products root ON root.id = p.origin_product_id
                       WHERE ri.sale_return_id = r.id AND ri.deleted_at IS NULL AND ${PRODUCT_NAME} = $4)
        ORDER BY r.date DESC, r.return_no DESC`,
      [from, to, branchId, product],
    );
    const saleIds = sales.map((s) => s.id);
    const returnIds = returns.map((r) => r.id);
    const [saleCosts, returnItems, returnCosts] = await Promise.all([
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
    const costOf = (rows: Row[], refId: unknown) =>
      rows
        .filter((c) => c.refId === refId && c.product === product)
        .reduce(
          (sum, c) => ({
            cost: sum.cost.plus(c.cost ?? 0),
            estimated: sum.estimated.plus(c.estimated ?? 0),
          }),
          { cost: new Decimal(0), estimated: new Decimal(0) },
        );
    const money = (value: Decimal) => toMoney(value).toFixed(2);
    const total = {
      qty: new Decimal(0),
      gross: new Decimal(0),
      discount: new Decimal(0),
      invoiced: new Decimal(0),
      revenue: new Decimal(0),
      cost: new Decimal(0),
    };

    const saleRows = sales.map((s) => {
      const subtotal = new Decimal(s.subtotal ?? 0);
      const saleTotal = new Decimal(s.total ?? 0);
      const received = Decimal.min(new Decimal(s.received ?? 0), saleTotal);
      const lineTotal = new Decimal(s.lineTotal ?? 0);
      const gross = new Decimal(s.gross ?? 0);
      const qty = new Decimal(s.qty ?? 0);
      const invoiced = subtotal.gt(0) ? lineTotal.times(saleTotal).div(subtotal) : new Decimal(0);
      const revenue = subtotal.gt(0) ? lineTotal.times(received).div(subtotal) : new Decimal(0);
      const discount = Decimal.max(0, gross.minus(invoiced));
      const { cost, estimated } = costOf(saleCosts, s.id);
      total.qty = total.qty.plus(qty);
      total.gross = total.gross.plus(gross);
      total.discount = total.discount.plus(discount);
      total.invoiced = total.invoiced.plus(invoiced);
      total.revenue = total.revenue.plus(revenue);
      total.cost = total.cost.plus(cost);
      return {
        kind: 'sale' as const,
        id: s.id as string,
        reference: s.invoiceNo as string,
        invoiceNo: s.invoiceNo as string,
        saleType: s.saleType as string,
        date: s.day as string,
        branch: { code: s.branchCode as string, name: s.branchName as string },
        patient: s.patient,
        qty: toQuantity(qty).toFixed(3),
        unitPrice: qty.gt(0) ? money(gross.div(qty)) : null,
        gross: money(gross),
        discount: money(discount),
        invoiced: money(invoiced),
        revenue: money(revenue),
        notReceived: money(Decimal.max(0, invoiced.minus(revenue))),
        cost: money(cost),
        costEstimated: estimated.gt(0),
        profit: money(revenue.minus(cost)),
      };
    });

    const returnRows = returns.map((r) => {
      const items = returnItems.filter((i) => i.refId === r.id);
      const value = items.reduce((sum, i) => sum.plus(i.value ?? 0), new Decimal(0));
      const mine = items.filter((i) => i.product === product);
      const refund = new Decimal(r.refund ?? 0);
      const myRefund = mine.reduce(
        (sum, i) =>
          sum.plus(
            refund.times(
              value.gt(0) ? new Decimal(i.value ?? 0).div(value) : new Decimal(1).div(items.length || 1),
            ),
          ),
        new Decimal(0),
      );
      const qty = mine.reduce((sum, i) => sum.plus(i.qty ?? 0), new Decimal(0));
      const { cost } = costOf(returnCosts, r.id);
      total.qty = total.qty.minus(qty);
      total.revenue = total.revenue.minus(myRefund);
      total.cost = total.cost.minus(cost);
      return {
        kind: 'return' as const,
        id: r.id as string,
        reference: r.returnNo as string,
        invoiceNo: r.invoiceNo as string,
        saleType: null,
        date: r.day as string,
        branch: { code: r.branchCode as string, name: r.branchName as string },
        patient: r.patient,
        qty: toQuantity(qty.negated()).toFixed(3),
        unitPrice: null,
        gross: null,
        discount: null,
        invoiced: null,
        revenue: money(myRefund.negated()),
        notReceived: null,
        cost: money(cost.negated()),
        costEstimated: false,
        profit: money(cost.minus(myRefund)),
      };
    });

    const branches = new Map<
      string,
      { code: string; name: string; qty: Decimal; revenue: Decimal; profit: Decimal }
    >();
    for (const row of [...saleRows, ...returnRows]) {
      const entry = branches.get(row.branch.code) ?? {
        ...row.branch,
        qty: new Decimal(0),
        revenue: new Decimal(0),
        profit: new Decimal(0),
      };
      entry.qty = entry.qty.plus(row.qty);
      entry.revenue = entry.revenue.plus(row.revenue);
      entry.profit = entry.profit.plus(row.profit);
      branches.set(row.branch.code, entry);
    }

    return {
      product,
      year,
      month,
      period: { from, to },
      branchId,
      summary: {
        sales: saleRows.length,
        returns: returnRows.length,
        qty: toQuantity(total.qty).toFixed(3),
        gross: money(total.gross),
        discount: money(total.discount),
        invoiced: money(total.invoiced),
        revenue: money(total.revenue),
        cost: money(total.cost),
        profit: money(total.revenue.minus(total.cost)),
      },
      branches: [...branches.values()]
        .map((b) => ({
          code: b.code,
          name: b.name,
          qty: toQuantity(b.qty).toFixed(3),
          revenue: money(b.revenue),
          profit: money(b.profit),
        }))
        .sort((a, b) => Number(b.revenue) - Number(a.revenue)),
      rows: [...saleRows, ...returnRows].sort((a, b) => b.date.localeCompare(a.date)),
    };
  },
};
