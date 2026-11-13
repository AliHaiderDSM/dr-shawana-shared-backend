import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class ReplacementApprovals1795300000000 implements MigrationInterface {
  name = 'ReplacementApprovals1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_sale_replacements_branch_seq"`);
    await queryRunner.query(
      `CREATE TABLE "sale_replacement_files" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "sale_replacement_id" uuid NOT NULL, "file_path" text NOT NULL, "original_name" character varying(255) NOT NULL, "content_type" character varying(100) NOT NULL, "size_bytes" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_e1b05193414e21b28b529f83ee6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_492f3d7ac5ec757163fb9aca54" ON "sale_replacement_files" ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b7286331a5be188ad78940932e" ON "sale_replacement_files" ("sale_replacement_id") `,
    );
    await queryRunner.query(`ALTER TABLE "sale_replacements" ADD "reason" "public"."sale_return_reason"`);
    await queryRunner.query(
      `UPDATE "sale_replacements" rp SET "reason" = r."reason" FROM "sale_returns" r WHERE r."id" = rp."sale_return_id"`,
    );
    await queryRunner.query(`UPDATE "sale_replacements" SET "reason" = 'other' WHERE "reason" IS NULL`);
    await queryRunner.query(`ALTER TABLE "sale_replacements" ALTER COLUMN "reason" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "sale_replacements" ADD "decided_by" uuid`);
    await queryRunner.query(`ALTER TABLE "sale_replacements" ADD "decided_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "sale_replacements" ADD "decision_note" text`);
    await queryRunner.query(
      `ALTER TABLE "sale_replacements" ALTER COLUMN "replacement_no" TYPE character varying(40)`,
    );
    await queryRunner.query(`ALTER TABLE "sale_replacements" ALTER COLUMN "sale_return_id" DROP NOT NULL`);
    await queryRunner.query(
      `UPDATE "sale_replacements" rp SET "replacement_seq" = n.seq, "replacement_no" = s."invoice_no" || '.' || n.seq
         FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "sale_id" ORDER BY "created_at", "id") AS seq FROM "sale_replacements") n,
              "sales" s
        WHERE n."id" = rp."id" AND s."id" = rp."sale_id"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."sale_replacement_status" RENAME TO "sale_replacement_status_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."sale_replacement_status" AS ENUM('pending_approval', 'approved', 'rejected', 'sent')`,
    );
    await queryRunner.query(`ALTER TABLE "sale_replacements" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "sale_replacements" ALTER COLUMN "status" TYPE "public"."sale_replacement_status" USING (CASE "status"::text WHEN 'pending' THEN 'approved' ELSE "status"::text END)::"public"."sale_replacement_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_replacements" ALTER COLUMN "status" SET DEFAULT 'pending_approval'`,
    );
    await queryRunner.query(`DROP TYPE "public"."sale_replacement_status_old"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sale_replacements_sale_seq" ON "sale_replacements" ("sale_id", "replacement_seq") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_replacement_files" ADD CONSTRAINT "FK_492f3d7ac5ec757163fb9aca54d" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_replacement_files" ADD CONSTRAINT "FK_b7286331a5be188ad78940932ec" FOREIGN KEY ("sale_replacement_id") REFERENCES "sale_replacements"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "sale_replacement_files" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sale_replacement_files"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_sale_replacements_sale_seq"`);
    await queryRunner.query(
      `DELETE FROM "sale_replacement_items" WHERE "sale_replacement_id" IN (SELECT "id" FROM "sale_replacements" WHERE "sale_return_id" IS NULL OR "status" IN ('pending_approval', 'rejected'))`,
    );
    await queryRunner.query(
      `DELETE FROM "sale_replacements" WHERE "sale_return_id" IS NULL OR "status" IN ('pending_approval', 'rejected')`,
    );
    await queryRunner.query(`CREATE TYPE "public"."sale_replacement_status_old" AS ENUM('pending', 'sent')`);
    await queryRunner.query(`ALTER TABLE "sale_replacements" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "sale_replacements" ALTER COLUMN "status" TYPE "public"."sale_replacement_status_old" USING (CASE "status"::text WHEN 'approved' THEN 'pending' ELSE "status"::text END)::"public"."sale_replacement_status_old"`,
    );
    await queryRunner.query(`ALTER TABLE "sale_replacements" ALTER COLUMN "status" SET DEFAULT 'pending'`);
    await queryRunner.query(`DROP TYPE "public"."sale_replacement_status"`);
    await queryRunner.query(
      `ALTER TYPE "public"."sale_replacement_status_old" RENAME TO "sale_replacement_status"`,
    );
    await queryRunner.query(
      `UPDATE "sale_replacements" rp SET "replacement_seq" = n.seq, "replacement_no" = b."code" || '-REP-' || LPAD(n.seq::text, 6, '0')
         FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "branch_id" ORDER BY "created_at", "id") AS seq FROM "sale_replacements") n,
              "branches" b
        WHERE n."id" = rp."id" AND b."id" = rp."branch_id"`,
    );
    await queryRunner.query(`ALTER TABLE "sale_replacements" ALTER COLUMN "sale_return_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "sale_replacements" ALTER COLUMN "replacement_no" TYPE character varying(30)`,
    );
    await queryRunner.query(`ALTER TABLE "sale_replacements" DROP COLUMN "decision_note"`);
    await queryRunner.query(`ALTER TABLE "sale_replacements" DROP COLUMN "decided_at"`);
    await queryRunner.query(`ALTER TABLE "sale_replacements" DROP COLUMN "decided_by"`);
    await queryRunner.query(`ALTER TABLE "sale_replacements" DROP COLUMN "reason"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sale_replacements_branch_seq" ON "sale_replacements" ("branch_id", "replacement_seq") `,
    );
  }
}
