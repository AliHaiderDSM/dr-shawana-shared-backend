import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../../database/data-source';
import { catalogService } from '../prescriptions/prescriptions.service';
import { readDump } from './dump-reader';
import { POSSOFT_CLINICAL_TABLES, importPossoftClinical } from './import-clinical';

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

const DUMP = [
  table(
    'doctors',
    [
      'doc_id',
      'doc_name',
      'doc_phone',
      'doc_email',
      'doc_username',
      'doc_details',
      'close',
      'status',
      'crt_date',
    ],
    [
      [1, 'Dr Test One', '03001234567', 'one@dsm.com', 'drone', 'Gynae', 1, 1, '2025-06-01 00:00:00'],
      [2, 'Dr Gone', '0300', '', '', '', 0, 1, '2025-06-01 00:00:00'],
    ],
  ),
  table(
    'customers',
    [
      'cust_id',
      'cust_name',
      'cust_phone',
      'cust_city',
      'cust_age',
      'cust_country',
      'cust_address',
      'close',
      'crt_date',
    ],
    [
      [50, 'Existing Pat', '03111234567', 'Lahore', '30', 'Pakistan', '', 1, '2025-06-01 00:00:00'],
      [51, 'New Consult', '03229876543', 'Islamabad', '40', 'Pakistan', '', 1, '2025-06-02 00:00:00'],
    ],
  ),
  table('banks', ['bank_id', 'bank_name', 'close'], [[1, 'Cash', 1]]),
  table(
    'accounts_sheet',
    ['as_id', 'as_account_name', 'as_account_code', 'as_sheet_type', 'as_date', 'close', 'create_at'],
    [[1, 'Office Cash', 'C-1', 1, '2025-06-01', 1, '2025-06-01 00:00:00']],
  ),
  table(
    'appointments',
    [
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
      'app_payment_method',
      'app_received_amount',
      'app_remark',
      'app_status',
      'close',
      'crt_date',
    ],
    [
      [
        1,
        50,
        'Lahore',
        1,
        'Physical',
        'New',
        '2025-07-01',
        '10:00:00',
        '10:30:00',
        'Hot flashes',
        'Cash Payment',
        '3000',
        'ok',
        1,
        1,
        '2025-07-01 10:00:00',
      ],
      [
        2,
        51,
        'Islamabad',
        1,
        'Online',
        'Followup',
        '2025-07-02',
        '11:00:00',
        '11:00:00',
        'Review',
        '',
        '0',
        '',
        0,
        1,
        '2025-07-02 11:00:00',
      ],
      [
        3,
        50,
        'Lahore',
        2,
        'Physical',
        'New',
        '2025-07-03',
        '09:00:00',
        '09:30:00',
        'x',
        '',
        '0',
        '',
        1,
        1,
        '2025-07-03 09:00:00',
      ],
    ],
  ),
  table(
    'appointment_payments',
    [
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
    ],
    [[1, 1, 'Cash Payment', '', '', '', 1, '3000', '2025-07-01', 1, '2025-07-01 10:00:00']],
  ),
  table(
    'prescriptions',
    [
      'pres_id',
      'pres_cust_id',
      'pres_doc_id',
      'pres_date',
      'pres_diaganosis',
      'pres_fsh',
      'pres_estradiol',
      'pres_bloodNote',
      'pres_imagingNote',
      'pres_supplementsNote',
      'pres_skinCareNote',
      'pres_hairCareNote',
      'pres_plantreatment',
      'pres_followup_date',
      'close',
      'crt_date',
    ],
    [
      [
        1,
        50,
        1,
        '2025-07-01',
        'Perimenopause',
        1,
        1,
        'Repeat in 6 weeks',
        '',
        'Vit D',
        '',
        '',
        'Start HRT',
        '2025-08-01',
        1,
        '2025-07-01 10:00:00',
      ],
      [2, 51, 1, '2025-07-02', 'Followup', 0, 0, '', '', '', '', '', '', '', 1, '2025-07-02 11:00:00'],
    ],
  ),
].join('\n');

