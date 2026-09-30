import { config as loadDotenv } from 'dotenv';
import { assertSafeTestDatabase } from './helpers/guard';

export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  loadDotenv({ quiet: true });
  assertSafeTestDatabase();

  const { AppDataSource } = await import('../src/database/data-source');
  await AppDataSource.initialize();
  try {
    await AppDataSource.runMigrations({ transaction: 'each' });
  } finally {
    await AppDataSource.destroy();
  }
}
