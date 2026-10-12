import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WriteOffApproval1792000000000 implements MigrationInterface {
  name = 'WriteOffApproval1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."write_off_status" AS ENUM('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_write_offs" ADD "status" "public"."write_off_status" NOT NULL DEFAULT 'approved'`,
    );
    await queryRunner.query(`ALTER TABLE "stock_write_offs" ALTER COLUMN "status" SET DEFAULT 'pending'`);
    await queryRunner.query(`ALTER TABLE "stock_write_offs" ADD "serials" text[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "stock_write_offs" ADD "decided_by" uuid`);
    await queryRunner.query(`ALTER TABLE "stock_write_offs" ADD "decided_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "stock_write_offs" ADD "decision_note" character varying(500)`);
    await queryRunner.query(`CREATE INDEX "IDX_stock_write_offs_status" ON "stock_write_offs" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_write_offs_status"`);
    for (const column of ['decision_note', 'decided_at', 'decided_by', 'serials', 'status']) {
      await queryRunner.query(`ALTER TABLE "stock_write_offs" DROP COLUMN "${column}"`);
    }
    await queryRunner.query(`DROP TYPE "public"."write_off_status"`);
  }
}
