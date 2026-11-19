import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TreatmentPlanItems1795800000000 implements MigrationInterface {
  name = 'TreatmentPlanItems1795800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "treatment_plans" ALTER COLUMN "plan" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "treatment_plans" ADD "items" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "treatment_plans" DROP COLUMN "items"`);
    await queryRunner.query(`UPDATE "treatment_plans" SET "plan" = '' WHERE "plan" IS NULL`);
    await queryRunner.query(`ALTER TABLE "treatment_plans" ALTER COLUMN "plan" SET NOT NULL`);
  }
}
