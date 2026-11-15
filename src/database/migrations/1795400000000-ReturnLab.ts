import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ReturnLab1795400000000 implements MigrationInterface {
  name = 'ReturnLab1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."sale_return_disposition" ADD VALUE IF NOT EXISTS 'lab'`);
    await queryRunner.query(`ALTER TYPE "public"."inventory_item_status" ADD VALUE IF NOT EXISTS 'at_lab'`);
    await queryRunner.query(
      `ALTER TYPE "public"."inventory_item_event_type" ADD VALUE IF NOT EXISTS 'sent_to_lab'`,
    );
    await queryRunner.query(`ALTER TABLE "sale_return_items" ADD "lab_sent_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "sale_return_items" ADD "lab_sent_by" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_sale_return_items_lab_sent_at" ON "sale_return_items" ("lab_sent_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "sale_return_items" SET "disposition" = 'quarantined' WHERE "disposition" = 'lab'`,
    );
    await queryRunner.query(
      `UPDATE "sale_return_items" SET "proposed_disposition" = 'quarantined' WHERE "proposed_disposition" = 'lab'`,
    );
    await queryRunner.query(
      `UPDATE "inventory_items" SET "status" = 'quarantined' WHERE "status" = 'at_lab'`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_sale_return_items_lab_sent_at"`);
    await queryRunner.query(`ALTER TABLE "sale_return_items" DROP COLUMN "lab_sent_by"`);
    await queryRunner.query(`ALTER TABLE "sale_return_items" DROP COLUMN "lab_sent_at"`);
  }
}
