import { type MigrationInterface, type QueryRunner } from 'typeorm';

const INDEXES: [name: string, table: string, column: string][] = [
  ['IDX_patients_name_trgm', 'patients', 'name'],
  ['IDX_patients_phone_trgm', 'patients', 'phone'],
  ['IDX_patients_city_trgm', 'patients', 'city'],
  ['IDX_products_name_trgm', 'products', 'name'],
  ['IDX_product_batches_batch_no_trgm', 'product_batches', 'batch_no'],
  ['IDX_inventory_items_serial_trgm', 'inventory_items', 'serial'],
];

export class SearchTrigramIndexes1794300000000 implements MigrationInterface {
  name = 'SearchTrigramIndexes1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    const [row] = (await queryRunner.query(
      `SELECT n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pg_trgm'`,
    )) as { schema: string }[];
    const ops = `"${row?.schema ?? 'public'}".gin_trgm_ops`;
    for (const [name, table, column] of INDEXES) {
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "${name}" ON "${table}" USING gin ("${column}" ${ops})`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [name] of INDEXES) await queryRunner.query(`DROP INDEX IF EXISTS "${name}"`);
  }
}
