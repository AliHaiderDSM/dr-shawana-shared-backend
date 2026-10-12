import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LabReportSummaries1792300000000 implements MigrationInterface {
  name = 'LabReportSummaries1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "lab_report_summaries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "deleted_by" uuid,
        "branch_id" uuid NOT NULL,
        "patient_id" uuid NOT NULL,
        "test_date" date,
        "file_name" character varying(255),
        "values_found" integer NOT NULL DEFAULT 0,
        "summary" jsonb NOT NULL,
        "model" character varying(80),
        CONSTRAINT "PK_lab_report_summaries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lab_report_summaries_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lab_report_summaries_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_report_summaries_patient" ON "lab_report_summaries" ("patient_id", "created_at")`,
    );
    await queryRunner.query(`ALTER TABLE "lab_report_summaries" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "lab_report_summaries"`);
  }
}
