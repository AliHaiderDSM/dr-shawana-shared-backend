import { type CookieOptions, type Request, type Response } from 'express';
import { env, isProduction } from '../../config/env';

export const REFRESH_COOKIE = 'dsm_refresh';
const TRANSPORT_HEADER = 'x-auth-transport';
const COOKIE_PATH = '/api/v1/auth';

export const usesCookie = (req: Request) => req.header(TRANSPORT_HEADER)?.toLowerCase() === 'cookie';

function options(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction || env.AUTH_COOKIE_SAMESITE === 'none',
    sameSite: env.AUTH_COOKIE_SAMESITE,
    path: COOKIE_PATH,
    ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
  };
}

export function readRefreshCookie(req: Request): string | null {
  const header = req.header('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== REFRESH_COOKIE) continue;
    const value = part.slice(index + 1).trim();
    try {
      return value ? decodeURIComponent(value) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function writeRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, { ...options(), expires: expiresAt });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, options());
}
