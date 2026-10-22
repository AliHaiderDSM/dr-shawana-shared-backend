import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class SaleCancelledOn1794100000000 implements MigrationInterface {
  name = 'SaleCancelledOn1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales" ADD "cancelled_on" date`);
    await queryRunner.query(
      `UPDATE "sales" SET "cancelled_on" = ("updated_at" AT TIME ZONE 'UTC')::date
        WHERE "delivery_status" = 'cancelled'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN "cancelled_on"`);
  }
}
