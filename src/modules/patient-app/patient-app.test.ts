import { randomBytes, scryptSync } from 'node:crypto';
import request from 'supertest';
import { today } from '../../lib/validation';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';
import { env } from '../../config/env';

const fake = installFakeSupabase();
const app = createApp();

const isoIn = (days: number) => today(new Date(Date.now() + days * 86_400_000));

describe('patient app', () => {
  let frontDesk: { id: string };
  let doctorUser: { id: string };
  let islamabadAdmin: { id: string };
  let superAdmin: { id: string };
  let patientId: string;
  let otherPatientId: string;
  let pastAppointmentId: string;
  let upcomingAppointmentId: string;
  let prescriptionId: string;
  let otherPrescriptionId: string;
  let session: { accessToken: string; refreshToken: string };

  const staff = (method: 'get' | 'post' | 'patch', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));
  const asPatient = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    token = session.accessToken,
  ) =>
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
    upcomingAppointmentId = await book(patientId, isoIn(20));
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

  it('lets the patient make a password, log in with it and reset it with a clinic code', async () => {
    const passwordLogin = (password: string) =>
      request(app).post('/api/v1/patient/auth/password-login').send({ phone: '03001112233', password });

    expect((await asPatient('get', '/patient/me')).body.data).toMatchObject({ hasPassword: false });
    expect((await passwordLogin('Secret123')).status).toBe(401);
    expect((await asPatient('post', '/patient/me/password').send({ password: '123' })).status).toBe(400);
    expect((await asPatient('post', '/patient/me/password').send({ password: 'Secret123' })).status).toBe(
      204,
    );
    expect((await asPatient('get', '/patient/me')).body.data).toMatchObject({ hasPassword: true });

    expect((await passwordLogin('Wrong999')).status).toBe(401);
    const byPassword = await passwordLogin('Secret123');
    expect(byPassword.status).toBe(200);
    expect(byPassword.body.data).toMatchObject({ accessToken: expect.any(String) });

    expect((await asPatient('post', '/patient/me/password').send({ password: 'Other456' })).status).toBe(400);
    expect(
      (
        await asPatient('post', '/patient/me/password').send({
          currentPassword: 'Secret123',
          password: 'Other456',
        })
      ).status,
    ).toBe(204);
    expect((await passwordLogin('Secret123')).status).toBe(401);
    expect((await passwordLogin('Other456')).status).toBe(200);

    const access = (await staff('get', `/branch/patients/${patientId}/app-access`, frontDesk)).body.data;
    expect(access).toMatchObject({ hasPassword: true, passwordSetAt: expect.any(String) });
    expect(JSON.stringify(access)).not.toMatch(/Other456|scrypt/);

    const { code } = await issueCode(patientId);
    const reset = (password: string, given = code) =>
      request(app)
        .post('/api/v1/patient/auth/reset-password')
        .send({ phone: '03001112233', code: given, password });
    expect((await reset('Fresh789', code === '000000' ? '111111' : '000000')).status).toBe(401);
    const fresh = await reset('Fresh789');
    expect(fresh.status).toBe(200);
    expect((await asPatient('get', '/patient/me')).status).toBe(401);
    expect((await reset('Again000')).status).toBe(401);
    session = fresh.body.data;
    expect((await passwordLogin('Other456')).status).toBe(401);
    expect((await passwordLogin('Fresh789')).status).toBe(200);
    expect((await asPatient('get', '/patient/me')).status).toBe(200);
  });

  it('lets the patient edit the profile and marks it as changed in the app', async () => {
    expect((await asPatient('patch', '/patient/me').send({})).status).toBe(400);
    const edited = await asPatient('patch', '/patient/me').send({
      name: 'Ayesha Khan',
      city: 'Karachi',
      age: 46,
      weightKg: 68.5,
      heightCm: 162,
      phone: '03009999999',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({
      name: 'Ayesha Khan',
      city: 'Karachi',
      age: 46,
      weightKg: 68.5,
      heightCm: 162,
    });
    expect((await asPatient('patch', '/patient/me').send({ weightKg: 900 })).status).toBe(400);
    const seen = (await staff('get', `/branch/patients/${patientId}`, frontDesk)).body.data;
    expect(seen).toMatchObject({
      name: 'Ayesha Khan',
      city: 'Karachi',
      weightKg: '68.5',
      heightCm: '162.0',
      appUpdatedAt: expect.any(String),
    });
    expect(seen.phone).not.toContain('9999999');
    await asPatient('patch', '/patient/me').send({ name: 'Ayesha', city: 'Lahore' });
  });

  it('shows only the patient own data', async () => {
    const me = await asPatient('get', '/patient/me');
    expect(me.body.data).toMatchObject({ id: patientId, name: 'Ayesha', phone: expect.any(String) });

    const overview = await asPatient('get', '/patient/overview');
    expect(overview.body.data.resources).toBeNull();
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
    expect(
      (await asPatient('delete', `/patient/documents/${upload.body.data.id}`, other.accessToken)).status,
    ).toBe(404);
  });

  it('reads an uploaded lab report with AI into the blood work table right after the upload', async () => {
    const saved = {
      provider: env.AI_PROVIDER,
      gemini: env.GEMINI_API_KEY,
      fallback: env.GEMINI_FALLBACK_MODEL,
    };
    env.AI_PROVIDER = 'gemini';
    env.GEMINI_API_KEY = 'test-key';
    env.GEMINI_FALLBACK_MODEL = env.GEMINI_MODEL;
    const answer = (testDate: string | null) =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      testDate,
                      results: [
                        { test: 'fsh', value: '38.4', unit: 'mIU/mL', document: 1 },
                        { test: 'vit_d3', value: '14.2', unit: 'ng/mL', document: 1 },
                      ],
                      summary: {
                        patient: [],
                        abnormal: [
                          { test: 'FSH', value: '38.4', unit: 'mIU/mL', range: '3.5 - 12.5', flag: 'high' },
                        ],
                        normal: [],
                        overview: 'FSH is high.',
                        reviewPoints: [],
                        unreadable: [],
                      },
                      documents: [],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => answer('2026-08-15'));
    try {
      const upload = await asPatient('post', '/patient/documents')
        .field('title', 'Hormones')
        .attach('files', Buffer.from('%PDF-1.4 fsh'), {
          filename: 'hormones.pdf',
          contentType: 'application/pdf',
        });
      expect(upload.status).toBe(201);
      const scan = await asPatient('post', `/patient/documents/${upload.body.data.id}/scan`);
      expect(scan.status).toBe(200);
      expect(scan.body.data).toMatchObject({ scanned: true, saved: 2, dates: ['2026-08-15'] });
      expect(scan.body.data.summaryId).toEqual(expect.any(String));

      const blood = await staff('get', `/branch/patients/${patientId}/blood-work`, frontDesk);
      expect(blood.body.data.dates).toContain('2026-08-15');
      expect(
        blood.body.data.results
          .filter((r: { testDate: string }) => r.testDate === '2026-08-15')
          .map((r: { test: string; value: string }) => [r.test, Number(r.value)]),
      ).toEqual(
        expect.arrayContaining([
          ['fsh', 38.4],
          ['vit_d3', 14.2],
        ]),
      );
      const summaries = await staff('get', `/branch/patients/${patientId}/report-summaries`, frontDesk);
      expect(summaries.body.data[0]).toMatchObject({ fileName: 'hormones.pdf', valuesFound: 2 });

      const { code } = await issueCode(otherPatientId);
      const other = (await loginWith('03004445566', code)).body.data;
      expect(
        (await asPatient('post', `/patient/documents/${upload.body.data.id}/scan`, other.accessToken)).status,
      ).toBe(404);

      const imaging = await asPatient('post', '/patient/documents')
        .field('type', 'imaging')
        .attach('files', Buffer.from('%PDF-1.4'), { filename: 'us.pdf', contentType: 'application/pdf' });
      const skipped = await asPatient('post', `/patient/documents/${imaging.body.data.id}/scan`);
      expect(skipped.body.data).toMatchObject({ scanned: false, saved: 0 });

      fetchMock.mockImplementation(async () => answer(null));
      const byClinic = await staff('post', `/branch/patients/${patientId}/medical-records`, frontDesk)
        .field('data', JSON.stringify({ type: 'medical_record', date: '2026-07-01' }))
        .attach('files', Buffer.from('%PDF-1.4'), { filename: 'old.pdf', contentType: 'application/pdf' });
      const staffScan = await staff(
        'post',
        `/branch/patients/${patientId}/medical-records/${byClinic.body.data.id}/scan`,
        frontDesk,
      ).send({ fileIds: [byClinic.body.data.files[0].id] });
      expect(staffScan.status).toBe(200);
      expect(staffScan.body.data).toMatchObject({ scanned: true, saved: 2, dates: ['2026-07-01'] });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      env.AI_PROVIDER = saved.provider;
      env.GEMINI_API_KEY = saved.gemini;
      env.GEMINI_FALLBACK_MODEL = saved.fallback;
      fetchMock.mockRestore();
    }
  });

  it('keeps imaging apart and lets the patient delete only own uploads', async () => {
    const scan = await asPatient('post', '/patient/documents')
      .field('title', 'Pelvic scan')
      .field('type', 'imaging')
      .attach('files', Buffer.from('%PDF-1.4'), { filename: 'scan.pdf', contentType: 'application/pdf' });
    expect(scan.status).toBe(201);
    expect(scan.body.data).toMatchObject({ type: 'imaging', title: 'Pelvic scan' });

    const byClinic = await staff('post', `/branch/patients/${patientId}/medical-records`, frontDesk)
      .field('data', JSON.stringify({ type: 'medical_record', date: '2026-10-01', note: 'Lab' }))
      .attach('files', Buffer.from('%PDF-1.4'), { filename: 'lab.pdf', contentType: 'application/pdf' });
    expect(byClinic.status).toBe(201);
    expect((await asPatient('delete', `/patient/documents/${byClinic.body.data.id}`)).status).toBe(403);

    const pair = await asPatient('post', '/patient/documents')
      .field('title', 'Two pages')
      .attach('files', Buffer.from('%PDF-1.4'), { filename: 'p1.pdf', contentType: 'application/pdf' })
      .attach('files', Buffer.from('%PDF-1.4'), { filename: 'p2.pdf', contentType: 'application/pdf' });
    const [first, second] = pair.body.data.files as { id: string }[];
    expect(
      (await asPatient('delete', `/patient/documents/files/${byClinic.body.data.files[0].id}`)).status,
    ).toBe(403);
    expect((await asPatient('delete', `/patient/documents/files/${first!.id}`)).status).toBe(204);
    const afterOne = (await asPatient('get', '/patient/documents')).body.data as {
      id: string;
      files: { id: string }[];
    }[];
    expect(afterOne.find((d) => d.id === pair.body.data.id)?.files.map((f) => f.id)).toEqual([second!.id]);
    expect((await asPatient('delete', `/patient/documents/files/${second!.id}`)).status).toBe(204);
    expect(
      ((await asPatient('get', '/patient/documents')).body.data as { id: string }[]).map((d) => d.id),
    ).not.toContain(pair.body.data.id);
    expect((await asPatient('delete', `/patient/documents/files/${second!.id}`)).status).toBe(404);

    expect((await asPatient('delete', `/patient/documents/${scan.body.data.id}`)).status).toBe(204);
    const left = (await asPatient('get', '/patient/documents')).body.data as { id: string }[];
    expect(left.map((d) => d.id)).not.toContain(scan.body.data.id);
    expect(left.map((d) => d.id)).toContain(byClinic.body.data.id);
  });

  it('lets the patient fill the medical history form until the doctor completes the visit', async () => {
    const empty = await asPatient('get', '/patient/intake');
    expect(empty.status).toBe(200);
    expect(empty.body.data).toMatchObject({
      editable: true,
      appointment: { id: upcomingAppointmentId },
      defaults: { name: 'Ayesha', city: 'Lahore' },
      sections: { basic_info: null, medical_history: null, additional_symptoms: null },
    });

    const basic = await asPatient('put', '/patient/intake/basic_info').send({
      name: 'Ayesha',
      age: 48,
      city: 'Lahore',
      country: 'Pakistan',
      weightKg: 70,
      heightFeet: 5.4,
      maritalStatus: 'married',
      marriedYears: '20',
      hasKids: 'yes',
      kidsDetails: '2',
    });
    expect(basic.status).toBe(200);
    expect(basic.body.data.sections.basic_info).toMatchObject({
      weightKg: 70,
      heightFeet: 5.4,
      hasKids: 'yes',
    });

    const consultation = await staff(
      'get',
      `/branch/appointments/${upcomingAppointmentId}/consultation`,
      doctorUser,
    );
    const consultationId = consultation.body.data.id as string;
    const doctorSave = await request(app)
      .put(`/api/v1/branch/consultations/${consultationId}/sections/medical_history`)
      .set(bearer(doctorUser))
      .send({
        conditions: ['std'],
        surgeries: [{ type: 'c_section', year: 2015 }],
        majorComplaint: 'Flushes',
      });
    expect(doctorSave.status).toBe(200);

    const history = await asPatient('put', '/patient/intake/medical_history').send({
      majorComplaint: 'Hot flushes and poor sleep',
      currentMedications: 'None',
      menopauseDiagnosed: 'no',
      conditions: ['hypothyroidism', 'no_cancer', 'std'],
      surgeries: [],
      clinicalNote: 'ignored',
    });
    expect(history.status).toBe(200);
    const saved = history.body.data.sections.medical_history;
    expect(saved.majorComplaint).toBe('Hot flushes and poor sleep');
    expect([...saved.conditions].sort()).toEqual(['hypothyroidism', 'no_cancer', 'std']);
    expect(saved.surgeries).toEqual([{ type: 'c_section', date: null, year: 2015 }]);
    expect(saved).not.toHaveProperty('clinicalNote');

    const symptoms = await asPatient('put', '/patient/intake/additional_symptoms').send({
      symptoms: ['hair_loss', 'headaches'],
    });
    expect(symptoms.body.data.sections.additional_symptoms.symptoms).toEqual(['hair_loss', 'headaches']);

    const seen = await staff('get', `/branch/consultations/${consultationId}`, doctorUser);
    expect(seen.body.data.sections.medical_history.data.majorComplaint).toBe('Hot flushes and poor sleep');
    expect((await asPatient('put', '/patient/intake/plans').send({})).status).toBe(400);

    await staff('post', `/branch/consultations/${consultationId}/status`, doctorUser)
      .send({ status: 'completed' })
      .expect(200);
    const after = await asPatient('get', '/patient/intake');
    expect(after.body.data).toMatchObject({ editable: true, appointment: { id: pastAppointmentId } });
    const pastConsultation = await staff(
      'get',
      `/branch/appointments/${pastAppointmentId}/consultation`,
      doctorUser,
    );
    await staff('post', `/branch/consultations/${pastConsultation.body.data.id}/status`, doctorUser)
      .send({ status: 'completed' })
      .expect(200);
    const done = await asPatient('get', '/patient/intake');
    expect(done.body.data).toMatchObject({ editable: false, appointment: { id: upcomingAppointmentId } });
    expect(done.body.data.sections.medical_history.majorComplaint).toBe('Hot flushes and poor sleep');
    const locked = await asPatient('put', '/patient/intake/basic_info').send({ name: 'Changed' });
    expect(locked.status).toBe(409);
    expect((await asPatient('get', '/patient/medicines')).body.data).toEqual([
      expect.objectContaining({
        prescriptionId,
        items: [expect.objectContaining({ name: 'Vitamin D', category: 'skin_care', dose: '1 daily' })],
      }),
    ]);
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

  it('revokes the session when an old refresh token is replayed after the grace period', async () => {
    const first = (await loginWith('03001112233', (await issueCode(patientId)).code)).body.data;
    const refresh = (token: string) =>
      request(app).post('/api/v1/patient/auth/refresh').send({ refreshToken: token });
    const second = await refresh(first.refreshToken);
    expect(second.status).toBe(200);
    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await asPatient('get', '/patient/me', second.body.data.accessToken)).status).toBe(200);

    await AppDataSource.query(
      `UPDATE patient_sessions SET rotated_at = now() - interval '5 minutes' WHERE refresh_hash IS NOT NULL`,
    );
    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await refresh(second.body.data.refreshToken)).status).toBe(401);
    expect((await asPatient('get', '/patient/me', second.body.data.accessToken)).status).toBe(401);
  });

  it('logs the other phones out when the patient changes the password, and keeps old hashes working', async () => {
    const salt = randomBytes(16);
    const key = scryptSync('ShortForm123', salt, 64);
    await AppDataSource.query(`UPDATE patient_accounts SET password_hash = $2 WHERE patient_id = $1`, [
      patientId,
      `scrypt$${salt.toString('base64')}$${key.toString('base64')}`,
    ]);
    const passwordLogin = () =>
      request(app)
        .post('/api/v1/patient/auth/password-login')
        .send({ phone: '03001112233', password: 'ShortForm123' });
    expect((await passwordLogin()).status).toBe(200);
    const [stored] = (await AppDataSource.query(
      `SELECT password_hash AS "upgraded" FROM patient_accounts WHERE patient_id = $1`,
      [patientId],
    )) as { upgraded: string }[];
    expect(stored?.upgraded.split('$')).toHaveLength(6);
    const phoneA = (await passwordLogin()).body.data;
    const phoneB = (await passwordLogin()).body.data;
    expect(phoneB.accessToken).toEqual(expect.any(String));

    const changed = await asPatient('post', '/patient/me/password', phoneA.accessToken).send({
      currentPassword: 'ShortForm123',
      password: 'NewSecret789',
    });
    expect(changed.status).toBe(204);
    expect((await asPatient('get', '/patient/me', phoneB.accessToken)).status).toBe(401);
    expect((await asPatient('get', '/patient/me', phoneA.accessToken)).status).toBe(200);
  });
});
