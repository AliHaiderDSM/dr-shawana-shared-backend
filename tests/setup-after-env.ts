import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source';
import { setSupabaseClientsForTests } from '../src/lib/supabase';
import { truncateAllTables } from './helpers/db';
import { assertSafeTestDatabase } from './helpers/guard';

beforeAll(async () => {
  assertSafeTestDatabase();
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await truncateAllTables();
});

afterAll(async () => {
  setSupabaseClientsForTests(undefined);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
});
