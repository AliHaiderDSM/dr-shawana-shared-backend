import { type MigrationInterface, type QueryRunner } from 'typeorm';

const PREVIOUS_VIEW =
  "CREATE VIEW \"account_movements\" WITH (security_invoker = true) AS SELECT y.branch_id, y.account_sheet_id, y.date, 'sale_payment'::text AS source, s.invoice_no::text AS reference, ('Sale ' || s.invoice_no || ' (' || y.method || ')')::text AS narration, y.amount AS debit, 0::numeric(12,2) AS credit FROM sale_payments y JOIN sales s ON s.id = y.sale_id AND s.deleted_at IS NULL WHERE y.deleted_at IS NULL UNION ALL SELECT y.branch_id, y.account_sheet_id, y.date, 'appointment_payment', 'APP#' || a.appointment_no, 'Appointment APP#' || a.appointment_no || ' (' || y.method || ')', y.amount, 0::numeric(12,2) FROM appointment_payments y JOIN appointments a ON a.id = y.appointment_id AND a.deleted_at IS NULL WHERE y.deleted_at IS NULL UNION ALL SELECT l.branch_id, l.account_sheet_id, e.date, 'journal', e.entry_no::text, COALESCE(l.description, e.narration), l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id AND e.deleted_at IS NULL WHERE l.deleted_at IS NULL AND l.account_sheet_id IS NOT NULL";

const REFUND_ROWS =
  " UNION ALL SELECT r.branch_id, r.refund_account_sheet_id, r.refund_date, 'sale_refund', r.return_no::text, ('Refund ' || r.return_no || ' (' || r.refund_method::text || ')')::text, 0::numeric(12,2), r.refund_amount FROM sale_returns r WHERE r.deleted_at IS NULL AND r.refund_amount > 0";

const REVOKE_VIEW =
  'DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'anon\') THEN REVOKE ALL ON "account_movements" FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'authenticated\') THEN REVOKE ALL ON "account_movements" FROM authenticated; END IF; END $$';

