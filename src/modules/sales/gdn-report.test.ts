import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';

const fake = installFakeSupabase();
const app = createApp();

describe('GDN day-end report', () => {
  let dispatcher: { id: string };
  let lahoreDesk: { id: string };
  let lahoreAdmin: { id: string };
  let superAdmin: { id: string };
  let dispatchId: string;
  let lahoreId: string;
  let patientId: string;
  let seq = 0;

  const order = async (date: string, extra: { dispatchedOn?: string; cancelledOn?: string } = {}) => {
    seq += 1;
    const status = extra.dispatchedOn ? 'delivered' : extra.cancelledOn ? 'cancelled' : 'pending';
    await AppDataSource.query(
      `INSERT INTO sales (branch_id, invoice_seq, invoice_no, patient_id, sale_type, city, date, subtotal, total,
                          delivery_status, fulfillment_branch_id, dispatched_on, delivered_on, gdn_no, cancelled_on)
       VALUES ($1, $2, $3, $4, 'online', 'Lahore', $5, 1000, 1000, $6, $7, $8, $8, $9, $10)`,
      [
        lahoreId,
        seq,
        `LHR-${String(seq).padStart(6, '0')}`,
        patientId,
        date,
        status,
        dispatchId,
        extra.dispatchedOn ?? null,
        extra.dispatchedOn ? `DSP-GDN-${String(seq).padStart(6, '0')}` : null,
        extra.cancelledOn ?? null,
      ],
    );
  };

  const counterSale = async (date: string) => {
    seq += 1;
    await AppDataSource.query(
      `INSERT INTO sales (branch_id, invoice_seq, invoice_no, patient_id, sale_type, city, date, subtotal, total, gdn_no)
       VALUES ($1, $2, $3, $4, 'office', 'Lahore', $5, 500, 500, $6)`,
      [
        lahoreId,
        seq,
        `LHR-${String(seq).padStart(6, '0')}`,
        patientId,
        date,
        `LHR-GDN-${String(seq).padStart(6, '0')}`,
      ],
    );
  };

  const report = (who: { id: string }, date: string) =>
    request(app).get(`/api/v1/branch/sales/gdn-report?date=${date}`).set(bearer(who));

  beforeAll(async () => {
    dispatchId = (await createBranch({ code: 'DSP', name: 'Leading Pharma', kind: 'dispatch' })).id;
    lahoreId = (await createBranch({ code: 'LHR', name: 'Lahore' })).id;
    dispatcher = await createStaff(fake, { role: 'dispatcher', branchId: dispatchId });
    lahoreDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
    lahoreAdmin = await createStaff(fake, { role: 'branch_admin', branchId: lahoreId });
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
    patientId = (
      await request(app)
        .post('/api/v1/branch/patients')
        .set(bearer(lahoreDesk))
        .send({ name: 'Sana', phone: '923001112223', city: 'Lahore' })
    ).body.data.id;

    for (let i = 0; i < 3; i += 1) await order('2026-10-20', { dispatchedOn: '2026-10-20' });
    for (let i = 0; i < 6; i += 1) await order('2026-10-20', { dispatchedOn: '2026-10-21' });
    await order('2026-10-20', { cancelledOn: '2026-10-21' });
    for (let i = 0; i < 2; i += 1) await order('2026-10-21', { dispatchedOn: '2026-10-21' });
    for (let i = 0; i < 2; i += 1) await order('2026-10-21');
    for (let i = 0; i < 3; i += 1) await counterSale('2026-10-21');
    await counterSale('2026-10-20');
  });

  it('shows the first day: 10 booked, 3 sent, 7 carried to the next day', async () => {
    const res = await report(dispatcher, '2026-10-20');
    expect(res.status).toBe(200);
    expect(res.body.data.branch).toMatchObject({ name: 'Leading Pharma', dispatch: true });
    expect(res.body.data.summary).toMatchObject({
      opening: 0,
      newOrders: 10,
      dispatched: 3,
      dispatchedFromOpening: 0,
      dispatchedFromNew: 3,
      cancelled: 0,
      closing: 7,
      closingAmount: '7000.00',
      oldestPending: '2026-10-20',
    });
    const sent = res.body.data.orders.filter((o: { status: string }) => o.status === 'dispatched');
    expect(sent[0]).toMatchObject({
      gdnNo: expect.stringMatching(/GDN/),
      customer: { name: 'Sana' },
      bookedAt: { code: 'LHR' },
    });
  });

  it('shows the next day with the earlier orders apart from the new ones', async () => {
    const { summary, orders } = (await report(dispatcher, '2026-10-21')).body.data;
    expect(summary).toMatchObject({
      opening: 7,
      newOrders: 4,
      dispatched: 8,
      dispatchedFromOpening: 6,
      dispatchedFromNew: 2,
      cancelled: 1,
      closing: 2,
      closingFromOpening: 0,
    });
    const early = orders.find(
      (o: { fromBefore: boolean; status: string }) => o.fromBefore && o.status === 'dispatched',
    );
    expect(early).toMatchObject({ date: '2026-10-20', dispatchedOn: '2026-10-21', waitingDays: 1 });

    const third = (await report(dispatcher, '2026-10-22')).body.data.summary;
    expect(third).toMatchObject({
      opening: 2,
      newOrders: 0,
      dispatched: 0,
      closing: 2,
      closingFromOpening: 2,
    });
  });

  it('lets the Super Admin open any branch report', async () => {
    const res = await request(app)
      .get(`/api/v1/branch/sales/gdn-report?date=2026-10-21&branchId=${dispatchId}`)
      .set(bearer(superAdmin));
    expect(res.body).toBeDefined();
    expect(res.status).toBe(200);
    expect(res.body.data.summary.opening).toBe(7);
  });

  it('adds the office sales of a branch, each handed over with its own GDN on the day', async () => {
    const at = (type: string) =>
      request(app)
        .get(`/api/v1/branch/sales/gdn-report?date=2026-10-21&branchId=${lahoreId}&type=${type}`)
        .set(bearer(superAdmin));
    const office = (await at('office')).body.data;
    expect(office.type).toBe('office');
    expect(office.summary).toMatchObject({
      office: 3,
      officeAmount: '1500.00',
      opening: 0,
      newOrders: 3,
      dispatched: 3,
      closing: 0,
    });
    expect(office.orders[0]).toMatchObject({
      saleType: 'office',
      status: 'dispatched',
      dispatchedOn: '2026-10-21',
      gdnNo: expect.stringMatching(/^LHR-GDN-/),
    });
    const all = (await at('all')).body.data.summary;
    expect(all).toMatchObject({ office: 3, opening: 7, newOrders: 7, dispatched: 11, closing: 2 });
    expect((await at('online')).body.data.summary).toMatchObject({ office: 0, newOrders: 4 });
    const dispatchAll = (
      await request(app)
        .get('/api/v1/branch/sales/gdn-report?date=2026-10-21&type=all')
        .set(bearer(dispatcher))
    ).body.data.summary;
    expect(dispatchAll).toMatchObject({ office: 0, dispatched: 8 });
  });

  it('keeps the report to the Dispatch Department and the Super Admin', async () => {
    const branchAdmin = await report(lahoreAdmin, '2026-10-21');
    expect(branchAdmin.status).toBe(403);
    expect(branchAdmin.body.error.message).toContain('Dispatch Department');
    expect((await report(lahoreDesk, '2026-10-21')).status).toBe(403);
    const lahore = (
      await request(app)
        .get(`/api/v1/branch/sales/gdn-report?date=2026-10-21&branchId=${lahoreId}`)
        .set(bearer(superAdmin))
    ).body.data;
    expect(lahore.branch).toMatchObject({ code: 'LHR', dispatch: false });
    expect(lahore.summary.opening).toBe(7);
  });
});
