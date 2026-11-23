import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source';
import { fixClinicalBranches } from '../src/modules/possoft-import/fix-branches';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await AppDataSource.initialize();
  try {
    await fixClinicalBranches(AppDataSource, { dryRun, onProgress: (message) => console.log(message) });
    console.log(dryRun ? 'Dry run: nothing was saved.' : 'Done.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Fix failed:', err);
  process.exit(1);
});
