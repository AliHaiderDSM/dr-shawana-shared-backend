import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DropAccountOpeningBalance1791286564632 implements MigrationInterface {
  name = 'DropAccountOpeningBalance1791286564632';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "account_sheets" DROP COLUMN "opening_balance"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "account_sheets" ADD "opening_balance" numeric(12,2) NOT NULL DEFAULT '0'`,
    );
  }
}
