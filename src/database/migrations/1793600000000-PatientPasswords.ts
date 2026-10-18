import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class PatientPasswords1793600000000 implements MigrationInterface {
  name = 'PatientPasswords1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patient_accounts" ADD "password_set_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patient_accounts" DROP COLUMN "password_set_at"`);
  }
}
