import { randomUUID } from 'node:crypto';
import { truncateAllTables } from '../../../tests/helpers/db';
import { AppDataSource } from '../../database/data-source';
import { fixClinicalBranches } from './fix-branches';

describe('fixClinicalBranches', () => {
  beforeEach(() => truncateAllTables());

  it('moves clinical data to the doctor and patient treating branch', async () => {
    const lhr = randomUUID();
    const khi = randomUUID();
    const patient = randomUUID();
    const staff = randomUUID();
    const doctor = randomUUID();
    const appointment = randomUUID();
    const payment = randomUUID();
    const prescription = randomUUID();
    const record = randomUUID();

    await AppDataSource.query(
      `INSERT INTO branches (id, name, code, city, kind, status) VALUES
         ($1,'DSM Lahore','LHR','Lahore','branch','active'),
         ($2,'DSM Karachi','KHI','Karachi','branch','active')`,
      [lhr, khi],
    );
    await AppDataSource.query(
      `INSERT INTO patients (id, name, phone, phone_normalized, phone_last9, city, created_in_branch_id)
       VALUES ($1,'Pat','0300','+92300','000000300','Lahore',$2)`,
      [patient, lhr],
    );
    await AppDataSource.query(
      `INSERT INTO staff_profiles (id, branch_id, role, first_name, last_name, email, username, status)
       VALUES ($1,$2,'doctor','Dr','Khi','k@x.dsm','drkhi','active')`,
      [staff, khi],
    );
    await AppDataSource.query(
      `INSERT INTO doctors (id, branch_id, staff_id, display_name, status) VALUES ($1,$2,$3,'Dr Khi','active')`,
      [doctor, khi, staff],
    );
    await AppDataSource.query(
      `INSERT INTO appointments (id, branch_id, patient_id, doctor_id, date, time_from, time_to, mode, visit_type, fee, status)
       VALUES ($1,$2,$3,$4,'2025-07-01','10:00:00','10:30:00','physical','new',0,'completed')`,
      [appointment, lhr, patient, doctor],
    );
    await AppDataSource.query(
      `INSERT INTO account_sheets (id, branch_id, account_name, account_code, type, date) VALUES ($1,$2,'Cash','C','cash',CURRENT_DATE)`,
      [randomUUID(), lhr],
    );
    const [sheet] = (await AppDataSource.query(`SELECT id FROM account_sheets LIMIT 1`)) as { id: string }[];
    await AppDataSource.query(
      `INSERT INTO appointment_payments (id, branch_id, appointment_id, method, amount, date, account_sheet_id)
       VALUES ($1,$2,$3,'cash',100,'2025-07-01',$4)`,
      [payment, lhr, appointment, sheet?.id],
    );
    await AppDataSource.query(
      `INSERT INTO prescriptions (id, branch_id, patient_id, doctor_id, date, diagnosis, notes)
       VALUES ($1,$2,$3,$4,'2025-07-01','dx','{}')`,
      [prescription, lhr, patient, doctor],
    );
    await AppDataSource.query(
      `INSERT INTO medical_records (id, branch_id, patient_id, type, date) VALUES ($1,$2,$3,'medical_record','2025-07-01')`,
      [record, lhr, patient],
    );

    const counts = await fixClinicalBranches(AppDataSource);
    expect(counts['appointments -> doctor branch']).toBe(1);

    const branchOf = async (table: string, id: string) =>
      (
        (await AppDataSource.query(
          `SELECT b.code FROM ${table} t JOIN branches b ON b.id = t.branch_id WHERE t.id = $1`,
          [id],
        )) as { code: string }[]
      )[0]?.code;

    expect(await branchOf('appointments', appointment)).toBe('KHI');
    expect(await branchOf('appointment_payments', payment)).toBe('KHI');
    expect(await branchOf('prescriptions', prescription)).toBe('KHI');
    expect(await branchOf('medical_records', record)).toBe('KHI');

    const again = await fixClinicalBranches(AppDataSource);
    expect(again['appointments -> doctor branch']).toBe(0);
  });
});
