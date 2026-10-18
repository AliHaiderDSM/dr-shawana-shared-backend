import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class DoctorProfilesForDoctorStaff1793400000000 implements MigrationInterface {
  name = 'DoctorProfilesForDoctorStaff1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO doctors (branch_id, staff_id, display_name, phone, email, created_by)
      SELECT s.branch_id, s.id, TRIM(s.first_name || ' ' || s.last_name), s.phone, s.email, s.created_by
        FROM staff_profiles s
       WHERE s.role = 'doctor'
         AND s.branch_id IS NOT NULL
         AND s.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM doctors d WHERE d.staff_id = s.id AND d.deleted_at IS NULL)
    `);
  }

  public async down(): Promise<void> {}
}
