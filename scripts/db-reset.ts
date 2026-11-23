import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source';
import { databaseName, resetDatabase } from '../src/modules/possoft-import/reset-database';

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  await AppDataSource.initialize();
  try {
    const name = await databaseName(AppDataSource);
    const confirm = argument('confirm');
    if (confirm !== name) {
      console.log(`This deletes EVERY record and login in the database "${name}".`);
      console.log(`Take a backup first, then run again with: --confirm ${name}`);
      process.exitCode = 1;
      return;
    }
    const { tables } = await resetDatabase(AppDataSource);
    console.log(`Database "${name}" is empty: ${tables} tables cleared, main warehouse created again.`);
    console.log('Next: npm run seed:super-admin, then the posSoft import, then npm run seed.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
