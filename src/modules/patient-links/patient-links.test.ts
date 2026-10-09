import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

describe('patient history links', () => {
  let admin: { id: string };
  let pharmacy: { id: string };
  let islamabadAdmin: { id: string };
  let appointmentId: string;
  let patientId: string;

  const api = (path: string, who?: { id: string }) => {
    const req = request(app).get(`/api/v1${path}`);
    return who ? req.set(bearer(who)) : req;
  };

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR' });
    const islamabad = await createBranch({ code: 'ISB' });
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    pharmacy = await createStaff(fake, { role: 'pharmacy', branchId: lahore.id });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });
    const doctorUser = await createStaff(fake, { role: 'doctor', branchId: lahore.id });
    const doctorId = (
      await request(app)
        .post('/api/v1/branch/doctors')
        .set(bearer(admin))
        .send({ staffId: doctorUser.id, displayName: 'Dr. Shawana' })
    ).body.data.id;
    patientId = (
      await request(app)
        .post('/api/v1/branch/patients')
        .set(bearer(admin))
        .send({ name: 'Ayesha', phone: '923001234567', city: 'Lahore' })
    ).body.data.id;
    appointmentId = (
      await request(app).post('/api/v1/branch/appointments').set(bearer(admin)).send({
        patientId,
        doctorId,
        date: '2026-10-05',
        timeFrom: '10:00',
        timeTo: '10:30',
        mode: 'physical',
        visitType: 'new',
      })
    ).body.data.id;
    await request(app)
      .post(`/api/v1/branch/patients/${patientId}/bhrt`)
      .set(bearer(doctorUser))
      .send({ status: 'on', date: '2026-10-05', note: 'Started', appointmentId });
  });

  it('creates a signed link that opens the history without login', async () => {
    const link = await api(`/branch/appointments/${appointmentId}/patient-link`, admin);
    expect(link.status).toBe(200);
    expect(link.body.data.token).toContain('.');
    expect(new Date(link.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const history = await api(`/public/patient-history/${link.body.data.token}`);
    expect(history.status).toBe(200);
    expect(history.headers['cache-control']).toBe('no-store');
    expect(history.body.data.patient).toEqual({ name: 'Ayesha', city: 'Lahore' });
    expect(history.body.data.appointments).toEqual([
      expect.objectContaining({ appointmentNo: 1, doctor: 'Dr. Shawana', status: 'booked' }),
    ]);
    expect(history.body.data.bhrt).toEqual([{ date: '2026-10-05', status: 'on', note: 'Started' }]);
    expect(JSON.stringify(history.body.data)).not.toContain(patientId);
  });

  it('lets the patient fill the intake form and shows the ticked resources', async () => {
    const { token } = (await api(`/branch/appointments/${appointmentId}/patient-link`, admin)).body.data;
    const empty = await api(`/public/patient-history/${token}`);
    expect(empty.body.data.form).toMatchObject({
      appointmentNo: 1,
      defaults: { name: 'Ayesha', city: 'Lahore' },
      sections: { basic_info: null },
    });
    expect(empty.body.data.resources).toEqual([]);

    const bad = await request(app)
      .put(`/api/v1/public/patient-history/${token}/sections/basic_info`)
      .send({ name: 'Ayesha' });
    expect(bad.status).toBe(400);
    const saved = await request(app).put(`/api/v1/public/patient-history/${token}/sections/basic_info`).send({
      name: 'Ayesha Khan',
      age: 41,
      city: 'Lahore',
      country: 'Pakistan',
      weightKg: '68',
      heightFeet: '5.4',
      maritalStatus: 'single',
    });
    expect(saved.status).toBe(200);
    expect(
      (await request(app).put(`/api/v1/public/patient-history/${token}/sections/plans`).send({})).status,
    ).toBe(400);

    const consultation = await api(`/branch/appointments/${appointmentId}/consultation`, admin);
    expect(consultation.body.data.sections.basic_info.data).toMatchObject({ name: 'Ayesha Khan', age: 41 });
    await request(app)
      .put(`/api/v1/branch/consultations/${consultation.body.data.id}/sections/plans`)
      .set(bearer(admin))
      .send({ glpDietPlan: 'yes', hairCareRoutine: 'yes', liverDetox: 'no' });

    const after = await api(`/public/patient-history/${token}`);
    expect(after.body.data.form.sections.basic_info).toMatchObject({ weightKg: expect.anything() });
    expect(after.body.data.resources).toEqual(['glpDietPlan', 'hairCareRoutine']);
  });

  it('rejects tampered tokens and unknown files', async () => {
    const { token } = (await api(`/branch/appointments/${appointmentId}/patient-link`, admin)).body.data;
    const [body, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        kind: 'patient-history',
        patientId: '00000000-0000-4000-8000-000000000000',
        exp: 9e9,
      }),
    ).toString('base64url');
    expect((await api(`/public/patient-history/${forged}.${signature}`)).status).toBe(404);
    expect((await api(`/public/patient-history/${body}.x${signature.slice(1)}`)).status).toBe(404);
    expect((await api(`/public/patient-history/not-a-token-at-all`)).status).toBe(404);
    expect(
      (await api(`/public/patient-history/${token}/files/00000000-0000-4000-8000-000000000000`)).status,
    ).toBe(404);
  });

  it('only lets staff with clinical access in the same branch create links', async () => {
    expect((await api(`/branch/appointments/${appointmentId}/patient-link`)).status).toBe(401);
    expect((await api(`/branch/appointments/${appointmentId}/patient-link`, pharmacy)).status).toBe(403);
    expect((await api(`/branch/appointments/${appointmentId}/patient-link`, islamabadAdmin)).status).toBe(
      404,
    );
  });
});
