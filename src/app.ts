import './lib/openapi';
import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env, isProduction } from './config/env';
import { buildOpenApiDocument } from './docs';
import { AppError } from './lib/errors';
import { logger, safePath } from './lib/logger';
import { requestTiming } from './lib/perf';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { RESOURCES_PATH } from './modules/educational-resources/educational-resources.service';
import { requestId } from './middleware/requestId';
import { apiRouter } from './routes';
import { limiter } from './lib/rate-limit';

export function createApp(): Express {
  const app = express();

  if (isProduction) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestTiming);
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      serializers: {
        req: (req: { id?: unknown; method?: string; url?: string }) => ({
          id: req.id,
          method: req.method,
          url: safePath(req.url),
        }),
      },
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
    }),
  );
  app.use(
    helmet({
      strictTransportSecurity: isProduction,
      contentSecurityPolicy: {
        directives: { upgradeInsecureRequests: isProduction ? [] : null },
      },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        callback(AppError.forbidden(`Origin ${origin} is not allowed`));
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'Server-Timing'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use(
    '/api',
    limiter('api', {
      windowMs: 60_000,
      limit: 1_500,
      testLimit: 10_000,
      message: 'Too many requests from this network, slow down',
      shared: false,
      byIp: true,
    }),
  );

  const openApiDocument = buildOpenApiDocument();
  app.get('/api/docs/openapi.json', (_req, res) => res.json(openApiDocument));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use(
    RESOURCES_PATH,
    express.static(path.resolve(process.cwd(), 'public', 'resources'), { maxAge: '7d', index: false }),
  );

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
