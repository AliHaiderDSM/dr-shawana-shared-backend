import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProductSizeUnit1791400000000 implements MigrationInterface {
  name = 'ProductSizeUnit1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD "size_unit" character varying(20) NOT NULL DEFAULT 'g'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "size_unit"`);
  }
}
