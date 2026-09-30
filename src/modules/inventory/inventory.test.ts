import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';
import { AuditLog } from '../audit/audit-log.entity';

const fake = installFakeSupabase();
const app = createApp();

describe('inventory: stock in, stock out, ledger and reports', () => {
  let admin: { id: string };
  let pharmacy: { id: string };
  let frontDesk: { id: string };
  let deliveryPrint: { id: string };
  let islamabadAdmin: { id: string };
  let lahoreId: string;
  let productId: string;
  let otherProductId: string;
  let supplierId: string;
  let dispatcherId: string;

  const post = (path: string, body: object, who = admin) =>
    request(app).post(`/api/v1${path}`).set(bearer(who)).send(body);

  async function balance(id = productId, who = admin) {
    const res = await request(app).get('/api/v1/branch/inventory/stock?pageSize=100').set(bearer(who));
    return res.body.data.find((r: { productId: string }) => r.productId === id)?.quantity as string;
  }

  beforeAll(async () => {
    lahoreId = (await createBranch({ code: 'LHR' })).id;
    const islamabad = await createBranch({ code: 'ISB' });
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahoreId });
    pharmacy = await createStaff(fake, { role: 'pharmacy', branchId: lahoreId });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
    deliveryPrint = await createStaff(fake, { role: 'delivery_print', branchId: lahoreId });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });

    const categoryId = (await post('/branch/categories', { name: 'Serums' })).body.data.id;
    productId = (
      await post('/branch/products', { name: 'Vitamin C Serum', categoryId, lowStockThreshold: '5' })
    ).body.data.id;
    otherProductId = (await post('/branch/products', { name: 'Toner', categoryId })).body.data.id;
    supplierId = (
      await post('/branch/suppliers', { name: 'Falcon', phone: '923001234567', type: 'supplier' })
    ).body.data.id;
    dispatcherId = (
      await post('/branch/suppliers', { name: 'TCS', phone: '923007654321', type: 'dispatcher' })
    ).body.data.id;
  });

  it('stock in creates one entry per item, shares files and adds stock', async () => {
    const res = await request(app)
      .post('/api/v1/branch/stock-ins')
      .set(bearer(pharmacy))
      .field(
        'data',
        JSON.stringify({
          supplierId,
          date: '2026-09-10',
          note: 'Lab batch',
          items: [
            { productId, qty: '20', batch: 'B-01' },
            { productId: otherProductId, qty: '4', batch: 'B-01' },
          ],
        }),
      )
      .attach('files', Buffer.from('%PDF-1.4'), { filename: 'invoice.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ qty: '20.000', batch: 'B-01', supplier: { name: 'Falcon' } });
    expect(res.body.data[0].attachments).toHaveLength(1);
    expect(res.body.data[1].attachments).toHaveLength(1);
    expect(await balance()).toBe('20.000');

    const url = await request(app)
      .get(
        `/api/v1/branch/stock-ins/${res.body.data[0].id}/attachments/${res.body.data[0].attachments[0].id}/url`,
      )
      .set(bearer(pharmacy));
    expect(url.status).toBe(200);
    expect(url.body.data.url).toContain('stock-files');
  });

  it('checks the supplier type', async () => {
    const res = await post('/branch/stock-ins', {
      supplierId: dispatcherId,
      date: '2026-09-10',
      items: [{ productId, qty: '1' }],
    });
    expect(res.status).toBe(400);
    const out = await post('/branch/stock-outs', {
      dispatcherId: supplierId,
      date: '2026-09-10',
      items: [{ productId, qty: '1', destination: 'Karachi Office' }],
    });
    expect(out.status).toBe(400);
  });

  it('stock out reduces stock and refuses to go negative', async () => {
    const short = await post('/branch/stock-outs', {
      dispatcherId,
      date: '2026-09-11',
      items: [{ productId, qty: '25', destination: 'Karachi Office' }],
    });
    expect(short.status).toBe(422);
    expect(short.body.error.details.shortages[0]).toMatchObject({ available: '20', required: '25' });

    const ok = await post('/branch/stock-outs', {
      dispatcherId,
      date: '2026-09-11',
      items: [{ productId, qty: '8', destination: 'Karachi Office' }],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data[0]).toMatchObject({ destination: 'Karachi Office', dispatcher: { name: 'TCS' } });
    expect(await balance()).toBe('12.000');

    const list = await request(app)
      .get('/api/v1/branch/stock-outs?destination=Karachi%20Office')
      .set(bearer(admin));
    expect(list.body.meta.total).toBe(1);
  });

  it('editing reverses the old movement and posts the new one, with an audit log', async () => {
    const created = await post('/branch/stock-ins', {
      date: '2026-09-12',
      items: [{ productId, qty: '10' }],
    });
    const id = created.body.data[0].id;
    expect(await balance()).toBe('22.000');

    const edited = await request(app)
      .patch(`/api/v1/branch/stock-ins/${id}`)
      .set(bearer(admin))
      .send({ qty: '3' });
    expect(edited.status).toBe(200);
    expect(await balance()).toBe('15.000');

    const movements: { qty: string; reversal: boolean }[] = await AppDataSource.query(
      `SELECT qty::text AS qty, reversal_of_id IS NOT NULL AS reversal FROM stock_movements
        WHERE reference_id = $1 ORDER BY created_at`,
      [id],
    );
    expect(movements).toEqual([
      { qty: '10.000', reversal: false },
      { qty: '-10.000', reversal: true },
      { qty: '3.000', reversal: false },
    ]);
    expect(
      await AppDataSource.getRepository(AuditLog).count({ where: { entityId: id, action: 'update' } }),
    ).toBe(1);

    expect((await request(app).delete(`/api/v1/branch/stock-ins/${id}`).set(bearer(admin))).status).toBe(204);
    expect(await balance()).toBe('12.000');
  });

  it('refuses an edit that would make stock negative', async () => {
    const created = await post('/branch/stock-ins', {
      date: '2026-09-13',
      items: [{ productId: otherProductId, qty: '2' }],
    });
    await post('/branch/stock-outs', {
      date: '2026-09-13',
      items: [{ productId: otherProductId, qty: '6', destination: 'Other' }],
    });
    const res = await request(app)
      .delete(`/api/v1/branch/stock-ins/${created.body.data[0].id}`)
      .set(bearer(admin));
    expect(res.status).toBe(422);
  });

  it('computes balance, sold and returned from the one ledger', async () => {
    await AppDataSource.query(
      `INSERT INTO stock_movements (branch_id, product_id, type, qty, reference_type, reference_id, date) VALUES
        ($1, $2, 'sale', -4, 'sale', gen_random_uuid(), '2026-09-20'),
        ($1, $2, 'sale_return', 1, 'sale', gen_random_uuid(), '2026-09-21')`,
      [lahoreId, productId],
    );
    expect(await balance()).toBe('9.000');

    const report = await request(app)
      .get(`/api/v1/branch/inventory/report?from=2026-09-11&to=2026-09-30&productId=${productId}`)
      .set(bearer(frontDesk));
    expect(report.status).toBe(200);
    expect(report.body.data.rows[0]).toMatchObject({
      opening: '20.000',
      stockIn: '0.000',
      stockOut: '8.000',
      sold: '4.000',
      returned: '1.000',
      closing: '9.000',
    });

    const ledger = await request(app)
      .get(`/api/v1/branch/inventory/products/${productId}/ledger?from=2026-09-11`)
      .set(bearer(admin));
    expect(ledger.body.data).toMatchObject({ opening: '20.000', closing: '9.000' });
    expect(ledger.body.data.movements.at(-1)).toMatchObject({
      type: 'sale_return',
      in: '1.000',
      balance: '9.000',
    });
  });

  it('flags low stock and filters by it', async () => {
    const low = await request(app).get('/api/v1/branch/inventory/stock?lowStockOnly=true').set(bearer(admin));
    const ids = low.body.data.map((r: { productId: string }) => r.productId);
    expect(ids).toContain(otherProductId);
    expect(ids).not.toContain(productId);
  });

  it('applies roles', async () => {
    expect((await request(app).get('/api/v1/branch/inventory/stock').set(bearer(deliveryPrint))).status).toBe(
      403,
    );
    expect((await request(app).get('/api/v1/branch/stock-ins').set(bearer(frontDesk))).status).toBe(403);
    const created = await post(
      '/branch/stock-ins',
      { date: '2026-09-14', items: [{ productId, qty: '1' }] },
      pharmacy,
    );
    expect(created.status).toBe(201);
    expect(
      (await request(app).delete(`/api/v1/branch/stock-ins/${created.body.data[0].id}`).set(bearer(pharmacy)))
        .status,
    ).toBe(403);
  });

  it('isolates branches', async () => {
    const created = await post('/branch/stock-ins', { date: '2026-09-15', items: [{ productId, qty: '1' }] });
    const id = created.body.data[0].id;
    expect(
      (await request(app).get(`/api/v1/branch/stock-ins/${id}`).set(bearer(islamabadAdmin))).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/v1/branch/stock-ins/${id}`)
          .set(bearer(islamabadAdmin))
          .send({ qty: '99' })
      ).status,
    ).toBe(404);
    const foreign = await post(
      '/branch/stock-ins',
      { date: '2026-09-15', items: [{ productId, qty: '100' }] },
      islamabadAdmin,
    );
    expect(foreign.status).toBe(400);
    const stock = await request(app).get('/api/v1/branch/inventory/stock').set(bearer(islamabadAdmin));
    expect(stock.body.data).toHaveLength(0);
    const ledger = await request(app)
      .get(`/api/v1/branch/inventory/products/${productId}/ledger`)
      .set(bearer(islamabadAdmin));
    expect(ledger.status).toBe(404);
  });
});
