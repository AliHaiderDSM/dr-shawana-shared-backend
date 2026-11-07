import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class PatientSessionRotation1794800000000 implements MigrationInterface {
  name = 'PatientSessionRotation1794800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patient_sessions" ADD "previous_hash" character varying(128)`);
    await queryRunner.query(`ALTER TABLE "patient_sessions" ADD "rotated_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "patient_sessions" ADD "revoked_reason" character varying(30)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_patient_sessions_previous_hash" ON "patient_sessions" ("previous_hash") WHERE "previous_hash" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_patient_sessions_previous_hash"`);
    await queryRunner.query(`ALTER TABLE "patient_sessions" DROP COLUMN "revoked_reason"`);
    await queryRunner.query(`ALTER TABLE "patient_sessions" DROP COLUMN "rotated_at"`);
    await queryRunner.query(`ALTER TABLE "patient_sessions" DROP COLUMN "previous_hash"`);
  }
}
