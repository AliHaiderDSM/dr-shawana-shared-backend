import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AppointmentFee1791500000000 implements MigrationInterface {
  name = 'AppointmentFee1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "appointments" ADD "fee" numeric(12,2) NOT NULL DEFAULT '0'`);
    await queryRunner.query(
      `UPDATE "appointments" a SET "fee" = GREATEST(d."consultation_fee", COALESCE((
         SELECT SUM(p."amount") FROM "appointment_payments" p WHERE p."appointment_id" = a."id" AND p."deleted_at" IS NULL), 0))
       FROM "doctors" d WHERE d."id" = a."doctor_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "fee"`);
  }
}
