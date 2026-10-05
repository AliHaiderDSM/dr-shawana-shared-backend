import './lib/openapi';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env, isProduction } from './config/env';
import { buildOpenApiDocument } from './docs';
import { AppError } from './lib/errors';
import { logger } from './lib/logger';
import { requestTiming } from './lib/perf';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { apiRouter } from './routes';

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
    rateLimit({
      windowMs: 60_000,
      limit: env.NODE_ENV === 'test' ? 10_000 : 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests, slow down')),
    }),
  );

  const openApiDocument = buildOpenApiDocument();
  app.get('/api/docs/openapi.json', (_req, res) => res.json(openApiDocument));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
