import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDataSource } from '../../database/data-source';
import { catalogService } from '../prescriptions/prescriptions.service';
import { readDump } from './dump-reader';
import { importPossoftClinical } from './import-clinical';
import { POSSOFT_DELTA_TABLES, importPossoftDelta } from './import-delta';
import { importPossoftSales } from './import-sales';
import { resetDatabase } from './reset-database';

function table(name: string, columns: string[], rows: (string | number)[][]): string {
  const create = `CREATE TABLE \`${name}\` (\n${columns.map((c) => `  \`${c}\` text`).join(',\n')}\n) ENGINE=InnoDB;`;
  const values = rows
    .map(
      (row) =>
        `(${row.map((v) => (typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`)).join(',')})`,
    )
    .join(',\n');
  return `${create}\nINSERT INTO \`${name}\` VALUES\n${values};\n`;
}

const dimensions = [
  table(
    'customers',
    ['cust_id', 'cust_name', 'cust_phone', 'cust_city', 'cust_age', 'cust_country', 'cust_address', 'close', 'crt_date'],
    [
      [1, 'Alpha Patient', '03001112223', 'Lahore', '35', 'Pakistan', '', 1, '2026-01-01 00:00:00'],
      [2, 'Beta Patient', '03004445556', 'Lahore', '41', 'Pakistan', '', 1, '2026-01-02 00:00:00'],
    ],
  ),
  table('categories', ['cat_id', 'cat_name', 'close', 'status'], [[1, 'Meds', 1, 1]]),
  table(
    'products',
    ['prod_id', 'prod_name', 'prod_batch_no', 'prod_cat_id', 'close', 'status'],
    [
      [10, 'Panadol', 'B-1', 1, 1, 1],
      [11, 'Calpol', 'B-2', 1, 1, 1],
    ],
  ),
  table(
    'product_details',
    ['prod_det_id', 'product_id', 'prod_det_price', 'close'],
    [
      [1, 10, '1200', 1],
      [2, 11, '500', 1],
    ],
  ),
  table('banks', ['bank_id', 'bank_name', 'close'], [[1, 'Cash', 1]]),
  table(
    'accounts_sheet',
    ['as_id', 'as_account_name', 'as_account_code', 'as_sheet_type', 'as_date', 'close', 'create_at', 'del_date'],
    [[1, 'Office Cash', 'C-1', 1, '2026-01-01', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00']],
  ),
  table(
    'doctors',
    ['doc_id', 'doc_name', 'doc_phone', 'doc_email', 'doc_username', 'doc_details', 'close', 'status', 'crt_date'],
    [[1, 'Dr One', '03000000000', 'one@dsm.com', 'drone', 'Gynae', 1, 1, '2026-01-01 00:00:00']],
  ),
];

const SALE_COLS = [
  'sale_id',
  'sale_cust_id',
  'sale_cust_city',
  'sale_date',
  'sale_type',
  'sale_city',
  'sale_sub_amount',
  'sale_discount',
  'sale_after_discount',
  'sale_total_amount',
  'sale_status',
  'close',
  'crt_date',
];
const SP_COLS = ['sp_id', 'sp_sale_id', 'sp_prod_id', 'sp_prod_qty', 'sp_prod_price', 'sp_prod_total_price', 'close', 'crt_date'];
const SPAY_COLS = [
  'sale_pay_id',
  'spay_sale_id',
  'spay_status',
  'spay_sender_bank',
  'spay_sender_account_title',
  'spay_sender_account_no',
  'spay_receiver_sheet_id',
  'spay_amount',
  'spay_date',
  'close',
  'crt_date',
];
const APP_COLS = [
  'app_id',
  'app_pat_id',
  'app_pat_city',
  'app_doc_id',
  'app_on_phy_status',
  'app_on_phy_followup',
  'app_date',
  'app_time_from',
  'app_time_to',
  'app_issues',
  'app_received_amount',
  'app_remark',
  'app_status',
  'close',
  'crt_date',
];
const APPAY_COLS = [
  'app_pay_id',
  'appoint_id',
  'app_pay_status',
  'app_pay_sender_bank',
  'app_pay_account_title',
  'app_pay_account_no',
  'app_pay_receiver_sheet_id',
  'app_pay_amount',
  'app_pay_date',
  'close',
  'crt_date',
];
const PRES_COLS = [
  'pres_id',
  'pres_cust_id',
  'pres_doc_id',
  'pres_date',
  'pres_diaganosis',
  'pres_bloodNote',
  'pres_imagingNote',
  'pres_supplementsNote',
  'pres_skinCareNote',
  'pres_hairCareNote',
  'pres_plantreatment',
  'pres_followup_date',
  'close',
  'crt_date',
];

const oldSales: (string | number)[][] = [
  [100, 1, 'Lahore', '2026-02-01', 'Office Sale', 'Lahore', '2400', '0', '2400', '2400', 1, 1, '2026-02-01 11:00:00'],
];
const oldSaleProducts: (string | number)[][] = [[1, 100, 10, '2', '1200', '2400', 1, '2026-02-01 11:00:00']];
const oldSalePayments: (string | number)[][] = [
  [1, 100, 'Cash Payment', '', '', '', 1, '2400', '2026-02-01', 1, '2026-02-01 11:00:00'],
];
const oldAppointments: (string | number)[][] = [
  [1, 1, 'Lahore', 1, 'Physical', 'New', '2026-07-01', '10:00:00', '10:30:00', 'issue', '3000', 'ok', 1, 1, '2026-07-01 10:00:00'],
];
const oldApptPayments: (string | number)[][] = [
  [1, 1, 'Cash Payment', '', '', '', 1, '2000', '2026-07-01', 1, '2026-07-01 10:00:00'],
];
const oldPrescriptions: (string | number)[][] = [
  [1, 1, 1, '2026-07-01', 'Diag A', 'blood', '', '', '', '', 'plan', '', 1, '2026-07-01 10:00:00'],
];

const newSales = [
  ...oldSales,
  [101, 1, 'Lahore', '2026-02-05', 'Office Sale', 'Lahore', '1200', '0', '1200', '1200', 1, 1, '2026-02-05 11:00:00'],
  [102, 2, 'Lahore', '2026-02-06', 'Office Sale', 'Lahore', '500', '0', '500', '500', 1, 1, '2026-02-06 11:00:00'],
];
const newSaleProducts = [
  ...oldSaleProducts,
  [2, 101, 10, '1', '1200', '1200', 1, '2026-02-05 11:00:00'],
  [3, 102, 11, '1', '500', '500', 1, '2026-02-06 11:00:00'],
];
const newSalePayments = [
  ...oldSalePayments,
  [2, 101, 'Cash Payment', '', '', '', 1, '1000', '2026-02-05', 1, '2026-02-05 11:00:00'],
  [3, 102, 'Cash Payment', '', '', '', 1, '500', '2026-02-06', 1, '2026-02-06 11:00:00'],
];
const newAppointments = [
  ...oldAppointments,
  [2, 1, 'Lahore', 1, 'Physical', 'New', '2026-07-05', '09:00:00', '09:30:00', 'x', '1500', 'r', 1, 1, '2026-07-05 09:00:00'],
  [3, 2, 'Lahore', 1, 'Online', 'Followup', '2026-07-06', '11:00:00', '11:30:00', 'y', '0', '', 1, 1, '2026-07-06 11:00:00'],
];
const newApptPayments = [
  ...oldApptPayments,
  [2, 2, 'Cash Payment', '', '', '', 1, '1500', '2026-07-05', 1, '2026-07-05 09:00:00'],
];
const newPrescriptions = [
  ...oldPrescriptions,
  [2, 2, 1, '2026-07-06', 'Diag B', '', '', '', '', '', 'plan b', '', 1, '2026-07-06 11:00:00'],
];

const buildDump = (
  sales: (string | number)[][],
  saleProducts: (string | number)[][],
  salePayments: (string | number)[][],
  appointments: (string | number)[][],
  apptPayments: (string | number)[][],
  prescriptions: (string | number)[][],
) =>
  [
    ...dimensions,
    table('sales', SALE_COLS, sales),
    table('sale_products', SP_COLS, saleProducts),
    table('sale_payments', SPAY_COLS, salePayments),
    table('appointments', APP_COLS, appointments),
    table('appointment_payments', APPAY_COLS, apptPayments),
    table('prescriptions', PRES_COLS, prescriptions),
  ].join('\n');

const OLD_DUMP = buildDump(oldSales, oldSaleProducts, oldSalePayments, oldAppointments, oldApptPayments, oldPrescriptions);
const NEW_DUMP = buildDump(
  newSales,
  newSaleProducts,
  newSalePayments,
  newAppointments,
  newApptPayments,
  newPrescriptions,
);

const count = async (sql: string, params: unknown[] = []) => {
  const [row] = (await AppDataSource.query(sql, params)) as { count: number }[];
  return row?.count ?? 0;
};

describe('posSoft delta import', () => {
  let dir: string;
  let oldFile: string;
  let newFile: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'possoft-delta-'));
    oldFile = join(dir, 'old.sql');
    newFile = join(dir, 'new.sql');
    writeFileSync(oldFile, OLD_DUMP);
    writeFileSync(newFile, NEW_DUMP);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('adds only the new rows, reuses existing patients, products and accounts, and is safe to run twice', async () => {
    await resetDatabase(AppDataSource);
    const [warehouse] = (await AppDataSource.query(
      `SELECT id FROM branches WHERE kind = 'warehouse'`,
    )) as { id: string }[];
    await catalogService.seedBranch(warehouse!.id);

    const oldDump = await readDump(oldFile, POSSOFT_DELTA_TABLES);
    await importPossoftSales(AppDataSource, oldDump);
    await importPossoftClinical(AppDataSource, oldDump, { password: 'StartPass1' });

    expect(await count(`SELECT COUNT(*)::int AS count FROM sales`)).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS count FROM appointments`)).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS count FROM prescriptions`)).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS count FROM patients`)).toBe(1);

    const newDump = await readDump(newFile, POSSOFT_DELTA_TABLES);
    const summary = await importPossoftDelta(AppDataSource, oldDump, newDump, { password: 'StartPass1' });

    expect(summary.diff).toEqual({ newSales: 2, newAppointments: 2, newPrescriptions: 1 });
    expect(summary.sales.sales).toBe(2);
    expect(summary.clinical).toMatchObject({ doctors: 0, doctorsReused: 1, appointments: 2, prescriptions: 1 });

    expect(await count(`SELECT COUNT(*)::int AS count FROM sales`)).toBe(3);
    expect(await count(`SELECT COUNT(*)::int AS count FROM appointments`)).toBe(3);
    expect(await count(`SELECT COUNT(*)::int AS count FROM prescriptions`)).toBe(2);
    expect(await count(`SELECT COUNT(*)::int AS count FROM patients`)).toBe(2);

    expect(await count(`SELECT COUNT(DISTINCT doctor_id)::int AS count FROM appointments`)).toBe(1);

    const lhrProducts = await AppDataSource.query(
      `SELECT p.name FROM products p JOIN branches b ON b.id = p.branch_id
        WHERE b.code = 'LHR' AND p.origin_product_id IS NOT NULL ORDER BY p.name`,
    );
    expect(lhrProducts).toEqual([{ name: 'Calpol' }, { name: 'Panadol' }]);

    expect(
      await count(`SELECT COUNT(*)::int AS count FROM account_sheets WHERE account_name = 'Office Cash'`),
    ).toBe(1);

    const invoices = (await AppDataSource.query(
      `SELECT s.invoice_no, s.invoice_seq FROM sales s JOIN branches b ON b.id = s.branch_id
        WHERE b.code = 'LHR' ORDER BY s.invoice_seq`,
    )) as { invoice_no: string; invoice_seq: number }[];
    expect(invoices.map((i) => i.invoice_seq)).toEqual([1, 2, 3]);
    expect(new Set(invoices.map((i) => i.invoice_no)).size).toBe(3);

    const again = await importPossoftDelta(AppDataSource, oldDump, newDump, { password: 'StartPass1' });
    expect(again.sales.sales).toBe(0);
    expect(again.clinical).toMatchObject({
      appointments: 0,
      prescriptions: 0,
      skipped: expect.objectContaining({ appointmentsExisting: 2, prescriptionsExisting: 1 }),
    });

    expect(await count(`SELECT COUNT(*)::int AS count FROM sales`)).toBe(3);
    expect(await count(`SELECT COUNT(*)::int AS count FROM appointments`)).toBe(3);
    expect(await count(`SELECT COUNT(*)::int AS count FROM prescriptions`)).toBe(2);
    expect(await count(`SELECT COUNT(*)::int AS count FROM patients`)).toBe(2);
  });
});
