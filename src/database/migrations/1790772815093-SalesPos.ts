import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class SalesPos1790772815093 implements MigrationInterface {
  name = 'SalesPos1790772815093';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sale_payments" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "sale_id" uuid NOT NULL, "method" "public"."payment_method" NOT NULL, "amount" numeric(12,2) NOT NULL, "date" date NOT NULL, "account_sheet_id" uuid NOT NULL, "sender_bank" character varying(150), "sender_account_title" character varying(150), "sender_account_no" character varying(100), "proof_file_path" text, "proof_original_name" character varying(255), "proof_content_type" character varying(100), CONSTRAINT "CHK_sale_payments_cash_fields" CHECK ("method" = 'online' OR ("sender_bank" IS NULL AND "sender_account_title" IS NULL AND "sender_account_no" IS NULL AND "proof_file_path" IS NULL)), CONSTRAINT "CHK_sale_payments_amount" CHECK ("amount" > 0), CONSTRAINT "PK_1117d02608a00d131b95f60a58e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_74dcee8adad12b108a49560119" ON "sale_payments"  ("branch_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_0e4445597642c2456ebdd7e23b" ON "sale_payments"  ("sale_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_71312a2645adc8f1b8fc343107" ON "sale_payments"  ("method") `);
    await queryRunner.query(`CREATE INDEX "IDX_cae48942758b3f35dcaefb3d57" ON "sale_payments"  ("date") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_e0c7eeb85d3963aa00abac66cf" ON "sale_payments"  ("account_sheet_id") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."sale_type" AS ENUM('office', 'online')`);
    await queryRunner.query(
      `CREATE TYPE "public"."sale_payment_status" AS ENUM('unpaid', 'partial', 'paid')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."sale_delivery_status" AS ENUM('pending', 'delivered', 'returned')`,
    );
    await queryRunner.query(
      `CREATE TABLE "sales" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "invoice_seq" integer NOT NULL, "invoice_no" character varying(30) NOT NULL, "patient_id" uuid NOT NULL, "patient_city" character varying(100), "sale_type" "public"."sale_type" NOT NULL, "city" character varying(100) NOT NULL, "date" date NOT NULL, "total_qty" numeric(12,3) NOT NULL DEFAULT '0', "subtotal" numeric(12,2) NOT NULL, "discount_percent" numeric(5,2) NOT NULL DEFAULT '0', "discount_amount" numeric(12,2) NOT NULL DEFAULT '0', "total" numeric(12,2) NOT NULL, "received" numeric(12,2) NOT NULL DEFAULT '0', "remaining" numeric(12,2) NOT NULL DEFAULT '0', "payment_status" "public"."sale_payment_status" NOT NULL DEFAULT 'unpaid', "delivery_status" "public"."sale_delivery_status", "note" text, CONSTRAINT "CHK_sales_discount" CHECK ("discount_percent" >= 0 AND "discount_percent" <= 100), CONSTRAINT "CHK_sales_delivery" CHECK (("sale_type" = 'online') = ("delivery_status" IS NOT NULL)), CONSTRAINT "PK_4f0bc990ae81dba46da680895ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_236f3154522de80a98f87c66b8" ON "sales"  ("branch_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_cc9d1e3f9b54f986c656f17189" ON "sales"  ("invoice_no") `);
    await queryRunner.query(`CREATE INDEX "IDX_742b48cee8319453602e7d6fd4" ON "sales"  ("patient_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_30d3befa517de40391a426f075" ON "sales"  ("sale_type") `);
    await queryRunner.query(`CREATE INDEX "IDX_405d9e16a4e7a1ab871d3fa082" ON "sales"  ("city") `);
    await queryRunner.query(`CREATE INDEX "IDX_8f2285a5185ef50ee3976d1cfd" ON "sales"  ("payment_status") `);
    await queryRunner.query(`CREATE INDEX "IDX_8f357792a11a65c73d4af50501" ON "sales"  ("delivery_status") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_8b16a3ffdcb10526c7d06ce68b" ON "sales"  ("branch_id", "date") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sales_branch_invoice" ON "sales"  ("branch_id", "invoice_seq") `,
    );
    await queryRunner.query(
      `CREATE TABLE "sale_items" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "sale_id" uuid NOT NULL, "product_id" uuid NOT NULL, "bundle_id" uuid, "qty" numeric(12,3) NOT NULL, "unit_price" numeric(12,2) NOT NULL, "line_total" numeric(12,2) NOT NULL, CONSTRAINT "CHK_sale_items_qty" CHECK ("qty" > 0), CONSTRAINT "PK_5a7dc5b4562a9e590528b3e08ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_7aca5f7b5c2c3278b8989e32d0" ON "sale_items"  ("branch_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_c210a330b80232c29c2ad68462" ON "sale_items"  ("sale_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_4ecae62db3f9e9cc9a368d57ad" ON "sale_items"  ("product_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_b9d23fe475d31b7e393ca20a41" ON "sale_items"  ("bundle_id") `);
    await queryRunner.query(
      `CREATE TABLE "document_sequences" ("branch_id" uuid NOT NULL, "key" character varying(30) NOT NULL, "last_value" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_24d36b27a643100064fc9d00fae" PRIMARY KEY ("branch_id", "key"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_payments" ADD CONSTRAINT "FK_74dcee8adad12b108a49560119a" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_payments" ADD CONSTRAINT "FK_0e4445597642c2456ebdd7e23b1" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_payments" ADD CONSTRAINT "FK_e0c7eeb85d3963aa00abac66cf8" FOREIGN KEY ("account_sheet_id") REFERENCES "account_sheets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales" ADD CONSTRAINT "FK_236f3154522de80a98f87c66b84" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales" ADD CONSTRAINT "FK_742b48cee8319453602e7d6fd4b" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_items" ADD CONSTRAINT "FK_7aca5f7b5c2c3278b8989e32d09" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_items" ADD CONSTRAINT "FK_c210a330b80232c29c2ad68462a" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_items" ADD CONSTRAINT "FK_4ecae62db3f9e9cc9a368d57adb" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_items" ADD CONSTRAINT "FK_b9d23fe475d31b7e393ca20a417" FOREIGN KEY ("bundle_id") REFERENCES "bundles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_sequences" ADD CONSTRAINT "FK_362a4a74c53e756e64ea13f0ad2" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "sale_items" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "sale_payments" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "document_sequences" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "document_sequences" DROP CONSTRAINT "FK_362a4a74c53e756e64ea13f0ad2"`,
    );
    await queryRunner.query(`ALTER TABLE "sale_items" DROP CONSTRAINT "FK_b9d23fe475d31b7e393ca20a417"`);
    await queryRunner.query(`ALTER TABLE "sale_items" DROP CONSTRAINT "FK_4ecae62db3f9e9cc9a368d57adb"`);
    await queryRunner.query(`ALTER TABLE "sale_items" DROP CONSTRAINT "FK_c210a330b80232c29c2ad68462a"`);
    await queryRunner.query(`ALTER TABLE "sale_items" DROP CONSTRAINT "FK_7aca5f7b5c2c3278b8989e32d09"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP CONSTRAINT "FK_742b48cee8319453602e7d6fd4b"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP CONSTRAINT "FK_236f3154522de80a98f87c66b84"`);
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP CONSTRAINT "FK_e0c7eeb85d3963aa00abac66cf8"`);
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP CONSTRAINT "FK_0e4445597642c2456ebdd7e23b1"`);
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP CONSTRAINT "FK_74dcee8adad12b108a49560119a"`);
    await queryRunner.query(`DROP TABLE "document_sequences"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b9d23fe475d31b7e393ca20a41"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4ecae62db3f9e9cc9a368d57ad"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c210a330b80232c29c2ad68462"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_7aca5f7b5c2c3278b8989e32d0"`);
    await queryRunner.query(`DROP TABLE "sale_items"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_sales_branch_invoice"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8b16a3ffdcb10526c7d06ce68b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8f357792a11a65c73d4af50501"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8f2285a5185ef50ee3976d1cfd"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_405d9e16a4e7a1ab871d3fa082"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_30d3befa517de40391a426f075"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_742b48cee8319453602e7d6fd4"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cc9d1e3f9b54f986c656f17189"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_236f3154522de80a98f87c66b8"`);
    await queryRunner.query(`DROP TABLE "sales"`);
    await queryRunner.query(`DROP TYPE "public"."sale_delivery_status"`);
    await queryRunner.query(`DROP TYPE "public"."sale_payment_status"`);
    await queryRunner.query(`DROP TYPE "public"."sale_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e0c7eeb85d3963aa00abac66cf"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cae48942758b3f35dcaefb3d57"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_71312a2645adc8f1b8fc343107"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0e4445597642c2456ebdd7e23b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_74dcee8adad12b108a49560119"`);
    await queryRunner.query(`DROP TABLE "sale_payments"`);
  }
}
