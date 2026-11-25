import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { truncateAllTables } from '../../../tests/helpers/db';
import { AppDataSource } from '../../database/data-source';
import { readDump } from './dump-reader';
import { POSSOFT_RESYNC_TABLES, resyncAppointments } from './resync-appointments';

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

const DOC_COLS = ['doc_id', 'doc_name', 'doc_username', 'close', 'status', 'crt_date'];
const CUST_COLS = ['cust_id', 'cust_name', 'cust_phone', 'cust_city', 'close', 'crt_date'];
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

const dims = [
  table('doctors', DOC_COLS, [[1, 'Dr X', 'drx', 1, 1, '2026-06-01 00:00:00']]),
  table('customers', CUST_COLS, [[1, 'Alpha', '03001112223', 'Lahore', 1, '2026-06-01 00:00:00']]),
];

const app = (id: number, date: string, from: string, to: string): (string | number)[] => [
  id,
  1,
  'Lahore',
  1,
  'Physical',
  'New',
  date,
  from,
  to,
  '',
  '0',
  '',
  0,
  1,
  '2026-06-20 10:00:00',
];

const OLD = [...dims, table('appointments', APP_COLS, [app(1, '2026-07-01', '10:00:00', '10:30:00')])].join('\n');
const NEW = [
  ...dims,
  table('appointments', APP_COLS, [
    app(1, '2026-07-05', '11:00:00', '11:30:00'),
    app(2, '2026-07-06', '12:00:00', '12:30:00'),
  ]),
].join('\n');

describe('resync appointments', () => {
  let dir: string;
  let branchId: string;
  let patientId: string;
  let doctorId: string;
  let existingAppt: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'resync-'));
    writeFileSync(join(dir, 'old.sql'), OLD);
    writeFileSync(join(dir, 'new.sql'), NEW);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    await truncateAllTables();
    branchId = randomUUID();
    patientId = randomUUID();
    doctorId = randomUUID();
    existingAppt = randomUUID();
    const staffId = randomUUID();
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
    await AppDataSource.query(
      `INSERT INTO appointments (id, branch_id, patient_id, doctor_id, date, time_from, time_to, mode, visit_type, fee, status)
       VALUES ($1,$2,$3,$4,'2026-07-01','10:00:00','10:30:00','physical','new',0,'booked')`,
      [existingAppt, branchId, patientId, doctorId],
    );
  });

  it('back-fills ids, updates rescheduled appointments and creates missing ones', async () => {
    const oldDump = await readDump(join(dir, 'old.sql'), POSSOFT_RESYNC_TABLES);
    const newDump = await readDump(join(dir, 'new.sql'), POSSOFT_RESYNC_TABLES);
    const summary = await resyncAppointments(AppDataSource, oldDump, newDump);
    expect(summary).toMatchObject({ backfilled: 1, updated: 1, created: 1 });

    const [moved] = (await AppDataSource.query(
      `SELECT to_char(date,'YYYY-MM-DD') AS d, time_from::text AS t, source_app_id FROM appointments WHERE id = $1`,
      [existingAppt],
    )) as { d: string; t: string; source_app_id: string }[];
    expect(moved).toMatchObject({ d: '2026-07-05', t: '11:00:00', source_app_id: '1' });

    const [fresh] = (await AppDataSource.query(
      `SELECT to_char(date,'YYYY-MM-DD') AS d FROM appointments WHERE source_app_id = '2'`,
    )) as { d: string }[];
    expect(fresh?.d).toBe('2026-07-06');

    const again = await resyncAppointments(AppDataSource, oldDump, newDump);
    expect(again).toMatchObject({ backfilled: 0, created: 0 });
  });
});
