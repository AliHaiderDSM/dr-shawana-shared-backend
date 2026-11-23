import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { truncateAllTables } from '../../../tests/helpers/db';
import { AppDataSource } from '../../database/data-source';
import { readDump } from './dump-reader';
import { POSSOFT_EXTRA_TABLES, importPossoftClinicalExtras } from './import-clinical-extra';

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
    [[80, 'Lab Pat', '03111234567', 'Lahore', '30', 'Pakistan', '', 1, '2025-06-01 00:00:00']],
  ),
  table(
    'customers_blood_work',
    [
      'cbw_id',
      'cbw_cust_id',
      'cbw_bloodNumbFSH',
      'cbw_bloodDateFSH',
      'cbw_bloodNumbTSH',
      'cbw_bloodDateTSH',
      'cbw_bloodNumbB12',
      'cbw_bloodDateB12',
      'close',
    ],
    [[1, 80, '7.5', '2025-07-01', 'pending', '2025-07-01', '450', '0000-00-00', 1]],
  ),
  table(
    'customers_bhrt_details',
    ['bhrt_id', 'bhrt_cust_id', 'bhrt_date', 'bhrt_status', 'bhrt_note', 'close', 'crt_date'],
    [
      [1, 80, '2025-07-01', 'Recommended BHRT', 'start soon', 1, '2025-07-01 10:00:00'],
      [2, 80, '2025-08-01', 'On BHRT', '', 1, '2025-08-01 10:00:00'],
    ],
  ),
].join('\n');

describe('posSoft blood work and BHRT import', () => {
  let dir: string;
  let file: string;
  let branchId: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'possoft-extra-'));
    file = join(dir, 'pos.sql');
    writeFileSync(file, DUMP);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    await truncateAllTables();
    branchId = randomUUID();
    await AppDataSource.query(
      `INSERT INTO branches (id, name, code, city, kind, status) VALUES ($1,'DSM Lahore','LHR','Lahore','branch','active')`,
      [branchId],
    );
    await AppDataSource.query(
      `INSERT INTO patients (id, name, phone, phone_normalized, phone_last9, city, created_in_branch_id)
       VALUES ($1,'Lab Pat','03111234567','+923111234567','111234567','Lahore',$2)`,
      [randomUUID(), branchId],
    );
  });

  it('imports blood work results and BHRT status logs', async () => {
    const dump = await readDump(file, POSSOFT_EXTRA_TABLES);
    const summary = await importPossoftClinicalExtras(AppDataSource, dump);
    expect(summary).toMatchObject({
      bloodWorkResults: 2,
      bhrtLogs: 2,
      patientsCreated: 0,
      skipped: { bloodWorkNoValue: 1, bloodWorkNoDate: 0 },
    });

    const blood = (await AppDataSource.query(
      `SELECT test, value, unit, test_date::text AS date, b.code FROM blood_work_results r JOIN branches b ON b.id = r.branch_id ORDER BY test`,
    )) as Record<string, unknown>[];
    expect(blood).toEqual([
      { test: 'fsh', value: '7.500', unit: 'mIU/mL', date: '2025-07-01', code: 'LHR' },
      { test: 'b12', value: '450.000', unit: 'pg/mL', date: '2025-07-01', code: 'LHR' },
    ]);

    const bhrt = (await AppDataSource.query(
      `SELECT status, note, date::text AS date FROM bhrt_status_log ORDER BY date`,
    )) as Record<string, unknown>[];
    expect(bhrt).toEqual([
      { status: 'recommended', note: 'start soon', date: '2025-07-01' },
      { status: 'on', note: null, date: '2025-08-01' },
    ]);

    const again = await importPossoftClinicalExtras(AppDataSource, dump);
    expect(again).toMatchObject({ bloodWorkResults: 0, bloodWorkReused: 2, bhrtLogs: 0, bhrtReused: 2 });
  });

  it('dry run saves nothing', async () => {
    const dump = await readDump(file, POSSOFT_EXTRA_TABLES);
    const summary = await importPossoftClinicalExtras(AppDataSource, dump, { dryRun: true });
    expect(summary).toMatchObject({ bloodWorkResults: 2, bhrtLogs: 2 });
    const [row] = (await AppDataSource.query(`SELECT COUNT(*)::int AS count FROM bhrt_status_log`)) as {
      count: number;
    }[];
    expect(row?.count).toBe(0);
  });
});
