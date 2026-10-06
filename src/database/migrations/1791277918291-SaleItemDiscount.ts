import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SaleItemDiscount1791277918291 implements MigrationInterface {
  name = 'SaleItemDiscount1791277918291';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sale_items" ADD "discount_percent" numeric(5,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_items" ADD "discount_amount" numeric(12,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_items" ADD CONSTRAINT "CHK_sale_items_discount" CHECK ("discount_percent" >= 0 AND "discount_percent" <= 100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sale_items" DROP CONSTRAINT "CHK_sale_items_discount"`);
    await queryRunner.query(`ALTER TABLE "sale_items" DROP COLUMN "discount_amount"`);
    await queryRunner.query(`ALTER TABLE "sale_items" DROP COLUMN "discount_percent"`);
  }
}
