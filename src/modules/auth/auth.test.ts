import bcrypt from 'bcryptjs';
import request from 'supertest';
import { bearer, createBranch, createStaff, TEST_PASSWORD } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';
import { verifyAccessToken } from '../../lib/jwt';
import { Branch } from '../branches/branch.entity';

const fake = installFakeSupabase();
const app = createApp();

const login = (identifier: string, password = TEST_PASSWORD) =>
  request(app).post('/api/v1/auth/login').send({ identifier, password });

const refresh = (refreshToken: string) => request(app).post('/api/v1/auth/refresh').send({ refreshToken });

async function hashOf(staffId: string) {
  const [row] = (await AppDataSource.query(
    `SELECT password_hash AS "hash" FROM staff_credentials WHERE staff_id = $1`,
    [staffId],
  )) as { hash: string }[];
  return row?.hash;
}

describe('auth', () => {
  let branchId: string;

  beforeAll(async () => {
    branchId = (await createBranch({ code: 'LHR', name: 'Lahore' })).id;
  });

  describe('POST /auth/login', () => {
    it('logs in with username or email and returns a signed token, role, branch and permissions', async () => {
      const desk = await createStaff(fake, { role: 'front_desk', branchId, username: 'desk.one' });

      for (const identifier of ['desk.one', 'DESK.ONE@test.dsm']) {
        const res = await login(identifier);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(verifyAccessToken(res.body.data.accessToken)).toMatchObject({ userId: desk.id });
        expect(res.body.data).toMatchObject({ tokenType: 'bearer', expiresIn: 900 });
        expect(res.body.data.refreshToken).toEqual(expect.any(String));
        expect(res.body.data.me).toMatchObject({ role: 'front_desk', branch: { id: branchId, code: 'LHR' } });
        expect(res.body.data.me.permissions).toEqual(
          expect.arrayContaining(['sales.create', 'patients.view']),
        );
        expect(res.body.data.me.permissions).not.toContain('staff.view');
      }
      const token = (await login('desk.one')).body.data.accessToken;
      const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
      expect(me.status).toBe(200);
    });

    it('rejects a wrong password or unknown user with the same message', async () => {
      await createStaff(fake, { role: 'doctor', branchId, username: 'doc.one' });
      const wrong = await login('doc.one', 'nope');
      const unknown = await login('ghost', 'nope');
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.error.message).toBe(unknown.body.error.message);
    });

    it('locks the account for 15 minutes after 10 wrong passwords', async () => {
      const staff = await createStaff(fake, { role: 'pharmacy', branchId, username: 'lock.me' });
      await AppDataSource.query(`UPDATE staff_credentials SET failed_attempts = 9 WHERE staff_id = $1`, [
        staff.id,
      ]);
      expect((await login('lock.me', 'wrong-again')).status).toBe(401);
      const locked = await login('lock.me');
      expect(locked.status).toBe(429);
      await AppDataSource.query(
        `UPDATE staff_credentials SET locked_until = now() - interval '1 minute' WHERE staff_id = $1`,
        [staff.id],
      );
      expect((await login('lock.me')).status).toBe(200);
    });

    it('accepts a password hash carried over from Supabase and upgrades it', async () => {
      const staff = await createStaff(fake, { role: 'accountant', branchId, username: 'legacy.one' });
      const legacy = await bcrypt.hash('Legacy1Pass', 10);
      await AppDataSource.query(`UPDATE staff_credentials SET password_hash = $2 WHERE staff_id = $1`, [
        staff.id,
        legacy,
      ]);
      expect((await login('legacy.one', 'Legacy1Pass')).status).toBe(200);
      expect(await hashOf(staff.id)).toMatch(/^scrypt\$/);
      expect((await login('legacy.one', 'Legacy1Pass')).status).toBe(200);
    });

    it('refuses inactive staff', async () => {
      await createStaff(fake, { role: 'pharmacy', branchId, username: 'pharm.off', status: 'inactive' });
      expect((await login('pharm.off')).status).toBe(403);
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

    it('rejects a token signed by someone else or with a staff id only', async () => {
      const staff = await createStaff(fake, { role: 'accountant', branchId });
      expect(
        (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${staff.id}`)).status,
      ).toBe(401);
      const [header, payload] = bearer(staff).Authorization.slice(7).split('.') as [string, string];
      const forged = `${header}.${payload}.${Buffer.alloc(32).toString('base64url')}`;
      expect(
        (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`)).status,
      ).toBe(401);
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

  describe('refresh, rotation and logout', () => {
    it('rotates the refresh token and ends the session when an old one is replayed', async () => {
      await createStaff(fake, { role: 'store_keeper', branchId, username: 'rotate.one' });
      const first = (await login('rotate.one')).body.data.refreshToken as string;

      const second = await refresh(first);
      expect(second.status).toBe(200);
      expect(second.body.data.refreshToken).not.toBe(first);

      expect((await refresh(first)).status).toBe(401);
      const second2 = second.body.data.refreshToken as string;
      expect((await refresh(second2)).status).toBe(200);

      await AppDataSource.query(
        `UPDATE staff_sessions SET rotated_at = now() - interval '5 minutes'
          WHERE staff_id = (SELECT id FROM staff_profiles WHERE username = 'rotate.one')`,
      );
      expect((await refresh(second2)).status).toBe(401);
      const [session] = (await AppDataSource.query(
        `SELECT revoked_reason AS "reason" FROM staff_sessions
          WHERE staff_id = (SELECT id FROM staff_profiles WHERE username = 'rotate.one')`,
      )) as { reason: string | null }[];
      expect(session?.reason).toBe('reuse');
    });

    it('logs out by revoking the refresh session', async () => {
      await createStaff(fake, { role: 'store_keeper', branchId, username: 'logout.one' });
      const token = (await login('logout.one')).body.data.refreshToken as string;
      const out = await request(app).post('/api/v1/auth/logout').send({ refreshToken: token });
      expect(out.status).toBe(204);
      expect((await refresh(token)).status).toBe(401);
      expect((await request(app).post('/api/v1/auth/logout').send({})).status).toBe(204);
    });

    it('keeps the dashboard refresh token in an HttpOnly cookie', async () => {
      await createStaff(fake, { role: 'front_desk', branchId, username: 'cookie.one' });
      const agent = request.agent(app);
      const res = await agent
        .post('/api/v1/auth/login')
        .set('X-Auth-Transport', 'cookie')
        .send({ identifier: 'cookie.one', password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.data.refreshToken).toBeNull();
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/dsm_refresh=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

      expect((await agent.post('/api/v1/auth/refresh').send({})).status).toBe(401);
      const renewed = await agent.post('/api/v1/auth/refresh').set('X-Auth-Transport', 'cookie').send({});
      expect(renewed.status).toBe(200);
      expect(renewed.body.data.refreshToken).toBeNull();

      const out = await agent.post('/api/v1/auth/logout').set('X-Auth-Transport', 'cookie').send({});
      expect(out.status).toBe(204);
      expect(String(out.headers['set-cookie'])).toMatch(/dsm_refresh=;/);
      expect(
        (await agent.post('/api/v1/auth/refresh').set('X-Auth-Transport', 'cookie').send({})).status,
      ).toBe(401);
    });

    it('rejects an unknown refresh token and a missing one', async () => {
      expect((await refresh('refresh-unknown-token')).status).toBe(401);
      expect((await request(app).post('/api/v1/auth/refresh').send({})).status).toBe(401);
    });

    it('ends the sessions of an account that was deactivated', async () => {
      const staff = await createStaff(fake, { role: 'front_desk', branchId, username: 'off.later' });
      const token = (await login('off.later')).body.data.refreshToken as string;
      await AppDataSource.query(`UPDATE staff_profiles SET status = 'inactive' WHERE id = $1`, [staff.id]);
      expect((await refresh(token)).status).toBe(403);
    });
  });

  describe('POST /auth/change-password', () => {
    it('changes the password after checking the current one and ends the other sessions', async () => {
      await createStaff(fake, { role: 'store_keeper', branchId, username: 'store.one' });
      const other = (await login('store.one')).body.data.refreshToken as string;
      const current = (await login('store.one')).body.data.accessToken as string;
      const auth = { Authorization: `Bearer ${current}` };

      const wrong = await request(app)
        .post('/api/v1/auth/change-password')
        .set(auth)
        .send({ currentPassword: 'wrong-one', newPassword: 'NewPassw0rd!' });
      expect(wrong.status).toBe(400);

      const ok = await request(app)
        .post('/api/v1/auth/change-password')
        .set(auth)
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'NewPassw0rd!' });
      expect(ok.status).toBe(204);

      expect((await refresh(other)).status).toBe(401);
      expect((await login('store.one')).status).toBe(401);
      const fresh = await login('store.one', 'NewPassw0rd!');
      expect(fresh.status).toBe(200);
      expect(fresh.body.data.me.profile.mustChangePassword).toBe(false);
    });
  });
});
