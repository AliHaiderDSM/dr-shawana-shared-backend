import 'reflect-metadata';
import { existsSync, statSync, writeFileSync } from 'node:fs';
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
    const { missingFiles, ...printable } = summary;
    console.log(JSON.stringify(printable, null, 2));
    if (missingFiles.length > 0) {
      const outPath = 'missing-files.txt';
      writeFileSync(outPath, missingFiles.join('\n') + '\n');
      console.log(
        `${missingFiles.length} file(s) were missing from --files. Their full list is written to ${outPath} — download these from posSoft, drop them into the files folder, and run this import again.`,
      );
    }
    console.log(dryRun ? 'Dry run: nothing was uploaded or saved.' : 'Medical records and files saved.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Medical import failed:', err);
  process.exit(1);
});