export class ReturnsBarcodes1790856106515 implements MigrationInterface {
  name = 'ReturnsBarcodes1790856106515';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."sale_return_reason" AS ENUM('damaged', 'expired', 'wrong_item', 'customer_refused', 'not_delivered', 'other')`,
    );
    await queryRunner.query(`CREATE TYPE "public"."sale_return_status" AS ENUM('pending', 'completed')`);
    await queryRunner.query(
      `CREATE TABLE "sale_returns" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "return_seq" integer NOT NULL, "return_no" character varying(30) NOT NULL, "sale_id" uuid NOT NULL, "date" date NOT NULL, "reason" "public"."sale_return_reason" NOT NULL, "note" text, "status" "public"."sale_return_status" NOT NULL DEFAULT 'pending', "refund_amount" numeric(12,2) NOT NULL DEFAULT '0', "refund_method" "public"."payment_method", "refund_account_sheet_id" uuid, "refund_date" date, CONSTRAINT "CHK_sale_returns_refund_fields" CHECK (("refund_amount" = 0) = ("refund_method" IS NULL AND "refund_account_sheet_id" IS NULL AND "refund_date" IS NULL)), CONSTRAINT "CHK_sale_returns_refund_amount" CHECK ("refund_amount" >= 0), CONSTRAINT "PK_0dacb97f81ef1ca47f61409f844" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15c0a61420a42a431ffb928571" ON "sale_returns"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_700ef26d0c1241be2cb4ea2198" ON "sale_returns"  ("return_no") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_2b61a5fa8b873de80fd1633166" ON "sale_returns"  ("sale_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_a67d1d85c1436062506ed79cbe" ON "sale_returns"  ("reason") `);
    await queryRunner.query(`CREATE INDEX "IDX_f1fcc000ad66beb9da157d5c4b" ON "sale_returns"  ("status") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_dba51f45ef8e88ed0fd6f9c116" ON "sale_returns"  ("refund_account_sheet_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c793921624b4e10c2d68f68ed1" ON "sale_returns"  ("branch_id", "date") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sale_returns_branch_seq" ON "sale_returns"  ("branch_id", "return_seq") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."sale_return_disposition" AS ENUM('pending', 'restocked', 'damaged', 'supplier')`,
    );
    await queryRunner.query(
      `CREATE TABLE "sale_return_items" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "sale_return_id" uuid NOT NULL, "product_id" uuid NOT NULL, "qty" numeric(12,3) NOT NULL, "disposition" "public"."sale_return_disposition" NOT NULL DEFAULT 'pending', "resolved_at" TIMESTAMP WITH TIME ZONE, "resolved_by" uuid, "resolution_note" text, CONSTRAINT "CHK_sale_return_items_resolved" CHECK (("disposition" = 'pending') = ("resolved_at" IS NULL)), CONSTRAINT "CHK_sale_return_items_qty" CHECK ("qty" > 0), CONSTRAINT "PK_87c0813662620cbb412d65c0cc4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_81db338aac017376b74e528bc1" ON "sale_return_items"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fee3a82ea330b3b8df0b41fc5d" ON "sale_return_items"  ("sale_return_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dc78c01dfac83634562e2fd88b" ON "sale_return_items"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b3860cd7c43c51f199f89a1cab" ON "sale_return_items"  ("disposition") `,
    );
    await queryRunner.query(`ALTER TABLE "products" ADD "barcode" character varying(64)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_products_branch_barcode" ON "products"  ("branch_id", "barcode") WHERE "barcode" IS NOT NULL AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_returns" ADD CONSTRAINT "FK_15c0a61420a42a431ffb9285717" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_returns" ADD CONSTRAINT "FK_2b61a5fa8b873de80fd16331667" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_returns" ADD CONSTRAINT "FK_dba51f45ef8e88ed0fd6f9c116d" FOREIGN KEY ("refund_account_sheet_id") REFERENCES "account_sheets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_return_items" ADD CONSTRAINT "FK_81db338aac017376b74e528bc18" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_return_items" ADD CONSTRAINT "FK_fee3a82ea330b3b8df0b41fc5da" FOREIGN KEY ("sale_return_id") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_return_items" ADD CONSTRAINT "FK_dc78c01dfac83634562e2fd88ba" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "sale_returns" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "sale_return_items" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP VIEW IF EXISTS "account_movements"`);
    await queryRunner.query(PREVIOUS_VIEW + REFUND_ROWS);
    await queryRunner.query(REVOKE_VIEW);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS "account_movements"`);
    await queryRunner.query(PREVIOUS_VIEW);
    await queryRunner.query(REVOKE_VIEW);
    await queryRunner.query(
      `ALTER TABLE "sale_return_items" DROP CONSTRAINT "FK_dc78c01dfac83634562e2fd88ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_return_items" DROP CONSTRAINT "FK_fee3a82ea330b3b8df0b41fc5da"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_return_items" DROP CONSTRAINT "FK_81db338aac017376b74e528bc18"`,
    );
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP CONSTRAINT "FK_dba51f45ef8e88ed0fd6f9c116d"`);
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP CONSTRAINT "FK_2b61a5fa8b873de80fd16331667"`);
    await queryRunner.query(`ALTER TABLE "sale_returns" DROP CONSTRAINT "FK_15c0a61420a42a431ffb9285717"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_products_branch_barcode"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "barcode"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b3860cd7c43c51f199f89a1cab"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dc78c01dfac83634562e2fd88b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fee3a82ea330b3b8df0b41fc5d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_81db338aac017376b74e528bc1"`);
    await queryRunner.query(`DROP TABLE "sale_return_items"`);
    await queryRunner.query(`DROP TYPE "public"."sale_return_disposition"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_sale_returns_branch_seq"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c793921624b4e10c2d68f68ed1"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dba51f45ef8e88ed0fd6f9c116"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f1fcc000ad66beb9da157d5c4b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a67d1d85c1436062506ed79cbe"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2b61a5fa8b873de80fd1633166"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_700ef26d0c1241be2cb4ea2198"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_15c0a61420a42a431ffb928571"`);
    await queryRunner.query(`DROP TABLE "sale_returns"`);
    await queryRunner.query(`DROP TYPE "public"."sale_return_status"`);
    await queryRunner.query(`DROP TYPE "public"."sale_return_reason"`);
  }
}
