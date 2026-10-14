import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';

const fake = installFakeSupabase();
const app = createApp();

describe('patient and doctor chat', () => {
  let admin: { id: string };
  let frontDesk: { id: string };
  let doctorUser: { id: string };
  let otherDoctorUser: { id: string };
  let doctorId: string;
  let otherDoctorId: string;
  let patientId: string;
  let token: string;
  let conversationId: string;

  const staff = (method: 'get' | 'post', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));
  const patient = (method: 'get' | 'post', path: string) =>
    request(app)
      [method](`/api/v1${path}`)
      .set({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const branchId = (await createBranch({ code: 'LHC' })).id;
    admin = await createStaff(fake, { role: 'branch_admin', branchId });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId });
    doctorUser = await createStaff(fake, { role: 'doctor', branchId });
    otherDoctorUser = await createStaff(fake, { role: 'doctor', branchId });
    doctorId = (
      await staff('post', '/branch/doctors', admin).send({
        staffId: doctorUser.id,
        displayName: 'Dr. Shawana',
      })
    ).body.data.id;
    otherDoctorId = (
      await staff('post', '/branch/doctors', admin).send({
        staffId: otherDoctorUser.id,
        displayName: 'Dr. Other',
      })
    ).body.data.id;
    patientId = (
      await staff('post', '/branch/patients', frontDesk).send({
        name: 'Hina',
        phone: '923005550001',
        city: 'Lahore',
      })
    ).body.data.id;
    await staff('post', '/branch/appointments', frontDesk).send({
      patientId,
      doctorId,
      date: '2026-09-01',
      timeFrom: '10:00',
      timeTo: '10:30',
      mode: 'physical',
      visitType: 'new',
    });
    const { code } = (await staff('post', `/branch/patients/${patientId}/app-access/code`, frontDesk)).body
      .data;
    token = (await request(app).post('/api/v1/patient/auth/login').send({ phone: '03005550001', code })).body
      .data.accessToken;
  });

  it('lists only the doctors the patient has seen and refuses others', async () => {
    const doctors = await patient('get', '/patient/chats');
    expect(doctors.status).toBe(200);
    expect(doctors.body.data).toEqual([
      expect.objectContaining({ doctorId, name: 'Dr. Shawana', unread: 0, lastMessage: null }),
    ]);
    expect(
      (await patient('post', `/patient/chats/${otherDoctorId}/messages`).send({ body: 'Hi' })).status,
    ).toBe(404);
    expect((await patient('get', `/patient/chats/${otherDoctorId}/messages`)).status).toBe(404);
  });

  it('lets the patient write and attach a report', async () => {
    expect((await patient('post', `/patient/chats/${doctorId}/messages`).send({ body: '  ' })).status).toBe(
      400,
    );
    const text = await patient('post', `/patient/chats/${doctorId}/messages`).send({
      body: 'My hot flushes are better',
    });
    expect(text.status).toBe(201);
    expect(text.body.data).toMatchObject({
      sender: 'patient',
      body: 'My hot flushes are better',
      file: null,
    });
    const withFile = await patient('post', `/patient/chats/${doctorId}/messages`)
      .field('body', 'New report')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'tsh.pdf', contentType: 'application/pdf' });
    expect(withFile.status).toBe(201);
    expect(withFile.body.data.file).toEqual({ name: 'tsh.pdf', type: 'application/pdf', size: 8 });
    const url = await patient('get', `/patient/chats/${doctorId}/messages/${withFile.body.data.id}/file`);
    expect(url.status).toBe(200);
  });

  it('shows the messages to that doctor only, and only a doctor can open them', async () => {
    for (const who of [admin, frontDesk]) {
      expect((await staff('get', '/branch/chats', who)).status).toBe(403);
    }
    expect((await staff('get', '/branch/chats', otherDoctorUser)).body.data).toEqual([]);
    expect((await staff('get', '/branch/badges', doctorUser)).body.data.patientMessages).toBe(2);

    const list = await staff('get', '/branch/chats', doctorUser);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        patient: expect.objectContaining({ id: patientId }),
        unread: 2,
        lastMessage: 'New report',
      }),
    ]);
    conversationId = list.body.data[0].id;
    expect((await staff('get', `/branch/chats/${conversationId}/messages`, otherDoctorUser)).status).toBe(
      404,
    );

    const thread = await staff('get', `/branch/chats/${conversationId}/messages`, doctorUser);
    expect(thread.body.data.items.map((m: { body: string }) => m.body)).toEqual([
      'My hot flushes are better',
      'New report',
    ]);
    expect((await staff('get', '/branch/badges', doctorUser)).body.data.patientMessages).toBe(0);
  });

  it('sends the doctor reply to the patient with a push notification', async () => {
    expect(
      (
        await patient('post', '/patient/push-token').send({
          token: 'ExponentPushToken[abc123]',
          platform: 'android',
        })
      ).status,
    ).toBe(204);
    const pushed = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => new Response('{}', { status: 200 }));
    try {
      const reply = await staff('post', `/branch/chats/${conversationId}/messages`, doctorUser).send({
        body: 'Good. Continue the same dose.',
      });
      expect(reply.status).toBe(201);
      expect(reply.body.data).toMatchObject({ sender: 'doctor' });
      expect(pushed).toHaveBeenCalledTimes(1);
      const [url, init] = pushed.mock.calls[0]!;
      expect(String(url)).toContain('exp.host');
      expect(String(init?.body)).toContain('ExponentPushToken[abc123]');
      expect(String(init?.body)).not.toContain('Continue the same dose');
    } finally {
      pushed.mockRestore();
    }
    expect(
      (await staff('post', `/branch/chats/${conversationId}/messages`, otherDoctorUser).send({ body: 'x' }))
        .status,
    ).toBe(404);

    expect((await patient('get', '/patient/chats')).body.data[0]).toMatchObject({ unread: 1 });
    expect((await patient('get', '/patient/chats/unread')).body.data).toEqual({ unread: 1 });
    const seen = await patient('get', `/patient/chats/${doctorId}/messages`);
    expect(seen.body.data.items.at(-1)).toMatchObject({
      sender: 'doctor',
      body: 'Good. Continue the same dose.',
    });
    expect((await patient('get', '/patient/chats/unread')).body.data).toEqual({ unread: 0 });
  });

  it('forgets the push token when the patient logs out', async () => {
    expect((await patient('post', '/patient/auth/logout')).status).toBe(204);
    const rows = (await AppDataSource.query(`SELECT 1 FROM patient_push_tokens WHERE patient_id = $1`, [
      patientId,
    ])) as unknown[];
    expect(rows).toHaveLength(0);
    expect((await patient('get', '/patient/chats')).status).toBe(401);
  });
});
