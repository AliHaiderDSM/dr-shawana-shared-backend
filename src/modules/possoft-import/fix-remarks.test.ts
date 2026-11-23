import { randomUUID } from 'node:crypto';
import { truncateAllTables } from '../../../tests/helpers/db';
import { AppDataSource } from '../../database/data-source';
import { fixClinicalRemarks } from './fix-remarks';

describe('fixClinicalRemarks', () => {
  beforeEach(() => truncateAllTables());

  it('fills clinical remarks from the appointment remark, creating consultations when needed', async () => {
    const branch = randomUUID();
    const patient = randomUUID();
    const staff = randomUUID();
    const doctor = randomUUID();
    const withConsult = randomUUID();
    const remarkOnly = randomUUID();
    const consultation = randomUUID();

    await AppDataSource.query(
      `INSERT INTO branches (id, name, code, city, kind, status) VALUES ($1,'DSM Lahore','LHR','Lahore','branch','active')`,
      [branch],
    );
    await AppDataSource.query(
      `INSERT INTO patients (id, name, phone, phone_normalized, phone_last9, city, created_in_branch_id)
       VALUES ($1,'Pat','0300','+92300','000000300','Lahore',$2)`,
      [patient, branch],
    );
    await AppDataSource.query(
      `INSERT INTO staff_profiles (id, branch_id, role, first_name, last_name, email, username, status)
       VALUES ($1,$2,'doctor','Dr','One','d1@x.dsm','drone','active')`,
      [staff, branch],
    );
    await AppDataSource.query(
      `INSERT INTO doctors (id, branch_id, staff_id, display_name, status) VALUES ($1,$2,$3,'Dr One','active')`,
      [doctor, branch, staff],
    );
    const appt = async (id: string, time: string, remark: string | null) =>
      AppDataSource.query(
        `INSERT INTO appointments (id, branch_id, patient_id, doctor_id, date, time_from, time_to, mode, visit_type, fee, status, remark)
         VALUES ($1,$2,$3,$4,'2025-07-01',$5,'10:30:00','physical','new',0,'completed',$6)`,
        [id, branch, patient, doctor, time, remark],
      );
    await appt(withConsult, '09:00:00', 'Detailed clinical note for visit one');
    await appt(remarkOnly, '10:00:00', 'Short note for visit two');
    await AppDataSource.query(
      `INSERT INTO consultations (id, branch_id, patient_id, doctor_id, appointment_id, status) VALUES ($1,$2,$3,$4,$5,'completed')`,
      [consultation, branch, patient, doctor, withConsult],
    );

    const counts = await fixClinicalRemarks(AppDataSource);
    expect(counts['consultations for appointments with a remark']).toBe(1);
    expect(counts['clinical remarks sections for consultations that lack one']).toBe(2);

    const plans = (await AppDataSource.query(
      `SELECT a.remark, cs.data->>'plan' AS plan
         FROM appointments a
         JOIN consultations c ON c.appointment_id = a.id
         JOIN consultation_sections cs ON cs.consultation_id = c.id AND cs.section_key = 'clinical_assessment'
        ORDER BY a.time_from`,
    )) as { remark: string; plan: string }[];
    expect(plans).toEqual([
      { remark: 'Detailed clinical note for visit one', plan: 'Detailed clinical note for visit one' },
      { remark: 'Short note for visit two', plan: 'Short note for visit two' },
    ]);

    const again = await fixClinicalRemarks(AppDataSource);
    expect(again['consultations for appointments with a remark']).toBe(0);
    expect(again['clinical remarks sections for consultations that lack one']).toBe(0);
  });
});
