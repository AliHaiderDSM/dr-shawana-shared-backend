import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';

const fake = installFakeSupabase();
const app = createApp();

describe('Replacements with and without a return', () => {
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
  let invoiceNo: string;
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
    invoiceNo = sale.body.data.invoiceNo;
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

  it('waits for the Super Admin before a return replacement leaves the stock', async () => {
    const body = {
      items: [
        { productId: serum, qty: '1' },
        { productId: toner, qty: '1' },
      ],
    };
    expect((await api('post', `/branch/returns/${returnId}/replacements`, frontDesk).send(body)).status).toBe(
      403,
    );
    expect(
      (await api('post', `/branch/returns/${returnId}/replacements`, islamabadAdmin).send(body)).status,
    ).toBe(404);
    const tooMany = await api('post', `/branch/returns/${returnId}/replacements`).send({
      items: [{ productId: serum, qty: '2' }],
    });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.details.items[0]).toMatchObject({ replaceable: '1.000', requested: '2.000' });

    const tonerBefore = await stockOf(toner);
    const serumBefore = await stockOf(serum);
    const created = await api('post', `/branch/returns/${returnId}/replacements`).send({
      ...body,
      note: 'Customer sent a photo',
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data).toMatchObject({
      replacementNo: `${invoiceNo}.1`,
      replacementSeq: 1,
      status: 'pending_approval',
      reason: 'damaged',
      returnNo: 'LHR-RET-000001',
      totalQty: '2.000',
      files: [],
      sale: { id: saleId },
    });
    expect(await stockOf(toner)).toBe(tonerBefore);

    expect(
      (
        await api('post', `/branch/returns/${returnId}/replacements`).send({
          items: [{ productId: toner, qty: '1' }],
        })
      ).status,
    ).toBe(422);
    expect(
      (await api('post', `/branch/replacements/${id}/send`).send({ serials: [serials[2]] })).status,
    ).toBe(409);
    expect((await api('post', `/admin/replacements/${id}/approve`).send({})).status).toBe(403);
    expect((await api('post', `/admin/replacements/${id}/reject`, owner).send({})).status).toBe(400);

    const approved = await api('post', `/admin/replacements/${id}/approve`, owner).send({ note: 'OK' });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ status: 'approved', decidedBy: owner.id, decisionNote: 'OK' });
    expect((await api('post', `/admin/replacements/${id}/approve`, owner).send({})).status).toBe(409);
    expect((await api('delete', `/branch/replacements/${id}`)).status).toBe(409);

    const unscanned = await api('post', `/branch/replacements/${id}/send`).send({});
    expect(unscanned.status).toBe(422);
    expect(unscanned.body.error.details.labels[0]).toMatchObject({ required: '1', scanned: '0' });
    const sent = await api('post', `/branch/replacements/${id}/send`).send({ serials: [serials[2]] });
    expect(sent.status).toBe(200);
    expect(sent.body.data).toMatchObject({ status: 'sent', serials: [serials[2]] });
    expect(Number(await stockOf(toner))).toBe(Number(tonerBefore) - 1);
    expect(Number(await stockOf(serum))).toBe(Number(serumBefore) - 1);

    const moves = (await AppDataSource.query(
      `SELECT type::text FROM stock_movements WHERE reference_type = 'sale_replacement' AND reference_id = $1`,
      [id],
    )) as { type: string }[];
    expect(moves.map((m) => m.type)).toEqual(['replacement', 'replacement']);

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
    expect((await api('delete', `/branch/returns/${returnId}`)).status).toBe(409);
  });

  it('replaces products of a sale without a return, with optional proof, after approval', async () => {
    const replaceable = await api('get', `/branch/sales/${saleId}/replaceable`);
    expect(replaceable.status).toBe(200);
    expect(replaceable.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: toner, sold: '2.000', returned: '1.000', replaceable: '1.000' }),
      ]),
    );
    const body = { reason: 'damaged', note: 'Photo on WhatsApp', items: [{ productId: toner, qty: '1' }] };
    expect((await api('post', `/branch/sales/${saleId}/replacements`, frontDesk).send(body)).status).toBe(
      403,
    );
    expect(
      (await api('post', `/branch/sales/${saleId}/replacements`).send({ items: body.items })).status,
    ).toBe(400);
    expect(
      (await api('post', `/branch/sales/${saleId}/replacements`).send({ ...body, reason: 'expired' })).status,
    ).toBe(400);
    expect(
      (
        await api('post', `/branch/sales/${saleId}/replacements`).send({
          ...body,
          items: [{ productId: toner, qty: '2' }],
        })
      ).status,
    ).toBe(422);

    const created = await api('post', `/branch/sales/${saleId}/replacements`)
      .field('data', JSON.stringify(body))
      .attach('files', Buffer.from('png'), { filename: 'photo.png', contentType: 'image/png' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data).toMatchObject({
      replacementNo: `${invoiceNo}.2`,
      saleReturnId: null,
      returnNo: null,
      reason: 'damaged',
      status: 'pending_approval',
      files: [expect.objectContaining({ originalName: 'photo.png' })],
    });
    const fileUrl = await api('get', `/branch/replacements/${id}/files/${created.body.data.files[0].id}/url`);
    expect(fileUrl.status).toBe(200);

    const left = await api('get', `/branch/sales/${saleId}/replaceable`);
    expect(left.body.data.items.find((i: { productId: string }) => i.productId === toner)).toMatchObject({
      replaced: '1.000',
      replaceable: '0.000',
    });
    expect((await api('get', `/branch/badges?branchId=${ownerBranch}`, owner)).body.data.replacements).toBe(
      1,
    );

    const rejected = await api('post', `/admin/replacements/${id}/reject`, owner).send({
      note: 'Send the bottle back first',
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      status: 'rejected',
      decisionNote: 'Send the bottle back first',
    });
    const again = await api('get', `/branch/sales/${saleId}/replaceable`);
    expect(again.body.data.items.find((i: { productId: string }) => i.productId === toner)).toMatchObject({
      replaceable: '1.000',
    });
    const listed = await api('get', `/branch/replacements?saleId=${saleId}&kind=without_return`, frontDesk);
    expect(listed.body.data.map((r: { id: string }) => r.id)).toEqual([id]);
    expect((await api('delete', `/branch/replacements/${id}`)).status).toBe(409);
    expect((await api('post', `/branch/replacements/${id}/send`).send({})).status).toBe(409);
  });

  it('lets the Dispatch Department send an approved online replacement', async () => {
    const order = await api('post', '/branch/sales', frontDesk).send({
      patientId,
      saleType: 'online',
      items: [{ productId: toner, qty: '2' }],
      payments: [{ method: 'cash', amount: '1000', accountSheetId: cashSheet }],
    });
    expect(order.status).toBe(201);
    const notDispatched = await api('post', `/branch/sales/${order.body.data.id}/replacements`).send({
      reason: 'damaged',
      items: [{ productId: toner, qty: '1' }],
    });
    expect(notDispatched.status).toBe(409);
    await api('post', `/branch/sales/${order.body.data.id}/payments/approve`).send({}).expect(200);
    await api('post', `/branch/sales/${order.body.data.id}/dispatch`, dispatcher).send({}).expect(200);
    const ret = await api('post', '/branch/returns', frontDesk).send({
      saleId: order.body.data.id,
      reason: 'damaged',
      items: [{ productId: toner, qty: '2' }],
    });
    expect(ret.status).toBe(201);
    const before = await stockOf(toner);
    const created = await api('post', `/branch/returns/${ret.body.data.id}/replacements`, dispatcher).send({
      items: [{ productId: toner, qty: '2' }],
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data).toMatchObject({
      status: 'pending_approval',
      replacementNo: `${order.body.data.invoiceNo}.1`,
    });
    expect((await api('post', `/branch/replacements/${id}/send`, dispatcher).send({})).status).toBe(409);
    await api('post', `/admin/replacements/${id}/approve`, owner).send({}).expect(200);
    expect((await api('get', '/branch/badges', dispatcher)).body.data.replacements).toBe(1);
    expect((await api('post', `/branch/replacements/${id}/send`, frontDesk).send({})).status).toBe(403);
    const sent = await api('post', `/branch/replacements/${id}/send`, dispatcher).send({});
    expect(sent.status).toBe(200);
    expect(sent.body.data).toMatchObject({ status: 'sent' });
    expect(Number(await stockOf(toner))).toBe(Number(before) - 2);
    expect((await api('post', `/branch/replacements/${id}/send`, dispatcher).send({})).status).toBe(409);

    const another = await api('post', `/branch/sales/${saleId}/replacements`, dispatcher).send({
      reason: 'wrong_item',
      items: [{ productId: toner, qty: '1' }],
    });
    expect(another.status).toBe(201);
    expect((await api('delete', `/branch/replacements/${another.body.data.id}`, dispatcher)).status).toBe(
      204,
    );
    expect((await api('get', `/branch/replacements/${another.body.data.id}`)).status).toBe(404);
  });
});
