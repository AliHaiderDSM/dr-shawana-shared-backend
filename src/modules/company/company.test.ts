import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

describe('company info', () => {
  let superAdmin: { id: string };
  let branchAdmin: { id: string };

  beforeAll(async () => {
    const branch = await createBranch();
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
    branchAdmin = await createStaff(fake, { role: 'branch_admin', branchId: branch.id });
  });

  it('is null until set, then keeps a single row', async () => {
    const empty = await request(app).get('/api/v1/admin/company-info').set(bearer(superAdmin));
    expect(empty.status).toBe(200);
    expect(empty.body.data).toBeNull();

    const first = await request(app)
      .put('/api/v1/admin/company-info')
      .set(bearer(superAdmin))
      .send({ name: 'Dr Shawana Mufti DSM', phone: '03284905049' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .put('/api/v1/admin/company-info')
      .set(bearer(superAdmin))
      .send({ name: 'DSM Clinics', email: 'info@drshawanamufti.com' });
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data).toMatchObject({ name: 'DSM Clinics', email: 'info@drshawanamufti.com' });
  });

  it('is forbidden for branch admins', async () => {
    expect((await request(app).get('/api/v1/admin/company-info').set(bearer(branchAdmin))).status).toBe(403);
  });
});
