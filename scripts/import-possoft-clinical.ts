import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { AppDataSource } from '../src/database/data-source';
import { readDump } from '../src/modules/possoft-import/dump-reader';
import {
  POSSOFT_CLINICAL_TABLES,
  importPossoftClinical,
} from '../src/modules/possoft-import/import-clinical';

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const file = argument('file');
  const password = argument('password');
  const dryRun = process.argv.includes('--dry-run');
  if (!file || !existsSync(file))
    throw new Error('Pass the posSoft data export: --file /path/to/pos_dsm.sql');
  if (!password || password.length < 8)
    throw new Error('Pass a starting password for the doctor logins (8+ chars): --password <value>');

  const dump = await readDump(file, POSSOFT_CLINICAL_TABLES);
  for (const table of POSSOFT_CLINICAL_TABLES)
    console.log(`Read ${table}: ${dump.get(table)?.length ?? 0} rows`);

  await AppDataSource.initialize();
  try {
    const summary = await importPossoftClinical(AppDataSource, dump, { dryRun, password });
    console.log(JSON.stringify(summary, null, 2));
    console.log(dryRun ? 'Dry run: nothing was saved.' : 'Clinical data saved.');
    console.log('Every imported doctor must change the password you set on first login.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Clinical import failed:', err);
  process.exit(1);
});
