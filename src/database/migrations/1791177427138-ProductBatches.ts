import { type MigrationInterface, type QueryRunner } from 'typeorm';

const BALANCES_VIEW =
  'CREATE OR REPLACE VIEW "product_stock_balances" WITH (security_invoker = true) AS SELECT p.branch_id, p.id AS product_id, p.name, p.batch_no, p.category_id, p.unit, p.low_stock_threshold, COALESCE(s.quantity, 0)::numeric(12,3) AS quantity, COALESCE(s.quantity, 0) <= p.low_stock_threshold AS is_low_stock, COALESCE(s.expired_quantity, 0)::numeric(12,3) AS expired_quantity FROM products p LEFT JOIN (SELECT m.product_id, SUM(m.qty) AS quantity, SUM(m.qty) FILTER (WHERE b.expiry_date < CURRENT_DATE) AS expired_quantity FROM stock_movements m LEFT JOIN product_batches b ON b.id = m.batch_id GROUP BY m.product_id) s ON s.product_id = p.id WHERE p.deleted_at IS NULL';

const PREVIOUS_BALANCES_VIEW =
  'CREATE VIEW "product_stock_balances" WITH (security_invoker = true) AS SELECT p.branch_id, p.id AS product_id, p.name, p.batch_no, p.category_id, p.unit, p.low_stock_threshold, COALESCE(s.quantity, 0)::numeric(12,3) AS quantity, COALESCE(s.quantity, 0) <= p.low_stock_threshold AS is_low_stock FROM products p LEFT JOIN (SELECT product_id, SUM(qty) AS quantity FROM stock_movements GROUP BY product_id) s ON s.product_id = p.id WHERE p.deleted_at IS NULL';

export class ProductBatches1791177427138 implements MigrationInterface {
  name = 'ProductBatches1791177427138';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "product_batches" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "product_id" uuid NOT NULL, "batch_no" character varying(100) NOT NULL, "manufacturing_date" date, "expiry_date" date, "supplier_id" uuid, "unit_cost" numeric(12,2), CONSTRAINT "CHK_product_batches_dates" CHECK ("expiry_date" IS NULL OR "manufacturing_date" IS NULL OR "expiry_date" >= "manufacturing_date"), CONSTRAINT "PK_843fa9e28be96c903f8c71292fc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b9e08a98a3e2f0245ce3b6cf1d" ON "product_batches"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_82998c582d28f74cca4eff80a7" ON "product_batches"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_48f05c0add93a7b2ae2759cbb6" ON "product_batches"  ("expiry_date") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c877a35c876b116df937f1754f" ON "product_batches"  ("supplier_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_product_batches_product_batch_no" ON "product_batches"  ("product_id", "batch_no") `,
    );
    await queryRunner.query(`ALTER TABLE "stock_ins" ADD "batch_id" uuid`);
    await queryRunner.query(`ALTER TABLE "stock_ins" ADD "manufacturing_date" date`);
    await queryRunner.query(`ALTER TABLE "stock_ins" ADD "expiry_date" date`);
    await queryRunner.query(`ALTER TABLE "stock_ins" ADD "unit_cost" numeric(12,2)`);
    await queryRunner.query(`ALTER TABLE "stock_movements" ADD "batch_id" uuid`);
    await queryRunner.query(`ALTER TYPE "public"."sale_return_disposition" ADD VALUE 'quarantined'`);
    await queryRunner.query(`ALTER TYPE "public"."sale_return_disposition" ADD VALUE 'expired'`);
    await queryRunner.query(`CREATE INDEX "IDX_cd697bbcf7505056cafe0ab8c8" ON "stock_ins"  ("batch_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_64c67f927d872a7e19700ab663" ON "stock_movements"  ("batch_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "product_batches" ADD CONSTRAINT "FK_b9e08a98a3e2f0245ce3b6cf1d2" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_batches" ADD CONSTRAINT "FK_82998c582d28f74cca4eff80a73" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_batches" ADD CONSTRAINT "FK_c877a35c876b116df937f1754f1" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_ins" ADD CONSTRAINT "FK_cd697bbcf7505056cafe0ab8c8a" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" ADD CONSTRAINT "FK_64c67f927d872a7e19700ab6637" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "product_batches" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(BALANCES_VIEW);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW "product_stock_balances"`);
    await queryRunner.query(PREVIOUS_BALANCES_VIEW);
    await queryRunner.query(`ALTER TABLE "stock_movements" DROP CONSTRAINT "FK_64c67f927d872a7e19700ab6637"`);
    await queryRunner.query(`ALTER TABLE "stock_ins" DROP CONSTRAINT "FK_cd697bbcf7505056cafe0ab8c8a"`);
    await queryRunner.query(`ALTER TABLE "product_batches" DROP CONSTRAINT "FK_c877a35c876b116df937f1754f1"`);
    await queryRunner.query(`ALTER TABLE "product_batches" DROP CONSTRAINT "FK_82998c582d28f74cca4eff80a73"`);
    await queryRunner.query(`ALTER TABLE "product_batches" DROP CONSTRAINT "FK_b9e08a98a3e2f0245ce3b6cf1d2"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_64c67f927d872a7e19700ab663"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cd697bbcf7505056cafe0ab8c8"`);
    await queryRunner.query(
      `CREATE TYPE "public"."sale_return_disposition_old" AS ENUM('pending', 'restocked', 'damaged', 'supplier')`,
    );
    await queryRunner.query(
      `UPDATE "sale_return_items" SET "disposition" = 'damaged' WHERE "disposition" IN ('quarantined', 'expired')`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_return_items" DROP CONSTRAINT "CHK_sale_return_items_resolved"`,
    );
    await queryRunner.query(`ALTER TABLE "sale_return_items" ALTER COLUMN "disposition" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "sale_return_items" ALTER COLUMN "disposition" TYPE "public"."sale_return_disposition_old" USING "disposition"::"text"::"public"."sale_return_disposition_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."sale_return_disposition"`);
    await queryRunner.query(
      `ALTER TYPE "public"."sale_return_disposition_old" RENAME TO "sale_return_disposition"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_return_items" ALTER COLUMN "disposition" SET DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_return_items" ADD CONSTRAINT "CHK_sale_return_items_resolved" CHECK (("disposition" = 'pending') = ("resolved_at" IS NULL))`,
    );
    await queryRunner.query(`ALTER TABLE "stock_movements" DROP COLUMN "batch_id"`);
    await queryRunner.query(`ALTER TABLE "stock_ins" DROP COLUMN "unit_cost"`);
    await queryRunner.query(`ALTER TABLE "stock_ins" DROP COLUMN "expiry_date"`);
    await queryRunner.query(`ALTER TABLE "stock_ins" DROP COLUMN "manufacturing_date"`);
    await queryRunner.query(`ALTER TABLE "stock_ins" DROP COLUMN "batch_id"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_product_batches_product_batch_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c877a35c876b116df937f1754f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_48f05c0add93a7b2ae2759cbb6"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_82998c582d28f74cca4eff80a7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b9e08a98a3e2f0245ce3b6cf1d"`);
    await queryRunner.query(`DROP TABLE "product_batches"`);
  }
}
