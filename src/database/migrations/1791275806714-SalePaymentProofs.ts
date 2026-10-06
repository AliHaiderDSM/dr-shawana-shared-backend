import type { MigrationInterface, QueryRunner } from 'typeorm';

const CASH_CHECK = 'CHK_sale_payments_cash_fields';

export class SalePaymentProofs1791275806714 implements MigrationInterface {
  name = 'SalePaymentProofs1791275806714';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sale_payment_proofs" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "payment_id" uuid NOT NULL, "file_path" text NOT NULL, "original_name" character varying(255) NOT NULL, "content_type" character varying(100) NOT NULL, "size_bytes" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_25540c6b61abbbed94ec5c90f8d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_43e8daa16a90220bc39cef2775" ON "sale_payment_proofs"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c609031941b0354cc054d6285f" ON "sale_payment_proofs"  ("payment_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_payment_proofs" ADD CONSTRAINT "FK_43e8daa16a90220bc39cef27755" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_payment_proofs" ADD CONSTRAINT "FK_c609031941b0354cc054d6285fa" FOREIGN KEY ("payment_id") REFERENCES "sale_payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "sale_payment_proofs" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(
      `INSERT INTO "sale_payment_proofs" ("branch_id", "payment_id", "file_path", "original_name", "content_type", "created_at", "created_by")
       SELECT "branch_id", "id", "proof_file_path", COALESCE("proof_original_name", 'screenshot'),
              COALESCE("proof_content_type", 'application/octet-stream'), "created_at", "created_by"
         FROM "sale_payments" WHERE "proof_file_path" IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP CONSTRAINT "${CASH_CHECK}"`);
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP COLUMN "proof_file_path"`);
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP COLUMN "proof_original_name"`);
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP COLUMN "proof_content_type"`);
    await queryRunner.query(
      `ALTER TABLE "sale_payments" ADD CONSTRAINT "${CASH_CHECK}" CHECK ("method" = 'online' OR ("sender_bank" IS NULL AND "sender_account_title" IS NULL AND "sender_account_no" IS NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sale_payments" DROP CONSTRAINT "${CASH_CHECK}"`);
    await queryRunner.query(`ALTER TABLE "sale_payments" ADD "proof_content_type" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "sale_payments" ADD "proof_original_name" character varying(255)`);
    await queryRunner.query(`ALTER TABLE "sale_payments" ADD "proof_file_path" text`);
    await queryRunner.query(
      `UPDATE "sale_payments" p SET "proof_file_path" = f."file_path", "proof_original_name" = f."original_name",
              "proof_content_type" = f."content_type"
         FROM (SELECT DISTINCT ON ("payment_id") * FROM "sale_payment_proofs"
                WHERE "deleted_at" IS NULL ORDER BY "payment_id", "created_at") f
        WHERE f."payment_id" = p."id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_payments" ADD CONSTRAINT "${CASH_CHECK}" CHECK ("method" = 'online' OR ("sender_bank" IS NULL AND "sender_account_title" IS NULL AND "sender_account_no" IS NULL AND "proof_file_path" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_payment_proofs" DROP CONSTRAINT "FK_c609031941b0354cc054d6285fa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_payment_proofs" DROP CONSTRAINT "FK_43e8daa16a90220bc39cef27755"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_c609031941b0354cc054d6285f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_43e8daa16a90220bc39cef2775"`);
    await queryRunner.query(`DROP TABLE "sale_payment_proofs"`);
  }
}
