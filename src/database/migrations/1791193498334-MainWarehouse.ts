import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MainWarehouse1791193498334 implements MigrationInterface {
  name = 'MainWarehouse1791193498334';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_branches_head_office"`);
    await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "is_head_office"`);
    await queryRunner.query(`CREATE TYPE "public"."branch_kind" AS ENUM('branch', 'warehouse')`);
    await queryRunner.query(
      `ALTER TABLE "branches" ADD "kind" "public"."branch_kind" NOT NULL DEFAULT 'branch'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_branches_single_warehouse" ON "branches"  ("kind") WHERE "kind" = 'warehouse' AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "products" ADD "origin_product_id" uuid`);
    await queryRunner.query(`ALTER TABLE "stock_ins" ADD "transfer_out_id" uuid`);
    await queryRunner.query(`ALTER TABLE "stock_outs" ADD "to_branch_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_866c980e93a59746d848fafc22" ON "products"  ("origin_product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3366b0a112cf61fb13ad171bb7" ON "stock_ins"  ("transfer_out_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34388273c47662f0de74f7fd39" ON "stock_outs"  ("to_branch_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_outs" ADD CONSTRAINT "FK_34388273c47662f0de74f7fd39e" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `UPDATE "branches" SET "kind" = 'warehouse' WHERE "code" = 'MAINWH' AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `INSERT INTO "branches" ("name", "code", "city", "kind", "status")
       SELECT 'Super Admin Stock', 'MAINWH', COALESCE((SELECT city FROM branches WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1), 'Lahore'), 'warehouse', 'active'
        WHERE NOT EXISTS (SELECT 1 FROM branches WHERE (kind = 'warehouse' OR code = 'MAINWH') AND deleted_at IS NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stock_outs" DROP CONSTRAINT "FK_34388273c47662f0de74f7fd39e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_34388273c47662f0de74f7fd39"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3366b0a112cf61fb13ad171bb7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_866c980e93a59746d848fafc22"`);
    await queryRunner.query(`ALTER TABLE "stock_outs" DROP COLUMN "to_branch_id"`);
    await queryRunner.query(`ALTER TABLE "stock_ins" DROP COLUMN "transfer_out_id"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "origin_product_id"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_branches_single_warehouse"`);
    await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "kind"`);
    await queryRunner.query(`DROP TYPE "public"."branch_kind"`);
    await queryRunner.query(`ALTER TABLE "branches" ADD "is_head_office" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_branches_head_office" ON "branches" ("is_head_office") WHERE "is_head_office" = true AND "deleted_at" IS NULL`,
    );
  }
}
