import { randomUUID } from 'node:crypto';
import { truncateAllTables } from '../../../tests/helpers/db';
import { AppDataSource } from '../../database/data-source';
import { fixDuplicateDoctors } from './fix-duplicate-doctors';

describe('fix duplicate doctors', () => {
  let branchId: string;
  let patientId: string;
  let keeper: string;
  let keeperStaff: string;
  let dup: string;
  let dupStaff: string;

  beforeEach(async () => {
    await truncateAllTables();
    branchId = randomUUID();
    patientId = randomUUID();
    keeper = randomUUID();
    keeperStaff = randomUUID();
    dup = randomUUID();
    dupStaff = randomUUID();
    await AppDataSource.query(
      `INSERT INTO branches (id, name, code, city, kind, status) VALUES ($1,'DSM Lahore','LHR','Lahore','branch','active')`,
      [branchId],
    );
    await AppDataSource.query(
      `INSERT INTO patients (id, name, phone, phone_normalized, phone_last9, city, created_in_branch_id)
       VALUES ($1,'Pat','03111234567','+923111234567','111234567','Lahore',$2)`,
      [patientId, branchId],
    );
    for (const [doc, staff, user] of [
      [keeper, keeperStaff, 'shawana1'],
      [dup, dupStaff, 'shawana2'],
    ]) {
      await AppDataSource.query(
        `INSERT INTO staff_profiles (id, branch_id, role, first_name, last_name, email, username, status)
         VALUES ($1,$2,'doctor','Shawana','Mufti',$3,$4,'active')`,
        [staff, branchId, `${user}@x.dsm`, user],
      );
      await AppDataSource.query(
        `INSERT INTO doctors (id, branch_id, staff_id, display_name, status) VALUES ($1,$2,$3,'Dr Shawana','active')`,
        [doc, branchId, staff],
      );
    }
    const appt = async (doctorId: string, from: string, to: string) =>
      AppDataSource.query(
        `INSERT INTO appointments (id, branch_id, patient_id, doctor_id, date, time_from, time_to, mode, visit_type, fee, status)
         VALUES ($1,$2,$3,$4,'2026-07-01',$5,$6,'physical','new',0,'completed')`,
        [randomUUID(), branchId, patientId, doctorId, from, to],
      );
    await appt(keeper, '10:00:00', '10:30:00');
    await appt(keeper, '11:00:00', '11:30:00');
    await appt(dup, '12:00:00', '12:30:00');
  });

  it('merges same-name doctors into the one with the most appointments', async () => {
    const result = await fixDuplicateDoctors(AppDataSource);
    expect(result).toMatchObject({ groups: 1, merged: 1, removedStaff: 1 });
    expect(result.reassigned.appointments).toBe(1);

    const [keeperCount] = (await AppDataSource.query(
      `SELECT COUNT(*)::int AS count FROM appointments WHERE doctor_id = $1`,
      [keeper],
    )) as { count: number }[];
    expect(keeperCount?.count).toBe(3);

    const [dupDoctor] = (await AppDataSource.query(
      `SELECT deleted_at IS NOT NULL AS deleted FROM doctors WHERE id = $1`,
      [dup],
    )) as { deleted: boolean }[];
    expect(dupDoctor?.deleted).toBe(true);

    const [dupStaffRow] = (await AppDataSource.query(
      `SELECT deleted_at IS NOT NULL AS deleted, status FROM staff_profiles WHERE id = $1`,
      [dupStaff],
    )) as { deleted: boolean; status: string }[];
    expect(dupStaffRow).toMatchObject({ deleted: true, status: 'inactive' });

    const again = await fixDuplicateDoctors(AppDataSource);
    expect(again.groups).toBe(0);
  });
});
