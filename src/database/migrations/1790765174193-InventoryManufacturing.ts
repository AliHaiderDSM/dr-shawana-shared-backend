import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class InventoryManufacturing1790765174193 implements MigrationInterface {
  name = 'InventoryManufacturing1790765174193';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."stock_document_type" AS ENUM('stock_in', 'stock_out')`);
    await queryRunner.query(
      `CREATE TABLE "stock_attachments" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "document_type" "public"."stock_document_type" NOT NULL, "document_id" uuid NOT NULL, "file_path" text NOT NULL, "original_name" character varying(255) NOT NULL, "content_type" character varying(100) NOT NULL, "size_bytes" integer NOT NULL, CONSTRAINT "PK_f2bb6c8b1fd765f8c20cee6f21b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_20f57cf3d6c4f198dc608b5de7" ON "stock_attachments"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_25c3017ece88ea77b96f806d53" ON "stock_attachments"  ("document_type", "document_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_ins" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "supplier_id" uuid, "product_id" uuid NOT NULL, "date" date NOT NULL, "qty" numeric(12,3) NOT NULL, "batch" character varying(100), "note" text, CONSTRAINT "CHK_stock_ins_qty" CHECK ("qty" > 0), CONSTRAINT "PK_f2777e234a5b7eb8b20ef8c37f2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_5142aaa7a48002ddd1ec1ef546" ON "stock_ins"  ("branch_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_dabbabafa9caa4340c3c13f3ca" ON "stock_ins"  ("supplier_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_75d25b5bcd7d3cb3343557ba6c" ON "stock_ins"  ("product_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_6be5c2de57c31f1278c0232c73" ON "stock_ins"  ("date") `);
    await queryRunner.query(`CREATE INDEX "IDX_4e33fc42a237153d10120b0923" ON "stock_ins"  ("batch") `);
    await queryRunner.query(
      `CREATE TABLE "stock_outs" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "dispatcher_id" uuid, "product_id" uuid NOT NULL, "date" date NOT NULL, "qty" numeric(12,3) NOT NULL, "destination" character varying(150) NOT NULL, "note" text, CONSTRAINT "CHK_stock_outs_qty" CHECK ("qty" > 0), CONSTRAINT "PK_f14fe1f113a399381ec96f79880" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_82c4d5c0d59a4943231a120e00" ON "stock_outs"  ("branch_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_5a8e2849052664790217a2227c" ON "stock_outs"  ("dispatcher_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_c4e561d46d23b84aeebff12176" ON "stock_outs"  ("product_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_0be649569f6709a798c60d1fa2" ON "stock_outs"  ("date") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_e21712f2fee73d70c377b06967" ON "stock_outs"  ("destination") `,
    );
    await queryRunner.query(
      `CREATE TABLE "material_categories" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "name" character varying(150) NOT NULL, CONSTRAINT "PK_b4a74f17ff7d126f627e0f5879b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92810656574fb0d8582fc491ef" ON "material_categories"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "materials" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "name" character varying(200) NOT NULL, "category_id" uuid NOT NULL, "unit" character varying(30) NOT NULL DEFAULT 'g', "minimum" numeric(12,3) NOT NULL DEFAULT '0', "bare_minimum" numeric(12,3) NOT NULL DEFAULT '0', CONSTRAINT "PK_2fd1a93ecb222a28bef28663fa0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_bdd0961a7a99e178a65c15441a" ON "materials"  ("branch_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_a342f3b8a3e1af973e7fe5a9ee" ON "materials"  ("category_id") `);
    await queryRunner.query(
      `CREATE TYPE "public"."material_batch_stage" AS ENUM('pharmacy_lab', 'finished_product')`,
    );
    await queryRunner.query(
      `CREATE TABLE "material_batches" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "batch_no" character varying(100) NOT NULL, "stage" "public"."material_batch_stage" NOT NULL, "date" date NOT NULL, "note" text, "lab_batch_id" uuid, "product_id" uuid, "produced_qty" numeric(12,3), CONSTRAINT "CHK_material_batches_output" CHECK (("product_id" IS NULL) = ("produced_qty" IS NULL) AND ("produced_qty" IS NULL OR "produced_qty" > 0)), CONSTRAINT "CHK_material_batches_stage_links" CHECK (("stage" = 'pharmacy_lab' AND "lab_batch_id" IS NULL AND "product_id" IS NULL) OR ("stage" = 'finished_product' AND "lab_batch_id" IS NOT NULL)), CONSTRAINT "PK_8150669171dda8588639d3a4aa1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab7a09d2f58bbb6daa535fbb7e" ON "material_batches"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_76cdd39fb146763d8f8c2d6d7f" ON "material_batches"  ("batch_no") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f4ac278071cee0daea62c50e9" ON "material_batches"  ("stage") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_1305af46e72476bc312db95407" ON "material_batches"  ("date") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_8a8f57feab885e74fe5a024e24" ON "material_batches"  ("lab_batch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80b33fd2182715ca3b1278994f" ON "material_batches"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_material_batches_lab_batch_no" ON "material_batches"  ("branch_id", "batch_no") WHERE "stage" = 'pharmacy_lab' AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "material_batch_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "batch_id" uuid NOT NULL, "material_id" uuid NOT NULL, "qty" numeric(12,3) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_material_batch_items_qty" CHECK ("qty" > 0), CONSTRAINT "PK_5512b6fc8282b0fc6795ddbdcbd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_940a1caaa6ca58157eb03219a2" ON "material_batch_items"  ("batch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d46eeee1a28a291590900d1877" ON "material_batch_items"  ("material_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_material_batch_items_batch_material" ON "material_batch_items"  ("batch_id", "material_id") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."material_location" AS ENUM('store', 'lab')`);
    await queryRunner.query(
      `CREATE TYPE "public"."material_movement_type" AS ENUM('material_in', 'material_out_to_lab', 'used_in_production')`,
    );
    await queryRunner.query(
      `CREATE TABLE "material_movements" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "material_id" uuid NOT NULL, "location" "public"."material_location" NOT NULL, "type" "public"."material_movement_type" NOT NULL, "qty" numeric(12,3) NOT NULL, "reference_type" character varying(40) NOT NULL, "reference_id" uuid NOT NULL, "reversal_of_id" uuid, "date" date NOT NULL, "note" text, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_material_movements_qty_not_zero" CHECK ("qty" <> 0), CONSTRAINT "PK_0b04c6e74cd473e18c2ff5880b2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0d0609e1f89d227cbd0d25c4a5" ON "material_movements"  ("material_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_395a8ce9d76dcd60d785de60ad" ON "material_movements"  ("type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cbf5c7749de0268a3d6064864b" ON "material_movements"  ("reversal_of_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9436304bf0534e40f1cec7b0cd" ON "material_movements"  ("reference_type", "reference_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a4a73b9dc28d9ecfa2d9c3d156" ON "material_movements"  ("branch_id", "material_id", "location", "date") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."material_place" AS ENUM('falcon', 'pharmacy')`);
    await queryRunner.query(
      `CREATE TABLE "material_receipts" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "material_id" uuid NOT NULL, "date" date NOT NULL, "quantity" numeric(12,3) NOT NULL, "place" "public"."material_place" NOT NULL DEFAULT 'falcon', "note" text, CONSTRAINT "CHK_material_receipts_quantity" CHECK ("quantity" > 0), CONSTRAINT "PK_b25a6c3310db31531310bf34ed5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f15ea1eddd130812b7afce91c6" ON "material_receipts"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92703a3677b1aecd87be650aa8" ON "material_receipts"  ("material_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a41db516452a65d824b1f4e35d" ON "material_receipts"  ("date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "product_recipes" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "product_id" uuid NOT NULL, "date" date NOT NULL, "note" text, CONSTRAINT "PK_eefb5f327f5fd58db7304eea7db" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_20f99c5f663ed402e534fa5e27" ON "product_recipes"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7b65dbb27e7a31f561d1712cfe" ON "product_recipes"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "recipe_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "recipe_id" uuid NOT NULL, "material_id" uuid NOT NULL, "qty" numeric(12,3), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_recipe_items_qty" CHECK ("qty" IS NULL OR "qty" > 0), CONSTRAINT "PK_daec78e42198e9c42e1fed60eec" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2de4c7251ed3dd16f2f96ce45e" ON "recipe_items"  ("recipe_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9cfffd10ab0517775cb6099133" ON "recipe_items"  ("material_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_recipe_items_recipe_material" ON "recipe_items"  ("recipe_id", "material_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_attachments" ADD CONSTRAINT "FK_20f57cf3d6c4f198dc608b5de77" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_ins" ADD CONSTRAINT "FK_5142aaa7a48002ddd1ec1ef546e" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_ins" ADD CONSTRAINT "FK_dabbabafa9caa4340c3c13f3ca6" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_ins" ADD CONSTRAINT "FK_75d25b5bcd7d3cb3343557ba6ca" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_outs" ADD CONSTRAINT "FK_82c4d5c0d59a4943231a120e00d" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_outs" ADD CONSTRAINT "FK_5a8e2849052664790217a2227c3" FOREIGN KEY ("dispatcher_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_outs" ADD CONSTRAINT "FK_c4e561d46d23b84aeebff121769" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_categories" ADD CONSTRAINT "FK_92810656574fb0d8582fc491efb" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "materials" ADD CONSTRAINT "FK_bdd0961a7a99e178a65c15441ac" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "materials" ADD CONSTRAINT "FK_a342f3b8a3e1af973e7fe5a9ee8" FOREIGN KEY ("category_id") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_batches" ADD CONSTRAINT "FK_ab7a09d2f58bbb6daa535fbb7e9" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_batches" ADD CONSTRAINT "FK_8a8f57feab885e74fe5a024e243" FOREIGN KEY ("lab_batch_id") REFERENCES "material_batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_batches" ADD CONSTRAINT "FK_80b33fd2182715ca3b1278994f5" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_batch_items" ADD CONSTRAINT "FK_940a1caaa6ca58157eb03219a2b" FOREIGN KEY ("batch_id") REFERENCES "material_batches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_batch_items" ADD CONSTRAINT "FK_d46eeee1a28a291590900d1877c" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_movements" ADD CONSTRAINT "FK_dd3103f9217e6f84b976d8a2cc0" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_movements" ADD CONSTRAINT "FK_0d0609e1f89d227cbd0d25c4a57" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_movements" ADD CONSTRAINT "FK_cbf5c7749de0268a3d6064864b4" FOREIGN KEY ("reversal_of_id") REFERENCES "material_movements"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_receipts" ADD CONSTRAINT "FK_f15ea1eddd130812b7afce91c67" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_receipts" ADD CONSTRAINT "FK_92703a3677b1aecd87be650aa8e" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_recipes" ADD CONSTRAINT "FK_20f99c5f663ed402e534fa5e276" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_recipes" ADD CONSTRAINT "FK_7b65dbb27e7a31f561d1712cfee" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_items" ADD CONSTRAINT "FK_2de4c7251ed3dd16f2f96ce45ed" FOREIGN KEY ("recipe_id") REFERENCES "product_recipes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_items" ADD CONSTRAINT "FK_9cfffd10ab0517775cb6099133e" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_material_categories_branch_name" ON "material_categories" ("branch_id", lower("name")) WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "TRG_material_movements_append_only" BEFORE UPDATE OR DELETE ON "material_movements" FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation()`,
    );
    await queryRunner.query(
      `CREATE VIEW "product_stock_balances" WITH (security_invoker = true) AS SELECT p.branch_id, p.id AS product_id, p.name, p.batch_no, p.category_id, p.unit, p.low_stock_threshold, COALESCE(s.quantity, 0)::numeric(12,3) AS quantity, COALESCE(s.quantity, 0) <= p.low_stock_threshold AS is_low_stock FROM products p LEFT JOIN (SELECT product_id, SUM(qty) AS quantity FROM stock_movements GROUP BY product_id) s ON s.product_id = p.id WHERE p.deleted_at IS NULL`,
    );
    await queryRunner.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "product_stock_balances" FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "product_stock_balances" FROM authenticated; END IF; END $$`,
    );
    await queryRunner.query(`ALTER TABLE "stock_ins" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "stock_outs" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "stock_attachments" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "material_categories" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "materials" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "material_receipts" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "material_movements" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "material_batches" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "material_batch_items" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "product_recipes" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "recipe_items" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS "product_stock_balances"`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_material_movements_append_only" ON "material_movements"`,
    );
    await queryRunner.query(`ALTER TABLE "recipe_items" DROP CONSTRAINT "FK_9cfffd10ab0517775cb6099133e"`);
    await queryRunner.query(`ALTER TABLE "recipe_items" DROP CONSTRAINT "FK_2de4c7251ed3dd16f2f96ce45ed"`);
    await queryRunner.query(`ALTER TABLE "product_recipes" DROP CONSTRAINT "FK_7b65dbb27e7a31f561d1712cfee"`);
    await queryRunner.query(`ALTER TABLE "product_recipes" DROP CONSTRAINT "FK_20f99c5f663ed402e534fa5e276"`);
    await queryRunner.query(
      `ALTER TABLE "material_receipts" DROP CONSTRAINT "FK_92703a3677b1aecd87be650aa8e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_receipts" DROP CONSTRAINT "FK_f15ea1eddd130812b7afce91c67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_movements" DROP CONSTRAINT "FK_cbf5c7749de0268a3d6064864b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_movements" DROP CONSTRAINT "FK_0d0609e1f89d227cbd0d25c4a57"`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_movements" DROP CONSTRAINT "FK_dd3103f9217e6f84b976d8a2cc0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_batch_items" DROP CONSTRAINT "FK_d46eeee1a28a291590900d1877c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_batch_items" DROP CONSTRAINT "FK_940a1caaa6ca58157eb03219a2b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_batches" DROP CONSTRAINT "FK_80b33fd2182715ca3b1278994f5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_batches" DROP CONSTRAINT "FK_8a8f57feab885e74fe5a024e243"`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_batches" DROP CONSTRAINT "FK_ab7a09d2f58bbb6daa535fbb7e9"`,
    );
    await queryRunner.query(`ALTER TABLE "materials" DROP CONSTRAINT "FK_a342f3b8a3e1af973e7fe5a9ee8"`);
    await queryRunner.query(`ALTER TABLE "materials" DROP CONSTRAINT "FK_bdd0961a7a99e178a65c15441ac"`);
    await queryRunner.query(
      `ALTER TABLE "material_categories" DROP CONSTRAINT "FK_92810656574fb0d8582fc491efb"`,
    );
    await queryRunner.query(`ALTER TABLE "stock_outs" DROP CONSTRAINT "FK_c4e561d46d23b84aeebff121769"`);
    await queryRunner.query(`ALTER TABLE "stock_outs" DROP CONSTRAINT "FK_5a8e2849052664790217a2227c3"`);
    await queryRunner.query(`ALTER TABLE "stock_outs" DROP CONSTRAINT "FK_82c4d5c0d59a4943231a120e00d"`);
    await queryRunner.query(`ALTER TABLE "stock_ins" DROP CONSTRAINT "FK_75d25b5bcd7d3cb3343557ba6ca"`);
    await queryRunner.query(`ALTER TABLE "stock_ins" DROP CONSTRAINT "FK_dabbabafa9caa4340c3c13f3ca6"`);
    await queryRunner.query(`ALTER TABLE "stock_ins" DROP CONSTRAINT "FK_5142aaa7a48002ddd1ec1ef546e"`);
    await queryRunner.query(
      `ALTER TABLE "stock_attachments" DROP CONSTRAINT "FK_20f57cf3d6c4f198dc608b5de77"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_recipe_items_recipe_material"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9cfffd10ab0517775cb6099133"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2de4c7251ed3dd16f2f96ce45e"`);
    await queryRunner.query(`DROP TABLE "recipe_items"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_7b65dbb27e7a31f561d1712cfe"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_20f99c5f663ed402e534fa5e27"`);
    await queryRunner.query(`DROP TABLE "product_recipes"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a41db516452a65d824b1f4e35d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_92703a3677b1aecd87be650aa8"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f15ea1eddd130812b7afce91c6"`);
    await queryRunner.query(`DROP TABLE "material_receipts"`);
    await queryRunner.query(`DROP TYPE "public"."material_place"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a4a73b9dc28d9ecfa2d9c3d156"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9436304bf0534e40f1cec7b0cd"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cbf5c7749de0268a3d6064864b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_395a8ce9d76dcd60d785de60ad"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0d0609e1f89d227cbd0d25c4a5"`);
    await queryRunner.query(`DROP TABLE "material_movements"`);
    await queryRunner.query(`DROP TYPE "public"."material_movement_type"`);
    await queryRunner.query(`DROP TYPE "public"."material_location"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_material_batch_items_batch_material"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d46eeee1a28a291590900d1877"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_940a1caaa6ca58157eb03219a2"`);
    await queryRunner.query(`DROP TABLE "material_batch_items"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_material_batches_lab_batch_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_80b33fd2182715ca3b1278994f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8a8f57feab885e74fe5a024e24"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1305af46e72476bc312db95407"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8f4ac278071cee0daea62c50e9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_76cdd39fb146763d8f8c2d6d7f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ab7a09d2f58bbb6daa535fbb7e"`);
    await queryRunner.query(`DROP TABLE "material_batches"`);
    await queryRunner.query(`DROP TYPE "public"."material_batch_stage"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a342f3b8a3e1af973e7fe5a9ee"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bdd0961a7a99e178a65c15441a"`);
    await queryRunner.query(`DROP TABLE "materials"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_92810656574fb0d8582fc491ef"`);
    await queryRunner.query(`DROP TABLE "material_categories"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e21712f2fee73d70c377b06967"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0be649569f6709a798c60d1fa2"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c4e561d46d23b84aeebff12176"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5a8e2849052664790217a2227c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_82c4d5c0d59a4943231a120e00"`);
    await queryRunner.query(`DROP TABLE "stock_outs"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4e33fc42a237153d10120b0923"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_6be5c2de57c31f1278c0232c73"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_75d25b5bcd7d3cb3343557ba6c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dabbabafa9caa4340c3c13f3ca"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5142aaa7a48002ddd1ec1ef546"`);
    await queryRunner.query(`DROP TABLE "stock_ins"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_25c3017ece88ea77b96f806d53"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_20f57cf3d6c4f198dc608b5de7"`);
    await queryRunner.query(`DROP TABLE "stock_attachments"`);
    await queryRunner.query(`DROP TYPE "public"."stock_document_type"`);
  }
}
