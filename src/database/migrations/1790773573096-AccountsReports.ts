import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AccountsReports1790773573096 implements MigrationInterface {
  name = 'AccountsReports1790773573096';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "expense_categories" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "name" character varying(150) NOT NULL, CONSTRAINT "PK_d0ef31e189d9523461215b62775" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d9738c9bbf8631acb5a05ed93" ON "expense_categories"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "journal_lines" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "journal_entry_id" uuid NOT NULL, "account_sheet_id" uuid, "expense_category_id" uuid, "description" text, "debit" numeric(12,2) NOT NULL DEFAULT '0', "credit" numeric(12,2) NOT NULL DEFAULT '0', CONSTRAINT "CHK_journal_lines_target" CHECK (("account_sheet_id" IS NULL) <> ("expense_category_id" IS NULL)), CONSTRAINT "CHK_journal_lines_amounts" CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" + "credit") > 0), CONSTRAINT "PK_70cba2da4588cee8921f73ef136" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e8217a1bb2f5a2492071d784a3" ON "journal_lines"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1fd23ae91f0c24764b4e581c72" ON "journal_lines"  ("journal_entry_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ebd57ad92ab10680f0bdda3f7" ON "journal_lines"  ("account_sheet_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_215bdff0a13410f6dfe8987948" ON "journal_lines"  ("expense_category_id") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."journal_source" AS ENUM('manual', 'expense')`);
    await queryRunner.query(
      `CREATE TABLE "journal_entries" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "entry_seq" integer NOT NULL, "entry_no" character varying(30) NOT NULL, "date" date NOT NULL, "narration" text NOT NULL, "reference" character varying(150), "source" "public"."journal_source" NOT NULL DEFAULT 'manual', CONSTRAINT "PK_a70368e64230434457c8d007ab3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_09abab9821d3dedb351b0ce36b" ON "journal_entries"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_463dfc25cc3f68726f9f756540" ON "journal_entries"  ("entry_no") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_a60ea60964189a5a56f07dc8dc" ON "journal_entries"  ("date") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_e33089fe2fdcea8d671ded8208" ON "journal_entries"  ("source") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_journal_entries_branch_no" ON "journal_entries"  ("branch_id", "entry_seq") `,
    );
    await queryRunner.query(
      `CREATE TABLE "expenses" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "date" date NOT NULL, "category_id" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, "account_sheet_id" uuid NOT NULL, "note" text, "journal_entry_id" uuid NOT NULL, "attachment_path" text, "attachment_name" character varying(255), CONSTRAINT "CHK_expenses_amount" CHECK ("amount" > 0), CONSTRAINT "PK_94c3ceb17e3140abc9282c20610" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_866a3b82ff438efc19c2398cda" ON "expenses"  ("branch_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_280137355ed0f561f9aee0ac2c" ON "expenses"  ("date") `);
    await queryRunner.query(`CREATE INDEX "IDX_5d1f4be708e0dfe2afa1a3c376" ON "expenses"  ("category_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_19e240bdaf0974dc3ea5dece17" ON "expenses"  ("account_sheet_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e6081be87dcb10f44075b40153" ON "expenses"  ("journal_entry_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" ADD "commission_percent" numeric(5,2) NOT NULL DEFAULT '3'`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_categories" ADD CONSTRAINT "FK_5d9738c9bbf8631acb5a05ed93f" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_lines" ADD CONSTRAINT "FK_e8217a1bb2f5a2492071d784a3f" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_lines" ADD CONSTRAINT "FK_1fd23ae91f0c24764b4e581c72e" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_lines" ADD CONSTRAINT "FK_1ebd57ad92ab10680f0bdda3f7e" FOREIGN KEY ("account_sheet_id") REFERENCES "account_sheets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_lines" ADD CONSTRAINT "FK_215bdff0a13410f6dfe89879480" FOREIGN KEY ("expense_category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entries" ADD CONSTRAINT "FK_09abab9821d3dedb351b0ce36b6" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "expenses" ADD CONSTRAINT "FK_866a3b82ff438efc19c2398cda6" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "expenses" ADD CONSTRAINT "FK_5d1f4be708e0dfe2afa1a3c376c" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "expenses" ADD CONSTRAINT "FK_19e240bdaf0974dc3ea5dece173" FOREIGN KEY ("account_sheet_id") REFERENCES "account_sheets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "expenses" ADD CONSTRAINT "FK_e6081be87dcb10f44075b40153f" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE OR REPLACE FUNCTION assert_journal_balanced() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ DECLARE entry uuid; diff numeric; BEGIN entry := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id); SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) INTO diff FROM journal_lines WHERE journal_entry_id = entry AND deleted_at IS NULL; IF diff <> 0 THEN RAISE EXCEPTION 'Journal entry % is not balanced', entry USING ERRCODE = 'check_violation'; END IF; RETURN NULL; END $$`,
    );
    await queryRunner.query(
      `CREATE CONSTRAINT TRIGGER "TRG_journal_lines_balanced" AFTER INSERT OR UPDATE OR DELETE ON "journal_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced()`,
    );
    await queryRunner.query(
      `CREATE VIEW "account_movements" WITH (security_invoker = true) AS SELECT y.branch_id, y.account_sheet_id, y.date, 'sale_payment'::text AS source, s.invoice_no::text AS reference, ('Sale ' || s.invoice_no || ' (' || y.method || ')')::text AS narration, y.amount AS debit, 0::numeric(12,2) AS credit FROM sale_payments y JOIN sales s ON s.id = y.sale_id AND s.deleted_at IS NULL WHERE y.deleted_at IS NULL UNION ALL SELECT y.branch_id, y.account_sheet_id, y.date, 'appointment_payment', 'APP#' || a.appointment_no, 'Appointment APP#' || a.appointment_no || ' (' || y.method || ')', y.amount, 0::numeric(12,2) FROM appointment_payments y JOIN appointments a ON a.id = y.appointment_id AND a.deleted_at IS NULL WHERE y.deleted_at IS NULL UNION ALL SELECT l.branch_id, l.account_sheet_id, e.date, 'journal', e.entry_no::text, COALESCE(l.description, e.narration), l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id AND e.deleted_at IS NULL WHERE l.deleted_at IS NULL AND l.account_sheet_id IS NOT NULL`,
    );
    await queryRunner.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "account_movements" FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "account_movements" FROM authenticated; END IF; END $$`,
    );
    await queryRunner.query(`REVOKE ALL ON FUNCTION assert_journal_balanced() FROM PUBLIC`);
    await queryRunner.query(`ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "expense_categories" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS "account_movements"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_journal_lines_balanced" ON "journal_lines"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS assert_journal_balanced()`);
    await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_e6081be87dcb10f44075b40153f"`);
    await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_19e240bdaf0974dc3ea5dece173"`);
    await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_5d1f4be708e0dfe2afa1a3c376c"`);
    await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_866a3b82ff438efc19c2398cda6"`);
    await queryRunner.query(`ALTER TABLE "journal_entries" DROP CONSTRAINT "FK_09abab9821d3dedb351b0ce36b6"`);
    await queryRunner.query(`ALTER TABLE "journal_lines" DROP CONSTRAINT "FK_215bdff0a13410f6dfe89879480"`);
    await queryRunner.query(`ALTER TABLE "journal_lines" DROP CONSTRAINT "FK_1ebd57ad92ab10680f0bdda3f7e"`);
    await queryRunner.query(`ALTER TABLE "journal_lines" DROP CONSTRAINT "FK_1fd23ae91f0c24764b4e581c72e"`);
    await queryRunner.query(`ALTER TABLE "journal_lines" DROP CONSTRAINT "FK_e8217a1bb2f5a2492071d784a3f"`);
    await queryRunner.query(
      `ALTER TABLE "expense_categories" DROP CONSTRAINT "FK_5d9738c9bbf8631acb5a05ed93f"`,
    );
    await queryRunner.query(`ALTER TABLE "doctors" DROP COLUMN "commission_percent"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e6081be87dcb10f44075b40153"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_19e240bdaf0974dc3ea5dece17"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5d1f4be708e0dfe2afa1a3c376"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_280137355ed0f561f9aee0ac2c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_866a3b82ff438efc19c2398cda"`);
    await queryRunner.query(`DROP TABLE "expenses"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_journal_entries_branch_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e33089fe2fdcea8d671ded8208"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a60ea60964189a5a56f07dc8dc"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_463dfc25cc3f68726f9f756540"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_09abab9821d3dedb351b0ce36b"`);
    await queryRunner.query(`DROP TABLE "journal_entries"`);
    await queryRunner.query(`DROP TYPE "public"."journal_source"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_215bdff0a13410f6dfe8987948"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1ebd57ad92ab10680f0bdda3f7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1fd23ae91f0c24764b4e581c72"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e8217a1bb2f5a2492071d784a3"`);
    await queryRunner.query(`DROP TABLE "journal_lines"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5d9738c9bbf8631acb5a05ed93"`);
    await queryRunner.query(`DROP TABLE "expense_categories"`);
  }
}
