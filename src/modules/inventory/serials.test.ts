import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';

const fake = installFakeSupabase();
const app = createApp();

describe('labelled pieces: DSM serials from stock in to sale and return', () => {
  let admin: { id: string };
  let frontDesk: { id: string };
  let islamabadAdmin: { id: string };
  let serum: string;
  let cream: string;
  let toner: string;
  let patientId: string;
  let firstStockIn: { id: string; batchId: string };
  let serials: string[];
  let saleId: string;
  let invoiceNo: string;

  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: { id: string } = admin) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));

  const stockIn = (items: Record<string, unknown>[], date = '2026-09-01') =>
    api('post', '/branch/stock-ins').send({ date, items });

  const pieces = async (query: string) => {
    const all: { serial: string; status: string; batchNo: string | null }[] = [];
    for (let page = 1; ; page += 1) {
      const res = await api('get', `/branch/inventory/items?pageSize=100&page=${page}&${query}`);
      all.push(...res.body.data);
      if (page >= res.body.meta.totalPages) return all;
    }
  };

  const stockOf = async (productId: string) => {
    const res = await api('get', '/branch/inventory/stock?pageSize=100');
    return res.body.data.find((r: { productId: string }) => r.productId === productId)?.quantity as string;
  };

  const sell = (body: Record<string, unknown>) =>
    api('post', '/branch/sales', frontDesk).send({
      patientId,
      date: '2026-10-01',
      saleType: 'office',
      payments: [],
      ...body,
    });

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR', city: 'Lahore' });
    const islamabad = await createBranch({ code: 'ISB', city: 'Islamabad' });
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahore.id });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });
    const categoryId = (await api('post', '/branch/categories').send({ name: 'Skin' })).body.data.id;
    const product = async (name: string, extra: Record<string, unknown> = {}) =>
      (await api('post', '/branch/products').send({ name, categoryId, salePrice: '1000', ...extra })).body
        .data.id;
    serum = await product('Vitamin C Serum');
    cream = await product('Night Cream', {
      initialPurchase: { date: '2026-08-01', quantity: '10', unitPrice: '700' },
    });
    toner = await product('Toner');
    patientId = (
      await api('post', '/branch/patients', frontDesk).send({
        name: 'Sana',
        phone: '923001112223',
        city: 'Lahore',
      })
    ).body.data.id;
  });

  it('creates one numbered piece per unit received and marks the product as tracked', async () => {
    const res = await stockIn([
      {
        productId: serum,
        qty: '100',
        batch: 'B-001',
        manufacturingDate: '2026-09-01',
        expiryDate: '2028-09-01',
        labels: 'generate',
      },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data[0].labels).toEqual({
      count: 100,
      firstSerial: 'DSM-000001',
      lastSerial: 'DSM-000100',
    });
    firstStockIn = res.body.data[0];

    const list = await pieces(`productId=${serum}`);
    expect(list).toHaveLength(100);
    expect(new Set(list.map((p) => p.serial)).size).toBe(100);
    expect(list.every((p) => p.status === 'in_stock' && p.batchNo === 'B-001')).toBe(true);
    serials = list.map((p) => p.serial);

    expect((await api('get', `/branch/products/${serum}`)).body.data.trackSerials).toBe(true);
    expect(await stockOf(serum)).toBe('100.000');
  });

  it('registers packs that already carry consecutive labels as a separate batch', async () => {
    const res = await stockIn([
      {
        productId: serum,
        qty: '20',
        batch: 'B-002',
        expiryDate: '2027-01-01',
        labels: 'existing',
        firstSerial: 'DSM-000500',
      },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data[0].labels).toEqual({
      count: 20,
      firstSerial: 'DSM-000500',
      lastSerial: 'DSM-000519',
    });
    expect(res.body.data[0].batchId).not.toBe(firstStockIn.batchId);

    const overlap = await stockIn([
      { productId: serum, qty: '5', batch: 'B-002', labels: 'existing', firstSerial: 'DSM-000518' },
    ]);
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.details.serials).toEqual(['DSM-000518', 'DSM-000519']);

    const next = await stockIn([{ productId: toner, qty: '2', labels: 'generate' }]);
    expect(next.body.data[0].labels).toMatchObject({ firstSerial: 'DSM-000520', lastSerial: 'DSM-000521' });
  });

  it('refuses stock in of a tracked product without labels and fractional labelled quantities', async () => {
    expect((await stockIn([{ productId: serum, qty: '5', batch: 'B-001' }])).status).toBe(422);
    expect((await stockIn([{ productId: toner, qty: '1.5', labels: 'generate' }])).status).toBe(400);
  });

  it('never hands out the same number twice when stock arrives at the same time', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => stockIn([{ productId: toner, qty: '25', labels: 'generate' }])),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const all = await pieces(`productId=${toner}`);
    expect(all).toHaveLength(102);
    expect(new Set(all.map((p) => p.serial)).size).toBe(102);
  });

  it('sells exactly the scanned pieces and refuses a sale without them', async () => {
    const unscanned = await sell({ items: [{ productId: serum, qty: '3' }] });
    expect(unscanned.status).toBe(422);
    expect(unscanned.body.error.details.labels[0]).toMatchObject({ required: '3', scanned: '0' });

    const sold = [serials[20]!, serials[21]!, serials[22]!];
    const sale = await sell({
      items: [{ productId: serum, qty: '3' }],
      serials: sold.map((s) => s.toLowerCase()),
    });
    expect(sale.status).toBe(201);
    expect(sale.body.data.invoiceNo).toMatch(/^LHR-\d{6}$/);
    saleId = sale.body.data.id;
    invoiceNo = sale.body.data.invoiceNo;

    const detail = await api('get', `/branch/sales/${saleId}`, frontDesk);
    expect(detail.body.data.serials.map((p: { serial: string }) => p.serial)).toEqual(sold);
    expect(detail.body.data.batches).toEqual([expect.objectContaining({ batchNo: 'B-001', qty: '3.000' })]);
    expect((await pieces(`saleId=${saleId}`)).every((p) => p.status === 'sold')).toBe(true);
    expect(await stockOf(serum)).toBe('117.000');
  });

  it('refuses a piece that is already sold, from another product or another branch', async () => {
    const again = await sell({ items: [{ productId: serum, qty: '1' }], serials: [serials[20]] });
    expect(again.status).toBe(422);
    expect(again.body.error.message).toContain('already sold');

    const wrong = await sell({ items: [{ productId: serum, qty: '1' }], serials: ['DSM-000520'] });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details.serials[0].problem).toContain('Toner');

    const twice = await sell({
      items: [{ productId: serum, qty: '2' }],
      serials: [serials[30], serials[30]],
    });
    expect(twice.status).toBe(400);

    const elsewhere = await api('get', `/branch/inventory/items/serial/${serials[30]}`, islamabadAdmin);
    expect(elsewhere.status).toBe(404);
  });

  it('refuses to sell a piece of an expired batch', async () => {
    const res = await stockIn([
      { productId: serum, qty: '2', batch: 'OLD', expiryDate: '2026-06-30', labels: 'generate' },
    ]);
    const old = res.body.data[0].labels.firstSerial;
    const sale = await sell({ items: [{ productId: serum, qty: '1' }], serials: [old] });
    expect(sale.status).toBe(422);
    expect(sale.body.error.message).toContain('expired');
  });

  it('swaps pieces when a sale is edited and frees them when it is deleted', async () => {
    const edited = await api('patch', `/branch/sales/${saleId}`, frontDesk).send({
      items: [{ productId: serum, qty: '3' }],
      serials: [serials[20], serials[21], serials[40]],
    });
    expect(edited.status).toBe(200);
    expect((await pieces(`saleId=${saleId}`)).map((p) => p.serial).sort()).toEqual(
      [serials[20], serials[21], serials[40]].sort(),
    );
    const freed = await api('get', `/branch/inventory/items/serial/${serials[22]}`);
    expect(freed.body.data.status).toBe('in_stock');
    expect(freed.body.data.history.map((h: { type: string }) => h.type)).toEqual([
      'received',
      'sold',
      'sale_edited',
    ]);
    expect(await stockOf(serum)).toBe('119.000');

    const keepLabels = await api('patch', `/branch/sales/${saleId}`, frontDesk).send({ note: 'Kept' });
    expect(keepLabels.status).toBe(200);

    const temp = await sell({ items: [{ productId: serum, qty: '1' }], serials: [serials[50]] });
    expect((await api('delete', `/branch/sales/${temp.body.data.id}`, admin)).status).toBe(204);
    expect((await api('get', `/branch/inventory/items/serial/${serials[50]}`)).body.data.status).toBe(
      'in_stock',
    );
  });

  it('returns the scanned piece for inspection, then quarantines and restocks it', async () => {
    const returnable = await api('get', `/branch/returns/sale/${saleId}/returnable`, frontDesk);
    expect(returnable.body.data.items[0]).toMatchObject({ trackSerials: true });
    expect(returnable.body.data.items[0].serials).toHaveLength(3);

    const unscanned = await api('post', '/branch/returns', frontDesk).send({
      saleId,
      reason: 'damaged',
      items: [{ productId: serum, qty: '1' }],
    });
    expect(unscanned.status).toBe(422);
    const notOnSale = await api('post', '/branch/returns', frontDesk).send({
      saleId,
      reason: 'damaged',
      items: [{ productId: serum, qty: '1', serials: [serials[60]] }],
    });
    expect(notOnSale.status).toBe(422);

    const ret = await api('post', '/branch/returns', frontDesk).send({
      saleId,
      reason: 'damaged',
      items: [{ productId: serum, qty: '2', serials: [serials[20], serials[21]] }],
    });
    expect(ret.status).toBe(201);
    expect(ret.body.data.items).toHaveLength(2);
    const id = ret.body.data.id;
    const detail = await api('get', `/branch/returns/${id}`, frontDesk);
    const [first, second] = detail.body.data.items as { id: string; serial: string }[];
    expect([first!.serial, second!.serial].sort()).toEqual([serials[20], serials[21]].sort());
    expect((await api('get', `/branch/inventory/items/serial/${first!.serial}`)).body.data.status).toBe(
      'returned',
    );
    expect(await stockOf(serum)).toBe('119.000');

    await api('post', `/branch/returns/${id}/items/${first!.id}/resolve`).send({
      disposition: 'quarantined',
    });
    expect((await api('get', `/branch/inventory/items/serial/${first!.serial}`)).body.data.status).toBe(
      'quarantined',
    );
    await api('post', `/branch/returns/${id}/items/${first!.id}/resolve`).send({ disposition: 'restocked' });
    await api('post', `/branch/returns/${id}/items/${second!.id}/resolve`).send({ disposition: 'damaged' });

    const back = await api('get', `/branch/inventory/items/serial/${first!.serial}`);
    expect(back.body.data).toMatchObject({
      status: 'in_stock',
      invoiceNo,
      batchNo: 'B-001',
      patientName: 'Sana',
    });
    expect(back.body.data.history.map((h: { type: string }) => h.type)).toEqual([
      'received',
      'sold',
      'returned',
      'quarantined',
      'restocked',
    ]);
    expect((await api('get', `/branch/inventory/items/serial/${second!.serial}`)).body.data.status).toBe(
      'damaged',
    );
    expect(await stockOf(serum)).toBe('120.000');
  });

  it('sends out exactly the scanned pieces and takes them back when the entry is removed', async () => {
    const dispatcherId = (
      await api('post', '/branch/suppliers').send({ name: 'TCS', type: 'dispatcher', phone: '923001234567' })
    ).body.data.id;
    const missing = await api('post', '/branch/stock-outs').send({
      dispatcherId,
      date: '2026-10-02',
      items: [{ productId: serum, qty: '2', destination: 'Karachi Office' }],
    });
    expect(missing.status).toBe(422);
    const out = await api('post', '/branch/stock-outs').send({
      dispatcherId,
      date: '2026-10-02',
      items: [
        { productId: serum, qty: '2', destination: 'Karachi Office', serials: [serials[70], serials[71]] },
      ],
    });
    expect(out.status).toBe(201);
    expect(out.body.data[0].labels).toMatchObject({ count: 2 });
    expect((await api('get', `/branch/inventory/items/serial/${serials[70]}`)).body.data.status).toBe(
      'dispatched',
    );
    expect(await stockOf(serum)).toBe('118.000');
    expect((await api('patch', `/branch/stock-outs/${out.body.data[0].id}`).send({ qty: '1' })).status).toBe(
      409,
    );
    expect((await api('delete', `/branch/stock-outs/${out.body.data[0].id}`)).status).toBe(204);
    expect((await api('get', `/branch/inventory/items/serial/${serials[70]}`)).body.data.status).toBe(
      'in_stock',
    );
    expect(await stockOf(serum)).toBe('120.000');
  });

  it('labels stock already on hand and keeps purchase entries away from tracked products', async () => {
    const tooMany = await api('post', '/branch/inventory/items/register').send({
      productId: cream,
      firstSerial: 'DSM-000900',
      qty: 11,
    });
    expect(tooMany.status).toBe(422);
    const ok = await api('post', '/branch/inventory/items/register').send({
      productId: cream,
      firstSerial: 'DSM-000900',
      qty: 10,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toEqual({ count: 10, firstSerial: 'DSM-000900', lastSerial: 'DSM-000909' });
    expect(await stockOf(cream)).toBe('10.000');
    const summary = await api('get', `/branch/inventory/products/${cream}/serials`);
    expect(summary.body.data).toMatchObject({
      trackSerials: true,
      byStatus: { in_stock: 10 },
      unlabelled: [],
    });

    const purchase = await api('post', `/branch/products/${cream}/purchases`).send({
      date: '2026-10-01',
      quantity: '5',
      unitPrice: '700',
    });
    expect(purchase.status).toBe(409);
  });

  it('removes untouched pieces with their stock in, and refuses once a piece has moved', async () => {
    expect((await api('delete', `/branch/stock-ins/${firstStockIn.id}`)).status).toBe(409);
    const extra = await stockIn([{ productId: toner, qty: '3', labels: 'generate' }]);
    const range = extra.body.data[0].labels;
    expect((await api('delete', `/branch/stock-ins/${extra.body.data[0].id}`)).status).toBe(204);
    expect((await api('get', `/branch/inventory/items/serial/${range.firstSerial}`)).status).toBe(404);
    const [{ n }] = (await AppDataSource.query(
      'SELECT COUNT(*)::int AS n FROM inventory_items WHERE serial = $1',
      [range.firstSerial],
    )) as [{ n: number }];
    expect(n).toBe(0);
  });

  it('keeps the ledger and the pieces in step', async () => {
    const rows: { productId: string; ledger: string; pieces: number }[] = await AppDataSource.query(
      `SELECT p.id AS "productId",
              COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.product_id = p.id), 0)::text AS ledger,
              (SELECT COUNT(*)::int FROM inventory_items i WHERE i.product_id = p.id AND i.status = 'in_stock') AS pieces
         FROM products p WHERE p.id = ANY($1)`,
      [[serum, cream, toner]],
    );
    for (const row of rows) expect(Number(row.ledger)).toBe(row.pieces);
  });
});
