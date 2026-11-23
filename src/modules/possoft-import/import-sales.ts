import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { Decimal } from '../../database/transformers';
import { normalizePhone } from '../patients/phone';
import type { DumpRow, DumpTables } from './dump-reader';

export const POSSOFT_SALES_TABLES = [
  'sales',
  'sale_products',
  'sale_payments',
  'customers',
  'products',
  'product_details',
  'categories',
  'banks',
  'accounts_sheet',
];

const CITY_BRANCHES = [
  { key: 'lahore', code: 'LHR', name: 'DSM Lahore', city: 'Lahore' },
  { key: 'islamabad', code: 'ISB', name: 'DSM Islamabad', city: 'Islamabad' },
  { key: 'multan', code: 'MUL', name: 'DSM Multan', city: 'Multan' },
  { key: 'karachi', code: 'KHI', name: 'DSM Karachi', city: 'Karachi' },
] as const;

type CityBranch = (typeof CITY_BRANCHES)[number];

export interface ImportSummary {
  branches: Record<string, { sales: number; created: boolean }>;
  patients: number;
  patientsMerged: number;
  patientsWithoutValidPhone: number;
  categories: number;
  products: number;
  sales: number;
  saleItems: number;
  payments: number;
  accountSheets: number;
  skipped: {
    deletedSales: number;
    deletedItems: number;
    itemsWithoutQty: number;
    deletedPayments: number;
    paymentsWithoutAmount: number;
    unknownCity: number;
    missingCustomer: number;
    missingProduct: number;
  };
}

const text = (value: string | null | undefined) => (value ?? '').trim();
const isActive = (row: DumpRow) => text(row.close) !== '0';

function amount(value: string | null | undefined): Decimal {
  const cleaned = text(value).replace(/[^0-9.-]/g, '');
  if (!cleaned || Number.isNaN(Number(cleaned))) return new Decimal(0);
  return new Decimal(cleaned);
}

function dateOf(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
    if (match && match[1] !== '0000' && match[2] !== '00' && match[3] !== '00') return match[0];
  }
  return null;
}

function timestampOf(value: string | null | undefined): string | null {
  const day = dateOf(value);
  if (!day) return null;
  const time = /\d{2}:\d{2}:\d{2}/.exec(text(value))?.[0] ?? '12:00:00';
  return `${day}T${time}+05:00`;
}

const money = (value: Decimal) => value.toFixed(2);
const clampPercent = (value: Decimal) => Decimal.min(Decimal.max(value, 0), 100).toFixed(2);

function cityBranchOf(saleCity: string): CityBranch | null {
  const lower = saleCity.toLowerCase();
  return CITY_BRANCHES.find((b) => lower.includes(b.key)) ?? null;
}

