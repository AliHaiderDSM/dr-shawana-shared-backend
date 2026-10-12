import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DispatchDepartment1791600000000 implements MigrationInterface {
  name = 'DispatchDepartment1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."branch_kind" ADD VALUE IF NOT EXISTS 'dispatch'`);
    await queryRunner.query(`ALTER TYPE "public"."staff_role" ADD VALUE IF NOT EXISTS 'dispatcher'`);
    await queryRunner.query(`ALTER TABLE "sales" ADD "fulfillment_branch_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "sales" ADD CONSTRAINT "FK_sales_fulfillment_branch" FOREIGN KEY ("fulfillment_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sales_fulfillment_branch" ON "sales" ("fulfillment_branch_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_sales_fulfillment_branch"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP CONSTRAINT "FK_sales_fulfillment_branch"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN "fulfillment_branch_id"`);
  }
}
