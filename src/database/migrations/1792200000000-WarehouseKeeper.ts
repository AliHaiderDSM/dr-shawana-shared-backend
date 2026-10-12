import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WarehouseKeeper1792200000000 implements MigrationInterface {
  name = 'WarehouseKeeper1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."staff_role" ADD VALUE IF NOT EXISTS 'warehouse_keeper'`);
  }

  public async down(): Promise<void> {
    return;
  }
}
