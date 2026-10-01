import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { databaseUrl, env } from '../config/env';

const glob = (...parts: string[]) => path.join(...parts).replace(/\\/g, '/');
const srcRoot = path.resolve(__dirname, '..');

function sslOptions() {
  if (!env.DATABASE_SSL) return false;
  if (env.DATABASE_SSL_CA)
    return { ca: fs.readFileSync(env.DATABASE_SSL_CA, 'utf8'), rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  driver: pg,
  url: databaseUrl,
  ssl: sslOptions(),
  synchronize: false,
  uuidExtension: 'pgcrypto',
  migrationsRun: false,
  logging: env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace' ? ['query', 'error'] : ['error'],
  entities: [
    glob(srcRoot, 'modules', '**', '*.entity.{ts,js}'),
    glob(srcRoot, 'database', 'entities', '*.{ts,js}'),
  ],
  migrations: [glob(__dirname, 'migrations', '*.{ts,js}')],
  migrationsTableName: 'typeorm_migrations',
  extra: {
    max: env.DATABASE_POOL_MAX,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  },
});
