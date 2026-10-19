import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

describe('doctor app', () => {
  let admin: { id: string };
  let frontDesk: { id: string };
  let doctorUser: { id: string };
  let otherDoctorUser: { id: string };
  let doctorId: string;
  let patientId: string;
  let strangerId: string;
  let appointmentId: string;
  let consultationId: string;
  let patientToken: string;

  const staff = (method: 'get' | 'post' | 'put', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));

  beforeAll(async () => {
    const lahore = (await createBranch({ code: 'LHD' })).id;
    const karachi = (await createBranch({ code: 'KHD' })).id;
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahore });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahore });
    const karachiDesk = await createStaff(fake, { role: 'front_desk', branchId: karachi });
    doctorUser = await createStaff(fake, { role: 'doctor', branchId: lahore });
    otherDoctorUser = await createStaff(fake, { role: 'doctor', branchId: lahore });
    doctorId = (
      await staff('post', '/branch/doctors', admin).send({
        staffId: doctorUser.id,
        displayName: 'Dr. Shawana',
      })
    ).body.data.id;
    await staff('post', '/branch/doctors', admin).send({
      staffId: otherDoctorUser.id,
      displayName: 'Dr. Other',
    });
    patientId = (
      await staff('post', '/branch/patients', frontDesk).send({
        name: 'Hina',
        phone: '923005550101',
        city: 'Lahore',
      })
    ).body.data.id;
    strangerId = (
      await staff('post', '/branch/patients', karachiDesk).send({
        name: 'Sara',
        phone: '923005550102',
        city: 'Karachi',
      })
    ).body.data.id;
    appointmentId = (
      await staff('post', '/branch/appointments', frontDesk).send({
        patientId,
        doctorId,
        date: '2026-09-01',
        timeFrom: '10:00',
        timeTo: '10:30',
        mode: 'physical',
        visitType: 'new',
      })
    ).body.data.id;
    consultationId = (await staff('post', `/branch/appointments/${appointmentId}/consultation`, doctorUser))
      .body.data.id;
    const { code } = (await staff('post', `/branch/patients/${patientId}/app-access/code`, frontDesk)).body
      .data;
    patientToken = (
      await request(app).post('/api/v1/patient/auth/login').send({ phone: '03005550101', code })
    ).body.data.accessToken;
  });

  it('is for doctors only', async () => {
    expect((await staff('get', '/doctor/home', frontDesk)).status).toBe(403);
    expect((await request(app).get('/api/v1/doctor/home')).status).toBe(401);
  });

  it('shows the home counts and only the doctor’s own patients', async () => {
    const home = await staff('get', '/doctor/home', doctorUser);
    expect(home.status).toBe(200);
    expect(home.body.data).toMatchObject({
      doctor: { id: doctorId, name: 'Dr. Shawana' },
      counts: { patients: 1, unread: 0 },
    });
    const list = (await staff('get', '/doctor/patients', doctorUser)).body.data as {
      id: string;
      visits: number;
    }[];
    expect(list.map((p) => p.id)).toEqual([patientId]);
    expect(list[0]).toMatchObject({ visits: 1, conversationId: null });
    expect((await staff('get', '/doctor/patients?search=hin', doctorUser)).body.data).toHaveLength(1);
    expect((await staff('get', '/doctor/patients?search=zzz', doctorUser)).body.data).toHaveLength(0);
    expect((await staff('get', '/doctor/patients', otherDoctorUser)).body.data).toEqual([]);
    expect((await staff('get', `/doctor/patients/${strangerId}`, doctorUser)).status).toBe(404);
    expect((await staff('get', `/doctor/patients/${patientId}`, otherDoctorUser)).status).toBe(404);
  });

  it('writes clinical remarks and shows the patient file by date', async () => {
    const saved = await staff('put', `/doctor/consultations/${consultationId}/remarks`, doctorUser).send({
      remarks: '<p><strong>Start</strong> BHRT</p>',
    });
    expect(saved.status).toBe(200);
    expect(
      (
        await staff('put', `/doctor/consultations/${consultationId}/remarks`, otherDoctorUser).send({
          remarks: 'x',
        })
      ).status,
    ).toBe(404);
    const file = (await staff('get', `/doctor/patients/${patientId}`, doctorUser)).body.data;
    expect(file.patient).toMatchObject({ id: patientId, name: 'Hina' });
    expect(file.appointments[0]).toMatchObject({ id: appointmentId, date: '2026-09-01', mine: true });
    expect(file.remarks[0]).toMatchObject({
      consultationId,
      remarks: '<p><strong>Start</strong> BHRT</p>',
      editable: true,
    });
    expect(file.prescriptions).toEqual([]);
    expect(file.records).toEqual([]);
  });

  it('starts a chat, sends to the patient and gets a push when the patient answers', async () => {
    const opened = await staff('post', `/doctor/patients/${patientId}/chat`, doctorUser);
    expect(opened.status).toBe(200);
    const conversationId = opened.body.data.conversationId as string;
    expect(
      (await staff('post', `/doctor/patients/${patientId}/chat`, doctorUser)).body.data.conversationId,
    ).toBe(conversationId);
    expect(
      (
        await staff('post', '/doctor/push-token', doctorUser).send({
          token: 'ExponentPushToken[doc1]',
          platform: 'android',
        })
      ).status,
    ).toBe(204);

    const pushed = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => new Response('{}', { status: 200 }));
    try {
      const first = await staff('post', `/branch/chats/${conversationId}/messages`, doctorUser).send({
        body: 'How are you feeling?',
      });
      expect(first.status).toBe(201);
      const reply = await request(app)
        .post(`/api/v1/patient/chats/${doctorId}/messages`)
        .set({ Authorization: `Bearer ${patientToken}` })
        .send({ body: 'Better, thank you' });
      expect(reply.status).toBe(201);
      const toDoctor = pushed.mock.calls.find(([, init]) =>
        String(init?.body).includes('ExponentPushToken[doc1]'),
      );
      expect(JSON.parse(String(toDoctor?.[1]?.body))[0]).toMatchObject({
        title: 'Hina',
        data: { type: 'doctor_chat', conversationId, patientId },
      });
    } finally {
      pushed.mockRestore();
    }
    const home = (await staff('get', '/doctor/home', doctorUser)).body.data;
    expect(home.counts.unread).toBe(1);
    expect(home.chats[0]).toMatchObject({ conversationId, patient: { id: patientId }, unread: 1 });
    expect(
      (
        await staff('post', '/doctor/push-token/remove', doctorUser).send({
          token: 'ExponentPushToken[doc1]',
        })
      ).status,
    ).toBe(204);
  });
});