describe('posSoft clinical import', () => {
  let dir: string;
  let file: string;
  let branchId: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'possoft-clin-'));
    file = join(dir, 'pos.sql');
    writeFileSync(file, DUMP);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    branchId = randomUUID();
    await AppDataSource.query(
      `INSERT INTO branches (id, name, code, city, kind, status) VALUES ($1,'DSM Lahore','LHR','Lahore','branch','active')`,
      [branchId],
    );
    await AppDataSource.query(
      `INSERT INTO account_sheets (id, branch_id, account_name, account_code, type, date) VALUES ($1,$2,'Office Cash','C-1','cash',CURRENT_DATE)`,
      [randomUUID(), branchId],
    );
    await AppDataSource.query(
      `INSERT INTO patients (id, name, phone, phone_normalized, phone_last9, city, created_in_branch_id)
       VALUES ($1,'Existing Pat','03111234567','+923111234567','111234567','Lahore',$2)`,
      [randomUUID(), branchId],
    );
    await catalogService.seedBranch(branchId);
  });

  it('imports doctors with logins, appointments, payments and prescriptions', async () => {
    const dump = await readDump(file, POSSOFT_CLINICAL_TABLES);
    const summary = await importPossoftClinical(AppDataSource, dump, {
      dryRun: true,
      password: 'StartPass1',
    });
    expect(summary).toMatchObject({
      doctorBranch: 'LHR',
      doctors: 1,
      appointments: 2,
      appointmentPayments: 1,
      prescriptions: 2,
      patientsCreated: 1,
      skipped: { appointmentsNoDoctor: 1 },
    });
    const [afterDry] = (await AppDataSource.query(`SELECT COUNT(*)::int AS count FROM appointments`)) as {
      count: number;
    }[];
    expect(afterDry?.count).toBe(0);

    await importPossoftClinical(AppDataSource, dump, { password: 'StartPass1' });

    const doctor = (await AppDataSource.query(
      `SELECT s.username, s.role, s.must_change_password AS must, (c.staff_id IS NOT NULL) AS login
         FROM doctors d JOIN staff_profiles s ON s.id = d.staff_id
         LEFT JOIN staff_credentials c ON c.staff_id = s.id WHERE d.display_name = 'Dr Test One'`,
    )) as Record<string, unknown>[];
    expect(doctor[0]).toMatchObject({ username: 'drone', role: 'doctor', must: true, login: true });

    const appts = (await AppDataSource.query(
      `SELECT b.code, a.status, a.mode, a.visit_type, a.fee, a.time_from::text AS time_from, a.time_to::text AS time_to, p.name AS patient
         FROM appointments a JOIN branches b ON b.id = a.branch_id JOIN patients p ON p.id = a.patient_id
        ORDER BY a.date`,
    )) as Record<string, unknown>[];
    expect(appts).toEqual([
      expect.objectContaining({
        code: 'LHR',
        status: 'completed',
        mode: 'physical',
        visit_type: 'new',
        fee: '3000.00',
        patient: 'Existing Pat',
      }),
      expect.objectContaining({
        code: 'LHR',
        status: 'booked',
        mode: 'online',
        visit_type: 'followup',
        time_from: '11:00:00',
        time_to: '11:15:00',
        patient: 'New Consult',
      }),
    ]);

    const [pay] = (await AppDataSource.query(
      `SELECT y.method, y.amount, a.account_name FROM appointment_payments y
         JOIN account_sheets a ON a.id = y.account_sheet_id`,
    )) as Record<string, unknown>[];
    expect(pay).toMatchObject({ method: 'cash', amount: '3000.00', account_name: 'Office Cash' });

    const items = (await AppDataSource.query(
      `SELECT i.name, i.category, (i.catalog_item_id IS NOT NULL) AS linked
         FROM prescription_items i JOIN prescriptions p ON p.id = i.prescription_id
        WHERE p.diagnosis = 'Perimenopause' ORDER BY i.sort_order`,
    )) as Record<string, unknown>[];
    expect(items).toEqual([
      { name: 'FSH', category: 'lab', linked: true },
      { name: 'Estradiol', category: 'lab', linked: true },
    ]);
    const [pres] = (await AppDataSource.query(
      `SELECT notes, plan_treatment FROM prescriptions WHERE diagnosis = 'Perimenopause'`,
    )) as { notes: Record<string, string>; plan_treatment: string }[];
    expect(pres?.notes).toMatchObject({ blood: 'Repeat in 6 weeks', supplements: 'Vit D' });
    expect(pres?.plan_treatment).toBe('Start HRT');

    await expect(importPossoftClinical(AppDataSource, dump, { password: 'StartPass1' })).rejects.toThrow(
      'already exist',
    );
  });
});
