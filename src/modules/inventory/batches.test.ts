import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

interface Allocation {
  batchNo: string | null;
  qty: string;
}

describe('product batches: stock in, FEFO sales, expiry and returns', () => {
  let admin: { id: string };
  let frontDesk: { id: string };
  let islamabadAdmin: { id: string };
  let serum: string;
  let cream: string;
  let patientId: string;
  let cashSheet: string;
  let saleId: string;

  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: { id: string } = admin) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));

  const stockIn = (items: Record<string, unknown>[], date = '2026-09-01') =>
    api('post', '/branch/stock-ins', admin).send({ date, items });

  const sell = (productId: string, qty: string, date = '2026-10-01') =>
    api('post', '/branch/sales', frontDesk).send({
      patientId,
      date,
      saleType: 'office',
      items: [{ productId, qty }],
      payments: [{ method: 'cash', amount: '1', accountSheetId: cashSheet }],
    });

  async function batches(productId: string) {
    const res = await api('get', `/branch/inventory/batches?productId=${productId}`);
    return Object.fromEntries(
      (res.body.data as { batchNo: string; quantity: string }[]).map((b) => [b.batchNo, b.quantity]),
    );
  }

  const allocations = (list: Allocation[]) => Object.fromEntries(list.map((b) => [b.batchNo, b.qty]));

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR', city: 'Lahore' });
    const islamabad = await createBranch({ code: 'ISB', city: 'Islamabad' });
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahore.id });
    cashSheet = (
      await request(app)
        .post('/api/v1/branch/account-sheets')
        .set(bearer(admin))
        .send({ accountName: 'Cash', accountCode: 'CASH', type: 'cash' })
    ).body.data.id;
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });
    const categoryId = (await api('post', '/branch/categories').send({ name: 'Skin' })).body.data.id;
    serum = (await api('post', '/branch/products').send({ name: 'Vitamin C Serum', categoryId })).body.data
      .id;
    cream = (await api('post', '/branch/products').send({ name: 'Night Cream', categoryId })).body.data.id;
    patientId = (
      await api('post', '/branch/patients', frontDesk).send({
        name: 'Sana',
        phone: '923001112223',
        city: 'Lahore',
      })
    ).body.data.id;
  });

  it('creates a batch on stock in and adds a repeat batch number to the same batch', async () => {
    const first = await stockIn([
      {
        productId: serum,
        qty: '100',
        batch: 'BATCH-001',
        manufacturingDate: '2026-09-01',
        expiryDate: '2028-09-01',
        unitCost: '500',
      },
    ]);
    expect(first.status).toBe(201);
    expect(first.body.data[0]).toMatchObject({
      batch: 'BATCH-001',
      manufacturingDate: '2026-09-01',
      expiryDate: '2028-09-01',
      unitCost: '500.00',
    });
    expect(first.body.data[0].batchId).toEqual(expect.any(String));

    const again = await stockIn([{ productId: serum, qty: '20', batch: 'BATCH-001' }], '2026-09-02');
    expect(again.body.data[0].batchId).toBe(first.body.data[0].batchId);
    expect(again.body.data[0].expiryDate).toBe('2028-09-01');

    const second = await stockIn([
      {
        productId: serum,
        qty: '50',
        batch: 'BATCH-002',
        manufacturingDate: '2026-08-01',
        expiryDate: '2027-03-01',
      },
    ]);
    expect(second.body.data[0].batchId).not.toBe(first.body.data[0].batchId);
    expect(await batches(serum)).toEqual({ 'BATCH-001': '120.000', 'BATCH-002': '50.000' });

    const list = await api('get', `/branch/inventory/batches?productId=${serum}`);
    expect(list.body.data[0]).toMatchObject({ batchNo: 'BATCH-002', received: '50.000', status: 'ok' });
  });

  it('validates batch fields and refuses a conflicting expiry', async () => {
    const noBatch = await stockIn([{ productId: serum, qty: '1', expiryDate: '2028-01-01' }]);
    expect(noBatch.status).toBe(400);
    const backwards = await stockIn([
      { productId: serum, qty: '1', batch: 'X', manufacturingDate: '2026-09-01', expiryDate: '2026-01-01' },
    ]);
    expect(backwards.status).toBe(400);
    const conflict = await stockIn([
      { productId: serum, qty: '1', batch: 'BATCH-001', expiryDate: '2029-01-01' },
    ]);
    expect(conflict.status).toBe(409);
  });

  it('shows the batches a stock out took, first expiry first', async () => {
    const out = await api('post', '/branch/stock-outs').send({
      date: '2026-09-03',
      items: [{ productId: serum, qty: '60', destination: 'Office' }],
    });
    expect(out.status).toBe(201);
    expect(out.body.data[0].batches).toEqual([
      { batchNo: 'BATCH-002', manufacturingDate: '2026-08-01', expiryDate: '2027-03-01', qty: '50.000' },
      { batchNo: 'BATCH-001', manufacturingDate: '2026-09-01', expiryDate: '2028-09-01', qty: '10.000' },
    ]);
    const listed = (await api('get', '/branch/stock-outs')).body.data[0];
    expect(listed.batches).toHaveLength(2);
    expect((await api('delete', `/branch/stock-outs/${out.body.data[0].id}`)).status).toBe(204);
    expect(await batches(serum)).toEqual({ 'BATCH-001': '120.000', 'BATCH-002': '50.000' });
  });

  it('sells from the batch that expires first and shows the batches on the sale', async () => {
    const sale = await sell(serum, '3');
    expect(sale.status).toBe(201);
    saleId = sale.body.data.id;
    const detail = await api('get', `/branch/sales/${saleId}`, frontDesk);
    expect(allocations(detail.body.data.batches)).toEqual({ 'BATCH-002': '3.000' });
    expect(await batches(serum)).toEqual({ 'BATCH-001': '120.000', 'BATCH-002': '47.000' });

    const big = await sell(serum, '50');
    const bigDetail = await api('get', `/branch/sales/${big.body.data.id}`, frontDesk);
    expect(allocations(bigDetail.body.data.batches)).toEqual({ 'BATCH-002': '47.000', 'BATCH-001': '3.000' });
    expect(await batches(serum)).toEqual({ 'BATCH-001': '117.000', 'BATCH-002': '0.000' });

    expect((await api('delete', `/branch/sales/${big.body.data.id}`)).status).toBe(204);
    expect(await batches(serum)).toEqual({ 'BATCH-001': '120.000', 'BATCH-002': '47.000' });
  });

  it('puts stock back into the same batch when a sale is edited down', async () => {
    const edited = await api('patch', `/branch/sales/${saleId}`, frontDesk).send({
      items: [{ productId: serum, qty: '1' }],
    });
    expect(edited.status).toBe(200);
    expect(await batches(serum)).toEqual({ 'BATCH-001': '120.000', 'BATCH-002': '49.000' });
    const detail = await api('get', `/branch/sales/${saleId}`, frontDesk);
    expect(allocations(detail.body.data.batches)).toEqual({ 'BATCH-002': '1.000' });
  });

  it('never sells an expired batch and lets it be written off', async () => {
    await stockIn([
      { productId: cream, qty: '5', batch: 'OLD', manufacturingDate: '2025-01-01', expiryDate: '2026-06-30' },
      { productId: cream, qty: '2', batch: 'NEW', expiryDate: '2027-06-30' },
    ]);
    const stock = await api('get', '/branch/inventory/stock?pageSize=100');
    expect(stock.body.data.find((r: { productId: string }) => r.productId === cream)).toMatchObject({
      quantity: '7.000',
      expiredQuantity: '5.000',
    });

    const tooMuch = await sell(cream, '3');
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.details.shortages[0]).toMatchObject({
      available: '2',
      required: '3',
      expired: '5',
    });
    const ok = await sell(cream, '2');
    expect(ok.status).toBe(201);
    expect(await batches(cream)).toEqual({ OLD: '5.000', NEW: '0.000' });

    const expired = await api('get', `/branch/inventory/batches?productId=${cream}&status=expired`);
    expect(expired.body.data).toHaveLength(1);
    expect(expired.body.data[0]).toMatchObject({ batchNo: 'OLD', status: 'expired' });
    const tooLarge = await api('post', `/branch/inventory/batches/${expired.body.data[0].id}/write-off`).send(
      {
        qty: '6',
        reason: 'expired',
      },
    );
    expect(tooLarge.status).toBe(422);
    const writeOff = await api('post', `/branch/inventory/batches/${expired.body.data[0].id}/write-off`).send(
      {
        qty: '5',
        reason: 'expired',
        note: 'Disposed',
      },
    );
    expect(writeOff.status).toBe(200);
    expect(writeOff.body.data.quantity).toBe('0.000');
    expect(writeOff.body.data.movements.at(-1)).toMatchObject({ type: 'adjustment', qty: '-5.000' });
    expect(
      (
        await api('post', `/branch/inventory/batches/${expired.body.data[0].id}/write-off`, frontDesk).send({
          qty: '1',
          reason: 'expired',
        })
      ).status,
    ).toBe(403);
  });

  it('holds a return for inspection, quarantines it, then restocks into the sold batch', async () => {
    const ret = await api('post', '/branch/returns', frontDesk).send({
      saleId,
      reason: 'damaged',
      items: [{ productId: serum, qty: '1' }],
    });
    expect(ret.status).toBe(201);
    const id = ret.body.data.id;
    const itemId = ret.body.data.items[0].id;
    expect(await batches(serum)).toEqual({ 'BATCH-001': '120.000', 'BATCH-002': '49.000' });

    const detail = await api('get', `/branch/returns/${id}`, frontDesk);
    expect(allocations(detail.body.data.soldBatches)).toEqual({ 'BATCH-002': '1.000' });

    const quarantined = await api('post', `/branch/returns/${id}/items/${itemId}/resolve`).send({
      disposition: 'quarantined',
    });
    expect(quarantined.status).toBe(200);
    expect(quarantined.body.data).toMatchObject({ status: 'pending' });
    expect(
      (
        await api('post', `/branch/returns/${id}/items/${itemId}/resolve`).send({
          disposition: 'quarantined',
        })
      ).status,
    ).toBe(409);

    const restocked = await api('post', `/branch/returns/${id}/items/${itemId}/resolve`).send({
      disposition: 'restocked',
    });
    expect(restocked.status).toBe(200);
    expect(restocked.body.data.status).toBe('completed');
    expect(await batches(serum)).toEqual({ 'BATCH-001': '120.000', 'BATCH-002': '50.000' });
    const after = await api('get', `/branch/returns/${id}`, frontDesk);
    expect(allocations(after.body.data.restockedBatches)).toEqual({ 'BATCH-002': '1.000' });
  });

  it('records an expired return without adding stock', async () => {
    const sale = await sell(serum, '2');
    const ret = await api('post', '/branch/returns', frontDesk).send({
      saleId: sale.body.data.id,
      reason: 'expired',
      items: [{ productId: serum, qty: '2' }],
    });
    const resolved = await api(
      'post',
      `/branch/returns/${ret.body.data.id}/items/${ret.body.data.items[0].id}/resolve`,
    ).send({ disposition: 'expired' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.items[0].disposition).toBe('expired');
    expect(await batches(serum)).toEqual({ 'BATCH-001': '120.000', 'BATCH-002': '48.000' });
  });

  it('keeps one batch per number when the same batch is received at the same time', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        stockIn([{ productId: cream, qty: '1', batch: 'RUSH', expiryDate: '2027-01-01' }]),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.body.data[0].batchId)).size).toBe(1);
    expect((await batches(cream)).RUSH).toBe('5.000');
  });

  it('keeps batches inside their branch', async () => {
    const list = await api('get', '/branch/inventory/batches', islamabadAdmin);
    expect(list.body.data).toEqual([]);
    const own = await api('get', `/branch/inventory/batches?productId=${serum}`);
    expect(
      (await api('get', `/branch/inventory/batches/${own.body.data[0].id}`, islamabadAdmin)).status,
    ).toBe(404);
  });
});
