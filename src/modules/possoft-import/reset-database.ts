import type { DataSource } from 'typeorm';

const KEEP_TABLES = new Set(['typeorm_migrations']);

export async function databaseName(source: DataSource): Promise<string> {
  const [row] = (await source.query('SELECT current_database() AS name')) as { name: string }[];
  return row?.name ?? '';
}

export async function resetDatabase(source: DataSource): Promise<{ tables: number }> {
  const rows: { tablename: string }[] = await source.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const tables = rows.map((r) => r.tablename).filter((t) => !KEEP_TABLES.has(t));
  await source.transaction(async (em) => {
    if (tables.length) {
      await em.query(`TRUNCATE ${tables.map((t) => `"public"."${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
    }
    await em.query('ALTER SEQUENCE IF EXISTS inventory_item_serial_seq RESTART');
    await em.query(
      `INSERT INTO branches (name, code, city, kind, status) VALUES ('Super Admin Stock', 'MAINWH', 'Lahore', 'warehouse', 'active')`,
    );
  });
  return { tables: tables.length };
}
