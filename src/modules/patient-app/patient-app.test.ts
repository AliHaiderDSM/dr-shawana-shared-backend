import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('patient app', () => {
  let frontDesk: { id: string };
  let doctorUser: { id: string };
  let islamabadAdmin: { id: string };
  let superAdmin: { id: string };
  let patientId: string;
  let otherPatientId: string;
  let pastAppointmentId: string;
  let prescriptionId: string;
  let otherPrescriptionId: string;
  let session: { accessToken: string; refreshToken: string };

  const staff = (method: 'get' | 'post' | 'patch', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));
  const asPatient = (method: 'get' | 'post' | 'patch', path: string, token = session.accessToken) =>
    request(app)
      [method](`/api/v1${path}`)
      .set({ Authorization: `Bearer ${token}` });
  const loginWith = (phone: string, code: string) =>
    request(app).post('/api/v1/patient/auth/login').send({ phone, code });
  const issueCode = async (id: string) =>
    (await staff('post', `/branch/patients/${id}/app-access/code`, frontDesk)).body.data as {
      code: string;
      expiresAt: string;
    };

  beforeAll(async () => {
    const lahoreId = (await createBranch({ code: 'LHP' })).id;
    const islamabadId = (await createBranch({ code: 'ISP' })).id;
    const admin = await createStaff(fake, { role: 'branch_admin', branchId: lahoreId });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
    doctorUser = await createStaff(fake, { role: 'doctor', branchId: lahoreId });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabadId });
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
    const doctorId = (
      await staff('post', '/branch/doctors', admin).send({
        staffId: doctorUser.id,
        displayName: 'Dr. Shawana',
      })
    ).body.data.id;
    const addPatient = async (name: string, phone: string) =>
      (await staff('post', '/branch/patients', frontDesk).send({ name, phone, city: 'Lahore' })).body.data.id;
    patientId = await addPatient('Ayesha', '923001112233');
    otherPatientId = await addPatient('Sara', '923004445566');
    const book = async (who: string, date: string) =>
      (
        await staff('post', '/branch/appointments', frontDesk).send({
          patientId: who,
          doctorId,
          date,
          timeFrom: '10:00',
          timeTo: '10:30',
          mode: 'physical',
          visitType: 'new',
        })
      ).body.data.id;
    pastAppointmentId = await book(patientId, '2026-09-01');
    await book(patientId, isoIn(20));
    const otherAppointment = await book(otherPatientId, '2026-09-02');
    const prescribe = async (appointmentId: string) => {
      const consultationId = (
        await staff('post', `/branch/appointments/${appointmentId}/consultation`, doctorUser)
      ).body.data.id;
      return (
        await staff('post', '/branch/prescriptions', doctorUser).send({
          consultationId,
          date: '2026-09-01',
          diagnosis: 'Perimenopause',
          notes: { blood: 'Internal note' },
          planTreatment: '<p>Start BHRT</p>',
          items: [{ name: 'Vitamin D', category: 'skin_care', dose: '1 daily' }],
        })
      ).body.data.id;
    };
    prescriptionId = await prescribe(pastAppointmentId);
    otherPrescriptionId = await prescribe(otherAppointment);
  });

  it('logs the patient in with the phone number and a one-time code from the clinic', async () => {
    expect((await staff('get', `/branch/patients/${patientId}/app-access`, frontDesk)).body.data.status).toBe(
      'not_invited',
    );
    expect((await loginWith('03001112233', '123456')).status).toBe(401);

    const { code } = await issueCode(patientId);
    expect(code).toMatch(/^\d{6}$/);
    expect((await staff('get', `/branch/patients/${patientId}/app-access`, frontDesk)).body.data.status).toBe(
      'invited',
    );

    expect((await loginWith('03001112233', code === '000000' ? '111111' : '000000')).status).toBe(401);
    expect((await loginWith('03004445566', code)).status).toBe(401);
    const withPassword = await request(app)
      .post('/api/v1/patient/auth/login')
      .send({ phone: '03001112233', password: 'abc12345' });
    expect(withPassword.status).toBe(400);
    expect((await request(app).post('/api/v1/patient/auth/activate').send({})).status).toBe(404);

    const ok = await request(app)
      .post('/api/v1/patient/auth/login')
      .send({ phone: '+92 300 1112233', code, device: 'Pixel' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
    session = ok.body.data;
    expect((await loginWith('03001112233', code)).status).toBe(401);
    expect((await staff('get', `/branch/patients/${patientId}/app-access`, frontDesk)).body.data.status).toBe(
      'active',
    );
  });

  it('keeps patient and staff tokens apart', async () => {
    expect((await asPatient('get', '/patient/me')).status).toBe(200);
    expect((await request(app).get('/api/v1/patient/me').set(bearer(frontDesk))).status).toBe(401);
    expect((await request(app).get('/api/v1/patient/me')).status).toBe(401);
    expect((await asPatient('get', `/branch/patients/${patientId}`)).status).toBe(401);
  });

  it('shows only the patient own data', async () => {
    const me = await asPatient('get', '/patient/me');
    expect(me.body.data).toMatchObject({ id: patientId, name: 'Ayesha', phone: expect.any(String) });

    const overview = await asPatient('get', '/patient/overview');
    expect(overview.body.data.nextAppointment).toMatchObject({
      upcoming: true,
      doctor: { name: 'Dr. Shawana' },
    });
    expect(overview.body.data.latestPrescription).toMatchObject({
      id: prescriptionId,
      diagnosis: 'Perimenopause',
    });

    const appointments = await asPatient('get', '/patient/appointments');
    expect(appointments.body.data).toHaveLength(2);
    expect(appointments.body.data[0].branch).toMatchObject({ name: expect.any(String) });

    const visit = await asPatient('get', `/patient/appointments/${pastAppointmentId}`);
    expect(visit.body.data.prescriptions).toEqual([expect.objectContaining({ id: prescriptionId })]);

    const history = await asPatient('get', '/patient/history');
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].prescriptions[0].id).toBe(prescriptionId);

    const rx = await asPatient('get', `/patient/prescriptions/${prescriptionId}`);
    expect(rx.body.data).toMatchObject({ appointmentId: pastAppointmentId, items: [{ name: 'Vitamin D' }] });
    expect(rx.body.data.notes).toBeUndefined();

    expect((await asPatient('get', `/patient/prescriptions/${otherPrescriptionId}`)).status).toBe(404);
    expect((await asPatient('get', '/patient/prescriptions')).body.data).toHaveLength(1);
  });

  it('uploads documents to the medical records and opens only own files', async () => {
    const upload = await asPatient('post', '/patient/documents')
      .field('title', 'Blood test')
      .attach('files', Buffer.from('%PDF-1.4'), { filename: 'cbc.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    expect(upload.body.data).toMatchObject({ title: 'Blood test', uploadedByPatient: true });
    const fileId = upload.body.data.files[0].id;
    expect((await asPatient('get', `/patient/documents/files/${fileId}/url`)).status).toBe(200);

    const records = await staff('get', `/branch/patients/${patientId}/medical-records`, frontDesk);
    expect(records.body.data[0]).toMatchObject({ uploadedByPatient: true, note: 'Blood test' });

    const bad = await asPatient('post', '/patient/documents').attach('files', Buffer.from('x'), {
      filename: 'a.exe',
      contentType: 'application/x-msdownload',
    });
    expect(bad.status).toBe(400);

    const { code } = await issueCode(otherPatientId);
    const other = (await loginWith('03004445566', code)).body.data;
    expect((await asPatient('get', `/patient/documents/files/${fileId}/url`, other.accessToken)).status).toBe(
      404,
    );
  });

  it('sends requests to management and shows their replies', async () => {
    const created = await asPatient('post', '/patient/requests').send({
      category: 'appointment',
      subject: 'Change my visit',
      message: 'Please move my next visit to Friday.',
      patientId: 'ignored',
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      status: 'submitted',
      requestNo: expect.stringMatching(/-PR-000001$/),
    });
    const id = created.body.data.id;

    const list = await staff('get', '/branch/patient-requests?status=open', frontDesk);
    expect(list.body.data).toEqual([
      expect.objectContaining({ id, patient: expect.objectContaining({ id: patientId }) }),
    ]);
    expect((await staff('get', '/branch/patient-requests', islamabadAdmin)).body.data).toEqual([]);
    expect((await staff('get', '/branch/badges', frontDesk)).body.data.patientRequests).toBe(1);
    expect((await staff('get', '/branch/patient-requests', superAdmin)).body.data).toHaveLength(1);

    const replied = await staff('patch', `/branch/patient-requests/${id}`, frontDesk).send({
      status: 'resolved',
      reply: 'Moved to Friday 11am.',
    });
    expect(replied.status).toBe(200);
    expect(replied.body.data.history).toHaveLength(2);

    const seen = await asPatient('get', `/patient/requests/${id}`);
    expect(seen.body.data).toMatchObject({ status: 'resolved', reply: 'Moved to Friday 11am.' });
    expect(seen.body.data.history.map((h: { status: string }) => h.status)).toEqual([
      'submitted',
      'resolved',
    ]);

    const invalid = await asPatient('post', '/patient/requests').send({
      category: 'x',
      subject: '',
      message: '',
    });
    expect(invalid.status).toBe(400);
  });

  it('rotates refresh tokens, logs out and honours disabled access', async () => {
    const refreshed = await request(app)
      .post('/api/v1/patient/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(200);
    const again = await request(app)
      .post('/api/v1/patient/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(again.status).toBe(401);
    session = refreshed.body.data;

    expect((await asPatient('post', '/patient/auth/logout')).status).toBe(204);
    expect((await asPatient('get', '/patient/me')).status).toBe(401);

    session = (await loginWith('03001112233', (await issueCode(patientId)).code)).body.data;
    expect(session.accessToken).toEqual(expect.any(String));
    const disabled = await staff('post', `/branch/patients/${patientId}/app-access/disable`, frontDesk);
    expect(disabled.body.data.status).toBe('disabled');
    expect((await asPatient('get', '/patient/me')).status).toBe(401);
    const old = await issueCode(patientId);
    await staff('post', `/branch/patients/${patientId}/app-access/disable`, frontDesk);
    expect((await loginWith('03001112233', old.code)).status).toBe(401);
    const fresh = await issueCode(patientId);
    expect((await loginWith('03001112233', fresh.code)).status).toBe(200);
    expect((await staff('get', `/branch/patients/${patientId}/app-access`, frontDesk)).body.data.status).toBe(
      'active',
    );
  });

  it('stops a code after five wrong tries', async () => {
    const { code } = await issueCode(patientId);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) expect((await loginWith('03001112233', wrong)).status).toBe(401);
    expect((await loginWith('03001112233', code)).status).toBe(401);
  });
});
