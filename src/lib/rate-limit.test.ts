import { env } from '../config/env';
import { RedisStore } from './rate-limit';

describe('RedisStore', () => {
  const saved = { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN };

  beforeAll(() => {
    Object.assign(env, { UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 'token' });
  });

  afterAll(() => {
    Object.assign(env, { UPSTASH_REDIS_REST_URL: saved.url, UPSTASH_REDIS_REST_TOKEN: saved.token });
  });

  afterEach(() => jest.restoreAllMocks());

  const store = () => {
    const s = new RedisStore('login');
    s.init({ windowMs: 60_000 } as never);
    return s;
  };

  it('counts hits in Redis with one command per request', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ result: [3, 42_000] }), { status: 200 }));
    const result = await store().increment('1.2.3.4');
    expect(result.totalHits).toBe(3);
    expect(result.resetTime!.getTime()).toBeGreaterThan(Date.now() + 40_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://redis.test');
    const command = JSON.parse(String(init?.body)) as unknown[];
    expect(command[0]).toBe('EVAL');
    expect(command.slice(2)).toEqual([1, 'rl:login:1.2.3.4', 60_000]);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token');
  });

  it('keeps limiting in memory when Redis is down', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const s = store();
    expect((await s.increment('5.6.7.8')).totalHits).toBe(1);
    expect((await s.increment('5.6.7.8')).totalHits).toBe(2);
    await s.resetKey('5.6.7.8');
    expect((await s.increment('5.6.7.8')).totalHits).toBe(1);
  });

  it('treats a Redis error reply as down', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'WRONGPASS' }), { status: 401 }));
    expect((await store().increment('9.9.9.9')).totalHits).toBe(1);
  });
});
