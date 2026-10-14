import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PatientAppProfile1792900000000 implements MigrationInterface {
  name = 'PatientAppProfile1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patients" ADD "app_updated_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN "app_updated_at"`);
  }
}
