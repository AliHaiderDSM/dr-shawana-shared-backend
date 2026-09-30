import request from 'supertest';
import { bearer, createBranch, createStaff, TEST_PASSWORD } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';
import { Branch } from '../branches/branch.entity';

const fake = installFakeSupabase();
const app = createApp();

describe('auth', () => {
  let branchId: string;

  beforeAll(async () => {
    branchId = (await createBranch({ code: 'LHR', name: 'Lahore' })).id;
  });

  describe('POST /auth/login', () => {
    it('logs in with username or email and returns role, branch and permissions', async () => {
      const desk = await createStaff(fake, { role: 'front_desk', branchId, username: 'desk.one' });

      for (const identifier of ['desk.one', 'DESK.ONE@test.dsm']) {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({ identifier, password: TEST_PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toBe(desk.id);
        expect(res.body.data.me).toMatchObject({ role: 'front_desk', branch: { id: branchId, code: 'LHR' } });
        expect(res.body.data.me.permissions).toEqual(
          expect.arrayContaining(['sales.create', 'patients.view']),
        );
        expect(res.body.data.me.permissions).not.toContain('staff.view');
      }
    });

    it('rejects a wrong password or unknown user with the same message', async () => {
      await createStaff(fake, { role: 'doctor', branchId, username: 'doc.one' });
      const wrong = await request(app)
        .post('/api/v1/auth/login')
        .send({ identifier: 'doc.one', password: 'nope' });
      const unknown = await request(app)
        .post('/api/v1/auth/login')
        .send({ identifier: 'ghost', password: 'nope' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.error.message).toBe(unknown.body.error.message);
    });

    it('refuses inactive staff', async () => {
      await createStaff(fake, { role: 'pharmacy', branchId, username: 'pharm.off', status: 'inactive' });
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ identifier: 'pharm.off', password: TEST_PASSWORD });
      expect(res.status).toBe(403);
    });

    it('validates the body', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({ identifier: 'x' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the super admin with no branch and all permissions', async () => {
      const admin = await createStaff(fake, { role: 'super_admin', branchId: null });
      const res = await request(app).get('/api/v1/auth/me').set(bearer(admin));
      expect(res.status).toBe(200);
      expect(res.body.data.branch).toBeNull();
      expect(res.body.data.permissions).toEqual(
        expect.arrayContaining(['branches.create', 'company.update']),
      );
    });

    it('rejects an inactive user with 403', async () => {
      const staff = await createStaff(fake, { role: 'accountant', branchId, status: 'inactive' });
      expect((await request(app).get('/api/v1/auth/me').set(bearer(staff))).status).toBe(403);
    });

    it('rejects staff of an inactive branch with 403', async () => {
      const closed = await createBranch({ code: 'KHI', status: 'inactive' });
      const staff = await createStaff(fake, { role: 'front_desk', branchId: closed.id });
      const res = await request(app).get('/api/v1/auth/me').set(bearer(staff));
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/branch/i);
    });

    it('rejects staff of a deleted branch with 403', async () => {
      const gone = await createBranch({ code: 'MUX' });
      const staff = await createStaff(fake, { role: 'front_desk', branchId: gone.id });
      await AppDataSource.getRepository(Branch).softDelete({ id: gone.id });
      expect((await request(app).get('/api/v1/auth/me').set(bearer(staff))).status).toBe(403);
    });
  });

  describe('PATCH /auth/me', () => {
    it('updates own profile fields only', async () => {
      const staff = await createStaff(fake, { role: 'doctor', branchId });
      const res = await request(app)
        .patch('/api/v1/auth/me')
        .set(bearer(staff))
        .send({ firstName: 'Ayesha', designation: 'Consultant' });
      expect(res.status).toBe(200);
      expect(res.body.data.profile).toMatchObject({ firstName: 'Ayesha', designation: 'Consultant' });

      const roleChange = await request(app)
        .patch('/api/v1/auth/me')
        .set(bearer(staff))
        .send({ role: 'branch_admin' });
      expect(roleChange.status).toBe(400);
    });
  });

  describe('POST /auth/change-password and /auth/refresh', () => {
    it('changes the password after checking the current one', async () => {
      const staff = await createStaff(fake, { role: 'store_keeper', branchId, username: 'store.one' });

      const wrong = await request(app)
        .post('/api/v1/auth/change-password')
        .set(bearer(staff))
        .send({ currentPassword: 'wrong-one', newPassword: 'NewPassw0rd!' });
      expect(wrong.status).toBe(400);

      const ok = await request(app)
        .post('/api/v1/auth/change-password')
        .set(bearer(staff))
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'NewPassw0rd!' });
      expect(ok.status).toBe(204);

      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ identifier: 'store.one', password: 'NewPassw0rd!' });
      expect(login.status).toBe(200);
      expect(login.body.data.me.profile.mustChangePassword).toBe(false);

      const refreshed = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login.body.data.refreshToken });
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.data.accessToken).toBe(staff.id);
    });

    it('rejects an unknown refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'refresh-unknown-token' });
      expect(res.status).toBe(401);
    });
  });
});
