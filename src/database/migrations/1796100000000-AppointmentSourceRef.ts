import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AppointmentSourceRef1796100000000 implements MigrationInterface {
  name = 'AppointmentSourceRef1796100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "appointments" ADD "source_app_id" character varying(20)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_appointments_source_app_id" ON "appointments" ("source_app_id") WHERE "source_app_id" IS NOT NULL AND "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_appointments_source_app_id"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "source_app_id"`);
  }
}
