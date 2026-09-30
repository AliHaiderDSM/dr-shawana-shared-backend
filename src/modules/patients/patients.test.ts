import request from 'supertest';
import { bearer, createBranch, createStaff, TEST_PASSWORD } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { normalizePhone } from './phone';

const fake = installFakeSupabase();
const app = createApp();

describe('phone normalisation', () => {
  it('turns local and international formats into +92 with the last 9 digits as the key', () => {
    expect(normalizePhone('923001234567')).toEqual({ normalized: '+923001234567', last9: '001234567' });
    expect(normalizePhone('0300-1234567')).toEqual({ normalized: '+923001234567', last9: '001234567' });
    expect(normalizePhone('3001234567')).toEqual({ normalized: '+923001234567', last9: '001234567' });
    expect(normalizePhone('+92 300 1234567')).toEqual({ normalized: '+923001234567', last9: '001234567' });
    expect(normalizePhone('00971501234567')).toEqual({ normalized: '+971501234567', last9: '501234567' });
    expect(normalizePhone('12345')).toBeNull();
  });
});

describe('patients and doctors', () => {
  let admin: { id: string };
  let frontDesk: { id: string };
  let accountant: { id: string };
  let pharmacy: { id: string };
  let islamabadAdmin: { id: string };
  let patientId: string;
  let lahoreId: string;

  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR' });
    lahoreId = lahore.id;
    const islamabad = await createBranch({ code: 'ISB' });
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahore.id });
    accountant = await createStaff(fake, { role: 'accountant', branchId: lahore.id });
    pharmacy = await createStaff(fake, { role: 'pharmacy', branchId: lahore.id });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });
  });

  describe('patients', () => {
    it('creates a patient with a normalised phone', async () => {
      const res = await api('post', '/branch/patients', frontDesk).send({
        name: 'Ayesha Khan',
        phone: '923001234567',
        city: 'Lahore',
        age: '42',
        country: 'Pakistan',
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        phone: '923001234567',
        phoneNormalized: '+923001234567',
        age: 42,
        bhrtStatus: 'none',
        createdBy: frontDesk.id,
      });
      expect(res.body.data).not.toHaveProperty('phoneLast9');
      patientId = res.body.data.id;
    });

    it('rejects the same last 9 digits, as posSoft did', async () => {
      const res = await api('post', '/branch/patients', frontDesk).send({
        name: 'Duplicate',
        phone: '0300-1234567',
        city: 'Lahore',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.details.patient).toMatchObject({ id: patientId, name: 'Ayesha Khan' });

      const check = await api('get', '/branch/patients/check-phone?phone=03001234567', frontDesk);
      expect(check.body.data).toMatchObject({ exists: true, patient: { id: patientId } });
      const self = await api(
        'get',
        `/branch/patients/check-phone?phone=03001234567&excludeId=${patientId}`,
        frontDesk,
      );
      expect(self.body.data).toEqual({ exists: false, patient: null });
    });

    it('validates the input', async () => {
      const res = await api('post', '/branch/patients', frontDesk).send({ name: '', phone: '123', city: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
        expect.arrayContaining(['body.name', 'body.phone', 'body.city']),
      );
    });

    it('lists branch patients, and finds other branches only by search', async () => {
      const own = await api('get', '/branch/patients', admin);
      expect(own.body.data.map((p: { id: string }) => p.id)).toEqual([patientId]);

      const other = await api('get', '/branch/patients', islamabadAdmin);
      expect(other.body.data).toEqual([]);
      const searched = await api('get', '/branch/patients?search=0300%201234567', islamabadAdmin);
      expect(searched.body.data.map((p: { id: string }) => p.id)).toEqual([patientId]);

      const byName = await api('get', '/branch/patients/options?search=ayesha', islamabadAdmin);
      expect(byName.body.data).toEqual([
        { id: patientId, name: 'Ayesha Khan', phone: '923001234567', city: 'Lahore' },
      ]);
    });

    it('suggests cities', async () => {
      const res = await api('get', '/branch/patients/cities?search=lah', frontDesk);
      expect(res.body.data).toEqual(['Lahore']);
    });

    it('applies posSoft permissions', async () => {
      expect(
        (await api('patch', `/branch/patients/${patientId}`, frontDesk).send({ city: 'Kasur' })).status,
      ).toBe(200);
      expect(
        (await api('patch', `/branch/patients/${patientId}`, accountant).send({ city: 'X' })).status,
      ).toBe(403);
      expect((await api('get', '/branch/patients', pharmacy)).status).toBe(403);
      expect((await api('delete', `/branch/patients/${patientId}`, accountant)).status).toBe(403);
    });

    it('rejects a phone change that collides with another patient', async () => {
      const other = await api('post', '/branch/patients', frontDesk).send({
        name: 'Sara',
        phone: '923211112222',
        city: 'Lahore',
      });
      const res = await api('patch', `/branch/patients/${other.body.data.id}`, frontDesk).send({
        phone: '+92 300 1234567',
      });
      expect(res.status).toBe(409);
      expect((await api('delete', `/branch/patients/${other.body.data.id}`, frontDesk)).status).toBe(204);
      expect((await api('get', `/branch/patients/${other.body.data.id}`, frontDesk)).status).toBe(404);
    });
  });

  describe('doctors', () => {
    let doctorId: string;
    let doctorLogin: { id: string };

    it('creates the doctor and its login in one step, as posSoft did', async () => {
      const res = await api('post', '/branch/doctors', admin).send({
        consultationFee: '3000',
        details: 'MBBS, FCPS',
        account: {
          firstName: 'Shawana',
          lastName: 'Mufti',
          email: 'dr.shawana@test.dsm',
          username: 'drshawana',
          password: TEST_PASSWORD,
          phone: '923009998888',
          gender: 'female',
        },
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        displayName: 'Shawana Mufti',
        phone: '923009998888',
        email: 'dr.shawana@test.dsm',
        consultationFee: '3000.00',
        status: 'active',
        staff: { username: 'drshawana', status: 'active' },
      });
      doctorId = res.body.data.id;
      doctorLogin = { id: res.body.data.staffId };

      const me = await request(app).get('/api/v1/auth/me').set(bearer(doctorLogin));
      expect(me.body.data.role).toBe('doctor');
      const profile = await api('get', '/branch/doctors/me', doctorLogin);
      expect(profile.body.data.id).toBe(doctorId);
    });

    it('links an existing doctor-role staff member only once', async () => {
      const staff = await createStaff(fake, { role: 'doctor', branchId: lahoreId });
      const linked = await api('post', '/branch/doctors', admin).send({
        staffId: staff.id,
        displayName: 'Dr. Ali',
      });
      expect(linked.status).toBe(201);
      const again = await api('post', '/branch/doctors', admin).send({ staffId: staff.id });
      expect(again.status).toBe(409);
      const notDoctor = await api('post', '/branch/doctors', admin).send({ staffId: frontDesk.id });
      expect(notDoctor.status).toBe(400);
      const both = await api('post', '/branch/doctors', admin).send({ staffId: staff.id, account: {} });
      expect(both.status).toBe(400);

      await api('patch', `/branch/doctors/${linked.body.data.id}`, admin).send({ status: 'inactive' });
      const options = await api('get', '/branch/doctors/options', frontDesk);
      expect(options.status).toBe(200);
      expect(options.body.data.map((d: { id: string }) => d.id)).toEqual([doctorId]);
    });

    it('keeps doctor management to the branch admin', async () => {
      expect((await api('get', '/branch/doctors', frontDesk)).status).toBe(403);
      expect((await api('post', '/branch/doctors', frontDesk).send({ staffId: frontDesk.id })).status).toBe(
        403,
      );
      const accountantAccount = await api('post', '/branch/doctors', accountant).send({
        account: {
          firstName: 'A',
          lastName: 'B',
          email: 'x@test.dsm',
          username: 'xdoc',
          password: TEST_PASSWORD,
        },
      });
      expect(accountantAccount.status).toBe(403);
      expect((await api('get', `/branch/doctors/${doctorId}`, islamabadAdmin)).status).toBe(404);
      expect(
        (await api('patch', `/branch/doctors/${doctorId}`, islamabadAdmin).send({ phone: '1' })).status,
      ).toBe(404);
    });
  });
});
