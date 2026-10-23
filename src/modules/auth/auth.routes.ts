import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { authController } from './auth.controller';
import { changePasswordSchema, loginSchema, refreshSchema, updateOwnProfileSchema } from './auth.schemas';
import { limiter } from '../../lib/rate-limit';

export const authRouter = Router();

const credentialLimiter = limiter('staff-credentials', {
  windowMs: 15 * 60_000,
  limit: 20,
  message: 'Too many login attempts, try again in a few minutes',
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
