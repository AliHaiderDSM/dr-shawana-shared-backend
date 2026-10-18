import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class PatientWeightHeight1793500000000 implements MigrationInterface {
  name = 'PatientWeightHeight1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patients" ADD "weight_kg" numeric(5,1)`);
    await queryRunner.query(`ALTER TABLE "patients" ADD "height_cm" numeric(5,1)`);
    await queryRunner.query(
      `ALTER TABLE "patients" ADD CONSTRAINT "CHK_patients_weight" CHECK ("weight_kg" IS NULL OR ("weight_kg" > 0 AND "weight_kg" <= 400))`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD CONSTRAINT "CHK_patients_height" CHECK ("height_cm" IS NULL OR ("height_cm" > 0 AND "height_cm" <= 260))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patients" DROP CONSTRAINT "CHK_patients_height"`);
    await queryRunner.query(`ALTER TABLE "patients" DROP CONSTRAINT "CHK_patients_weight"`);
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN "height_cm"`);
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN "weight_kg"`);
  }
}
