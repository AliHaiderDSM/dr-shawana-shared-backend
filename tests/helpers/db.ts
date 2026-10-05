import { AppDataSource } from '../../src/database/data-source';

const KEEP_TABLES = new Set(['typeorm_migrations']);

export async function truncateAllTables(): Promise<void> {
  const rows: { tablename: string }[] = await AppDataSource.query(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = rows.map((r) => r.tablename).filter((t) => !KEEP_TABLES.has(t));
  if (tables.length === 0) return;
  await AppDataSource.query(
    `TRUNCATE ${tables.map((t) => `"public"."${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  await AppDataSource.query('ALTER SEQUENCE IF EXISTS inventory_item_serial_seq RESTART');
}
