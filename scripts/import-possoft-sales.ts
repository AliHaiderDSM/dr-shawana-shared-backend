import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { AppDataSource } from '../src/database/data-source';
import { readDump } from '../src/modules/possoft-import/dump-reader';
import { POSSOFT_SALES_TABLES, importPossoftSales } from '../src/modules/possoft-import/import-sales';

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const file = argument('file');
  const dryRun = process.argv.includes('--dry-run');
  if (!file || !existsSync(file))
    throw new Error('Pass the posSoft data export: --file /path/to/pos_dsm.sql');

  const dump = await readDump(file, POSSOFT_SALES_TABLES);
  for (const table of POSSOFT_SALES_TABLES)
    console.log(`Read ${table}: ${dump.get(table)?.length ?? 0} rows`);
  if (!dump.get('sales')?.length)
    throw new Error('No sales rows in this file. Export the data, not only the structure.');

  await AppDataSource.initialize();
  try {
    const summary = await importPossoftSales(AppDataSource, dump, { dryRun });
    console.log(JSON.stringify(summary, null, 2));
    console.log(dryRun ? 'Dry run: nothing was saved.' : 'Import saved.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Import failed:', err);
  process.exit(1);
});