async function insertMany(em: EntityManager, table: string, columns: string[], rows: unknown[][]) {
  const perChunk = Math.max(1, Math.floor(60000 / columns.length));
  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const marks = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${marks.join(', ')})`;
    });
    await em.query(
      `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${tuples.join(', ')}`,
      params,
    );
  }
}

function byId(rows: DumpRow[], key: string) {
  const map = new Map<string, DumpRow>();
  for (const row of rows) map.set(text(row[key]), row);
  return map;
}

function groupBy(rows: DumpRow[], key: string) {
  const map = new Map<string, DumpRow[]>();
  for (const row of rows) {
    const id = text(row[key]);
    const list = map.get(id) ?? [];
    list.push(row);
    map.set(id, list);
  }
  return map;
}

class DryRunRollback extends Error {}

export async function importPossoftSales(
  source: DataSource,
  dump: DumpTables,
  options: { dryRun?: boolean } = {},
): Promise<ImportSummary> {
  const rows = (table: string) => dump.get(table) ?? [];
  const summary: ImportSummary = {
    branches: {},
    patients: 0,
    patientsMerged: 0,
    patientsWithoutValidPhone: 0,
    categories: 0,
    products: 0,
    sales: 0,
    saleItems: 0,
    payments: 0,
    accountSheets: 0,
    skipped: {
      deletedSales: 0,
      deletedItems: 0,
      itemsWithoutQty: 0,
      deletedPayments: 0,
      paymentsWithoutAmount: 0,
      unknownCity: 0,
      missingCustomer: 0,
      missingProduct: 0,
    },
  };

  const customers = byId(rows('customers'), 'cust_id');
  const products = byId(rows('products'), 'prod_id');
  const categories = byId(rows('categories'), 'cat_id');
  const banks = byId(rows('banks'), 'bank_id');
  const sheets = byId(rows('accounts_sheet'), 'as_id');
  const itemsBySale = groupBy(rows('sale_products'), 'sp_sale_id');
  const paymentsBySale = groupBy(rows('sale_payments'), 'spay_sale_id');
  const latestPrice = new Map<string, { id: number; price: Decimal }>();
  for (const detail of rows('product_details')) {
    if (!isActive(detail)) continue;
    const productId = text(detail.product_id);
    const id = Number(text(detail.prod_det_id)) || 0;
    const current = latestPrice.get(productId);
    if (!current || id > current.id) latestPrice.set(productId, { id, price: amount(detail.prod_det_price) });
  }

  const saleRows = rows('sales')
    .filter((sale) => {
      if (isActive(sale)) return true;
      summary.skipped.deletedSales += 1;
      return false;
    })
    .map((sale) => {
      const branch = cityBranchOf(text(sale.sale_city));
      if (!branch) summary.skipped.unknownCity += 1;
      return { sale, branch: branch ?? CITY_BRANCHES[0] };
    })
    .sort((a, b) => {
      const dateA = dateOf(a.sale.sale_date, a.sale.crt_date) ?? '';
      const dateB = dateOf(b.sale.sale_date, b.sale.crt_date) ?? '';
      if (dateA !== dateB) return dateA < dateB ? -1 : 1;
      return Number(text(a.sale.sale_id)) - Number(text(b.sale.sale_id));
    });

  try {
    await source.transaction(async (em) => {
      const [existing] = (await em.query(`SELECT COUNT(*)::int AS count FROM sales`)) as { count: number }[];
      if ((existing?.count ?? 0) > 0) {
        throw new Error(
          'The sales table is not empty. Reset the database first so the import is not added twice.',
        );
      }

      const branchIds = new Map<string, string>();
      const usedBranches = CITY_BRANCHES.filter((b) => saleRows.some((r) => r.branch.code === b.code));
      for (const branch of usedBranches) {
        const online = saleRows.some(
          (r) => r.branch.code === branch.code && /online/i.test(text(r.sale.sale_type)),
        );
        const [found] = (await em.query(
          `SELECT id FROM branches WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
          [branch.code],
        )) as { id: string }[];
        if (found) {
          branchIds.set(branch.code, found.id);
          if (online) await em.query(`UPDATE branches SET online_sales = true WHERE id = $1`, [found.id]);
          summary.branches[branch.code] = { sales: 0, created: false };
          continue;
        }
        const id = randomUUID();
        await insertMany(
          em,
          'branches',
          ['id', 'name', 'code', 'city', 'kind', 'status', 'online_sales'],
          [[id, branch.name, branch.code, branch.city, 'branch', 'active', online]],
        );
        branchIds.set(branch.code, id);
        summary.branches[branch.code] = { sales: 0, created: true };
      }
      const branchIdOf = (code: string) => branchIds.get(code) as string;

      const patientIds = new Map<string, string>();
      const patientByLast9 = new Map<string, string>();
      const patientRows: unknown[][] = [];
      for (const { sale, branch } of saleRows) {
        const custId = text(sale.sale_cust_id);
        if (patientIds.has(custId)) continue;
        const customer = customers.get(custId);
        if (!customer) summary.skipped.missingCustomer += 1;
        const rawPhone = text(customer?.cust_phone);
        const phone = normalizePhone(rawPhone);
        if (phone && patientByLast9.has(phone.last9)) {
          patientIds.set(custId, patientByLast9.get(phone.last9) as string);
          summary.patientsMerged += 1;
          continue;
        }
        if (!phone) summary.patientsWithoutValidPhone += 1;
        const id = randomUUID();
        const key = `P${custId.padStart(8, '0').slice(-8)}`;
        const age = Number(text(customer?.cust_age).replace(/\D/g, ''));
        patientRows.push([
          id,
          text(customer?.cust_name).slice(0, 150) || `posSoft customer ${custId}`,
          (rawPhone || 'not given').slice(0, 30),
          phone?.normalized ?? `possoft-${custId}`.slice(0, 20),
          phone?.last9 ?? key,
          (text(customer?.cust_city) || text(sale.sale_cust_city) || branch.city).slice(0, 100),
          Number.isInteger(age) && age > 0 && age <= 150 ? age : null,
          text(customer?.cust_country).slice(0, 100) || null,
          text(customer?.cust_address) || null,
          branchIdOf(branch.code),
          timestampOf(customer?.crt_date) ?? new Date().toISOString(),
        ]);
        patientIds.set(custId, id);
        if (phone) patientByLast9.set(phone.last9, id);
      }
      await insertMany(
        em,
        'patients',
        [
          'id',
          'name',
          'phone',
          'phone_normalized',
          'phone_last9',
          'city',
          'age',
          'country',
          'address',
          'created_in_branch_id',
          'created_at',
        ],
        patientRows,
      );
      summary.patients = patientRows.length;

      const masterCode = usedBranches[0]?.code;
      const categoryNames = new Map<string, string>();
      const productIds = new Map<string, string>();
      const masterProductIds = new Map<string, string>();
      const categoryRows: unknown[][] = [];
      const productRows: unknown[][] = [];

      const categoryFor = (code: string, catId: string) => {
        const name = (text(categories.get(catId)?.cat_name) || 'posSoft products').slice(0, 150);
        const nameKey = `${code}:${name.toLowerCase()}`;
        const existingId = categoryNames.get(nameKey);
        if (existingId) return existingId;
        const id = randomUUID();
        categoryRows.push([id, branchIdOf(code), name]);
        categoryNames.set(nameKey, id);
        return id;
      };

      const productFor = (code: string, prodId: string) => {
        const key = `${code}:${prodId}`;
        const known = productIds.get(key);
        if (known) return known;
        const product = products.get(prodId);
        if (!product) summary.skipped.missingProduct += 1;
        const categoryId = categoryFor(code, text(product?.prod_cat_id));
        const id = randomUUID();
        const active = product ? isActive(product) && text(product.status) !== '0' : false;
        const origin = code === masterCode ? null : (masterProductIds.get(prodId) ?? null);
        productRows.push([
          id,
          branchIdOf(code),
          (text(product?.prod_name) || `posSoft product ${prodId}`).slice(0, 200),
          categoryId,
          text(product?.prod_batch_no).slice(0, 100) || null,
          money(latestPrice.get(prodId)?.price ?? new Decimal(0)),
          active ? 'active' : 'inactive',
          origin,
        ]);
        productIds.set(key, id);
        if (code === masterCode) masterProductIds.set(prodId, id);
        return id;
      };

      if (masterCode) {
        for (const { sale } of saleRows) {
          for (const item of itemsBySale.get(text(sale.sale_id)) ?? []) {
            if (isActive(item) && amount(item.sp_prod_qty).gt(0))
              productFor(masterCode, text(item.sp_prod_id));
          }
        }
      }

      const sheetIds = new Map<string, string>();
      const bankNames = new Map<string, string>();
      const bankRows: unknown[][] = [];
      const sheetRows: unknown[][] = [];

      const bankFor = (code: string, name: string) => {
        const nameKey = `${code}:${name.toLowerCase()}`;
        const existingId = bankNames.get(nameKey);
        if (existingId) return existingId;
        const id = randomUUID();
        bankRows.push([id, branchIdOf(code), name]);
        bankNames.set(nameKey, id);
        return id;
      };

      const sheetFor = (code: string, sheetId: string, method: 'cash' | 'online', fallbackDate: string) => {
        const sheet = sheets.get(sheetId);
        const key = sheet ? `${code}:${sheetId}` : `${code}:fallback:${method}`;
        const known = sheetIds.get(key);
        if (known) return known;
        const bankName = text(banks.get(text(sheet?.as_sheet_type))?.bank_name);
        const isCash = sheet ? !bankName || /cash/i.test(bankName) : method === 'cash';
        const id = randomUUID();
        const bankId = isCash ? null : bankFor(code, (bankName || 'posSoft bank').slice(0, 150));
        sheetRows.push([
          id,
          branchIdOf(code),
          (text(sheet?.as_account_name) || (isCash ? 'posSoft cash' : 'posSoft bank')).slice(0, 150),
          (text(sheet?.as_account_code) || '-').slice(0, 100),
          bankId,
          isCash ? 'cash' : 'bank',
          dateOf(sheet?.as_date, sheet?.create_at) ?? fallbackDate,
        ]);
        sheetIds.set(key, id);
        return id;
      };

      const sequence = new Map<string, number>();
      const salesInsert: unknown[][] = [];
      const itemsInsert: unknown[][] = [];
      const paymentsInsert: unknown[][] = [];

      for (const { sale, branch } of saleRows) {
        const code = branch.code;
        const branchId = branchIdOf(code);
        const saleId = text(sale.sale_id);
        const date = dateOf(sale.sale_date, sale.crt_date) ?? new Date().toISOString().slice(0, 10);
        const online = /online/i.test(text(sale.sale_type));
        const id = randomUUID();
        const createdAt = timestampOf(sale.crt_date) ?? `${date}T12:00:00+05:00`;

        let totalQty = new Decimal(0);
        for (const item of itemsBySale.get(saleId) ?? []) {
          if (!isActive(item)) {
            summary.skipped.deletedItems += 1;
            continue;
          }
          const qty = amount(item.sp_prod_qty);
          if (qty.lte(0)) {
            summary.skipped.itemsWithoutQty += 1;
            continue;
          }
          const unitPrice = amount(item.sp_prod_price);
          const lineTotal = text(item.sp_prod_total_price)
            ? amount(item.sp_prod_total_price)
            : unitPrice.times(qty);
          totalQty = totalQty.plus(qty);
          itemsInsert.push([
            randomUUID(),
            branchId,
            id,
            productFor(code, text(item.sp_prod_id)),
            qty.toFixed(3),
            money(unitPrice),
            money(lineTotal),
            createdAt,
          ]);
        }

        let received = new Decimal(0);
        for (const payment of paymentsBySale.get(saleId) ?? []) {
          if (!isActive(payment)) {
            summary.skipped.deletedPayments += 1;
            continue;
          }
          const value = amount(payment.spay_amount);
          if (value.lte(0)) {
            summary.skipped.paymentsWithoutAmount += 1;
            continue;
          }
          const method = /online/i.test(text(payment.spay_status)) ? 'online' : 'cash';
          const paidOn = dateOf(payment.spay_date, payment.crt_date) ?? date;
          received = received.plus(value);
          paymentsInsert.push([
            randomUUID(),
            branchId,
            id,
            method,
            money(value),
            paidOn,
            sheetFor(code, text(payment.spay_receiver_sheet_id), method, paidOn),
            method === 'online' ? text(payment.spay_sender_bank).slice(0, 150) || null : null,
            method === 'online' ? text(payment.spay_sender_account_title).slice(0, 150) || null : null,
            method === 'online' ? text(payment.spay_sender_account_no).slice(0, 100) || null : null,
            `${paidOn}T12:00:00+05:00`,
            timestampOf(payment.crt_date) ?? createdAt,
          ]);
        }

        const total = amount(sale.sale_total_amount);
        const remaining = Decimal.max(total.minus(received), 0);
        const paymentStatus = received.gte(total) ? 'paid' : received.gt(0) ? 'partial' : 'unpaid';
        const delivered = text(sale.sale_status) !== '0';
        const seq = (sequence.get(code) ?? 0) + 1;
        sequence.set(code, seq);
        const custId = text(sale.sale_cust_id);
        salesInsert.push([
          id,
          branchId,
          seq,
          `${code}-${String(seq).padStart(6, '0')}`,
          patientIds.get(custId),
          (text(sale.sale_cust_city) || text(customers.get(custId)?.cust_city)).slice(0, 100) || null,
          online ? 'online' : 'office',
          (text(sale.sale_city) || branch.city).slice(0, 100),
          date,
          totalQty.toFixed(3),
          money(amount(sale.sale_sub_amount)),
          clampPercent(amount(sale.sale_discount)),
          money(amount(sale.sale_after_discount)),
          money(total),
          money(received),
          money(remaining),
          paymentStatus,
          online ? (delivered ? 'delivered' : 'pending') : null,
          online && delivered ? date : null,
          `posSoft sale #${saleId}`,
          createdAt,
        ]);
        summary.branches[code] = { sales: seq, created: summary.branches[code]?.created ?? false };
      }

      await insertMany(em, 'categories', ['id', 'branch_id', 'name'], categoryRows);
      await insertMany(
        em,
        'products',
        ['id', 'branch_id', 'name', 'category_id', 'batch_no', 'sale_price', 'status', 'origin_product_id'],
        productRows,
      );
      await insertMany(em, 'banks', ['id', 'branch_id', 'name'], bankRows);
      await insertMany(
        em,
        'account_sheets',
        ['id', 'branch_id', 'account_name', 'account_code', 'bank_id', 'type', 'date'],
        sheetRows,
      );
      await insertMany(
        em,
        'sales',
        [
          'id',
          'branch_id',
          'invoice_seq',
          'invoice_no',
          'patient_id',
          'patient_city',
          'sale_type',
          'city',
          'date',
          'total_qty',
          'subtotal',
          'discount_percent',
          'discount_amount',
          'total',
          'received',
          'remaining',
          'payment_status',
          'delivery_status',
          'delivered_on',
          'note',
          'created_at',
        ],
        salesInsert,
      );
      await insertMany(
        em,
        'sale_items',
        ['id', 'branch_id', 'sale_id', 'product_id', 'qty', 'unit_price', 'line_total', 'created_at'],
        itemsInsert,
      );
      await insertMany(
        em,
        'sale_payments',
        [
          'id',
          'branch_id',
          'sale_id',
          'method',
          'amount',
          'date',
          'account_sheet_id',
          'sender_bank',
          'sender_account_title',
          'sender_account_no',
          'approved_at',
          'created_at',
        ],
        paymentsInsert,
      );
      for (const [code, last] of sequence) {
        await em.query(
          `INSERT INTO document_sequences (branch_id, key, last_value) VALUES ($1, 'sale', $2)
         ON CONFLICT (branch_id, key) DO UPDATE SET last_value = GREATEST(document_sequences.last_value, EXCLUDED.last_value)`,
          [branchIdOf(code), last],
        );
      }

      summary.categories = categoryRows.length;
      summary.products = productRows.length;
      summary.accountSheets = sheetRows.length;
      summary.sales = salesInsert.length;
      summary.saleItems = itemsInsert.length;
      summary.payments = paymentsInsert.length;
      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }

  return summary;
}
