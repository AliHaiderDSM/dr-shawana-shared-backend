import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class StockInEditRequests1794200000000 implements MigrationInterface {
  name = 'StockInEditRequests1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "stock_in_edit_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "branch_id" uuid NOT NULL,
        "grn_no" character varying(30) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "changes" jsonb NOT NULL,
        "before" jsonb NOT NULL,
        "note" text,
        "requested_by" uuid NOT NULL,
        "decided_by" uuid,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "decision_note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_in_edit_requests" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_in_edit_requests_status" CHECK ("status" IN ('pending', 'approved', 'rejected')),
        CONSTRAINT "FK_stock_in_edit_requests_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_stock_in_edit_requests_requested_by" FOREIGN KEY ("requested_by") REFERENCES "staff_profiles"("id"),
        CONSTRAINT "FK_stock_in_edit_requests_decided_by" FOREIGN KEY ("decided_by") REFERENCES "staff_profiles"("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_in_edit_requests_grn" ON "stock_in_edit_requests" ("branch_id", "grn_no")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_stock_in_edit_requests_pending" ON "stock_in_edit_requests" ("branch_id", "grn_no") WHERE "status" = 'pending'`,
    );
    await queryRunner.query(`ALTER TABLE "stock_in_edit_requests" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "stock_in_edit_requests"`);
  }
}
