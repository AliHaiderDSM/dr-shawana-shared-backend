import pino from 'pino';
import { env } from '../config/env';

const SECRET_SEGMENTS = /(\/public\/patient-history\/)[^/?#]+/;

export function safePath(url: string | undefined) {
  if (!url) return url;
  const path = url.split('?')[0] ?? '';
  return path.replace(SECRET_SEGMENTS, '$1[token]');
}

export const logger = pino({
  level: env.NODE_ENV === 'test' ? (process.env.TEST_LOG_LEVEL ?? 'silent') : env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
    censor: '[redacted]',
  },
});
