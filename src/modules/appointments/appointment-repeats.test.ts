import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

describe('repeat visits', () => {
  let frontDesk: { id: string };
  let owner: { id: string };
  let branchId: string;
  let doctorId: string;
  let otherDoctorId: string;
  let patientId: string;
  let otherPatientId: string;
  let firstId: string;
  let firstNo: number;
  const repeatIds: string[] = [];

  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));

  const slot = (timeFrom: string, timeTo: string, overrides: object = {}) => ({
    doctorId,
    date: '2026-10-20',
    timeFrom,
    timeTo,
    mode: 'physical',
    visitType: 'new',
    ...overrides,
  });

  beforeAll(async () => {
    const branch = await createBranch({ code: 'RPT' });
    branchId = branch.id;
    const admin = await createStaff(fake, { role: 'branch_admin', branchId });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId });
    owner = await createStaff(fake, { role: 'super_admin', branchId: null });
    const doctorUser = await createStaff(fake, { role: 'doctor', branchId });
    const otherDoctorUser = await createStaff(fake, { role: 'doctor', branchId });
    doctorId = (
      await api('post', '/branch/doctors', admin).send({
        staffId: doctorUser.id,
        displayName: 'Dr. Repeat',
        consultationFee: '5000',
      })
    ).body.data.id;
    otherDoctorId = (
      await api('post', '/branch/doctors', admin).send({
        staffId: otherDoctorUser.id,
        displayName: 'Dr. Other',
      })
    ).body.data.id;

    const first = await api('post', '/branch/appointments', frontDesk).send({
      ...slot('09:00', '09:30'),
      patient: { name: 'Repeat Patient', phone: '03007770001', city: 'Lahore' },
    });
    expect(first.status).toBe(201);
    firstId = first.body.data.id;
    firstNo = first.body.data.appointmentNo;
    patientId = first.body.data.patientId;
    const other = await api('post', '/branch/appointments', frontDesk).send({
      ...slot('09:30', '10:00'),
      patient: { name: 'Other Patient', phone: '03007770002', city: 'Lahore' },
    });
    otherPatientId = other.body.data.patientId;
  });

  it('only repeats a completed appointment of the same patient', async () => {
    const early = await api('post', '/branch/appointments', frontDesk).send({
      ...slot('10:00', '10:15', { date: '2026-10-27' }),
      patientId,
      repeatOfId: firstId,
    });
    expect(early.status).toBe(400);
    expect(early.body.error.message).toMatch(/completed/);

    await api('post', `/branch/appointments/${firstId}/status`, frontDesk)
      .send({ status: 'completed' })
      .expect(200);

    const stranger = await api('post', '/branch/appointments', frontDesk).send({
      ...slot('10:00', '10:15', { date: '2026-10-27' }),
      patientId: otherPatientId,
      repeatOfId: firstId,
    });
    expect(stranger.status).toBe(400);
    expect(stranger.body.error.message).toMatch(/same patient/);

    const paying = await api('post', '/branch/appointments', frontDesk).send({
      ...slot('10:00', '10:15', { date: '2026-10-27' }),
      patientId,
      repeatOfId: firstId,
      payments: [{ method: 'cash', amount: '500', date: '2026-10-20' }],
    });
    expect(paying.status).toBe(400);
  });

  it('numbers repeats under the first appointment with no fee, any doctor, and keeps the next number', async () => {
    const repeat = await api('post', '/branch/appointments', frontDesk).send({
      ...slot('10:00', '10:15', { date: '2026-10-27', doctorId: otherDoctorId }),
      patientId,
      repeatOfId: firstId,
    });
    expect(repeat.status).toBe(201);
    expect(repeat.body.data).toMatchObject({
      appointmentNo: firstNo,
      repeatNo: 1,
      repeatOfId: firstId,
      fee: '0.00',
      paymentStatus: 'paid',
      visitType: 'followup',
      doctorId: otherDoctorId,
    });

    await api('post', `/branch/appointments/${repeat.body.data.id}/status`, frontDesk)
      .send({ status: 'completed' })
      .expect(200);
    const second = await api('post', '/branch/appointments', frontDesk).send({
      ...slot('10:15', '10:30', { date: '2026-11-03' }),
      patientId,
      repeatOfId: repeat.body.data.id,
    });
    expect(second.status).toBe(201);
    repeatIds.push(repeat.body.data.id, second.body.data.id);
    expect(second.body.data).toMatchObject({ appointmentNo: firstNo, repeatNo: 2, repeatOfId: firstId });

    const fresh = await api('post', '/branch/appointments', frontDesk).send({
      ...slot('11:00', '11:30', { date: '2026-11-03' }),
      patientId: otherPatientId,
    });
    expect(fresh.body.data.repeatNo).toBeNull();
    expect(fresh.body.data.appointmentNo).toBeGreaterThan(firstNo);

    const pay = await api('post', `/branch/appointments/${second.body.data.id}/payments`, frontDesk).send({
      method: 'cash',
      amount: '100',
      date: '2026-11-03',
    });
    expect(pay.status).toBe(400);

    const fee = await api('patch', `/branch/appointments/${second.body.data.id}`, frontDesk).send({
      fee: '1000',
    });
    expect(fee.status).toBe(400);

    const found = await api('get', `/branch/appointments?search=APP%23${firstNo}.2`, frontDesk);
    expect(found.body.data.map((a: { id: string }) => a.id)).toEqual([second.body.data.id]);

    const removeFirst = await api('delete', `/branch/appointments/${firstId}`, frontDesk);
    expect(removeFirst.status).toBe(409);
  });

  it('counts main appointments, repeats and new patients, and keeps repeats out of the money report', async () => {
    const summary = await api('get', '/branch/appointments/summary?from=2026-10-01&to=2026-11-30', frontDesk);
    expect(summary.status).toBe(200);
    expect(summary.body.data).toEqual({ appointments: 3, repeats: 2, newPatients: 2 });

    const later = await api('get', '/branch/appointments/summary?from=2026-10-25&to=2026-11-30', frontDesk);
    expect(later.body.data).toEqual({ appointments: 1, repeats: 2, newPatients: 0 });

    const onlyRepeats = await api(
      'get',
      '/branch/appointments/summary?from=2026-10-01&to=2026-11-30&repeat=true&status=booked',
      frontDesk,
    );
    expect(onlyRepeats.body.data).toEqual({ appointments: 0, repeats: 1, newPatients: 0 });

    const searched = await api(
      'get',
      '/branch/appointments/summary?from=2026-10-01&to=2026-11-30&search=Other%20Patient',
      frontDesk,
    );
    expect(searched.body.data).toEqual({ appointments: 2, repeats: 0, newPatients: 1 });

    const sorted = await api(
      'get',
      '/branch/appointments?sort=-appointmentNo&patientId=' + patientId,
      frontDesk,
    );
    expect(sorted.body.data.map((a: { repeatNo: number | null }) => a.repeatNo)).toEqual([2, 1, null]);

    const money = await api(
      'get',
      `/admin/reports/appointment-payments?from=2026-10-01&to=2026-11-30&branchId=${branchId}`,
      owner,
    );
    expect(money.status).toBe(200);
    const ids = [...money.body.data.rows, ...money.body.data.visits].map(
      (r: { appointment: { id: string } }) => r.appointment.id,
    );
    expect(ids).toContain(firstId);
    expect(ids.filter((id: string) => repeatIds.includes(id))).toEqual([]);
  });
});
