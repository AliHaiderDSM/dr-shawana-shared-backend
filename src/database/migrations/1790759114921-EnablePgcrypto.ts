import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class EnablePgcrypto1790759114921 implements MigrationInterface {
  name = 'EnablePgcrypto1790759114921';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
