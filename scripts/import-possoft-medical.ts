import 'reflect-metadata';
import { existsSync, statSync } from 'node:fs';
import { AppDataSource } from '../src/database/data-source';
import { readDump } from '../src/modules/possoft-import/dump-reader';
import { POSSOFT_MEDICAL_TABLES, importPossoftMedical } from '../src/modules/possoft-import/import-medical';

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const file = argument('file');
  const filesDir = argument('files');
  const dryRun = process.argv.includes('--dry-run');
  if (!file || !existsSync(file))
    throw new Error('Pass the posSoft data export: --file /path/to/pos_dsm.sql');
  if (!filesDir || !existsSync(filesDir) || !statSync(filesDir).isDirectory())
    throw new Error('Pass the folder that holds the posSoft files: --files /path/to/pos-img');

  const dump = await readDump(file, POSSOFT_MEDICAL_TABLES);
  console.log(`Read customers_med_record: ${dump.get('customers_med_record')?.length ?? 0} rows`);

  await AppDataSource.initialize();
  try {
    const summary = await importPossoftMedical(AppDataSource, dump, {
      dryRun,
      filesDir,
      onProgress: (message) => console.log(message),
    });
    console.log(JSON.stringify(summary, null, 2));
    console.log(dryRun ? 'Dry run: nothing was uploaded or saved.' : 'Medical records and files saved.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Medical import failed:', err);
  process.exit(1);
});
