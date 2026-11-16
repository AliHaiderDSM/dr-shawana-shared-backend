import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BranchToBranchRequests1795600000000 implements MigrationInterface {
  name = 'BranchToBranchRequests1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stock_requests" ADD "from_branch_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_requests_from_branch_id" ON "stock_requests" ("from_branch_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_requests" ADD CONSTRAINT "FK_stock_requests_from_branch" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stock_requests" DROP CONSTRAINT "FK_stock_requests_from_branch"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_requests_from_branch_id"`);
    await queryRunner.query(`ALTER TABLE "stock_requests" DROP COLUMN "from_branch_id"`);
  }
}
