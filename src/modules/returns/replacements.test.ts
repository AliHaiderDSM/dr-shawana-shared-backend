import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';

const fake = installFakeSupabase();
const app = createApp();

describe('Replacements for damaged or expired returns', () => {
  let admin: { id: string };
  let owner: { id: string };
  let frontDesk: { id: string };
  let dispatcher: { id: string };
  let islamabadAdmin: { id: string };
  let ownerBranch: string;
  let serum: string;
  let toner: string;
  let cashSheet: string;
  let patientId: string;
  let serials: string[];
  let saleId: string;
  let saleTotal: string;
  let returnId: string;

  const api = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    who: { id: string } = admin,
  ) => request(app)[method](`/api/v1${path}`).set(bearer(who));
  const catalog = (path: string, body: object) =>
    request(app).post(`/api/v1${path}?branchId=${ownerBranch}`).set(bearer(owner)).send(body);

  const stockOf = async (productId: string) => {
    const res = await api('get', '/branch/inventory/stock?pageSize=100');
    return res.body.data.find((r: { productId: string }) => r.productId === productId)?.quantity as string;
  };

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR', city: 'Lahore' });
    const islamabad = await createBranch({ code: 'ISB', city: 'Islamabad' });
    ownerBranch = lahore.id;
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    owner = await createStaff(fake, { role: 'super_admin', branchId: null });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahore.id });
    dispatcher = await createStaff(fake, { role: 'dispatcher', branchId: lahore.id });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });
    cashSheet = (
      await catalog('/branch/account-sheets', { accountName: 'Cash', accountCode: 'CASH', type: 'cash' })
    ).body.data.id;
    const categoryId = (await catalog('/branch/categories', { name: 'Skin' })).body.data.id;
    serum = (await catalog('/branch/products', { name: 'Serum', categoryId, salePrice: '1000' })).body.data
      .id;
    toner = (
      await catalog('/branch/products', {
        name: 'Toner',
        categoryId,
        salePrice: '500',
        initialPurchase: { date: '2026-08-01', quantity: '10', unitPrice: '300' },
      })
    ).body.data.id;
    const stockIn = await api('post', '/branch/stock-ins').send({
      date: '2026-09-01',
      items: [
        {
          productId: serum,
          qty: '6',
          unitCost: '400',
          batch: 'S-1',
          expiryDate: '2028-09-01',
          labels: 'generate',
        },
      ],
    });
    expect(stockIn.status).toBe(201);
    const pieces = await api('get', `/branch/inventory/items?pageSize=100&productId=${serum}`);
    serials = (pieces.body.data as { serial: string }[]).map((p) => p.serial).sort();
    patientId = (
      await api('post', '/branch/patients', frontDesk).send({
        name: 'Sana',
        phone: '923001112223',
        city: 'Lahore',
      })
    ).body.data.id;
    const sale = await api('post', '/branch/sales', frontDesk).send({
      patientId,
      date: '2026-10-01',
      saleType: 'office',
      items: [
        { productId: serum, qty: '2' },
        { productId: toner, qty: '2' },
      ],
      serials: [serials[0], serials[1]],
      payments: [{ method: 'cash', amount: '3000', accountSheetId: cashSheet }],
    });
    expect(sale.status).toBe(201);
    saleId = sale.body.data.id;
    saleTotal = sale.body.data.total;
    const ret = await api('post', '/branch/returns', frontDesk).send({
      saleId,
      reason: 'damaged',
      note: 'Bottle cracked on arrival',
      items: [
        { productId: serum, qty: '1', serials: [serials[0]] },
        { productId: toner, qty: '1' },
      ],
    });
    expect(ret.status).toBe(201);
    expect(ret.body.data.reason).toBe('damaged');
    returnId = ret.body.data.id;
  });

  it('lets only the branch admin or the dispatcher send a replacement, up to what came back', async () => {
    const body = {
      items: [
        { productId: serum, qty: '1' },
        { productId: toner, qty: '1' },
      ],
      serials: [serials[2]],
    };
    expect((await api('post', `/branch/returns/${returnId}/replacements`, frontDesk).send(body)).status).toBe(
      403,
    );
    expect(
      (await api('post', `/branch/returns/${returnId}/replacements`, islamabadAdmin).send(body)).status,
    ).toBe(404);
    const tooMany = await api('post', `/branch/returns/${returnId}/replacements`).send({
      items: [{ productId: serum, qty: '2' }],
      serials: [serials[2], serials[3]],
    });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.details.items[0]).toMatchObject({ replaceable: '1.000', requested: '2.000' });
    const otherProduct = await api('post', `/branch/returns/${returnId}/replacements`).send({
      items: [
        { productId: toner, qty: '1' },
        { productId: serum, qty: '1' },
      ],
    });
    expect(otherProduct.status).toBe(422);
    expect(otherProduct.body.error.details.labels[0]).toMatchObject({ required: '1', scanned: '0' });
  });

  it('hands an office replacement over now, free, with its labels, and keeps it out of sales', async () => {
    const tonerBefore = await stockOf(toner);
    const serumBefore = await stockOf(serum);
    const created = await api('post', `/branch/returns/${returnId}/replacements`).send({
      note: 'Customer sent a photo',
      items: [
        { productId: serum, qty: '1' },
        { productId: toner, qty: '1' },
      ],
      serials: [serials[2]],
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      replacementNo: 'LHR-REP-000001',
      status: 'sent',
      returnNo: 'LHR-RET-000001',
      totalQty: '2.000',
      serials: [serials[2]],
      sale: { id: saleId },
    });
    expect(Number(await stockOf(toner))).toBe(Number(tonerBefore) - 1);
    expect(Number(await stockOf(serum))).toBe(Number(serumBefore) - 1);

    const moves = (await AppDataSource.query(
      `SELECT type::text, qty::text FROM stock_movements WHERE reference_type = 'sale_replacement' AND reference_id = $1 ORDER BY qty`,
      [created.body.data.id],
    )) as { type: string; qty: string }[];
    expect(moves.map((m) => m.type)).toEqual(['replacement', 'replacement']);

    const again = await api('post', `/branch/returns/${returnId}/replacements`).send({
      items: [{ productId: toner, qty: '1' }],
    });
    expect(again.status).toBe(422);

    const sales = await api('get', '/branch/sales?pageSize=100');
    expect(sales.body.data).toHaveLength(1);
    expect(sales.body.data[0]).toMatchObject({ id: saleId, total: saleTotal });

    const returnable = await api('get', `/branch/returns/sale/${saleId}/returnable`, frontDesk);
    expect(returnable.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: serum,
          sold: '2.000',
          replaced: '1.000',
          returned: '1.000',
          returnable: '2.000',
          serials: [serials[1], serials[2]],
        }),
      ]),
    );

    const listed = await api('get', `/branch/replacements?saleReturnId=${returnId}`, frontDesk);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    const detail = await api('get', `/branch/replacements/${created.body.data.id}`, frontDesk);
    expect(detail.body.data.serials).toEqual([serials[2]]);

    expect((await api('delete', `/branch/replacements/${created.body.data.id}`)).status).toBe(409);
    expect((await api('delete', `/branch/returns/${returnId}`)).status).toBe(409);
  });

  it('waits for the dispatch on an online sale, then the stock leaves when it is sent', async () => {
    const order = await api('post', '/branch/sales', frontDesk).send({
      patientId,
      saleType: 'online',
      items: [{ productId: toner, qty: '2' }],
      payments: [{ method: 'cash', amount: '1000', accountSheetId: cashSheet }],
    });
    expect(order.status).toBe(201);
    await api('post', `/branch/sales/${order.body.data.id}/payments/approve`).send({}).expect(200);
    await api('post', `/branch/sales/${order.body.data.id}/dispatch`, dispatcher).send({}).expect(200);
    const ret = await api('post', '/branch/returns', frontDesk).send({
      saleId: order.body.data.id,
      reason: 'expired',
      items: [{ productId: toner, qty: '2' }],
    });
    expect(ret.status).toBe(201);
    const before = await stockOf(toner);
    const withLabels = await api('post', `/branch/returns/${ret.body.data.id}/replacements`).send({
      items: [{ productId: toner, qty: '2' }],
      serials: [serials[4]],
    });
    expect(withLabels.status).toBe(400);
    const created = await api('post', `/branch/returns/${ret.body.data.id}/replacements`).send({
      items: [{ productId: toner, qty: '2' }],
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      status: 'pending',
      sentOn: null,
      replacementNo: 'LHR-REP-000002',
    });
    expect(await stockOf(toner)).toBe(before);

    const pending = await api('get', '/branch/replacements?status=pending', dispatcher);
    expect(pending.body.data.map((r: { id: string }) => r.id)).toEqual([created.body.data.id]);
    expect(
      (await api('post', `/branch/replacements/${created.body.data.id}/send`, frontDesk).send({})).status,
    ).toBe(403);
    const sent = await api('post', `/branch/replacements/${created.body.data.id}/send`, dispatcher).send({});
    expect(sent.status).toBe(200);
    expect(sent.body.data).toMatchObject({ status: 'sent' });
    expect(Number(await stockOf(toner))).toBe(Number(before) - 2);
    expect(
      (await api('post', `/branch/replacements/${created.body.data.id}/send`, dispatcher).send({})).status,
    ).toBe(409);

    const another = await api('post', '/branch/sales', frontDesk).send({
      patientId,
      saleType: 'online',
      items: [{ productId: toner, qty: '1' }],
      payments: [{ method: 'cash', amount: '500', accountSheetId: cashSheet }],
    });
    await api('post', `/branch/sales/${another.body.data.id}/payments/approve`).send({}).expect(200);
    await api('post', `/branch/sales/${another.body.data.id}/dispatch`, dispatcher).send({}).expect(200);
    const second = await api('post', '/branch/returns', frontDesk).send({
      saleId: another.body.data.id,
      reason: 'damaged',
      items: [{ productId: toner, qty: '1' }],
    });
    const waiting = await api('post', `/branch/returns/${second.body.data.id}/replacements`, dispatcher).send(
      {
        items: [{ productId: toner, qty: '1' }],
      },
    );
    expect(waiting.status).toBe(201);
    expect((await api('delete', `/branch/replacements/${waiting.body.data.id}`, dispatcher)).status).toBe(
      204,
    );
    expect((await api('get', `/branch/replacements/${waiting.body.data.id}`)).status).toBe(404);
  });
});
