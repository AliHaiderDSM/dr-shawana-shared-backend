import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';
import { AuditLog } from '../audit/audit-log.entity';

const fake = installFakeSupabase();
const app = createApp();

describe('appointments and payments', () => {
  let admin: { id: string };
  let frontDesk: { id: string };
  let pharmacy: { id: string };
  let islamabadAdmin: { id: string };
  let doctorUser: { id: string };
  let doctorId: string;
  let otherDoctorId: string;
  let cashSheetId: string;
  let bankSheetId: string;
  let appointmentId: string;
  let patientId: string;

  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));

  const booking = (overrides: object = {}) => ({
    patientId,
    doctorId,
    date: '2026-10-05',
    timeFrom: '10:00',
    timeTo: '10:30',
    mode: 'physical',
    visitType: 'followup',
    ...overrides,
  });

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR' });
    const islamabad = await createBranch({ code: 'ISB' });
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahore.id });
    pharmacy = await createStaff(fake, { role: 'pharmacy', branchId: lahore.id });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });
    doctorUser = await createStaff(fake, { role: 'doctor', branchId: lahore.id });
    const otherDoctorUser = await createStaff(fake, { role: 'doctor', branchId: lahore.id });

    doctorId = (
      await api('post', '/branch/doctors', admin).send({ staffId: doctorUser.id, displayName: 'Dr. Shawana' })
    ).body.data.id;
    otherDoctorId = (
      await api('post', '/branch/doctors', admin).send({
        staffId: otherDoctorUser.id,
        displayName: 'Dr. Ali',
      })
    ).body.data.id;
    cashSheetId = (
      await api('post', '/branch/account-sheets', admin).send({
        accountName: 'Cash',
        accountCode: 'C1',
        type: 'cash',
      })
    ).body.data.id;
    bankSheetId = (
      await api('post', '/branch/account-sheets', admin).send({
        accountName: 'Clinic Meezan',
        accountCode: 'M1',
        type: 'bank',
        bankName: 'Meezan Bank',
      })
    ).body.data.id;
  });

  it('books with an inline patient, payments, a screenshot and a medical record', async () => {
    const res = await request(app)
      .post('/api/v1/branch/appointments')
      .set(bearer(frontDesk))
      .field(
        'data',
        JSON.stringify({
          patient: { name: 'Ayesha Khan', phone: '03001234567', city: 'Lahore' },
          doctorId,
          date: '2026-10-05',
          timeFrom: '09:30',
          timeTo: '10:00',
          mode: 'online',
          visitType: 'new',
          issues: '<p>Hot flushes</p>',
          medicalRecord: { note: 'Old reports' },
          payments: [
            { method: 'cash', amount: '1000', date: '2026-10-01', accountSheetId: cashSheetId },
            {
              method: 'online',
              amount: '2000',
              date: '2026-10-02',
              accountSheetId: bankSheetId,
              senderBank: 'HBL',
              senderAccountTitle: 'Ayesha',
              senderAccountNo: '1234',
              proofIndex: 0,
            },
          ],
        }),
      )
      .attach('paymentProofs', Buffer.from('png'), { filename: 'proof.png', contentType: 'image/png' })
      .attach('medicalRecordFiles', Buffer.from('%PDF-1.4'), {
        filename: 'report.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'booked',
      source: 'dashboard',
      timeFrom: '09:30:00',
      timeTo: '10:00:00',
      patientCity: 'Lahore',
      patient: { name: 'Ayesha Khan', phone: '03001234567' },
      doctor: { id: doctorId, name: 'Dr. Shawana' },
      receivedAmount: '3000.00',
      fee: '0.00',
      remainingAmount: '0.00',
      paymentStatus: 'paid',
      paymentMethods: ['cash', 'online'],
    });
    expect(res.body.data.appointmentNo).toEqual(expect.any(Number));
    expect(res.body.data.payments).toHaveLength(2);
    expect(res.body.data.payments[0]).toMatchObject({ method: 'cash', hasProof: false, senderBank: null });
    expect(res.body.data.payments[1]).toMatchObject({ method: 'online', hasProof: true, senderBank: 'HBL' });
    expect(res.body.data.medicalRecords).toHaveLength(1);
    expect(res.body.data.medicalRecords[0].files[0]).toMatchObject({ originalName: 'report.pdf' });
    appointmentId = res.body.data.id;
    patientId = res.body.data.patientId;

    const proof = await api(
      'get',
      `/branch/appointments/${appointmentId}/payments/${res.body.data.payments[1].id}/proof-url`,
      frontDesk,
    );
    expect(proof.status).toBe(200);
    expect(proof.body.data.url).toContain('payment-proofs/');

    const file = await api(
      'get',
      `/branch/appointments/${appointmentId}/medical-records/files/${res.body.data.medicalRecords[0].files[0].id}/url`,
      frontDesk,
    );
    expect(file.body.data.url).toContain('medical-records/');

    const audit = await AppDataSource.getRepository(AuditLog).findOneBy({
      entity: 'appointment',
      entityId: appointmentId,
    });
    expect(audit?.action).toBe('create');
  });

  it('rolls back the inline patient and the uploads when the booking fails', async () => {
    const objects = fake.objects.size;
    const res = await request(app)
      .post('/api/v1/branch/appointments')
      .set(bearer(frontDesk))
      .field(
        'data',
        JSON.stringify({
          ...booking({ patientId: undefined, timeFrom: '09:45', timeTo: '10:15' }),
          patient: { name: 'Temp', phone: '03219990000', city: 'Lahore' },
        }),
      )
      .attach('medicalRecordFiles', Buffer.from('png'), { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.conflicts[0]).toMatchObject({ timeFrom: '09:30:00', timeTo: '10:00:00' });
    expect(fake.objects.size).toBe(objects);
    const check = await api('get', '/branch/patients/check-phone?phone=03219990000', frontDesk);
    expect(check.body.data.exists).toBe(false);
  });

  it('rejects overlapping times for the same doctor only', async () => {
    expect((await api('post', '/branch/appointments', frontDesk).send(booking())).status).toBe(201);
    const clash = await api('post', '/branch/appointments', frontDesk).send(
      booking({ timeFrom: '10:15', timeTo: '10:45' }),
    );
    expect(clash.status).toBe(409);
    const adjacent = await api('post', '/branch/appointments', frontDesk).send(
      booking({ timeFrom: '10:30', timeTo: '11:00' }),
    );
    expect(adjacent.status).toBe(201);
    const otherDoctor = await api('post', '/branch/appointments', frontDesk).send(
      booking({ doctorId: otherDoctorId, timeFrom: '10:15', timeTo: '10:45' }),
    );
    expect(otherDoctor.status).toBe(201);

    const slots = await api('get', `/branch/doctors/${doctorId}/slots?date=2026-10-05`, frontDesk);
    expect(slots.body.data.map((s: { timeFrom: string }) => s.timeFrom)).toEqual([
      '09:30:00',
      '10:00:00',
      '10:30:00',
    ]);
  });

  it('validates times and the patient choice', async () => {
    const backwards = await api('post', '/branch/appointments', frontDesk).send(
      booking({ timeFrom: '12:00', timeTo: '11:00' }),
    );
    expect(backwards.status).toBe(400);
    const both = await api('post', '/branch/appointments', frontDesk).send(
      booking({ patient: { name: 'X', phone: '923331112222', city: 'Lahore' } }),
    );
    expect(both.status).toBe(400);
    const cashProof = await api('post', '/branch/appointments', frontDesk).send(
      booking({
        timeFrom: '15:00',
        timeTo: '15:30',
        payments: [{ method: 'cash', amount: '10', accountSheetId: cashSheetId, proofIndex: 0 }],
      }),
    );
    expect(cashProof.status).toBe(400);
  });

  it('re-checks the overlap on edit, ignoring the appointment itself', async () => {
    const same = await api('patch', `/branch/appointments/${appointmentId}`, frontDesk).send({
      timeTo: '09:55',
    });
    expect(same.status).toBe(200);
    expect(same.body.data.timeTo).toBe('09:55:00');
    const clash = await api('patch', `/branch/appointments/${appointmentId}`, frontDesk).send({
      timeTo: '10:10',
    });
    expect(clash.status).toBe(409);
    const moved = await api('patch', `/branch/appointments/${appointmentId}`, frontDesk).send({
      doctorId: otherDoctorId,
      timeFrom: '09:00',
      timeTo: '09:30',
    });
    expect(moved.status).toBe(200);
    await api('patch', `/branch/appointments/${appointmentId}`, frontDesk).send({ doctorId });
  });

  it('shows doctors only their own appointments', async () => {
    const list = await api('get', '/branch/appointments', doctorUser);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data.every((a: { doctorId: string }) => a.doctorId === doctorId)).toBe(true);

    const others = await api('get', `/branch/appointments?doctorId=${otherDoctorId}`, admin);
    const foreign = others.body.data[0].id;
    expect((await api('get', `/branch/appointments/${foreign}`, doctorUser)).status).toBe(404);
    expect(
      (await api('get', `/branch/doctors/${otherDoctorId}/slots?date=2026-10-05`, doctorUser)).status,
    ).toBe(404);

    const forOther = await api('post', '/branch/appointments', doctorUser).send(
      booking({ doctorId: otherDoctorId, timeFrom: '18:00', timeTo: '18:30' }),
    );
    expect(forOther.status).toBe(403);
    const own = await api('post', '/branch/appointments', doctorUser).send(
      booking({ timeFrom: '18:00', timeTo: '18:30' }),
    );
    expect(own.status).toBe(201);
  });

  it('filters the list and the calendar', async () => {
    const online = await api('get', '/branch/appointments?mode=online', admin);
    expect(online.body.data.map((a: { id: string }) => a.id)).toEqual([appointmentId]);
    expect(typeof online.body.data[0].createdByName).toBe('string');
    const search = await api('get', '/branch/appointments?search=ayesha', admin);
    expect(search.body.meta.total).toBeGreaterThan(0);
    const byNo = await api(
      'get',
      `/branch/appointments?search=APP%23${online.body.data[0].appointmentNo}`,
      admin,
    );
    expect(byNo.body.data.map((a: { id: string }) => a.id)).toContain(appointmentId);
    const ordered = await api('get', `/branch/appointments?doctorId=${doctorId}&sort=date`, admin);
    expect(ordered.body.data.map((a: { timeFrom: string }) => a.timeFrom)).toEqual([
      '09:00:00',
      '10:00:00',
      '10:30:00',
      '18:00:00',
    ]);

    const calendar = await api('get', '/branch/appointments/calendar?from=2026-10-01&to=2026-10-31', admin);
    expect(calendar.body.data).toHaveLength(5);
    expect(calendar.body.data[0]).toMatchObject({
      patient: { name: 'Ayesha Khan' },
      doctor: { name: 'Dr. Shawana' },
    });
    const tooLong = await api('get', '/branch/appointments/calendar?from=2026-01-01&to=2026-12-31', admin);
    expect(tooLong.status).toBe(400);
  });

  it('sets the status and remark with screenshots', async () => {
    const res = await request(app)
      .post(`/api/v1/branch/appointments/${appointmentId}/status`)
      .set(bearer(doctorUser))
      .field('data', JSON.stringify({ status: 'completed', remark: 'Started BHRT' }))
      .attach('files', Buffer.from('png'), { filename: 'remark.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'completed', remark: 'Started BHRT' });
    expect(res.body.data.attachments).toHaveLength(1);
    const url = await api(
      'get',
      `/branch/appointments/${appointmentId}/attachments/${res.body.data.attachments[0].id}/url`,
      frontDesk,
    );
    expect(url.status).toBe(200);
  });

  it('manages payments and audits them', async () => {
    const added = await request(app)
      .post(`/api/v1/branch/appointments/${appointmentId}/payments`)
      .set(bearer(frontDesk))
      .field(
        'data',
        JSON.stringify({ method: 'online', amount: '500', date: '2026-11-03', accountSheetId: bankSheetId }),
      )
      .attach('proof', Buffer.from('png'), { filename: 'p.png', contentType: 'image/png' });
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({ amount: '500.00', hasProof: true });
    const paymentId = added.body.data.id;

    const toCash = await api(
      'patch',
      `/branch/appointments/${appointmentId}/payments/${paymentId}`,
      frontDesk,
    ).send({
      method: 'cash',
      accountSheetId: cashSheetId,
    });
    expect(toCash.body.data).toMatchObject({ method: 'cash', hasProof: false, senderBank: null });
    const proofOnCash = await request(app)
      .post(`/api/v1/branch/appointments/${appointmentId}/payments/${paymentId}/proof`)
      .set(bearer(frontDesk))
      .attach('proof', Buffer.from('png'), { filename: 'p.png', contentType: 'image/png' });
    expect(proofOnCash.status).toBe(400);

    const list = await api('get', `/branch/appointments/${appointmentId}/payments`, frontDesk);
    expect(list.body.data).toHaveLength(3);
    expect(
      (await api('delete', `/branch/appointments/${appointmentId}/payments/${paymentId}`, frontDesk)).status,
    ).toBe(204);
    const actions = await AppDataSource.getRepository(AuditLog).find({
      where: { entity: 'appointment_payment', entityId: paymentId },
      order: { createdAt: 'ASC' },
    });
    expect(actions.map((a) => a.action)).toEqual(['create', 'update', 'delete']);
  });

  it('reports payments per appointment, like posSoft', async () => {
    const all = await api('get', '/branch/appointment-payments', admin);
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(1);
    expect(all.body.data[0]).toMatchObject({
      appointmentId,
      amount: '3000.00',
      lastPaymentDate: '2026-10-02',
      patient: { name: 'Ayesha Khan' },
    });
    expect(all.body.data[0].methods.sort()).toEqual(['cash', 'online']);
    expect(all.body.meta.totalAmount).toBe('3000.00');

    const online = await api('get', '/branch/appointment-payments?method=online&month=2026-10', admin);
    expect(online.body.data[0].amount).toBe('2000.00');
    const sheet = await api('get', `/branch/appointment-payments?accountSheetId=${cashSheetId}`, admin);
    expect(sheet.body.meta.totalAmount).toBe('1000.00');
    const empty = await api('get', '/branch/appointment-payments?month=2026-12', admin);
    expect(empty.body).toMatchObject({ data: [], meta: { total: 0, totalAmount: '0.00' } });
  });

  it('summarises the patient for this branch', async () => {
    const res = await api('get', `/branch/patients/${patientId}/summary`, frontDesk);
    expect(res.status).toBe(200);
    expect(res.body.data.appointments).toMatchObject({
      total: 5,
      completed: 1,
      booked: 4,
      lastVisit: '2026-10-05',
    });
    expect(res.body.data.payments.totalReceived).toBe('3000.00');
    expect(res.body.data.medicalRecords).toHaveLength(1);

    const other = await api('get', `/branch/patients/${patientId}/summary`, islamabadAdmin);
    expect(other.body.data.appointments.total).toBe(0);
    expect(other.body.data.medicalRecords).toEqual([]);
    const fileId = res.body.data.medicalRecords[0].files[0].id;
    expect(
      (await api('get', `/branch/patients/${patientId}/medical-records/files/${fileId}/url`, frontDesk))
        .status,
    ).toBe(200);
    expect(
      (await api('get', `/branch/patients/${patientId}/medical-records/files/${fileId}/url`, islamabadAdmin))
        .status,
    ).toBe(404);
  });

  it('keeps other branches and roles out', async () => {
    expect((await api('get', `/branch/appointments/${appointmentId}`, islamabadAdmin)).status).toBe(404);
    expect((await api('get', `/branch/appointments/${appointmentId}/payments`, islamabadAdmin)).status).toBe(
      404,
    );
    const foreignDoctor = await api('post', '/branch/appointments', islamabadAdmin).send(booking());
    expect(foreignDoctor.status).toBe(404);
    expect((await api('get', '/branch/appointments', pharmacy)).status).toBe(403);
    expect((await api('get', '/branch/doctors/options', pharmacy)).status).toBe(403);
    const withPaymentByPharmacy = await api('post', '/branch/appointments', pharmacy).send(booking());
    expect(withPaymentByPharmacy.status).toBe(403);
  });

  it('removes an appointment with its payments; patients with appointments stay', async () => {
    expect((await api('delete', `/branch/patients/${patientId}`, frontDesk)).status).toBe(409);
    expect((await api('delete', `/branch/appointments/${appointmentId}`, frontDesk)).status).toBe(204);
    expect((await api('get', `/branch/appointments/${appointmentId}`, frontDesk)).status).toBe(404);
    const report = await api('get', '/branch/appointment-payments', admin);
    expect(report.body.data).toEqual([]);
  });

  it('tracks an advance against the appointment fee', async () => {
    const advance = await api('post', '/branch/appointments', frontDesk).send(
      booking({
        date: '2026-12-01',
        timeFrom: '16:00',
        timeTo: '16:30',
        fee: '5000',
        payments: [{ method: 'cash', amount: '2000', accountSheetId: cashSheetId }],
      }),
    );
    expect(advance.status).toBe(201);
    expect(advance.body.data).toMatchObject({
      fee: '5000.00',
      receivedAmount: '2000.00',
      remainingAmount: '3000.00',
      paymentStatus: 'partial',
    });
    const lowered = await api('patch', `/branch/appointments/${advance.body.data.id}`, frontDesk).send({
      fee: '2000',
    });
    expect(lowered.body.data).toMatchObject({ remainingAmount: '0.00', paymentStatus: 'paid' });
    const unpaid = await api('post', '/branch/appointments', frontDesk).send(
      booking({ date: '2026-12-02', timeFrom: '16:00', timeTo: '16:30', fee: '1500' }),
    );
    expect(unpaid.body.data).toMatchObject({ paymentStatus: 'unpaid', remainingAmount: '1500.00' });
  });
});
