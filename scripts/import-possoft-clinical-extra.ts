import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { AppDataSource } from '../src/database/data-source';
import { readDump } from '../src/modules/possoft-import/dump-reader';
import {
  POSSOFT_EXTRA_TABLES,
  importPossoftClinicalExtras,
} from '../src/modules/possoft-import/import-clinical-extra';

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const file = argument('file');
  const dryRun = process.argv.includes('--dry-run');
  if (!file || !existsSync(file))
    throw new Error('Pass the posSoft data export: --file /path/to/pos_dsm.sql');

  const dump = await readDump(file, POSSOFT_EXTRA_TABLES);
  for (const table of POSSOFT_EXTRA_TABLES)
    console.log(`Read ${table}: ${dump.get(table)?.length ?? 0} rows`);

  await AppDataSource.initialize();
  try {
    const summary = await importPossoftClinicalExtras(AppDataSource, dump, { dryRun });
    console.log(JSON.stringify(summary, null, 2));
    console.log(dryRun ? 'Dry run: nothing was saved.' : 'Blood work and BHRT saved.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Clinical extras import failed:', err);
  process.exit(1);
});
