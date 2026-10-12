import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BranchCodeFormat1791700000000 implements MigrationInterface {
  name = 'BranchCodeFormat1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "branches" DROP CONSTRAINT "CHK_branches_code_format"`);
    await queryRunner.query(`ALTER TABLE "branches" ALTER COLUMN "code" TYPE varchar(12)`);
    await queryRunner.query(
      `ALTER TABLE "branches" ADD CONSTRAINT "CHK_branches_code_format" CHECK ("code" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND char_length("code") BETWEEN 2 AND 12)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "branches" DROP CONSTRAINT "CHK_branches_code_format"`);
    await queryRunner.query(`ALTER TABLE "branches" ALTER COLUMN "code" TYPE varchar(10)`);
    await queryRunner.query(
      `ALTER TABLE "branches" ADD CONSTRAINT "CHK_branches_code_format" CHECK ("code" ~ '^[A-Z0-9]{2,10}$')`,
    );
  }
}
