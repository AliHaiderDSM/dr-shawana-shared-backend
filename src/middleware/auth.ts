import { type RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { verifyAccessToken } from '../lib/jwt';
import { perUserLimit } from '../lib/rate-limit';
import { authService } from '../modules/auth/auth.service';

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token, extra] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token && extra === undefined ? token : null;
}

export const authenticate: RequestHandler = async (req, res, next) => {
  if (req.auth) return next();
  const token = bearerToken(req.header('authorization'));
  if (!token) return next(AppError.unauthorized());

  const claims = verifyAccessToken(token);
  if (!claims) return next(AppError.unauthorized('Invalid or expired token'));

  req.auth = await authService.resolveContext(claims.userId, claims.sessionId);
  void perUserLimit(req, res, next);
};
