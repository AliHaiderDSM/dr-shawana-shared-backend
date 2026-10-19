import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class BranchOnlineSales1793700000000 implements MigrationInterface {
  name = 'BranchOnlineSales1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "branches" ADD "online_sales" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(
      `UPDATE "branches" SET "online_sales" = true WHERE "code" IN ('LHR-001', 'ISB-002') AND "kind" = 'branch'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "online_sales"`);
  }
}
