import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { authController } from './auth.controller';
import { changePasswordSchema, loginSchema, refreshSchema, updateOwnProfileSchema } from './auth.schemas';

export const authRouter = Router();

const credentialLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'test' ? 1_000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(new AppError(429, 'RATE_LIMITED', 'Too many login attempts, try again in a few minutes')),
});

authRouter.post('/auth/login', credentialLimiter, validate({ body: loginSchema }), authController.login);
authRouter.post(
  '/auth/refresh',
  credentialLimiter,
  validate({ body: refreshSchema }),
  authController.refresh,
);
authRouter.get('/auth/me', authenticate, authController.me);
authRouter.patch(
  '/auth/me',
  authenticate,
  validate({ body: updateOwnProfileSchema }),
  authController.updateMe,
);
authRouter.post(
  '/auth/change-password',
  authenticate,
  credentialLimiter,
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);
