import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDataSource } from '../../database/data-source';
import { readDump } from './dump-reader';
import { POSSOFT_SALES_TABLES, importPossoftSales } from './import-sales';
import { resetDatabase } from './reset-database';

const DUMP = `
CREATE TABLE \`customers\` (
  \`cust_id\` int(11) NOT NULL,
  \`cust_name\` varchar(255) NOT NULL,
  \`cust_phone\` varchar(50) NOT NULL,
  \`cust_city\` varchar(255) NOT NULL,
  \`cust_age\` varchar(255) NOT NULL,
  \`cust_country\` varchar(255) NOT NULL,
  \`cust_address\` text NOT NULL,
  \`cust_bhrt_status\` int(2) NOT NULL,
  \`close\` int(2) NOT NULL,
  \`status\` int(2) NOT NULL,
  \`crt_date\` datetime NOT NULL DEFAULT current_timestamp(),
  \`entry_by\` varchar(50) NOT NULL,
  \`del_by\` int(2) NOT NULL,
  \`del_date\` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB;

INSERT INTO \`customers\` (\`cust_id\`, \`cust_name\`, \`cust_phone\`, \`cust_city\`, \`cust_age\`, \`cust_country\`, \`cust_address\`, \`cust_bhrt_status\`, \`close\`, \`status\`, \`crt_date\`, \`entry_by\`, \`del_by\`, \`del_date\`) VALUES
(1, 'Test Patient One', '0300-1234567', 'Lahore', '34', 'Pakistan', 'House 1, it\\'s here', 0, 1, 1, '2026-01-02 10:00:00', '1', 0, '2026-01-02 10:00:00'),
(2, 'Same Phone Two', '+92 300 1234567', 'Lahore', '', 'Pakistan', '', 0, 1, 1, '2026-01-03 10:00:00', '1', 0, '2026-01-03 10:00:00'),
(3, 'No Phone Three', '12', 'Karachi', 'abc', '', '', 0, 1, 1, '2026-01-04 10:00:00', '1', 0, '2026-01-04 10:00:00');

CREATE TABLE \`categories\` (
  \`cat_id\` int(11) NOT NULL,
  \`cat_name\` varchar(255) NOT NULL,
  \`cat_image\` text NOT NULL,
  \`close\` int(2) NOT NULL,
  \`status\` int(2) NOT NULL
) ENGINE=InnoDB;

INSERT INTO \`categories\` VALUES (1,'Supplements','',1,1),(2,'BHRT','',1,1);

CREATE TABLE \`products\` (
  \`prod_id\` int(11) NOT NULL,
  \`prod_name\` varchar(255) NOT NULL,
  \`prod_batch_no\` varchar(255) NOT NULL,
  \`prod_cat_id\` int(11) NOT NULL,
  \`prod_image\` text NOT NULL,
  \`close\` int(2) NOT NULL,
  \`status\` int(2) NOT NULL
) ENGINE=InnoDB;

INSERT INTO \`products\` VALUES (10,'Vitamin D3','B-1',1,'',1,1),(11,'Progesterone Cream','',2,'',0,1);

CREATE TABLE \`product_details\` (
  \`prod_det_id\` int(11) NOT NULL,
  \`product_id\` int(11) NOT NULL,
  \`prod_det_price\` varchar(50) NOT NULL,
  \`close\` int(2) NOT NULL
) ENGINE=InnoDB;

INSERT INTO \`product_details\` VALUES (1,10,'1000',1),(2,10,'1,200',1),(3,11,'3500',1);

CREATE TABLE \`banks\` (
  \`bank_id\` int(11) NOT NULL,
  \`bank_name\` varchar(255) NOT NULL,
  \`close\` int(2) NOT NULL
) ENGINE=InnoDB;

INSERT INTO \`banks\` VALUES (1,'Cash',1),(2,'Meezan Bank',1);

CREATE TABLE \`accounts_sheet\` (
  \`as_id\` int(11) NOT NULL,
  \`as_account_name\` varchar(255) NOT NULL,
  \`as_account_code\` varchar(255) NOT NULL,
  \`as_sheet_type\` int(11) NOT NULL,
  \`as_date\` date NOT NULL,
  \`close\` int(2) NOT NULL,
  \`create_at\` datetime NOT NULL
) ENGINE=InnoDB;

INSERT INTO \`accounts_sheet\` VALUES (1,'Office Cash','C-1',1,'2026-01-01',1,'2026-01-01 09:00:00'),(2,'Meezan Main','0123',2,'0000-00-00',1,'2026-01-01 09:00:00');

CREATE TABLE \`sales\` (
  \`sale_id\` int(11) NOT NULL,
  \`sale_cust_id\` int(11) NOT NULL,
  \`sale_cust_city\` varchar(255) NOT NULL,
  \`sale_date\` date NOT NULL,
  \`sale_type\` varchar(255) NOT NULL,
  \`sale_city\` varchar(50) NOT NULL,
  \`sale_total_qty\` varchar(50) NOT NULL,
  \`sale_sub_amount\` varchar(50) NOT NULL,
  \`sale_discount\` varchar(50) NOT NULL,
  \`sale_after_discount\` varchar(50) NOT NULL,
  \`sale_total_amount\` varchar(50) NOT NULL,
  \`sale_payment_method\` varchar(50) NOT NULL,
  \`sale_received_amount\` varchar(50) NOT NULL,
  \`sale_remaining\` varchar(50) NOT NULL,
  \`sale_status\` int(2) NOT NULL,
  \`close\` int(2) NOT NULL,
  \`status\` int(2) NOT NULL,
  \`entry_by\` varchar(50) NOT NULL,
  \`crt_date\` datetime NOT NULL DEFAULT current_timestamp(),
  \`del_by\` int(2) NOT NULL,
  \`del_date\` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB;

INSERT INTO \`sales\` (\`sale_id\`, \`sale_cust_id\`, \`sale_cust_city\`, \`sale_date\`, \`sale_type\`, \`sale_city\`, \`sale_total_qty\`, \`sale_sub_amount\`, \`sale_discount\`, \`sale_after_discount\`, \`sale_total_amount\`, \`sale_payment_method\`, \`sale_received_amount\`, \`sale_remaining\`, \`sale_status\`, \`close\`, \`status\`, \`entry_by\`, \`crt_date\`, \`del_by\`, \`del_date\`) VALUES
(5, 1, 'Lahore', '2026-02-01', 'Office Sale', 'Lahore', '2', '2400', '10', '240', '2160', 'Cash Payment', '2160', '0', 1, 1, 1, '1', '2026-02-01 11:00:00', 0, '2026-02-01 11:00:00'),
(6, 2, 'Lahore', '2026-01-15', 'Online Sale', 'Lahore Office', '1', '3500', '0', '0', '3500', 'Online Payment', '1000', '2500', 0, 1, 1, '1', '2026-01-15 11:00:00', 0, '2026-01-15 11:00:00'),
(7, 3, 'Karachi', '2026-02-03', 'Office Sale', 'Karachi', '1', '1200', '0', '0', '1200', '', '0', '1200', 1, 1, 1, '1', '2026-02-03 11:00:00', 0, '2026-02-03 11:00:00'),
(8, 1, 'Lahore', '2026-02-04', 'Office Sale', 'Lahore', '1', '1200', '0', '0', '1200', '', '0', '1200', 1, 0, 1, '1', '2026-02-04 11:00:00', 1, '2026-02-04 12:00:00');

CREATE TABLE \`sale_products\` (
  \`sp_id\` int(11) NOT NULL,
  \`sp_sale_id\` int(11) NOT NULL,
  \`sp_cust_id\` int(11) NOT NULL,
  \`sp_date\` date NOT NULL,
  \`sp_prod_id\` int(11) NOT NULL,
  \`sp_prod_qty\` varchar(50) NOT NULL,
  \`sp_prod_price\` varchar(50) NOT NULL,
  \`sp_prod_total_price\` varchar(50) NOT NULL,
  \`close\` int(2) NOT NULL,
  \`status\` int(2) NOT NULL,
  \`entry_by\` varchar(50) NOT NULL,
  \`crt_date\` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB;

INSERT INTO \`sale_products\` VALUES (1,5,1,'2026-02-01',10,'2','1200','2400',1,1,'1','2026-02-01 11:00:00'),(2,6,2,'2026-01-15',11,'1','3500','3500',1,1,'1','2026-01-15 11:00:00'),(3,7,3,'2026-02-03',10,'1','1200','1200',1,1,'1','2026-02-03 11:00:00'),(4,7,3,'2026-02-03',99,'0','10','0',1,1,'1','2026-02-03 11:00:00');

CREATE TABLE \`sale_payments\` (
  \`sale_pay_id\` int(11) NOT NULL,
  \`spay_sale_id\` int(11) NOT NULL,
  \`spay_cust_id\` int(11) NOT NULL,
  \`spay_status\` varchar(50) NOT NULL,
  \`spay_sender_bank\` varchar(255) NOT NULL,
  \`spay_sender_account_title\` varchar(255) NOT NULL,
  \`spay_sender_account_no\` varchar(255) NOT NULL,
  \`spay_sender_pay_file\` text NOT NULL,
  \`spay_receiver_sheet_id\` int(11) NOT NULL,
  \`spay_amount\` varchar(50) NOT NULL,
  \`spay_date\` date NOT NULL,
  \`spay_sale_status\` int(2) NOT NULL,
  \`close\` int(2) NOT NULL,
  \`status\` int(2) NOT NULL,
  \`entry_by\` varchar(50) NOT NULL,
  \`crt_date\` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB;

INSERT INTO \`sale_payments\` VALUES
(1,5,1,'Cash Payment','HBL','x','1','',1,'2160','2026-02-01',1,1,1,'1','2026-02-01 11:00:00'),
(2,6,2,'Online Payment','HBL','Patient Two','PK00123','shot.jpg',2,'1000','2026-01-15',0,1,1,'1','2026-01-15 11:00:00'),
(3,6,2,'Cash Payment','','','','',1,'0','2026-01-15',0,1,1,'1','2026-01-15 11:00:00');
`;

