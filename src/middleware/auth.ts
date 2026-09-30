import { type RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { getSupabaseAdmin } from '../lib/supabase';
import { authService } from '../modules/auth/auth.service';

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  if (req.auth) return next();
  const token = bearerToken(req.header('authorization'));
  if (!token) return next(AppError.unauthorized());

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) return next(AppError.unauthorized('Invalid or expired token'));

  req.auth = await authService.resolveContext(data.user.id);
  next();
};
