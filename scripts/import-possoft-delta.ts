import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { AppDataSource } from '../src/database/data-source';
import { readDump } from '../src/modules/possoft-import/dump-reader';
import { POSSOFT_DELTA_TABLES, importPossoftDelta } from '../src/modules/possoft-import/import-delta';

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const oldFile = argument('old');
  const file = argument('file');
  const password = argument('password');
  const dryRun = process.argv.includes('--dry-run');
  if (!oldFile || !existsSync(oldFile))
    throw new Error('Pass the already-imported export: --old /path/to/old.sql');
  if (!file || !existsSync(file))
    throw new Error('Pass the fresh posSoft export: --file /path/to/new.sql');
  if (!password || password.length < 8)
    throw new Error('Pass a starting password for any new doctor logins (8+ chars): --password <value>');

  const [oldDump, newDump] = await Promise.all([
    readDump(oldFile, POSSOFT_DELTA_TABLES),
    readDump(file, POSSOFT_DELTA_TABLES),
  ]);

  await AppDataSource.initialize();
  try {
    const summary = await importPossoftDelta(AppDataSource, oldDump, newDump, { dryRun, password });
    console.log(JSON.stringify(summary, null, 2));
    console.log(
      `New rows found: ${summary.diff.newSales} sales, ${summary.diff.newAppointments} appointments, ${summary.diff.newPrescriptions} prescriptions.`,
    );
    console.log(
      dryRun
        ? 'Dry run: nothing was saved. Check the counts, then run again without --dry-run.'
        : 'Delta saved. Now re-run import:possoft-medical, import:possoft-clinical-extra and import:possoft-history on the fresh export to add any new medical records, blood work, BHRT and intake history.',
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Delta import failed:', err);
  process.exit(1);
});
