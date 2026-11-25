import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { AppDataSource } from '../src/database/data-source';
import { readDump } from '../src/modules/possoft-import/dump-reader';
import {
  POSSOFT_RESYNC_TABLES,
  resyncAppointments,
} from '../src/modules/possoft-import/resync-appointments';

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const oldFile = argument('old');
  const file = argument('file');
  const dryRun = process.argv.includes('--dry-run');
  if (!oldFile || !existsSync(oldFile))
    throw new Error('Pass the already-imported export: --old /path/to/old.sql');
  if (!file || !existsSync(file)) throw new Error('Pass the fresh posSoft export: --file /path/to/new.sql');

  const [oldDump, newDump] = await Promise.all([
    readDump(oldFile, POSSOFT_RESYNC_TABLES),
    readDump(file, POSSOFT_RESYNC_TABLES),
  ]);

  await AppDataSource.initialize();
  try {
    const summary = await resyncAppointments(AppDataSource, oldDump, newDump, {
      dryRun,
      onProgress: (message) => console.log(message),
    });
    console.log(JSON.stringify(summary, null, 2));
    console.log(dryRun ? 'Dry run: nothing was saved.' : 'Appointments re-synced from posSoft.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Resync failed:', err);
  process.exit(1);
});
