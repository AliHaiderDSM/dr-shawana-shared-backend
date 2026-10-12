import type { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreReceipts1792400000000 implements MigrationInterface {
  name = 'StoreReceipts1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."staff_role" ADD VALUE IF NOT EXISTS 'lab_officer'`);
    await queryRunner.query(`CREATE TYPE "public"."stock_receipt_status" AS ENUM('pending', 'confirmed')`);
    await queryRunner.query(`ALTER TABLE "stock_ins" ADD "grn_no" character varying(30)`);
    await queryRunner.query(`ALTER TABLE "stock_ins" ADD "receipt_status" "public"."stock_receipt_status"`);
    await queryRunner.query(`ALTER TABLE "stock_ins" ADD "received_qty" numeric(12,3)`);
    await queryRunner.query(`ALTER TABLE "stock_ins" ADD "receipt_note" text`);
    await queryRunner.query(`ALTER TABLE "stock_ins" ADD "confirmed_by" uuid`);
    await queryRunner.query(`ALTER TABLE "stock_ins" ADD "confirmed_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`CREATE INDEX "IDX_stock_ins_grn_no" ON "stock_ins" ("grn_no")`);
    await queryRunner.query(`CREATE INDEX "IDX_stock_ins_receipt_status" ON "stock_ins" ("receipt_status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_ins_receipt_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_ins_grn_no"`);
    for (const column of ['confirmed_at', 'confirmed_by', 'receipt_note', 'received_qty', 'receipt_status', 'grn_no']) {
      await queryRunner.query(`ALTER TABLE "stock_ins" DROP COLUMN "${column}"`);
    }
    await queryRunner.query(`DROP TYPE "public"."stock_receipt_status"`);
  }
}
