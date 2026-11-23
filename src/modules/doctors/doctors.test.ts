import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

describe('doctors list across branches', () => {
  let owner: { id: string };
  let lahoreAdmin: { id: string };
  let lahoreId: string;
  let islamabadId: string;

  const api = (method: 'get' | 'post', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR' });
    const islamabad = await createBranch({ code: 'ISB' });
    lahoreId = lahore.id;
    islamabadId = islamabad.id;
    owner = await createStaff(fake, { role: 'super_admin', branchId: null });
    lahoreAdmin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    const lahoreDoc = await createStaff(fake, { role: 'doctor', branchId: lahore.id });
    const islamabadDoc = await createStaff(fake, { role: 'doctor', branchId: islamabad.id });
    await api('post', `/branch/doctors?branchId=${lahore.id}`, owner).send({
      staffId: lahoreDoc.id,
      displayName: 'Dr Lahore',
    });
    await api('post', `/branch/doctors?branchId=${islamabad.id}`, owner).send({
      staffId: islamabadDoc.id,
      displayName: 'Dr Islamabad',
    });
  });

  it('shows the super admin every doctor with its branch when no branch is selected', async () => {
    const res = await api('get', '/branch/doctors', owner);
    expect(res.status).toBe(200);
    const rows = (res.body.data as { displayName: string; branch: { code: string } | null }[])
      .map((d) => ({ name: d.displayName, code: d.branch?.code }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(rows).toEqual([
      { name: 'Dr Islamabad', code: 'ISB' },
      { name: 'Dr Lahore', code: 'LHR' },
    ]);
  });

  it('filters to one branch for the super admin when a branch is selected', async () => {
    const res = await api('get', `/branch/doctors?branchId=${lahoreId}`, owner);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ displayName: 'Dr Lahore', branch: { code: 'LHR' } });
  });

  it('shows a branch admin only their own branch doctors', async () => {
    const res = await api('get', '/branch/doctors', lahoreAdmin);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].displayName).toBe('Dr Lahore');
    const other = await api('get', `/branch/doctors?branchId=${islamabadId}`, lahoreAdmin);
    expect(other.status).toBe(403);
  });
});
