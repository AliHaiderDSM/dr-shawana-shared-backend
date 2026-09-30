import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';
import { AuditLog } from '../audit/audit-log.entity';
import { StockMovement } from '../inventory/stock-movement.entity';

const fake = installFakeSupabase();
const app = createApp();

async function stockOf(productId: string) {
  const rows: { qty: string }[] = await AppDataSource.query(
    `SELECT COALESCE(SUM(qty), 0)::text AS qty FROM stock_movements WHERE product_id = $1`,
    [productId],
  );
  return rows[0]!.qty;
}

describe('products and purchase entries', () => {
  let lahoreAdmin: { id: string };
  let islamabadAdmin: { id: string };
  let accountant: { id: string };
  let storeKeeper: { id: string };
  let frontDesk: { id: string };
  let categoryId: string;
  let islamabadCategoryId: string;
  let supplierId: string;

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR' });
    const islamabad = await createBranch({ code: 'ISB' });
    lahoreAdmin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });
    accountant = await createStaff(fake, { role: 'accountant', branchId: lahore.id });
    storeKeeper = await createStaff(fake, { role: 'store_keeper', branchId: lahore.id });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahore.id });

    categoryId = (
      await request(app).post('/api/v1/branch/categories').set(bearer(lahoreAdmin)).send({ name: 'Oils' })
    ).body.data.id;
    islamabadCategoryId = (
      await request(app).post('/api/v1/branch/categories').set(bearer(islamabadAdmin)).send({ name: 'Oils' })
    ).body.data.id;
    supplierId = (
      await request(app)
        .post('/api/v1/branch/suppliers')
        .set(bearer(lahoreAdmin))
        .send({ name: 'Falcon Traders', phone: '923001234567', type: 'supplier' })
    ).body.data.id;
  });

  const createProduct = (body: Record<string, unknown>, who = lahoreAdmin) =>
    request(app).post('/api/v1/branch/products').set(bearer(who)).send(body);

  it('creates a product with its first purchase entry, stock and sale price', async () => {
    const res = await createProduct({
      name: 'Hair Oil',
      categoryId,
      batchNo: '100',
      sizeGrams: '100',
      initialPurchase: { supplierId, date: '2026-09-01', quantity: '20', unitPrice: '1500' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Hair Oil',
      salePrice: '1500.00',
      category: { name: 'Oils' },
    });
    expect(await stockOf(res.body.data.id)).toBe('20.000');
  });

  it('uses the latest purchase entry price as the sale price and keeps history', async () => {
    const product = (await createProduct({ name: 'Face Serum', categoryId })).body.data;
    const url = `/api/v1/branch/products/${product.id}/purchases`;

    const first = await request(app)
      .post(url)
      .set(bearer(lahoreAdmin))
      .send({ date: '2026-09-02', quantity: '10', unitPrice: '800.50' });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post(url)
      .set(bearer(lahoreAdmin))
      .send({ date: '2026-09-01', quantity: '5', unitPrice: '900' });
    expect(second.status).toBe(201);

    let current = await request(app).get(`/api/v1/branch/products/${product.id}`).set(bearer(lahoreAdmin));
    expect(current.body.data.salePrice).toBe('900.00');
    expect(await stockOf(product.id)).toBe('15.000');

    const corrected = await request(app)
      .patch(`${url}/${first.body.data.id}`)
      .set(bearer(lahoreAdmin))
      .send({ quantity: '12' });
    expect(corrected.status).toBe(200);
    expect(await stockOf(product.id)).toBe('17.000');

    expect((await request(app).delete(`${url}/${second.body.data.id}`).set(bearer(lahoreAdmin))).status).toBe(
      204,
    );
    current = await request(app).get(`/api/v1/branch/products/${product.id}`).set(bearer(lahoreAdmin));
    expect(current.body.data.salePrice).toBe('800.50');
    expect(await stockOf(product.id)).toBe('12.000');

    const history = await request(app).get(url).set(bearer(lahoreAdmin));
    expect(history.body.data).toHaveLength(1);
    const movements = await AppDataSource.getRepository(StockMovement).find({
      where: { productId: product.id },
    });
    expect(movements.length).toBe(5);
    expect(movements.filter((m) => m.reversalOfId).length).toBe(2);

    const audits = await AppDataSource.getRepository(AuditLog).count({
      where: { entity: 'product_purchase' },
    });
    expect(audits).toBeGreaterThanOrEqual(4);
  });

  it('refuses to remove a purchase when that stock is already gone', async () => {
    const product = (
      await createProduct({
        name: 'Lip Balm',
        categoryId,
        initialPurchase: { date: '2026-09-01', quantity: '3', unitPrice: '300' },
      })
    ).body.data;
    await AppDataSource.query(
      `INSERT INTO stock_movements (branch_id, product_id, type, qty, reference_type, reference_id, date)
       VALUES ($1, $2, 'sale', -2, 'test', gen_random_uuid(), '2026-09-02')`,
      [product.branchId, product.id],
    );
    const entries = await request(app)
      .get(`/api/v1/branch/products/${product.id}/purchases`)
      .set(bearer(lahoreAdmin));
    const res = await request(app)
      .delete(`/api/v1/branch/products/${product.id}/purchases/${entries.body.data[0].id}`)
      .set(bearer(lahoreAdmin));
    expect(res.status).toBe(422);
    expect(res.body.error.details.shortages[0]).toMatchObject({ available: '1', required: '3' });
  });

  it('keeps the stock ledger append-only', async () => {
    await expect(AppDataSource.query(`UPDATE stock_movements SET qty = 999`)).rejects.toThrow(/append-only/);
    await expect(AppDataSource.query(`DELETE FROM stock_movements`)).rejects.toThrow(/append-only/);
  });

  it('validates input and rejects a category of another branch', async () => {
    expect((await createProduct({ name: '', categoryId })).status).toBe(400);
    expect((await createProduct({ name: 'X', categoryId, salePrice: '-5' })).status).toBe(400);
    const res = await createProduct({ name: 'X', categoryId: islamabadCategoryId });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate SKU in the same branch only', async () => {
    expect((await createProduct({ name: 'A', categoryId, sku: 'SKU-1' })).status).toBe(201);
    expect((await createProduct({ name: 'B', categoryId, sku: 'sku-1' })).status).toBe(409);
    expect(
      (await createProduct({ name: 'B', categoryId: islamabadCategoryId, sku: 'SKU-1' }, islamabadAdmin))
        .status,
    ).toBe(201);
  });

  it('uploads a product image to the public bucket', async () => {
    const product = (await createProduct({ name: 'Soap', categoryId })).body.data;
    const res = await request(app)
      .post(`/api/v1/branch/products/${product.id}/image`)
      .set(bearer(lahoreAdmin))
      .attach('image', Buffer.from('fake-png'), { filename: 'soap.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.data.imagePath).toMatch(
      new RegExp(`^${product.branchId}/${product.id}/[0-9a-f-]+\\.png$`),
    );
    expect(res.body.data.imageUrl).toContain('product-images');

    const bad = await request(app)
      .post(`/api/v1/branch/products/${product.id}/image`)
      .set(bearer(lahoreAdmin))
      .attach('image', Buffer.from('x'), { filename: 'evil.exe', contentType: 'application/x-msdownload' });
    expect(bad.status).toBe(400);
  });

  describe('roles', () => {
    it('lets store keeper and front desk read but not create', async () => {
      expect((await request(app).get('/api/v1/branch/products').set(bearer(storeKeeper))).status).toBe(200);
      expect((await request(app).get('/api/v1/branch/products/options').set(bearer(frontDesk))).status).toBe(
        200,
      );
      expect((await createProduct({ name: 'Nope', categoryId }, storeKeeper)).status).toBe(403);
      expect((await createProduct({ name: 'Nope', categoryId }, frontDesk)).status).toBe(403);
    });

    it('lets the accountant add but not edit or delete (posSoft admin-only buttons)', async () => {
      const created = await createProduct({ name: 'Accountant item', categoryId }, accountant);
      expect(created.status).toBe(201);
      const id = created.body.data.id;
      expect(
        (
          await request(app)
            .patch(`/api/v1/branch/products/${id}`)
            .set(bearer(accountant))
            .send({ name: 'Y' })
        ).status,
      ).toBe(403);
      expect(
        (await request(app).delete(`/api/v1/branch/products/${id}`).set(bearer(accountant))).status,
      ).toBe(403);
    });
  });

  describe('branch isolation', () => {
    it('Islamabad cannot see, edit or stock a Lahore product', async () => {
      const product = (await createProduct({ name: 'Lahore only', categoryId })).body.data;
      const base = `/api/v1/branch/products/${product.id}`;
      expect((await request(app).get(base).set(bearer(islamabadAdmin))).status).toBe(404);
      expect((await request(app).patch(base).set(bearer(islamabadAdmin)).send({ name: 'Hack' })).status).toBe(
        404,
      );
      expect(
        (
          await request(app)
            .post(`${base}/purchases`)
            .set(bearer(islamabadAdmin))
            .send({ date: '2026-09-01', quantity: '1', unitPrice: '1' })
        ).status,
      ).toBe(404);
      const list = await request(app).get('/api/v1/branch/products?pageSize=100').set(bearer(islamabadAdmin));
      expect(list.body.data.map((p: { id: string }) => p.id)).not.toContain(product.id);
    });
  });
});
