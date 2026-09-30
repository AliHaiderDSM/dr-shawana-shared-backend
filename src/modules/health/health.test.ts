import request from 'supertest';
import { createApp } from '../../app';

const app = createApp();

describe('GET /api/v1/health', () => {
  it('returns ok with the database up', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', database: 'up' });
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('echoes a safe incoming X-Request-Id', async () => {
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});

describe('standard HTTP behaviour', () => {
  it('returns the error envelope for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects browser origins that are not in the allowlist', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app).get('/api/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/health']).toBeDefined();
  });
});
