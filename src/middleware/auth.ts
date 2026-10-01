import { type RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { getSupabaseAdmin } from '../lib/supabase';
import { authService } from '../modules/auth/auth.service';

const TOKEN_TTL_MS = 60_000;
const MAX_CACHED_TOKENS = 1000;
const verifiedTokens = new Map<string, { userId: string; expiresAt: number }>();

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

async function verifiedUserId(token: string): Promise<string | null> {
  const now = Date.now();
  const cached = verifiedTokens.get(token);
  if (cached && cached.expiresAt > now) return cached.userId;
  verifiedTokens.delete(token);

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;

  if (verifiedTokens.size >= MAX_CACHED_TOKENS) verifiedTokens.clear();
  verifiedTokens.set(token, { userId: data.user.id, expiresAt: now + TOKEN_TTL_MS });
  return data.user.id;
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  if (req.auth) return next();
  const token = bearerToken(req.header('authorization'));
  if (!token) return next(AppError.unauthorized());

  const userId = await verifiedUserId(token);
  if (!userId) return next(AppError.unauthorized('Invalid or expired token'));

  req.auth = await authService.resolveContext(userId);
  next();
};
