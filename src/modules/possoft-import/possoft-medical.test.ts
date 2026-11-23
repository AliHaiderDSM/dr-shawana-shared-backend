import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { truncateAllTables } from '../../../tests/helpers/db';
import { AppDataSource } from '../../database/data-source';
import { readDump } from './dump-reader';
import { POSSOFT_MEDICAL_TABLES, importPossoftMedical } from './import-medical';

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

describe('posSoft medical records import', () => {
  const fake = installFakeSupabase();
  let dir: string;
  let filesDir: string;
  let file: string;
  let branchId: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'possoft-med-'));
    filesDir = join(dir, 'pos-img');
    mkdirSync(filesDir);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    await truncateAllTables();
    fake.objects.clear();
    writeFileSync(join(filesDir, 'scan1.png'), Buffer.from('PNGDATA-1'));
    writeFileSync(join(filesDir, 'report.pdf'), Buffer.from('PDF-REPORT-BYTES'));
    file = join(dir, 'pos.sql');
    writeFileSync(
      file,
      [
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
          [[70, 'Med Pat', '03111234567', 'Lahore', '30', 'Pakistan', '', 1, '2025-06-01 00:00:00']],
        ),
        table(
          'customers_med_record',
          [
            'med_record_id',
            'med_record_cust_id',
            'med_record_date',
            'med_record_status',
            'med_record_screenshot',
            'med_record_note',
            'close',
            'crt_date',
          ],
          [
            [
              1,
              70,
              '2025-07-01',
              'previous',
              'scan1.png,report.pdf,junk.zip',
              'blood work',
              1,
              '2025-07-01 10:00:00',
            ],
            [2, 70, '2025-07-02', '', 'gone.png', 'missing one', 1, '2025-07-02 10:00:00'],
          ],
        ),
      ].join('\n'),
    );

    branchId = randomUUID();
    await AppDataSource.query(
      `INSERT INTO branches (id, name, code, city, kind, status) VALUES ($1,'DSM Lahore','LHR','Lahore','branch','active')`,
      [branchId],
    );
    await AppDataSource.query(
      `INSERT INTO patients (id, name, phone, phone_normalized, phone_last9, city, created_in_branch_id)
       VALUES ($1,'Med Pat','03111234567','+923111234567','111234567','Lahore',$2)`,
      [randomUUID(), branchId],
    );
  });

  it('creates medical records and uploads image and pdf files', async () => {
    const dump = await readDump(file, POSSOFT_MEDICAL_TABLES);
    const summary = await importPossoftMedical(AppDataSource, dump, { filesDir });
    expect(summary).toMatchObject({
      medicalRecords: 2,
      filesUploaded: 2,
      patientsCreated: 0,
      skipped: { filesMissing: 1, filesWrongType: 1 },
    });

    const files = (await AppDataSource.query(
      `SELECT f.original_name, f.content_type, f.size_bytes, f.file_path, b.code, p.name AS patient
         FROM medical_record_files f JOIN branches b ON b.id = f.branch_id
         JOIN medical_records r ON r.id = f.medical_record_id JOIN patients p ON p.id = r.patient_id
        ORDER BY f.original_name`,
    )) as Record<string, unknown>[];
    expect(files).toEqual([
      expect.objectContaining({
        original_name: 'report.pdf',
        content_type: 'application/pdf',
        size_bytes: 16,
        code: 'LHR',
        patient: 'Med Pat',
      }),
      expect.objectContaining({
        original_name: 'scan1.png',
        content_type: 'image/png',
        size_bytes: 9,
      }),
    ]);
    expect(String(files[0]?.file_path)).toMatch(/^LHR\/medical-records\/[0-9a-f-]+\.pdf$/);
    expect(fake.objects.has(`medical-records/${String(files[0]?.file_path)}`)).toBe(true);
    expect(
      [...fake.objects.keys()].filter((k) => k.startsWith('medical-records/LHR/medical-records/')),
    ).toHaveLength(2);

    const again = await importPossoftMedical(AppDataSource, dump, { filesDir });
    expect(again).toMatchObject({ medicalRecords: 0, recordsReused: 2, filesUploaded: 0, filesReused: 2 });
    const [fileCount] = (await AppDataSource.query(
      `SELECT COUNT(*)::int AS count FROM medical_record_files`,
    )) as { count: number }[];
    expect(fileCount?.count).toBe(2);
  });

  it('dry run uploads nothing and saves nothing', async () => {
    const dump = await readDump(file, POSSOFT_MEDICAL_TABLES);
    const summary = await importPossoftMedical(AppDataSource, dump, { filesDir, dryRun: true });
    expect(summary).toMatchObject({ medicalRecords: 2, filesUploaded: 2, skipped: { filesMissing: 1 } });
    expect(fake.objects.size).toBe(0);
    const [recCount] = (await AppDataSource.query(`SELECT COUNT(*)::int AS count FROM medical_records`)) as {
      count: number;
    }[];
    expect(recCount?.count).toBe(0);
  });
});
