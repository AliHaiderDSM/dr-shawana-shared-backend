import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SuperAdminStockName1791210000000 implements MigrationInterface {
  name = 'SuperAdminStockName1791210000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "branches" SET "name" = 'Super Admin Stock' WHERE "kind" = 'warehouse' AND "name" = 'Main Warehouse'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "branches" SET "name" = 'Main Warehouse' WHERE "kind" = 'warehouse' AND "name" = 'Super Admin Stock'`,
    );
  }
}
