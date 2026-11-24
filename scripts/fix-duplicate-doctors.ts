import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source';
import { fixDuplicateDoctors } from '../src/modules/possoft-import/fix-duplicate-doctors';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await AppDataSource.initialize();
  try {
    const result = await fixDuplicateDoctors(AppDataSource, {
      dryRun,
      onProgress: (message) => console.log(message),
    });
    console.log(JSON.stringify(result, null, 2));
    console.log(dryRun ? 'Dry run: nothing was saved.' : 'Duplicate doctors merged.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Fix failed:', err);
  process.exit(1);
});
