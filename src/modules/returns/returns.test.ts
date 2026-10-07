import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';

const fake = installFakeSupabase();
const app = createApp();

describe('Sale returns and barcodes', () => {
  let admin: { id: string };
  let frontDesk: { id: string };
  let pharmacy: { id: string };
  let doctor: { id: string };
  let islamabadAdmin: { id: string };
  let serum: string;
  let toner: string;
  let cashSheet: string;
  let saleId: string;

  const api = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));

  async function stock(productId: string) {
    const res = await api('get', '/branch/inventory/stock?pageSize=100', admin);
    return res.body.data.find((r: { productId: string }) => r.productId === productId)?.quantity as string;
  }

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR', city: 'Lahore' });
    const islamabad = await createBranch({ code: 'ISB', city: 'Islamabad' });
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahore.id });
    pharmacy = await createStaff(fake, { role: 'pharmacy', branchId: lahore.id });
    doctor = await createStaff(fake, { role: 'doctor', branchId: lahore.id });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });

    const categoryId = (await api('post', '/branch/categories', admin).send({ name: 'Skin' })).body.data.id;
    const product = (name: string, barcode: string | null) =>
      api('post', '/branch/products', admin).send({
        name,
        categoryId,
        barcode,
        initialPurchase: { date: '2026-09-01', quantity: '10', unitPrice: '1000' },
      });
    serum = (await product('Serum', '8964000123456')).body.data.id;
    toner = (await product('Toner', null)).body.data.id;
    cashSheet = (
      await api('post', '/branch/account-sheets', admin).send({
        accountName: 'Cash',
        accountCode: 'C1',
        type: 'cash',
      })
    ).body.data.id;
    const patientId = (
      await api('post', '/branch/patients', frontDesk).send({
        name: 'Sana',
        phone: '923001112223',
        city: 'Lahore',
      })
    ).body.data.id;
    const sale = await api('post', '/branch/sales', frontDesk).send({
      patientId,
      date: '2026-09-10',
      saleType: 'office',
      items: [
        { productId: serum, qty: '3' },
        { productId: toner, qty: '2' },
      ],
      payments: [{ method: 'cash', amount: '4000', accountSheetId: cashSheet }],
    });
    expect(sale.status).toBe(201);
    saleId = sale.body.data.id;
    expect(sale.body.data.paymentStatus).toBe('awaiting_approval');
    const approved = await api('post', `/branch/sales/${saleId}/payments/approve`, admin).send({});
    expect(approved.body.data.paymentStatus).toBe('partial');
  });

  it('finds products by their printed barcode and keeps barcodes unique per branch', async () => {
    const found = await api('get', '/branch/products/barcode/8964000123456', pharmacy);
    expect(found.status).toBe(200);
    expect(found.body.data).toMatchObject({ id: serum, barcode: '8964000123456' });
    expect((await api('get', '/branch/products/barcode/0000000000', admin)).status).toBe(404);
    expect((await api('get', '/branch/products/barcode/8964000123456', islamabadAdmin)).status).toBe(404);
    expect(
      (await api('patch', `/branch/products/${toner}`, admin).send({ barcode: '8964000123456' })).status,
    ).toBe(409);
    const search = await api('get', '/branch/products?search=89640001', admin);
    expect(search.body.data.map((p: { id: string }) => p.id)).toEqual([serum]);
  });

  it('shows what is still returnable and refuses returning more than was sold', async () => {
    const returnable = await api('get', `/branch/returns/sale/${saleId}/returnable`, frontDesk);
    expect(returnable.body.data).toMatchObject({ received: '4000.00', refunded: '0.00' });
    expect(returnable.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: serum, sold: '3.000', returned: '0.000', returnable: '3.000' }),
      ]),
    );
    const tooMany = await api('post', '/branch/returns', frontDesk).send({
      saleId,
      reason: 'damaged',
      items: [{ productId: serum, qty: '4' }],
    });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.details.items[0]).toMatchObject({ returnable: '3.000', requested: '4.000' });
    const tooMuchRefund = await api('post', '/branch/returns', frontDesk).send({
      saleId,
      reason: 'damaged',
      items: [{ productId: serum, qty: '1' }],
      refund: { amount: '5000', method: 'cash', accountSheetId: cashSheet },
    });
    expect(tooMuchRefund.status).toBe(422);
  });

  it('holds returned stock until inspection, then restocks, writes off or sends back each item', async () => {
    const created = await api('post', '/branch/returns', frontDesk).send({
      saleId,
      reason: 'damaged',
      note: 'Box crushed in transit',
      items: [
        { productId: serum, qty: '2' },
        { productId: toner, qty: '2' },
      ],
      refund: { amount: '1500', method: 'cash', accountSheetId: cashSheet, date: '2026-09-12' },
    });
    expect(created.status).toBe(201);
    const ret = created.body.data;
    expect(ret).toMatchObject({ status: 'pending', totalQty: '4.000', refundAmount: '1500.00' });
    expect(ret.returnNo).toBe('LHR-RET-000001');
    expect(await stock(serum)).toBe('7.000');

    expect(
      (await api('post', '/branch/returns', pharmacy).send({ saleId, reason: 'other', items: [] })).status,
    ).toBe(403);
    expect((await api('get', '/branch/returns', doctor)).status).toBe(403);
    expect((await api('get', `/branch/returns/${ret.id}`, islamabadAdmin)).status).toBe(404);

    const serumItem = ret.items.find((i: { productId: string }) => i.productId === serum);
    const tonerItem = ret.items.find((i: { productId: string }) => i.productId === toner);
    const restocked = await api(
      'post',
      `/branch/returns/${ret.id}/items/${serumItem.id}/resolve`,
      pharmacy,
    ).send({
      disposition: 'restocked',
    });
    expect(restocked.status).toBe(200);
    expect(restocked.body.data.status).toBe('pending');
    expect(await stock(serum)).toBe('9.000');
    expect(
      (
        await api('post', `/branch/returns/${ret.id}/items/${serumItem.id}/resolve`, admin).send({
          disposition: 'damaged',
        })
      ).status,
    ).toBe(409);

    const damaged = await api('post', `/branch/returns/${ret.id}/items/${tonerItem.id}/resolve`, admin).send({
      disposition: 'damaged',
      note: 'Leaking',
    });
    expect(damaged.body.data.status).toBe('completed');
    expect(damaged.body.data.items.find((i: { id: string }) => i.id === tonerItem.id)).toMatchObject({
      disposition: 'damaged',
      resolutionNote: 'Leaking',
    });
    expect(await stock(toner)).toBe('8.000');
    expect((await api('delete', `/branch/returns/${ret.id}`, admin)).status).toBe(409);

    const remaining = await api('get', `/branch/returns/sale/${saleId}/returnable`, admin);
    expect(remaining.body.data).toMatchObject({ refunded: '1500.00' });
    expect(remaining.body.data.items.find((i: { productId: string }) => i.productId === serum)).toMatchObject(
      { returnable: '1.000' },
    );
  });

  it('records refunds as money leaving the account', async () => {
    const rows: { source: string; debit: string; credit: string }[] = await AppDataSource.query(
      `SELECT source, debit::text, credit::text FROM account_movements WHERE account_sheet_id = $1 ORDER BY source`,
      [cashSheet],
    );
    expect(rows).toEqual([
      { source: 'sale_payment', debit: '4000.00', credit: '0.00' },
      { source: 'sale_refund', debit: '0.00', credit: '1500.00' },
    ]);
  });

  it('keeps sales with returns intact and deletes a return that was never inspected', async () => {
    expect(
      (await api('patch', `/branch/sales/${saleId}`, admin).send({ items: [{ productId: serum, qty: '1' }] }))
        .status,
    ).toBe(409);
    expect((await api('delete', `/branch/sales/${saleId}`, admin)).status).toBe(409);

    const second = await api('post', '/branch/returns', frontDesk).send({
      saleId,
      reason: 'expired',
      items: [{ productId: serum, qty: '1' }],
    });
    expect(second.body.data.returnNo).toBe('LHR-RET-000002');
    const withRefund = await api('put', `/branch/returns/${second.body.data.id}/refund`, frontDesk).send({
      refund: { amount: '2500', method: 'cash', accountSheetId: cashSheet },
    });
    expect(withRefund.body.data.refundAmount).toBe('2500.00');
    const tooMuch = await api('put', `/branch/returns/${second.body.data.id}/refund`, frontDesk).send({
      refund: { amount: '2501', method: 'cash', accountSheetId: cashSheet },
    });
    expect(tooMuch.status).toBe(422);
    const cleared = await api('put', `/branch/returns/${second.body.data.id}/refund`, frontDesk).send({
      refund: null,
    });
    expect(cleared.body.data).toMatchObject({ refundAmount: '0.00', refundMethod: null });

    const list = await api('get', '/branch/returns?status=pending&reason=expired', admin);
    expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([second.body.data.id]);
    expect((await api('get', '/branch/returns?disposition=damaged', admin)).body.meta.total).toBe(1);
    expect((await api('get', '/branch/returns?search=LHR-RET-000002', admin)).body.meta.total).toBe(1);

    expect((await api('delete', `/branch/returns/${second.body.data.id}`, frontDesk)).status).toBe(403);
    expect((await api('delete', `/branch/returns/${second.body.data.id}`, admin)).status).toBe(204);
    expect(await stock(serum)).toBe('9.000');
  });
});