describe('posSoft sales import', () => {
  let dir: string;
  let file: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'possoft-'));
    file = join(dir, 'pos_dsm.sql');
    writeFileSync(file, DUMP);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads phpMyAdmin and mysqldump style inserts with escaped strings', async () => {
    const dump = await readDump(file, POSSOFT_SALES_TABLES);
    expect(dump.get('customers')).toHaveLength(3);
    expect(dump.get('customers')?.[0]?.cust_address).toBe("House 1, it's here");
    expect(dump.get('categories')?.[1]).toMatchObject({ cat_id: '2', cat_name: 'BHRT' });
    expect(dump.get('sale_products')).toHaveLength(4);
    expect(dump.get('sales')).toHaveLength(4);
  });

  it('resets the database and imports sales into the branch of each sale city', async () => {
    await AppDataSource.query(
      `INSERT INTO branches (name, code, city) VALUES ('Old Branch', 'OLD', 'Lahore')`,
    );
    await resetDatabase(AppDataSource);
    const afterReset = (await AppDataSource.query(`SELECT code, kind FROM branches`)) as {
      code: string;
      kind: string;
    }[];
    expect(afterReset).toEqual([{ code: 'MAINWH', kind: 'warehouse' }]);

    const dump = await readDump(file, POSSOFT_SALES_TABLES);
    const dry = await importPossoftSales(AppDataSource, dump, { dryRun: true });
    expect(dry.sales).toBe(3);
    const [afterDry] = (await AppDataSource.query(`SELECT COUNT(*)::int AS count FROM sales`)) as {
      count: number;
    }[];
    expect(afterDry?.count).toBe(0);

    const summary = await importPossoftSales(AppDataSource, dump);
    expect(summary).toMatchObject({
      patients: 2,
      patientsMerged: 1,
      patientsWithoutValidPhone: 1,
      sales: 3,
      saleItems: 3,
      payments: 2,
      branches: { LHR: { sales: 2, created: true }, KHI: { sales: 1, created: true } },
      skipped: { deletedSales: 1, itemsWithoutQty: 1, paymentsWithoutAmount: 1 },
    });

    const sales = (await AppDataSource.query(
      `SELECT s.invoice_no, b.code, s.sale_type, s.date::text AS date, s.total, s.received, s.remaining,
              s.payment_status, s.delivery_status, s.discount_percent, s.discount_amount, s.note, p.name AS patient
         FROM sales s JOIN branches b ON b.id = s.branch_id JOIN patients p ON p.id = s.patient_id
        ORDER BY b.code, s.invoice_seq`,
    )) as Record<string, string>[];
    expect(sales).toEqual([
      expect.objectContaining({
        invoice_no: 'KHI-000001',
        sale_type: 'office',
        payment_status: 'unpaid',
        remaining: '1200.00',
        patient: 'No Phone Three',
      }),
      expect.objectContaining({
        invoice_no: 'LHR-000001',
        date: '2026-01-15',
        sale_type: 'online',
        delivery_status: 'pending',
        payment_status: 'partial',
        received: '1000.00',
        remaining: '2500.00',
        note: 'posSoft sale #6',
        patient: 'Same Phone Two',
      }),
      expect.objectContaining({
        invoice_no: 'LHR-000002',
        payment_status: 'paid',
        discount_percent: '10.00',
        discount_amount: '240.00',
        total: '2160.00',
        delivery_status: null,
      }),
    ]);

    const products = (await AppDataSource.query(
      `SELECT b.code, p.name, p.sale_price, p.status, p.origin_product_id IS NOT NULL AS copy
         FROM products p JOIN branches b ON b.id = p.branch_id ORDER BY b.code, p.name`,
    )) as Record<string, unknown>[];
    expect(products).toEqual([
      { code: 'KHI', name: 'Vitamin D3', sale_price: '1200.00', status: 'active', copy: true },
      { code: 'LHR', name: 'Progesterone Cream', sale_price: '3500.00', status: 'inactive', copy: false },
      { code: 'LHR', name: 'Vitamin D3', sale_price: '1200.00', status: 'active', copy: false },
    ]);

    const payments = (await AppDataSource.query(
      `SELECT y.method, y.amount, y.sender_bank, a.type, a.account_name, k.name AS bank, y.approved_at IS NOT NULL AS approved
         FROM sale_payments y JOIN account_sheets a ON a.id = y.account_sheet_id LEFT JOIN banks k ON k.id = a.bank_id
        ORDER BY y.amount`,
    )) as Record<string, unknown>[];
    expect(payments).toEqual([
      {
        method: 'online',
        amount: '1000.00',
        sender_bank: 'HBL',
        type: 'bank',
        account_name: 'Meezan Main',
        bank: 'Meezan Bank',
        approved: true,
      },
      {
        method: 'cash',
        amount: '2160.00',
        sender_bank: null,
        type: 'cash',
        account_name: 'Office Cash',
        bank: null,
        approved: true,
      },
    ]);

    const balances = (await AppDataSource.query(
      `SELECT SUM(debit)::text AS total FROM account_movements`,
    )) as { total: string }[];
    expect(balances[0]?.total).toBe('3160.00');

    const [next] = (await AppDataSource.query(
      `SELECT d.last_value FROM document_sequences d JOIN branches b ON b.id = d.branch_id WHERE b.code = 'LHR' AND d.key = 'sale'`,
    )) as { last_value: number }[];
    expect(Number(next?.last_value)).toBe(2);

    await expect(importPossoftSales(AppDataSource, dump)).rejects.toThrow('not empty');
  });
});
