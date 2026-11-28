import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { truncateAllTables } from '../../../tests/helpers/db';
import { AppDataSource } from '../../database/data-source';
import { POSSOFT_ENTERED_BY_TABLES, backfillEnteredBy } from './backfill-entered-by';
import { readDump } from './dump-reader';

function table(name: string, columns: string[], rows: (string | number)[][]): string {
  const create = `CREATE TABLE \`${name}\` (\n${columns.map((c) => `  \`${c}\` text`).join(',\n')}\n) ENGINE=InnoDB;`;
  const values = rows.map((row) => `(${row.map((v) => `'${String(v)}'`).join(',')})`).join(',\n');
  return `${create}\nINSERT INTO \`${name}\` VALUES\n${values};\n`;
}

const DUMP = [
  table(
    'wt_users',
    ['wt_id', 'fname', 'lname'],
    [
      [4, 'Amna', 'Rafique'],
      [7, 'Zainab', 'Yaseen'],
    ],
  ),
  table(
    'appointments',
    ['app_id', 'entry_by', 'crt_date', 'close'],
    [
      [101, 4, '2026-11-16 11:12:00', 1],
      [102, 7, '2026-10-23 12:18:00', 1],
      [103, 99, '2026-10-01 09:00:00', 1],
      [104, 7, '2026-09-05 17:45:00', 1],
    ],
  ),
].join('\n');

describe('backfill posSoft entered by', () => {
  let dir: string;
  let branchId: string;
  let patientId: string;
  let doctorId: string;
  let staffId: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'entered-by-'));
    writeFileSync(join(dir, 'dump.sql'), DUMP);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    await truncateAllTables();
    branchId = randomUUID();
    patientId = randomUUID();
    doctorId = randomUUID();
    staffId = randomUUID();
    await AppDataSource.query(
      `INSERT INTO branches (id, name, code, city, kind, status) VALUES ($1,'DSM Lahore','LHR','Lahore','branch','active')`,
      [branchId],
    );
    await AppDataSource.query(
      `INSERT INTO patients (id, name, phone, phone_normalized, phone_last9, city, created_in_branch_id)
       VALUES ($1,'Alpha','03001112223','+923001112223','001112223','Lahore',$2)`,
      [patientId, branchId],
    );
    await AppDataSource.query(
      `INSERT INTO staff_profiles (id, branch_id, role, first_name, last_name, email, username, status)
       VALUES ($1,$2,'doctor','Dr','X','drx@x.dsm','drx','active')`,
      [staffId, branchId],
    );
    await AppDataSource.query(
      `INSERT INTO doctors (id, branch_id, staff_id, display_name, status) VALUES ($1,$2,$3,'Dr X','active')`,
      [doctorId, branchId, staffId],
    );
    const appt = (sourceId: string, time: string, createdBy: string | null) =>
      AppDataSource.query(
        `INSERT INTO appointments (branch_id, patient_id, doctor_id, date, time_from, time_to, mode, visit_type, fee, status, source_app_id, created_by)
         VALUES ($1,$2,$3,'2026-11-17',$4,'23:00:00','physical','new',0,'booked',$5,$6)`,
        [branchId, patientId, doctorId, time, sourceId, createdBy],
      );
    await appt('101', '10:00:00', null);
    await appt('102', '11:00:00', staffId);
    await appt('103', '12:00:00', null);
    await appt('104', '13:00:00', null);
  });

  it('fills the posSoft entry name and time on imported appointments only', async () => {
    const dump = await readDump(join(dir, 'dump.sql'), POSSOFT_ENTERED_BY_TABLES);
    const dry = await backfillEnteredBy(AppDataSource, dump, { dryRun: true });
    expect(dry).toMatchObject({ appointments: 4, updated: 3, withoutUser: 1 });
    const [untouched] = (await AppDataSource.query(
      `SELECT entered_by_name FROM appointments WHERE source_app_id = '101'`,
    )) as { entered_by_name: string | null }[];
    expect(untouched?.entered_by_name).toBeNull();

    await backfillEnteredBy(AppDataSource, dump);
    const rows = (await AppDataSource.query(
      `SELECT source_app_id AS id, entered_by_name AS name,
              to_char(created_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD HH24:MI') AS at
         FROM appointments ORDER BY source_app_id`,
    )) as { id: string; name: string | null; at: string }[];
    expect(rows[0]).toMatchObject({ id: '101', name: 'Amna Rafique', at: '2026-11-16 11:12' });
    expect(rows[1]?.name).toBeNull();
    expect(rows[2]).toMatchObject({ id: '103', name: null, at: '2026-10-01 09:00' });
    expect(rows[3]).toMatchObject({ id: '104', name: 'Zainab Yaseen', at: '2026-09-05 17:45' });
  });
});
