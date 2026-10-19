import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class SaleGdnNumbers1793800000000 implements MigrationInterface {
  name = 'SaleGdnNumbers1793800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales" ADD "gdn_no" character varying(30)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sales_gdn_no" ON "sales" ("gdn_no") WHERE "gdn_no" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_sales_gdn_no"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN "gdn_no"`);
  }
}
