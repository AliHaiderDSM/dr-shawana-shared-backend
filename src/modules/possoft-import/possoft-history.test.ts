import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { truncateAllTables } from '../../../tests/helpers/db';
import { AppDataSource } from '../../database/data-source';
import { readDump } from './dump-reader';
import { POSSOFT_HISTORY_TABLES, importPossoftHistory } from './import-history';

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
    [[90, 'Hist Pat', '03111234567', 'Lahore', '42', 'Pakistan', '', 1, '2025-06-01 00:00:00']],
  ),
  table(
    'appointments',
    ['app_id', 'app_pat_id', 'app_doc_id', 'app_date', 'app_time_from', 'app_time_to', 'close', 'crt_date'],
    [[5, 90, 1, '2025-07-01', '10:00:00', '10:30:00', 1, '2025-07-01 10:00:00']],
  ),
  table(
    'customers_history',
    [
      'hist_id',
      'hist_cust_id',
      'hist_appoint_id',
      'hist_custWeight',
      'hist_custHeight',
      'hist_custmaritStatus',
      'hist_custMarriedYear',
      'hist_custkidStatus',
      'hist_custkidDetails',
      'hist_custMajorComplaint',
      'hist_custCurrentMedication',
      'hist_custDiscussConsultation',
      'hist_PCOSVal',
      'hist_HypothyroidismVal',
      'hist_MRSDate',
      'hist_hotFlushesVal',
      'hist_sleepProblemsVal',
      'hist_BloatingVal',
      'hist_HairLossVal',
      'hist_StartBHRTReVal',
      'hist_VasomotorSymptomsReVal',
      'hist_glpDietPlanStatus',
      'close',
      'crt_date',
    ],
    [
      [
        1,
        90,
        5,
        '65',
        "5'6",
        'Married',
        '12',
        '1',
        'two kids',
        'Hot flashes and poor sleep',
        'None',
        'Discuss HRT',
        1,
        1,
        '2025-07-01',
        3,
        2,
        1,
        1,
        1,
        1,
        '1',
        1,
        '2025-07-01 10:00:00',
      ],
    ],
  ),
].join('\n');

describe('posSoft intake history import', () => {
  let dir: string;
  let file: string;
  let branchId: string;
  let patientId: string;
  let doctorId: string;
  let appointmentId: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'possoft-hist-'));
    file = join(dir, 'pos.sql');
    writeFileSync(file, DUMP);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    await truncateAllTables();
    branchId = randomUUID();
    patientId = randomUUID();
    doctorId = randomUUID();
    appointmentId = randomUUID();
    const staffId = randomUUID();
    await AppDataSource.query(
      `INSERT INTO branches (id, name, code, city, kind, status) VALUES ($1,'DSM Lahore','LHR','Lahore','branch','active')`,
      [branchId],
    );
    await AppDataSource.query(
      `INSERT INTO patients (id, name, phone, phone_normalized, phone_last9, city, created_in_branch_id)
       VALUES ($1,'Hist Pat','03111234567','+923111234567','111234567','Lahore',$2)`,
      [patientId, branchId],
    );
    await AppDataSource.query(
      `INSERT INTO staff_profiles (id, branch_id, role, first_name, last_name, email, username, status)
       VALUES ($1,$2,'doctor','Dr','One','d1@x.dsm','drone','active')`,
      [staffId, branchId],
    );
    await AppDataSource.query(
      `INSERT INTO doctors (id, branch_id, staff_id, display_name, status) VALUES ($1,$2,$3,'Dr One','active')`,
      [doctorId, branchId, staffId],
    );
    await AppDataSource.query(
      `INSERT INTO appointments (id, branch_id, patient_id, doctor_id, date, time_from, time_to, mode, visit_type, fee, status)
       VALUES ($1,$2,$3,$4,'2025-07-01','10:00:00','10:30:00','physical','new',0,'completed')`,
      [appointmentId, branchId, patientId, doctorId],
    );
  });

  it('creates a consultation linked to the appointment with valid intake sections', async () => {
    const dump = await readDump(file, POSSOFT_HISTORY_TABLES);
    const summary = await importPossoftHistory(AppDataSource, dump);
    expect(summary).toMatchObject({
      consultations: 1,
      skipped: { appointmentNotMatched: 0, noAppointmentRow: 0 },
    });
    expect(summary.sectionsByKey).toMatchObject({
      basic_info: 1,
      medical_history: 1,
      mrs_scale: 1,
      additional_symptoms: 1,
      clinical_assessment: 1,
      plans: 1,
    });

    const [consult] = (await AppDataSource.query(
      `SELECT appointment_id, patient_id, doctor_id, major_complaint FROM consultations WHERE appointment_id = $1`,
      [appointmentId],
    )) as Record<string, unknown>[];
    expect(consult).toMatchObject({
      appointment_id: appointmentId,
      patient_id: patientId,
      doctor_id: doctorId,
      major_complaint: 'Hot flashes and poor sleep',
    });

    const sections = (await AppDataSource.query(
      `SELECT section_key, data FROM consultation_sections s
         JOIN consultations c ON c.id = s.consultation_id WHERE c.appointment_id = $1`,
      [appointmentId],
    )) as { section_key: string; data: Record<string, unknown> }[];
    const byKey = Object.fromEntries(sections.map((s) => [s.section_key, s.data]));
    expect(byKey.basic_info).toMatchObject({ maritalStatus: 'married', weightKg: 65 });
    expect(byKey.medical_history?.conditions).toEqual(expect.arrayContaining(['pcos', 'hypothyroidism']));
    expect(byKey.mrs_scale).toMatchObject({ hotFlushes: 3, sleepProblems: 2 });
    expect(byKey.additional_symptoms?.symptoms).toEqual(expect.arrayContaining(['bloating', 'hair_loss']));
    expect(byKey.clinical_assessment?.treatmentPlan).toContain('start_bhrt');
    expect(byKey.plans).toMatchObject({ glpDietPlan: 'yes' });

    const again = await importPossoftHistory(AppDataSource, dump);
    expect(again).toMatchObject({ consultations: 0, consultationsReused: 1 });
  });

  it('dry run saves nothing', async () => {
    const dump = await readDump(file, POSSOFT_HISTORY_TABLES);
    const summary = await importPossoftHistory(AppDataSource, dump, { dryRun: true });
    expect(summary.consultations).toBe(1);
    const [row] = (await AppDataSource.query(`SELECT COUNT(*)::int AS count FROM consultations`)) as {
      count: number;
    }[];
    expect(row?.count).toBe(0);
  });
});
