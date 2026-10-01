import request from 'supertest';
import { bearer, createBranch, createStaff, TEST_PASSWORD } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

let seq = 0;
const staffBody = (role: string) => {
  seq += 1;
  return {
    role,
    firstName: 'Sana',
    lastName: `Iqbal ${seq}`,
    email: `sana${seq}@dsm.test`,
    username: `sana${seq}`,
    password: 'TempPassw0rd',
    gender: 'female',
    designation: 'Receptionist',
  };
};

describe('branch staff', () => {
  let lahoreId: string;
  let islamabadId: string;
  let superAdmin: { id: string };
  let lahoreAdmin: { id: string };
  let lahoreDesk: { id: string };
  let lahoreAccountant: { id: string };
  let islamabadDesk: { id: string };

  beforeAll(async () => {
    lahoreId = (await createBranch({ code: 'LHR', name: 'Lahore' })).id;
    islamabadId = (await createBranch({ code: 'ISB', name: 'Islamabad' })).id;
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
    lahoreAdmin = await createStaff(fake, { role: 'branch_admin', branchId: lahoreId });
    lahoreDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
    lahoreAccountant = await createStaff(fake, { role: 'accountant', branchId: lahoreId });
    islamabadDesk = await createStaff(fake, { role: 'front_desk', branchId: islamabadId });
  });

  describe('branch admin in their own branch', () => {
    it('creates staff for every branch role except admins', async () => {
      for (const role of [
        'accountant',
        'doctor',
        'front_desk',
        'team_manager',
        'pharmacy',
        'store_keeper',
        'delivery_print',
      ]) {
        const res = await request(app)
          .post('/api/v1/branch/staff')
          .set(bearer(lahoreAdmin))
          .send(staffBody(role));
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ role, branchId: lahoreId, mustChangePassword: true });
      }
    });

    it('cannot create branch_admin or super_admin', async () => {
      const admin = await request(app)
        .post('/api/v1/branch/staff')
        .set(bearer(lahoreAdmin))
        .send(staffBody('branch_admin'));
      expect(admin.status).toBe(403);
      const superRole = await request(app)
        .post('/api/v1/branch/staff')
        .set(bearer(lahoreAdmin))
        .send(staffBody('super_admin'));
      expect(superRole.status).toBe(400);
    });

    it('lists only its own branch', async () => {
      const res = await request(app).get('/api/v1/branch/staff?pageSize=100').set(bearer(lahoreAdmin));
      expect(res.status).toBe(200);
      const branchIds = new Set(res.body.data.map((s: { branchId: string }) => s.branchId));
      expect([...branchIds]).toEqual([lahoreId]);
      expect(res.body.data.map((s: { id: string }) => s.id)).not.toContain(islamabadDesk.id);
    });

    it('filters by role and searches', async () => {
      const res = await request(app).get('/api/v1/branch/staff?role=doctor').set(bearer(lahoreAdmin));
      expect(res.body.data.every((s: { role: string }) => s.role === 'doctor')).toBe(true);
      const all = await request(app).get('/api/v1/branch/staff?pageSize=100').set(bearer(lahoreAdmin));
      const someone = all.body.data[0] as { id: string; firstName: string };
      const search = await request(app)
        .get(`/api/v1/branch/staff?search=${encodeURIComponent(someone.firstName)}`)
        .set(bearer(lahoreAdmin));
      expect(search.status).toBe(200);
      expect(search.body.data.map((s: { id: string }) => s.id)).toContain(someone.id);
    });

    it('rejects duplicate username or email', async () => {
      const body = staffBody('doctor');
      expect(
        (await request(app).post('/api/v1/branch/staff').set(bearer(lahoreAdmin)).send(body)).status,
      ).toBe(201);
      const again = await request(app)
        .post('/api/v1/branch/staff')
        .set(bearer(lahoreAdmin))
        .send({ ...body, email: 'other@dsm.test' });
      expect(again.status).toBe(409);
    });

    it('edits, resets password, deactivates and removes staff', async () => {
      const created = await request(app)
        .post('/api/v1/branch/staff')
        .set(bearer(lahoreAdmin))
        .send(staffBody('front_desk'));
      const id = created.body.data.id;

      const edited = await request(app)
        .patch(`/api/v1/branch/staff/${id}`)
        .set(bearer(lahoreAdmin))
        .send({ designation: 'Senior Receptionist', role: 'team_manager' });
      expect(edited.body.data).toMatchObject({ designation: 'Senior Receptionist', role: 'team_manager' });

      const reset = await request(app)
        .post(`/api/v1/branch/staff/${id}/reset-password`)
        .set(bearer(lahoreAdmin))
        .send({ password: 'Another1Pass' });
      expect(reset.status).toBe(200);
      expect(fake.users.get(id)?.password).toBe('Another1Pass');

      const off = await request(app).post(`/api/v1/branch/staff/${id}/deactivate`).set(bearer(lahoreAdmin));
      expect(off.body.data.status).toBe('inactive');
      expect(fake.users.get(id)?.banned).toBe(true);

      const on = await request(app).post(`/api/v1/branch/staff/${id}/activate`).set(bearer(lahoreAdmin));
      expect(on.body.data.status).toBe('active');
      expect(fake.users.get(id)?.banned).toBe(false);

      expect((await request(app).delete(`/api/v1/branch/staff/${id}`).set(bearer(lahoreAdmin))).status).toBe(
        204,
      );
      expect((await request(app).get(`/api/v1/branch/staff/${id}`).set(bearer(lahoreAdmin))).status).toBe(
        404,
      );
    });

    it('cannot change its own account through staff management', async () => {
      const res = await request(app)
        .post(`/api/v1/branch/staff/${lahoreAdmin.id}/deactivate`)
        .set(bearer(lahoreAdmin));
      expect(res.status).toBe(403);
    });

    it('deactivated staff lose access immediately', async () => {
      const victim = await createStaff(fake, { role: 'pharmacy', branchId: lahoreId, username: 'pharm.lhr' });
      await request(app).post(`/api/v1/branch/staff/${victim.id}/deactivate`).set(bearer(lahoreAdmin));
      const me = await request(app).get('/api/v1/auth/me').set(bearer(victim));
      expect([401, 403]).toContain(me.status);
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ identifier: 'pharm.lhr', password: TEST_PASSWORD });
      expect([401, 403]).toContain(login.status);
    });
  });

  describe('branch isolation', () => {
    it('Lahore admin cannot list Islamabad staff', async () => {
      const res = await request(app)
        .get(`/api/v1/branch/staff?branchId=${islamabadId}`)
        .set(bearer(lahoreAdmin));
      expect(res.status).toBe(403);
    });

    it('Lahore admin cannot read or edit an Islamabad staff member', async () => {
      const read = await request(app)
        .get(`/api/v1/branch/staff/${islamabadDesk.id}`)
        .set(bearer(lahoreAdmin));
      expect(read.status).toBe(404);
      const edit = await request(app)
        .patch(`/api/v1/branch/staff/${islamabadDesk.id}`)
        .set(bearer(lahoreAdmin))
        .send({ firstName: 'Hacked' });
      expect(edit.status).toBe(404);
      const reset = await request(app)
        .post(`/api/v1/branch/staff/${islamabadDesk.id}/reset-password`)
        .set(bearer(lahoreAdmin))
        .send({ password: 'Hacked1234' });
      expect(reset.status).toBe(404);
    });

    it('Lahore admin cannot create staff in Islamabad', async () => {
      const res = await request(app)
        .post(`/api/v1/branch/staff?branchId=${islamabadId}`)
        .set(bearer(lahoreAdmin))
        .send(staffBody('front_desk'));
      expect(res.status).toBe(403);
    });
  });

  describe('roles without staff management', () => {
    it('front desk cannot create or list staff', async () => {
      expect(
        (await request(app).post('/api/v1/branch/staff').set(bearer(lahoreDesk)).send(staffBody('doctor')))
          .status,
      ).toBe(403);
      expect((await request(app).get('/api/v1/branch/staff').set(bearer(lahoreDesk))).status).toBe(403);
    });

    it('accountant cannot manage staff', async () => {
      expect((await request(app).get('/api/v1/branch/staff').set(bearer(lahoreAccountant))).status).toBe(403);
    });
  });

  describe('super admin', () => {
    it('must choose a branch', async () => {
      expect((await request(app).get('/api/v1/branch/staff').set(bearer(superAdmin))).status).toBe(400);
    });

    it('manages staff of any branch, including branch admins', async () => {
      const list = await request(app)
        .get(`/api/v1/branch/staff?branchId=${islamabadId}`)
        .set(bearer(superAdmin));
      expect(list.body.data.map((s: { id: string }) => s.id)).toContain(islamabadDesk.id);

      const admin = await request(app)
        .post(`/api/v1/branch/staff?branchId=${islamabadId}`)
        .set(bearer(superAdmin))
        .send(staffBody('branch_admin'));
      expect(admin.status).toBe(201);
      expect(admin.body.data.branchId).toBe(islamabadId);
    });

    it('gets 404 for an unknown branch', async () => {
      const res = await request(app)
        .get('/api/v1/branch/staff?branchId=00000000-0000-4000-8000-000000000000')
        .set(bearer(superAdmin));
      expect(res.status).toBe(404);
    });
  });
});
