import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ReceiveIssues1795500000000 implements MigrationInterface {
  name = 'ReceiveIssues1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."stock_hold_reason" ADD VALUE IF NOT EXISTS 'missing'`);
    await queryRunner.query(`ALTER TYPE "public"."stock_hold_status" ADD VALUE IF NOT EXISTS 'sent_back'`);
    await queryRunner.query(`ALTER TABLE "stock_holds" ADD "transfer_no" character varying(30)`);
    await queryRunner.query(`CREATE INDEX "IDX_stock_holds_transfer_no" ON "stock_holds" ("transfer_no")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "stock_holds" SET "reason" = 'other' WHERE "reason" = 'missing'`);
    await queryRunner.query(`UPDATE "stock_holds" SET "status" = 'released' WHERE "status" = 'sent_back'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_holds_transfer_no"`);
    await queryRunner.query(`ALTER TABLE "stock_holds" DROP COLUMN "transfer_no"`);
  }
}
