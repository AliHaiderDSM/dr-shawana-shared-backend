import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LabReportSummaryFiles1792600000000 implements MigrationInterface {
  name = 'LabReportSummaryFiles1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_report_summaries" ADD "files" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lab_report_summaries" DROP COLUMN "files"`);
  }
}
