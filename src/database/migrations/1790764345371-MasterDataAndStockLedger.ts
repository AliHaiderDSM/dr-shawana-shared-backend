import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class MasterDataAndStockLedger1790764345371 implements MigrationInterface {
  name = 'MasterDataAndStockLedger1790764345371';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "banks" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "name" character varying(150) NOT NULL, CONSTRAINT "PK_3975b5f684ec241e3901db62d77" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_67de84bfdfba208856c83bd291" ON "banks"  ("branch_id") `);
    await queryRunner.query(`CREATE TYPE "public"."account_type" AS ENUM('cash', 'bank')`);
    await queryRunner.query(
      `CREATE TABLE "account_sheets" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "account_name" character varying(150) NOT NULL, "account_code" character varying(100) NOT NULL, "bank_id" uuid, "type" "public"."account_type" NOT NULL, "opening_balance" numeric(12,2) NOT NULL DEFAULT '0', "date" date NOT NULL, CONSTRAINT "CHK_account_sheets_bank_required" CHECK (("type" = 'cash') OR ("bank_id" IS NOT NULL)), CONSTRAINT "PK_cb4d76a82862163763036c4a7a0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a474819dcdec1d70dbee5fa91c" ON "account_sheets"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_431465e08240728d027f64612f" ON "account_sheets"  ("bank_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ecaf684a0384b653fe5a252b31" ON "account_sheets"  ("type") `);
    await queryRunner.query(
      `CREATE TABLE "categories" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "name" character varying(150) NOT NULL, "image_path" text, CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_0011937b9b4cd88d39accdd6ed" ON "categories"  ("branch_id") `);
    await queryRunner.query(`CREATE TYPE "public"."product_status" AS ENUM('active', 'inactive')`);
    await queryRunner.query(
      `CREATE TABLE "products" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "name" character varying(200) NOT NULL, "category_id" uuid NOT NULL, "sku" character varying(60), "batch_no" character varying(100), "size_grams" numeric(12,3), "image_path" text, "unit" character varying(30) NOT NULL DEFAULT 'pcs', "low_stock_threshold" numeric(12,3) NOT NULL DEFAULT '10', "sale_price" numeric(12,2) NOT NULL DEFAULT '0', "status" "public"."product_status" NOT NULL DEFAULT 'active', CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_de720484cb95d8752861e50792" ON "products"  ("branch_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_9a5f6868c96e0069e699f33e12" ON "products"  ("category_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_1846199852a695713b1f8f5e9a" ON "products"  ("status") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_products_branch_sku" ON "products"  ("branch_id", "sku") WHERE "sku" IS NOT NULL AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "bundles" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "name" character varying(150) NOT NULL, "image_path" text, "total_price" numeric(12,2) NOT NULL DEFAULT '0', CONSTRAINT "PK_a9118b2e4597aede4d5d4c43433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_cdc5b2da538ae9a78ef5a8478c" ON "bundles"  ("branch_id") `);
    await queryRunner.query(
      `CREATE TABLE "bundle_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "bundle_id" uuid NOT NULL, "product_id" uuid NOT NULL, "qty" numeric(12,3) NOT NULL DEFAULT '1', "price" numeric(12,2) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_bundle_items_qty" CHECK ("qty" > 0), CONSTRAINT "PK_a455144e23de2139ebeb3461e83" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_204a2f0fd03ca0efbf9db586b7" ON "bundle_items"  ("bundle_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_95b9eb75eaeeaa5a491a5d9a15" ON "bundle_items"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_bundle_items_bundle_product" ON "bundle_items"  ("bundle_id", "product_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."stock_movement_type" AS ENUM('purchase_in', 'stock_in', 'stock_out', 'sale', 'sale_return', 'sale_edit_adjust', 'manufacturing_in', 'adjustment')`,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_movements" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "product_id" uuid NOT NULL, "type" "public"."stock_movement_type" NOT NULL, "qty" numeric(12,3) NOT NULL, "unit_cost" numeric(12,2), "reference_type" character varying(40) NOT NULL, "reference_id" uuid NOT NULL, "reversal_of_id" uuid, "date" date NOT NULL, "note" text, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_stock_movements_qty_not_zero" CHECK ("qty" <> 0), CONSTRAINT "PK_57a26b190618550d8e65fb860e7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2c1bb05b80ddcc562cd28d826c" ON "stock_movements"  ("product_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_cca7634960c09010c40b6490a1" ON "stock_movements"  ("type") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_4ad7a5803822082dd516e9e9ef" ON "stock_movements"  ("reversal_of_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bed9ede4e01a5a8072732a9415" ON "stock_movements"  ("reference_type", "reference_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4d64c2121bb84aac4072e2201c" ON "stock_movements"  ("branch_id", "product_id", "date") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."supplier_type" AS ENUM('supplier', 'dispatcher')`);
    await queryRunner.query(
      `CREATE TABLE "suppliers" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "name" character varying(150) NOT NULL, "phone" character varying(30) NOT NULL, "address" text, "type" "public"."supplier_type" NOT NULL, CONSTRAINT "PK_b70ac51766a9e3144f778cfe81e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ce35fd787e09aecdb311aaff66" ON "suppliers"  ("branch_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_73ea4840fc9114a341502b5054" ON "suppliers"  ("type") `);
    await queryRunner.query(
      `CREATE TABLE "product_purchase_entries" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "product_id" uuid NOT NULL, "supplier_id" uuid, "date" date NOT NULL, "quantity" numeric(12,3) NOT NULL, "unit_price" numeric(12,2) NOT NULL, "note" text, CONSTRAINT "CHK_product_purchase_entries_quantity" CHECK ("quantity" > 0), CONSTRAINT "PK_ff49e3277d0df8a67de0aac5079" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0fcad50022a582966d37a5b2e" ON "product_purchase_entries"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b3f6ffa692c8534b6e21a5fee" ON "product_purchase_entries"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c49b83289a23e538ce6405a8a7" ON "product_purchase_entries"  ("supplier_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_38fa128101025d5e55d7107436" ON "product_purchase_entries"  ("date") `,
    );
    await queryRunner.query(
      `ALTER TABLE "banks" ADD CONSTRAINT "FK_67de84bfdfba208856c83bd2914" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_sheets" ADD CONSTRAINT "FK_a474819dcdec1d70dbee5fa91c5" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_sheets" ADD CONSTRAINT "FK_431465e08240728d027f64612fa" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD CONSTRAINT "FK_0011937b9b4cd88d39accdd6edf" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_de720484cb95d8752861e507921" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_9a5f6868c96e0069e699f33e124" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bundles" ADD CONSTRAINT "FK_cdc5b2da538ae9a78ef5a8478c8" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bundle_items" ADD CONSTRAINT "FK_204a2f0fd03ca0efbf9db586b7f" FOREIGN KEY ("bundle_id") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bundle_items" ADD CONSTRAINT "FK_95b9eb75eaeeaa5a491a5d9a15f" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" ADD CONSTRAINT "FK_b85448ca9ec4bb8fc5eefb0c29d" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" ADD CONSTRAINT "FK_2c1bb05b80ddcc562cd28d826c6" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" ADD CONSTRAINT "FK_4ad7a5803822082dd516e9e9efd" FOREIGN KEY ("reversal_of_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "suppliers" ADD CONSTRAINT "FK_ce35fd787e09aecdb311aaff66c" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchase_entries" ADD CONSTRAINT "FK_f0fcad50022a582966d37a5b2ec" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchase_entries" ADD CONSTRAINT "FK_3b3f6ffa692c8534b6e21a5fee3" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchase_entries" ADD CONSTRAINT "FK_c49b83289a23e538ce6405a8a78" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_categories_branch_name" ON "categories" ("branch_id", lower("name")) WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_banks_branch_name" ON "banks" ("branch_id", lower("name")) WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION '% is append-only: add a reversing row instead', TG_TABLE_NAME USING ERRCODE = 'P0001'; END; $fn$`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "TRG_stock_movements_append_only" BEFORE UPDATE OR DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation()`,
    );
    await queryRunner.query(`ALTER TABLE "banks" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "account_sheets" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "products" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "bundles" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "bundle_items" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "product_purchase_entries" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_stock_movements_append_only" ON "stock_movements"`);
    await queryRunner.query(
      `ALTER TABLE "product_purchase_entries" DROP CONSTRAINT "FK_c49b83289a23e538ce6405a8a78"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchase_entries" DROP CONSTRAINT "FK_3b3f6ffa692c8534b6e21a5fee3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchase_entries" DROP CONSTRAINT "FK_f0fcad50022a582966d37a5b2ec"`,
    );
    await queryRunner.query(`ALTER TABLE "suppliers" DROP CONSTRAINT "FK_ce35fd787e09aecdb311aaff66c"`);
    await queryRunner.query(`ALTER TABLE "stock_movements" DROP CONSTRAINT "FK_4ad7a5803822082dd516e9e9efd"`);
    await queryRunner.query(`ALTER TABLE "stock_movements" DROP CONSTRAINT "FK_2c1bb05b80ddcc562cd28d826c6"`);
    await queryRunner.query(`ALTER TABLE "stock_movements" DROP CONSTRAINT "FK_b85448ca9ec4bb8fc5eefb0c29d"`);
    await queryRunner.query(`ALTER TABLE "bundle_items" DROP CONSTRAINT "FK_95b9eb75eaeeaa5a491a5d9a15f"`);
    await queryRunner.query(`ALTER TABLE "bundle_items" DROP CONSTRAINT "FK_204a2f0fd03ca0efbf9db586b7f"`);
    await queryRunner.query(`ALTER TABLE "bundles" DROP CONSTRAINT "FK_cdc5b2da538ae9a78ef5a8478c8"`);
    await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_9a5f6868c96e0069e699f33e124"`);
    await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_de720484cb95d8752861e507921"`);
    await queryRunner.query(`ALTER TABLE "categories" DROP CONSTRAINT "FK_0011937b9b4cd88d39accdd6edf"`);
    await queryRunner.query(`ALTER TABLE "account_sheets" DROP CONSTRAINT "FK_431465e08240728d027f64612fa"`);
    await queryRunner.query(`ALTER TABLE "account_sheets" DROP CONSTRAINT "FK_a474819dcdec1d70dbee5fa91c5"`);
    await queryRunner.query(`ALTER TABLE "banks" DROP CONSTRAINT "FK_67de84bfdfba208856c83bd2914"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_38fa128101025d5e55d7107436"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c49b83289a23e538ce6405a8a7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3b3f6ffa692c8534b6e21a5fee"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f0fcad50022a582966d37a5b2e"`);
    await queryRunner.query(`DROP TABLE "product_purchase_entries"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_73ea4840fc9114a341502b5054"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ce35fd787e09aecdb311aaff66"`);
    await queryRunner.query(`DROP TABLE "suppliers"`);
    await queryRunner.query(`DROP TYPE "public"."supplier_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4d64c2121bb84aac4072e2201c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bed9ede4e01a5a8072732a9415"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4ad7a5803822082dd516e9e9ef"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cca7634960c09010c40b6490a1"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2c1bb05b80ddcc562cd28d826c"`);
    await queryRunner.query(`DROP TABLE "stock_movements"`);
    await queryRunner.query(`DROP TYPE "public"."stock_movement_type"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_bundle_items_bundle_product"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_95b9eb75eaeeaa5a491a5d9a15"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_204a2f0fd03ca0efbf9db586b7"`);
    await queryRunner.query(`DROP TABLE "bundle_items"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cdc5b2da538ae9a78ef5a8478c"`);
    await queryRunner.query(`DROP TABLE "bundles"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_products_branch_sku"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1846199852a695713b1f8f5e9a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9a5f6868c96e0069e699f33e12"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_de720484cb95d8752861e50792"`);
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(`DROP TYPE "public"."product_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0011937b9b4cd88d39accdd6ed"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ecaf684a0384b653fe5a252b31"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_431465e08240728d027f64612f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a474819dcdec1d70dbee5fa91c"`);
    await queryRunner.query(`DROP TABLE "account_sheets"`);
    await queryRunner.query(`DROP TYPE "public"."account_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_67de84bfdfba208856c83bd291"`);
    await queryRunner.query(`DROP TABLE "banks"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS forbid_ledger_mutation()`);
  }
}
