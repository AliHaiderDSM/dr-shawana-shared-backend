import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class OverallDiscountRequests1794400000000 implements MigrationInterface {
  name = 'OverallDiscountRequests1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP CONSTRAINT "CHK_discount_requests_target"`);
    await queryRunner.query(
      `ALTER TABLE "discount_requests" ADD CONSTRAINT "CHK_discount_requests_target"
        CHECK ((("product_id" IS NOT NULL)::int + ("bundle_id" IS NOT NULL)::int) <= 1)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "discount_requests" WHERE "product_id" IS NULL AND "bundle_id" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP CONSTRAINT "CHK_discount_requests_target"`);
    await queryRunner.query(
      `ALTER TABLE "discount_requests" ADD CONSTRAINT "CHK_discount_requests_target"
        CHECK ((("product_id" IS NOT NULL)::int + ("bundle_id" IS NOT NULL)::int) = 1)`,
    );
  }
}
