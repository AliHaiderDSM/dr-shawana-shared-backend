import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source';
import { moveToBranchFolders } from '../src/lib/branch-folder-move';

async function main() {
  const deleteOld = process.argv.includes('--delete-old');
  await AppDataSource.initialize();
  try {
    const report = await moveToBranchFolders(AppDataSource, deleteOld);
    for (const [target, tally] of Object.entries(report)) {
      console.log(`${target}: ${tally.moved} moved, ${tally.missing} not found in R2`);
    }
    console.log(deleteOld ? 'Old copies deleted.' : 'Old copies kept. Run with --delete-old to remove them.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Moving files to branch folders failed:', err);
  process.exit(1);
});
