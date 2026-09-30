import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';
import { AuditLog } from '../audit/audit-log.entity';
import { StaffProfile } from '../staff/staff-profile.entity';
import { staffRepository } from '../staff/staff.repository';

const fake = installFakeSupabase();
const app = createApp();

const newBranch = { name: 'Islamabad Office', code: 'isb', city: 'Islamabad', phone: '0511234567' };
const newAdmin = {
  firstName: 'Bilal',
  lastName: 'Khan',
  email: 'Bilal@dsm.test',
  username: 'Bilal.Khan',
  password: 'TempPassw0rd',
};

describe('super admin branches', () => {
  let superAdmin: { id: string };
  let branchAdmin: { id: string };

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR', name: 'Lahore', isHeadOffice: true });
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
    branchAdmin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
  });

  it('creates, lists, updates and deactivates a branch with audit logs', async () => {
    const created = await request(app).post('/api/v1/admin/branches').set(bearer(superAdmin)).send(newBranch);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: 'ISB', status: 'active', isHeadOffice: false });
    const id = created.body.data.id;

    const list = await request(app).get('/api/v1/admin/branches?search=islam').set(bearer(superAdmin));
    expect(list.body.data.map((b: { id: string }) => b.id)).toContain(id);
    expect(list.body.meta).toMatchObject({ page: 1, total: 1 });

    const updated = await request(app)
      .patch(`/api/v1/admin/branches/${id}`)
      .set(bearer(superAdmin))
      .send({ address: 'Blue Area' });
    expect(updated.body.data.address).toBe('Blue Area');

    const off = await request(app).post(`/api/v1/admin/branches/${id}/deactivate`).set(bearer(superAdmin));
    expect(off.body.data.status).toBe('inactive');

    const actions = await AppDataSource.getRepository(AuditLog).find({ where: { entityId: id } });
    expect(actions.map((a) => a.action).sort()).toEqual(['create', 'deactivate', 'update']);
  });

  it('rejects duplicate codes and a second head office', async () => {
    const dup = await request(app)
      .post('/api/v1/admin/branches')
      .set(bearer(superAdmin))
      .send({ ...newBranch, code: 'LHR' });
    expect(dup.status).toBe(409);

    const head = await request(app)
      .post('/api/v1/admin/branches')
      .set(bearer(superAdmin))
      .send({ ...newBranch, code: 'KHI', isHeadOffice: true });
    expect(head.status).toBe(409);
  });

  it('validates input', async () => {
    const res = await request(app)
      .post('/api/v1/admin/branches')
      .set(bearer(superAdmin))
      .send({ name: 'X', code: 'bad code!', city: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is forbidden for branch admins', async () => {
    expect((await request(app).get('/api/v1/admin/branches').set(bearer(branchAdmin))).status).toBe(403);
    expect(
      (await request(app).post('/api/v1/admin/branches').set(bearer(branchAdmin)).send(newBranch)).status,
    ).toBe(403);
  });

  it('creates the branch admin login and profile in one step', async () => {
    const branch = await createBranch({ code: 'MUL', name: 'Multan' });
    const res = await request(app)
      .post(`/api/v1/admin/branches/${branch.id}/admin`)
      .set(bearer(superAdmin))
      .send(newAdmin);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      role: 'branch_admin',
      branchId: branch.id,
      email: 'bilal@dsm.test',
      username: 'bilal.khan',
      mustChangePassword: true,
    });
    expect(fake.users.get(res.body.data.id)?.email).toBe('bilal@dsm.test');
  });

  it('removes the auth user again when the profile insert fails', async () => {
    const branch = await createBranch({ code: 'FSD' });
    const usersBefore = fake.users.size;
    const spy = jest.spyOn(staffRepository, 'insert').mockRejectedValueOnce(new Error('db down'));

    const res = await request(app)
      .post(`/api/v1/admin/branches/${branch.id}/admin`)
      .set(bearer(superAdmin))
      .send({ ...newAdmin, email: 'rollback@dsm.test', username: 'rollback' });

    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(fake.users.size).toBe(usersBefore);
    expect(
      await AppDataSource.getRepository(StaffProfile).count({ where: { email: 'rollback@dsm.test' } }),
    ).toBe(0);
  });

  it('refuses to delete a branch that still has staff', async () => {
    const branch = await createBranch({ code: 'SKT' });
    await createStaff(fake, { role: 'front_desk', branchId: branch.id });
    const res = await request(app).delete(`/api/v1/admin/branches/${branch.id}`).set(bearer(superAdmin));
    expect(res.status).toBe(409);

    const empty = await createBranch({ code: 'GRW' });
    expect(
      (await request(app).delete(`/api/v1/admin/branches/${empty.id}`).set(bearer(superAdmin))).status,
    ).toBe(204);
    expect(
      (await request(app).get(`/api/v1/admin/branches/${empty.id}`).set(bearer(superAdmin))).status,
    ).toBe(404);
  });
});
