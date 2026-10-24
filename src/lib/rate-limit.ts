import { type Request, type RequestHandler } from 'express';
import rateLimit, {
  ipKeyGenerator,
  MemoryStore,
  type IncrementResponse,
  type Options,
  type Store,
} from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from './errors';
import { logger } from './logger';

const COUNT = `local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {hits, ttl}`;

const redisUrl = () => env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
const redisToken = () => env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;

export const sharedLimitsEnabled = () => env.NODE_ENV !== 'test' && Boolean(redisUrl() && redisToken());

async function redis(command: (string | number)[]) {
  const response = await fetch(redisUrl()!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(1_500),
  });
  const body = (await response.json()) as { result?: unknown; error?: string };
  if (!response.ok || body.error) throw new Error(body.error ?? `Redis ${response.status}`);
  return body.result;
}

export class RedisStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;
  private readonly fallback = new MemoryStore();
  private warned = false;

  constructor(name: string) {
    this.prefix = `rl:${name}:`;
  }

  init(options: Options) {
    this.windowMs = options.windowMs;
    this.fallback.init(options);
  }

  private degrade(error: unknown) {
    if (!this.warned) {
      logger.warn({ err: error, store: this.prefix }, 'Rate limit store unavailable, counting in memory');
      this.warned = true;
    }
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      const [hits, ttl] = (await redis(['EVAL', COUNT, 1, this.prefix + key, this.windowMs])) as [
        number,
        number,
      ];
      this.warned = false;
      return { totalHits: Number(hits), resetTime: new Date(Date.now() + Math.max(Number(ttl), 0)) };
    } catch (error) {
      this.degrade(error);
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string) {
    try {
      await redis(['DECR', this.prefix + key]);
    } catch (error) {
      this.degrade(error);
      this.fallback.decrement(key);
    }
  }

  async resetKey(key: string) {
    try {
      await redis(['DEL', this.prefix + key]);
    } catch (error) {
      this.degrade(error);
      this.fallback.resetKey(key);
    }
  }
}

type KeyOf = (req: Request) => unknown;

export function rateKey(req: Request, keyOf?: KeyOf) {
  const own = keyOf?.(req);
  if (typeof own === 'string' && own.trim()) return `id:${own.trim().toLowerCase()}`;
  if (req.auth?.userId) return `user:${req.auth.userId}`;
  if (req.patient?.patientId) return `patient:${req.patient.patientId}`;
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

export function limiter(
  name: string,
  options: {
    windowMs: number;
    limit: number;
    testLimit?: number;
    message: string;
    shared?: boolean;
    keyOf?: KeyOf;
    byIp?: boolean;
    failuresOnly?: boolean;
  },
) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: env.NODE_ENV === 'test' ? (options.testLimit ?? 1_000) : options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) =>
      options.byIp ? `ip:${ipKeyGenerator(req.ip ?? '')}` : rateKey(req, options.keyOf),
    skipSuccessfulRequests: options.failuresOnly ?? false,
    ...(options.shared !== false && sharedLimitsEnabled() ? { store: new RedisStore(name) } : {}),
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', options.message)),
  });
}

const fifteenMinutes = 15 * 60_000;

export function loginGuard(name: string, account: (body: Record<string, unknown>) => unknown) {
  return [
    limiter(`${name}-ip`, {
      windowMs: fifteenMinutes,
      limit: 200,
      byIp: true,
      message: 'Too many login attempts from this network, try again in a few minutes',
    }),
    limiter(name, {
      windowMs: fifteenMinutes,
      limit: 10,
      failuresOnly: true,
      keyOf: (req) => account((req.body ?? {}) as Record<string, unknown>),
      message: 'Too many wrong attempts on this account, try again in 15 minutes',
    }),
  ] as RequestHandler[];
}

export const perUserLimit = limiter('user', {
  windowMs: 60_000,
  limit: 300,
  testLimit: 10_000,
  shared: false,
  message: 'Too many requests, slow down',
});
