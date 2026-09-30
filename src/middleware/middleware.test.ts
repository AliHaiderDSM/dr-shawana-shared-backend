import express from 'express';
import request from 'supertest';
import { QueryFailedError } from 'typeorm';
import { z } from 'zod';
import { bearer, createBranch, createStaff } from '../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../tests/helpers/supabase-fake';
import { authenticate } from './auth';
import { branchScope } from './branchScope';
import { errorHandler } from './errorHandler';
import { requestId } from './requestId';
import { requirePermission } from './requirePermission';
import { requireRole } from './requireRole';
import { validate, validBody } from './validate';

const fake = installFakeSupabase();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(requestId);

  app.get('/scoped', authenticate, requireRole('branch_admin', 'front_desk'), branchScope(), (req, res) => {
    res.json({ data: { branchId: req.branchId } });
  });
  app.get(
    '/reports',
    authenticate,
    requireRole('branch_admin'),
    branchScope({ allowAllForSuperAdmin: true }),
    (req, res) => res.json({ data: { branchId: req.branchId } }),
  );
  app.get('/admin-only', authenticate, requireRole('branch_admin'), (_req, res) => res.json({ data: 'ok' }));
  app.get('/staff-create', authenticate, requirePermission('staff.create'), (_req, res) =>
    res.json({ data: 'ok' }),
  );

  const bodySchema = z.object({ qty: z.coerce.number().positive() });
  app.post('/validated', validate({ body: bodySchema }), (req, res) => {
    res.json({ data: validBody(req, bodySchema) });
  });

  app.get('/unique', () => {
    throw new QueryFailedError(
      'insert',
      [],
      Object.assign(new Error('dup'), { code: '23505', constraint: 'uq_x' }),
    );
  });
  app.get('/fk-delete', () => {
    throw new QueryFailedError(
      'delete',
      [],
      Object.assign(new Error('fk'), {
        code: '23503',
        detail: 'Key (id)=(1) is still referenced from table "sales".',
      }),
    );
  });
  app.get('/boom', () => {
    throw new Error('secret internal detail');
  });

  app.use(errorHandler);
  return app;
}

const app = buildApp();
let lahoreId: string;
let islamabadId: string;
let superAdmin: { id: string };
let lahoreAdmin: { id: string };
let lahoreDesk: { id: string };

beforeAll(async () => {
  const lahore = await createBranch({ code: 'LHR', name: 'Lahore' });
  const islamabad = await createBranch({ code: 'ISB', name: 'Islamabad', city: 'Islamabad' });
  lahoreId = lahore.id;
  islamabadId = islamabad.id;
  superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
  lahoreAdmin = await createStaff(fake, { role: 'branch_admin', branchId: lahoreId });
  lahoreDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
});

describe('authenticate', () => {
  it('401 without a token', async () => {
    const res = await request(app).get('/scoped');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('401 with an invalid token', async () => {
    expect(
      (
        await request(app)
          .get('/scoped')
          .set(bearer({ id: 'nobody' }))
      ).status,
    ).toBe(401);
  });

  it('401 for a valid login that has no staff profile', async () => {
    const orphan = fake.addUser('orphan@test.dsm', 'x');
    expect(
      (
        await request(app)
          .get('/scoped')
          .set(bearer({ id: orphan }))
      ).status,
    ).toBe(401);
  });
});

describe('requireRole and requirePermission', () => {
  it('403 for a role that is not allowed', async () => {
    const res = await request(app).get('/admin-only').set(bearer(lahoreDesk));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows a listed role and super_admin', async () => {
    expect((await request(app).get('/admin-only').set(bearer(lahoreAdmin))).status).toBe(200);
    expect((await request(app).get('/admin-only').set(bearer(superAdmin))).status).toBe(200);
  });

  it('checks the permission matrix', async () => {
    expect((await request(app).get('/staff-create').set(bearer(lahoreAdmin))).status).toBe(200);
    expect((await request(app).get('/staff-create').set(bearer(lahoreDesk))).status).toBe(403);
  });
});

describe('branchScope', () => {
  it('uses the branch from the token for branch staff', async () => {
    const res = await request(app).get('/scoped').set(bearer(lahoreDesk));
    expect(res.body.data.branchId).toBe(lahoreId);
  });

  it('forbids branch staff from selecting another branch', async () => {
    const res = await request(app).get(`/scoped?branchId=${islamabadId}`).set(bearer(lahoreAdmin));
    expect(res.status).toBe(403);
  });

  it('requires super_admin to choose a branch', async () => {
    expect((await request(app).get('/scoped').set(bearer(superAdmin))).status).toBe(400);
    const res = await request(app).get(`/scoped?branchId=${islamabadId}`).set(bearer(superAdmin));
    expect(res.body.data.branchId).toBe(islamabadId);
  });

  it('rejects a non-uuid branchId', async () => {
    expect((await request(app).get('/scoped?branchId=abc').set(bearer(superAdmin))).status).toBe(400);
  });

  it('lets super_admin act on all branches where allowed', async () => {
    const res = await request(app).get('/reports').set(bearer(superAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data.branchId).toBeNull();
  });
});

describe('validate', () => {
  it('stores parsed values', async () => {
    const res = await request(app).post('/validated').send({ qty: '2.5' });
    expect(res.body.data).toEqual({ qty: 2.5 });
  });

  it('returns 400 with field details', async () => {
    const res = await request(app).post('/validated').send({ qty: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('body.qty');
  });
});

describe('errorHandler', () => {
  it('maps a unique violation to 409', async () => {
    const res = await request(app).get('/unique');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', details: { constraint: 'uq_x' } });
  });

  it('maps a still-referenced FK violation to 409', async () => {
    expect((await request(app).get('/fk-delete')).status).toBe(409);
  });

  it('hides internal error details', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
