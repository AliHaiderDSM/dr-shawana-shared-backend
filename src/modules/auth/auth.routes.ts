import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { authController } from './auth.controller';
import { changePasswordSchema, loginSchema, refreshSchema, updateOwnProfileSchema } from './auth.schemas';
import { limiter, loginGuard } from '../../lib/rate-limit';

export const authRouter = Router();

const loginLimiter = loginGuard('staff-login', (body) => body.identifier);
const refreshLimiter = limiter('staff-refresh', {
  windowMs: 15 * 60_000,
  limit: 60,
  byIp: true,
  message: 'Too many attempts, try again in a few minutes',
});
const passwordLimiter = limiter('staff-password', {
  windowMs: 15 * 60_000,
  limit: 10,
  failuresOnly: true,
  message: 'Too many wrong passwords, try again in 15 minutes',
});

authRouter.post('/auth/login', ...loginLimiter, validate({ body: loginSchema }), authController.login);
authRouter.post('/auth/refresh', refreshLimiter, validate({ body: refreshSchema }), authController.refresh);
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
  passwordLimiter,
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);
