import 'reflect-metadata';
import { env } from './config/env';
import { AppDataSource } from './database/data-source';
import { createApp } from './app';
import { logger } from './lib/logger';

async function main() {
  await AppDataSource.initialize();
  logger.info('Database connected');

  const pending = await AppDataSource.showMigrations();
  if (pending) logger.warn('There are pending migrations. Run `npm run migration:run`.');

  const server = createApp().listen(env.PORT, () => {
    logger.info(`DSM Clinic API listening on http://localhost:${env.PORT} (docs: /api/docs)`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      AppDataSource.destroy()
        .catch((err: unknown) => logger.error({ err }, 'Error closing database'))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
