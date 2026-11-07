import { type MigrationInterface, type QueryRunner } from 'typeorm';

const TABLES = [
  { table: 'recipe_items', parent: 'recipe_id' },
  { table: 'material_batch_items', parent: 'batch_id' },
];

export class ItemPositions1794900000000 implements MigrationInterface {
  name = 'ItemPositions1794900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, parent } of TABLES) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD "position" integer NOT NULL DEFAULT 0`);
      await queryRunner.query(
        `UPDATE "${table}" t SET "position" = ranked.n FROM (
           SELECT id, row_number() OVER (PARTITION BY "${parent}" ORDER BY "created_at", id) - 1 AS n FROM "${table}"
         ) ranked WHERE ranked.id = t.id`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table } of TABLES) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "position"`);
    }
  }
}
