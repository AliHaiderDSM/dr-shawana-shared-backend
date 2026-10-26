import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';

const fake = installFakeSupabase();
const app = createApp();

describe('Profit and loss', () => {
  let owner: { id: string };
  let admin: { id: string };
  let branchId: string;
  let serum: string;
  let cashSheet: string;
  let saleId: string;

  const api = (method: 'get' | 'post', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));
  const owned = (path: string) => api('post', `${path}?branchId=${branchId}`, owner);
  const report = (query: string) => api('get', `/admin/reports/profit-loss?${query}`, owner);

  beforeAll(async () => {
    branchId = (await createBranch({ code: 'PLR', city: 'Lahore' })).id;
    owner = await createStaff(fake, { role: 'super_admin', branchId: null });
    admin = await createStaff(fake, { role: 'branch_admin', branchId });
    const categoryId = (await owned('/branch/categories').send({ name: 'Skin' })).body.data.id;
    serum = (
      await owned('/branch/products').send({
        name: 'Profit Serum',
        categoryId,
        salePrice: '1000',
      })
    ).body.data.id;
    await owned('/branch/stock-ins')
      .send({ date: '2026-09-01', items: [{ productId: serum, qty: '10', batch: 'B-1', unitCost: '400' }] })
      .expect(201);
    cashSheet = (
      await owned('/branch/account-sheets').send({ accountName: 'Cash', accountCode: 'C1', type: 'cash' })
    ).body.data.id;
    const patientId = (
      await api('post', '/branch/patients', admin).send({
        name: 'Hira',
        phone: '923007778889',
        city: 'Lahore',
      })
    ).body.data.id;
    const sale = await api('post', '/branch/sales', admin).send({
      patientId,
      date: '2026-09-10',
      saleType: 'office',
      items: [{ productId: serum, qty: '2' }],
      payments: [{ method: 'cash', amount: '1500', accountSheetId: cashSheet, date: '2026-09-10' }],
    });
    expect(sale.status).toBe(201);
    expect(sale.body.data.total).toBe('2000.00');
    saleId = sale.body.data.id;
    await api('post', `/branch/sales/${saleId}/payments/approve`, admin).send({}).expect(200);
  });

  it('counts only the money received, against the cost of the batch sold', async () => {
    const res = await report('year=2026&month=9');
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toMatchObject({
      invoiced: '2000.00',
      received: '1500.00',
      notReceived: '500.00',
      revenue: '1500.00',
      cost: '800.00',
      profit: '700.00',
      margin: '46.7',
      sales: 1,
      estimatedCostUnits: '0.000',
    });
    expect(res.body.data.products[0]).toMatchObject({
      product: 'Profit Serum',
      qtySold: '2.000',
      listPrice: '1000.00',
      lastCost: '400.00',
      avgSalePrice: '1000.00',
      avgCost: '400.00',
      revenue: '1500.00',
      profit: '700.00',
    });
    expect(res.body.data.branches).toEqual([expect.objectContaining({ code: 'PLR', profit: '700.00' })]);
    const september = res.body.data.months.find((m: { month: string }) => m.month === '2026-09');
    expect(september).toMatchObject({ revenue: '1500.00', cost: '800.00' });
    expect((await report('year=2026&month=8')).body.data.summary.revenue).toBe('0.00');
  });

  it('takes refunds off and falls back to the last known cost when a batch has none', async () => {
    const returned = await api('post', '/branch/returns', admin).send({
      saleId,
      date: '2026-09-12',
      reason: 'other',
      items: [{ productId: serum, qty: '1' }],
      refund: { amount: '500', method: 'cash', accountSheetId: cashSheet, date: '2026-09-12' },
    });
    expect(returned.status).toBe(201);
    const afterReturn = (await report('year=2026&month=9')).body.data;
    expect(afterReturn.summary).toMatchObject({ refunds: '500.00', revenue: '1000.00' });
    expect(afterReturn.products[0]).toMatchObject({ qtyReturned: '1.000', refunds: '500.00' });

    await AppDataSource.query(
      `UPDATE product_batches SET unit_cost = NULL
        WHERE id IN (SELECT batch_id FROM stock_movements WHERE reference_type = 'sale' AND reference_id = $1)`,
      [saleId],
    );
    await api('post', `/branch/stock-ins?branchId=${branchId}`, owner)
      .send({ date: '2026-09-20', items: [{ productId: serum, qty: '5', batch: 'NEW-1', unitCost: '450' }] })
      .expect(201);
    const estimated = (await report('year=2026&month=9')).body.data;
    expect(estimated.summary.estimatedCostUnits).not.toBe('0.000');
    expect(estimated.products[0]).toMatchObject({ lastCost: '450.00', avgCost: '450.00' });
  });

  it('is for the Super Admin only', async () => {
    expect((await api('get', '/admin/reports/profit-loss?year=2026', admin)).status).toBe(403);
    expect((await report('year=2026&month=13')).status).toBe(400);
  });
});
