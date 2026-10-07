import type { MigrationInterface, QueryRunner } from 'typeorm';

const PREVIOUS_VIEW =
  "CREATE VIEW \"account_movements\" WITH (security_invoker = true) AS SELECT y.branch_id, y.account_sheet_id, y.date, 'sale_payment'::text AS source, s.invoice_no::text AS reference, ('Sale ' || s.invoice_no || ' (' || y.method || ')')::text AS narration, y.amount AS debit, 0::numeric(12,2) AS credit FROM sale_payments y JOIN sales s ON s.id = y.sale_id AND s.deleted_at IS NULL WHERE y.deleted_at IS NULL UNION ALL SELECT y.branch_id, y.account_sheet_id, y.date, 'appointment_payment', 'APP#' || a.appointment_no, 'Appointment APP#' || a.appointment_no || ' (' || y.method || ')', y.amount, 0::numeric(12,2) FROM appointment_payments y JOIN appointments a ON a.id = y.appointment_id AND a.deleted_at IS NULL WHERE y.deleted_at IS NULL UNION ALL SELECT l.branch_id, l.account_sheet_id, e.date, 'journal', e.entry_no::text, COALESCE(l.description, e.narration), l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id AND e.deleted_at IS NULL WHERE l.deleted_at IS NULL AND l.account_sheet_id IS NOT NULL";

const REFUND_ROWS =
  " UNION ALL SELECT r.branch_id, r.refund_account_sheet_id, r.refund_date, 'sale_refund', r.return_no::text, ('Refund ' || r.return_no || ' (' || r.refund_method::text || ')')::text, 0::numeric(12,2), r.refund_amount FROM sale_returns r WHERE r.deleted_at IS NULL AND r.refund_amount > 0";

const REVOKE_VIEW =
  'DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'anon\') THEN REVOKE ALL ON "account_movements" FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'authenticated\') THEN REVOKE ALL ON "account_movements" FROM authenticated; END IF; END $$';

const ALL_PAYMENTS_VIEW = PREVIOUS_VIEW + REFUND_ROWS;
const APPROVED_PAYMENTS_VIEW = ALL_PAYMENTS_VIEW.replace(
  'FROM sale_payments y JOIN sales s ON s.id = y.sale_id AND s.deleted_at IS NULL WHERE y.deleted_at IS NULL',
  'FROM sale_payments y JOIN sales s ON s.id = y.sale_id AND s.deleted_at IS NULL WHERE y.deleted_at IS NULL AND y.approved_at IS NOT NULL',
);

export class SalePaymentApproval1791378029260 implements MigrationInterface {
  name = 'SalePaymentApproval1791378029260';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sale_payments" ADD "approved_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "sale_payments" ADD "approved_by" uuid`);
    await queryRunner.query(
      `UPDATE "sale_payments" SET "approved_at" = "created_at", "approved_by" = "created_by"`,
    );
    await queryRunner.query(`ALTER TYPE "public"."sale_payment_status" ADD VALUE 'awaiting_approval'`);
    await queryRunner.query(`DROP VIEW IF EXISTS "account_movements"`);
    await queryRunner.query(APPROVED_PAYMENTS_VIEW);
    await queryRunner.query(REVOKE_VIEW);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS "account_movements"`);
    await queryRunner.query(ALL_PAYMENTS_VIEW);
    await queryRunner.query(REVOKE_VIEW);
    await queryRunner.query(`ALTER TABLE "sales" ALTER COLUMN "payment_status" DROP DEFAULT`);
    await queryRunner.query(
      `CREATE TYPE "public"."sale_payment_status_old" AS ENUM('unpaid', 'partial', 'paid')`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales" ALTER COLUMN "payment_status" TYPE "public"."sale_payment_status_old" USING (CASE WHEN "payment_status"::text = 'awaiting_approval' THEN 'partial' ELSE "payment_status"::text END)::"public"."sale_payment_status_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."sale_payment_status"`);
    await queryRunner.query(`ALTER TYPE "public"."sale_payment_status_old" RENAME TO "sale_payment_status"`);
    await queryRunner.query(`ALTER TABLE "sales" ALTER COLUMN "payment_status" SET DEFAULT 'unpaid'`);
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP COLUMN "approved_by"`);
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP COLUMN "approved_at"`);
  }
}
