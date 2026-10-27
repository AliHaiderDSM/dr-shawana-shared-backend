import { type MigrationInterface, type QueryRunner } from 'typeorm';

const VIEW_BEFORE =
  "CREATE VIEW \"account_movements\" WITH (security_invoker = true) AS SELECT y.branch_id, y.account_sheet_id, y.date, 'sale_payment'::text AS source, s.invoice_no::text AS reference, ('Sale ' || s.invoice_no || ' (' || y.method || ')')::text AS narration, y.amount AS debit, 0::numeric(12,2) AS credit FROM sale_payments y JOIN sales s ON s.id = y.sale_id AND s.deleted_at IS NULL WHERE y.deleted_at IS NULL AND y.approved_at IS NOT NULL UNION ALL SELECT y.branch_id, y.account_sheet_id, y.date, 'appointment_payment', 'APP#' || a.appointment_no, 'Appointment APP#' || a.appointment_no || ' (' || y.method || ')', y.amount, 0::numeric(12,2) FROM appointment_payments y JOIN appointments a ON a.id = y.appointment_id AND a.deleted_at IS NULL WHERE y.deleted_at IS NULL UNION ALL SELECT l.branch_id, l.account_sheet_id, e.date, 'journal', e.entry_no::text, COALESCE(l.description, e.narration), l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id AND e.deleted_at IS NULL WHERE l.deleted_at IS NULL AND l.account_sheet_id IS NOT NULL UNION ALL SELECT r.branch_id, r.refund_account_sheet_id, r.refund_date, 'sale_refund', r.return_no::text, ('Refund ' || r.return_no || ' (' || r.refund_method::text || ')')::text, 0::numeric(12,2), r.refund_amount FROM sale_returns r WHERE r.deleted_at IS NULL AND r.refund_amount > 0";

const APPOINTMENT_REFUND_ROWS =
  " UNION ALL SELECT r.branch_id, r.account_sheet_id, r.date, 'appointment_refund', 'APP#' || a.appointment_no, ('Refund APP#' || a.appointment_no || ' (' || r.method::text || ')')::text, 0::numeric(12,2), r.amount FROM appointment_refunds r JOIN appointments a ON a.id = r.appointment_id AND a.deleted_at IS NULL WHERE r.deleted_at IS NULL";

const REVOKE_VIEW =
  'DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'anon\') THEN REVOKE ALL ON "account_movements" FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'authenticated\') THEN REVOKE ALL ON "account_movements" FROM authenticated; END IF; END $$';

export class AppointmentRefunds1794600000000 implements MigrationInterface {
  name = 'AppointmentRefunds1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "appointment_refunds" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "branch_id" uuid NOT NULL,
        "appointment_id" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "method" "public"."payment_method" NOT NULL,
        "account_sheet_id" uuid NOT NULL,
        "date" date NOT NULL,
        "note" varchar(500),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "deleted_at" timestamptz,
        "deleted_by" uuid,
        CONSTRAINT "PK_appointment_refunds" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_appointment_refunds_amount" CHECK ("amount" > 0),
        CONSTRAINT "FK_appointment_refunds_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_appointment_refunds_appointment" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_appointment_refunds_account" FOREIGN KEY ("account_sheet_id") REFERENCES "account_sheets"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_appointment_refunds_branch" ON "appointment_refunds" ("branch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_appointment_refunds_appointment" ON "appointment_refunds" ("appointment_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_appointment_refunds_date" ON "appointment_refunds" ("date")`);
    await queryRunner.query(`ALTER TABLE "appointment_refunds" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP VIEW IF EXISTS "account_movements"`);
    await queryRunner.query(VIEW_BEFORE + APPOINTMENT_REFUND_ROWS);
    await queryRunner.query(REVOKE_VIEW);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS "account_movements"`);
    await queryRunner.query(VIEW_BEFORE);
    await queryRunner.query(REVOKE_VIEW);
    await queryRunner.query(`DROP TABLE "appointment_refunds"`);
  }
}
