import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { Decimal } from '../../database/transformers';
import { normalizePhone } from '../patients/phone';
import type { DumpTables } from './dump-reader';
import { importPossoftCatalog } from './import-catalog';
import {
  amount,
  byId,
  dateOf,
  groupBy,
  insertMany,
  isActive,
  money,
  text,
  timestampOf,
} from './possoft-values';

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

export const NO_ACCOUNT_CHOSEN = 'posSoft: no account chosen';

export interface ImportSummary {
  branches: Record<string, { sales: number; created: boolean }>;
  patients: number;
  patientsMerged: number;
  patientsWithoutValidPhone: number;
  warehouseCategories: number;
  warehouseProducts: number;
  categories: number;
  products: number;
  sales: number;
  saleItems: number;
  payments: number;
  accountSheets: number;
  paymentsWithoutAccount: number;
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

const clampPercent = (value: Decimal) => Decimal.min(Decimal.max(value, 0), 100).toFixed(2);

function cityBranchOf(saleCity: string): CityBranch | null {
  const lower = saleCity.toLowerCase();
  return CITY_BRANCHES.find((b) => lower.includes(b.key)) ?? null;
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
    warehouseCategories: 0,
    warehouseProducts: 0,
    categories: 0,
    products: 0,
    sales: 0,
    saleItems: 0,
    payments: 0,
    accountSheets: 0,
    paymentsWithoutAccount: 0,
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

      const catalog = await importPossoftCatalog(em, dump);
      summary.warehouseCategories = catalog.categoriesAdded;
      summary.warehouseProducts = catalog.productsAdded;
      const prices = new Map<string, string>();
      const warehousePrices = (await em.query(
        `SELECT id, sale_price::text AS price FROM products WHERE branch_id = $1`,
        [catalog.warehouseId],
      )) as { id: string; price: string }[];
      for (const row of warehousePrices) prices.set(row.id, row.price);

      const categoryNames = new Map<string, string>();
      const productIds = new Map<string, string>();
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
        const origin = catalog.productIds.get(prodId) ?? null;
        const id = randomUUID();
        const active = product ? isActive(product) && text(product.status) !== '0' : false;
        productRows.push([
          id,
          branchIdOf(code),
          (text(product?.prod_name) || `posSoft product ${prodId}`).slice(0, 200),
          categoryFor(code, text(product?.prod_cat_id)),
          text(product?.prod_batch_no).slice(0, 100) || null,
          (origin && prices.get(origin)) ?? '0.00',
          active ? 'active' : 'inactive',
          origin,
        ]);
        productIds.set(key, id);
        return id;
      };

      const sheetIds = new Map<string, string>();
      const bankNames = new Map<string, string>();
      const bankRows: unknown[][] = [];
      const sheetRows: unknown[][] = [];

      const accountsBranchId = () => catalog.warehouseId;

      const bankFor = (name: string) => {
        const nameKey = name.toLowerCase();
        const existingId = bankNames.get(nameKey);
        if (existingId) return existingId;
        const id = randomUUID();
        bankRows.push([id, accountsBranchId(), name]);
        bankNames.set(nameKey, id);
        return id;
      };

      const noAccountChosen = (fallbackDate: string) => {
        const known = sheetIds.get('none');
        if (known) return known;
        const id = randomUUID();
        sheetRows.push([
          id,
          accountsBranchId(),
          NO_ACCOUNT_CHOSEN,
          '-',
          null,
          'cash',
          fallbackDate,
          new Date().toISOString(),
        ]);
        sheetIds.set('none', id);
        return id;
      };

      const sheetFor = (sheetId: string, fallbackDate: string) => {
        const sheet = sheets.get(sheetId);
        if (!sheet) {
          summary.paymentsWithoutAccount += 1;
          return noAccountChosen(fallbackDate);
        }
        const known = sheetIds.get(sheetId);
        if (known) return known;
        const bankName = text(banks.get(text(sheet.as_sheet_type))?.bank_name);
        const isCash = !bankName || /\bcash\b/i.test(bankName);
        const id = randomUUID();
        const bankId = isCash ? null : bankFor(bankName.slice(0, 150));
        sheetRows.push([
          id,
          accountsBranchId(),
          (text(sheet.as_account_name) || bankName || 'posSoft account').slice(0, 150),
          (text(sheet.as_account_code) || '-').slice(0, 100),
          bankId,
          isCash ? 'cash' : 'bank',
          dateOf(sheet.as_date, sheet.create_at) ?? fallbackDate,
          isActive(sheet) ? null : (timestampOf(sheet.del_date) ?? new Date().toISOString()),
        ]);
        sheetIds.set(sheetId, id);
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
            sheetFor(text(payment.spay_receiver_sheet_id), paidOn),
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
        ['id', 'branch_id', 'account_name', 'account_code', 'bank_id', 'type', 'date', 'deleted_at'],
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
