import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';
import { today } from '../../lib/validation';

const fake = installFakeSupabase();
const app = createApp();

const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describe('appointment advances, balances, refunds and the payment report', () => {
  let owner: { id: string };
  let admin: { id: string };
  let branchId: string;
  let doctorId: string;
  let patientId: string;
  let cashSheetId: string;
  const day0 = today();
  const visit = shift(day0, 3);

  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));
  const ownerApi = (method: 'get' | 'post' | 'delete', path: string) =>
    api(method, `${path}${path.includes('?') ? '&' : '?'}branchId=${branchId}`, owner);
  const book = (timeFrom: string, timeTo: string, fee: string) =>
    api('post', '/branch/appointments', admin).send({
      patientId,
      doctorId,
      date: visit,
      timeFrom,
      timeTo,
      mode: 'physical',
      visitType: 'new',
      fee,
    });
  const pay = (id: string, amount: string, date: string) =>
    api('post', `/branch/appointments/${id}/payments`, admin).send({
      method: 'cash',
      amount,
      date,
      accountSheetId: cashSheetId,
    });
  const ledger = (from: string, to = from) =>
    ownerApi('get', `/admin/reports/appointment-payments?from=${from}&to=${to}`);

  beforeAll(async () => {
    branchId = (await createBranch({ code: 'RFD' })).id;
    owner = await createStaff(fake, { role: 'super_admin', branchId: null });
    admin = await createStaff(fake, { role: 'branch_admin', branchId });
    const doctorUser = await createStaff(fake, { role: 'doctor', branchId });
    doctorId = (
      await api('post', '/branch/doctors', admin).send({ staffId: doctorUser.id, displayName: 'Dr. Refund' })
    ).body.data.id;
    cashSheetId = (
      await ownerApi('post', '/branch/account-sheets').send({
        accountName: 'Cash',
        accountCode: 'C1',
        type: 'cash',
      })
    ).body.data.id;
    patientId = (
      await api('post', '/branch/patients', admin).send({
        name: 'Nida',
        phone: '923005556667',
        city: 'Lahore',
      })
    ).body.data.id;
  });

  it('counts money before the visit as advance and on the visit day as balance', async () => {
    const booked = await book('10:00', '10:30', '5000');
    expect(booked.status).toBe(201);
    const id = booked.body.data.id as string;
    expect((await pay(id, '2000', day0)).status).toBe(201);

    const first = (await ledger(day0)).body.data;
    expect(first.summary).toMatchObject({
      bookings: 1,
      advance: 1,
      advanceAmount: '2000.00',
      balanceAmount: '0.00',
    });
    expect(first.rows[0]).toMatchObject({
      sr: 1,
      kind: 'advance',
      amount: '2000.00',
      appointment: { appointmentNo: booked.body.data.appointmentNo, fee: '5000.00' },
      paidAfter: '2000.00',
      remainingAfter: '3000.00',
      stateAfter: 'advance',
    });

    expect((await pay(id, '3000', visit)).status).toBe(201);
    const whole = (await ledger(day0, visit)).body.data;
    const mine = whole.rows.filter((r: { appointment: { id: string } }) => r.appointment.id === id);
    expect(
      mine.map((r: { kind: string; amount: string; stateAfter: string; fullyPaidHere: boolean }) => [
        r.kind,
        r.amount,
        r.stateAfter,
        r.fullyPaidHere,
      ]),
    ).toEqual([
      ['advance', '2000.00', 'advance', false],
      ['balance', '3000.00', 'paid', true],
    ]);
    expect(whole.summary).toMatchObject({ balanceAmount: '3000.00', fullyPaid: 1 });
    expect((await ledger(shift(visit, 1))).body.data.rows).toEqual([]);
  });

  it('shows a booking without money as its own entry', async () => {
    const booked = await book('11:00', '11:30', '1500');
    const rows = (await ledger(day0)).body.data.rows;
    expect(
      rows.find((r: { appointment: { id: string } }) => r.appointment.id === booked.body.data.id),
    ).toMatchObject({
      kind: 'booked',
      amount: '0.00',
      stateAfter: 'unpaid',
      remainingAfter: '1500.00',
    });
  });

  it('lets only the Super Admin refund a cancelled appointment, up to what was received', async () => {
    const booked = await book('12:00', '12:30', '4000');
    const id = booked.body.data.id as string;
    await pay(id, '1500', day0).expect(201);
    const refund = (who: { id: string }, amount: string) =>
      api(
        'post',
        `/branch/appointments/${id}/refunds${who === owner ? `?branchId=${branchId}` : ''}`,
        who,
      ).send({
        amount,
        method: 'cash',
        accountSheetId: cashSheetId,
        date: day0,
        note: 'Patient moved abroad',
      });
    expect((await refund(owner, '500')).status).toBe(409);
    await api('post', `/branch/appointments/${id}/status`, admin).send({ status: 'cancelled' }).expect(200);
    expect((await refund(admin, '500')).status).toBe(403);
    const given = await refund(owner, '1000');
    expect(given.status).toBe(201);
    expect(given.body.data).toMatchObject({
      amount: '1000.00',
      method: 'cash',
      note: 'Patient moved abroad',
    });
    expect((await refund(owner, '600')).status).toBe(422);

    const detail = (await api('get', `/branch/appointments/${id}`, admin)).body.data;
    expect(detail).toMatchObject({ refundedAmount: '1000.00' });
    expect(detail.refunds).toHaveLength(1);

    const report = (await ledger(day0)).body.data;
    expect(report.summary.refundAmount).toBe('1000.00');
    const refundRow = report.rows.find(
      (r: { kind: string; appointment: { id: string } }) => r.kind === 'refund' && r.appointment.id === id,
    );
    expect(refundRow).toMatchObject({
      amount: '1000.00',
      paidAfter: '1500.00',
      refundedAfter: '1000.00',
      stateAfter: 'held',
    });

    const [movement] = (await AppDataSource.query(
      `SELECT credit::text AS credit FROM account_movements WHERE source = 'appointment_refund' AND account_sheet_id = $1`,
      [cashSheetId],
    )) as { credit: string }[];
    expect(movement?.credit).toBe('1000.00');

    expect(
      (await api('post', `/branch/appointments/${id}/status`, admin).send({ status: 'booked' })).status,
    ).toBe(409);
    const paymentId = detail.payments[0].id as string;
    expect((await api('delete', `/branch/appointments/${id}/payments/${paymentId}`, admin)).status).toBe(409);

    expect(
      (await ownerApi('delete', `/branch/appointments/${id}/refunds/${given.body.data.id}`)).status,
    ).toBe(204);
    expect((await api('get', `/branch/appointments/${id}`, admin)).body.data.refundedAmount).toBe('0.00');
  });

  it('keeps both reports for the Super Admin', async () => {
    expect((await api('get', '/admin/reports/appointment-payments', admin)).status).toBe(403);
    expect(
      (await ownerApi('get', '/admin/reports/appointment-payments?from=2026-10-05&to=2026-10-01')).status,
    ).toBe(400);
  });
});
