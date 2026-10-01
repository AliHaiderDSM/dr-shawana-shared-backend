import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app';
import { AppDataSource } from './database/data-source';
import { logger } from './lib/logger';

const app = createApp();
let ready: Promise<unknown> | null = null;

function connect() {
  if (AppDataSource.isInitialized) return Promise.resolve();
  ready ??= AppDataSource.initialize().catch((err: unknown) => {
    ready = null;
    throw err;
  });
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await connect();
  } catch (err) {
    logger.error({ err }, 'Database connection failed');
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'The database is not reachable right now' },
      }),
    );
    return;
  }
  app(req, res);
}
