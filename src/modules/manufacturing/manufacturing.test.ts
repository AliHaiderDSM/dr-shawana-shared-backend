import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';

const fake = installFakeSupabase();
const app = createApp();

describe('manufacturing', () => {
  let admin: { id: string };
  let storeKeeper: { id: string };
  let pharmacy: { id: string };
  let islamabadAdmin: { id: string };
  let materialCategoryId: string;
  let almondOil: string;
  let beeswax: string;
  let productId: string;

  const post = (path: string, body: object, who = admin) =>
    request(app).post(`/api/v1${path}`).set(bearer(who)).send(body);
  const material = async (id: string, who = admin) =>
    (await request(app).get(`/api/v1/branch/materials/${id}`).set(bearer(who))).body.data;

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR' });
    const islamabad = await createBranch({ code: 'ISB' });
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    storeKeeper = await createStaff(fake, { role: 'store_keeper', branchId: lahore.id });
    pharmacy = await createStaff(fake, { role: 'pharmacy', branchId: lahore.id });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });

    const categoryId = (await post('/branch/categories', { name: 'Balms' })).body.data.id;
    productId = (await post('/branch/products', { name: 'Lip Balm 100g', categoryId, sizeGrams: '100' })).body
      .data.id;
  });

  it('manages material categories with a case-insensitive unique name', async () => {
    const created = await post('/branch/material-categories', { name: 'Oils' }, storeKeeper);
    expect(created.status).toBe(201);
    materialCategoryId = created.body.data.id;
    expect((await post('/branch/material-categories', { name: 'OILS' }, storeKeeper)).status).toBe(409);
  });

  it('creates materials with their first receipt into the store', async () => {
    const created = await post(
      '/branch/materials',
      {
        name: 'Almond Oil',
        categoryId: materialCategoryId,
        minimum: '500',
        bareMinimum: '200',
        initialReceipt: { date: '2026-09-01', quantity: '2000', place: 'falcon' },
      },
      storeKeeper,
    );
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ storeQuantity: '2000.000', labQuantity: '0.000' });
    almondOil = created.body.data.id;

    beeswax = (
      await post(
        '/branch/materials',
        { name: 'Beeswax', categoryId: materialCategoryId, minimum: '100', bareMinimum: '50' },
        storeKeeper,
      )
    ).body.data.id;
    const receipt = await post(
      `/branch/materials/${beeswax}/receipts`,
      { date: '2026-09-02', quantity: '300' },
      storeKeeper,
    );
    expect(receipt.status).toBe(201);

    const invalid = await post(
      '/branch/materials',
      { name: 'Bad', categoryId: materialCategoryId, minimum: '10', bareMinimum: '20' },
      storeKeeper,
    );
    expect(invalid.status).toBe(400);
  });

  it('moves material from store to the pharmacy lab (store keeper only)', async () => {
    expect(
      (
        await post(
          '/branch/lab-transfers',
          { batchNo: 'LAB-1', date: '2026-09-05', items: [{ materialId: almondOil, qty: '1' }] },
          pharmacy,
        )
      ).status,
    ).toBe(403);

    const short = await post(
      '/branch/lab-transfers',
      { batchNo: 'LAB-1', date: '2026-09-05', items: [{ materialId: almondOil, qty: '5000' }] },
      storeKeeper,
    );
    expect(short.status).toBe(422);

    const transfer = await post(
      '/branch/lab-transfers',
      {
        batchNo: 'LAB-1',
        date: '2026-09-05',
        items: [
          { materialId: almondOil, qty: '900' },
          { materialId: beeswax, qty: '100' },
        ],
      },
      storeKeeper,
    );
    expect(transfer.status).toBe(201);
    expect(transfer.body.data).toMatchObject({ stage: 'pharmacy_lab', totalQty: '1000.000' });
    expect(await material(almondOil)).toMatchObject({ storeQuantity: '1100.000', labQuantity: '900.000' });

    expect(
      (
        await post(
          '/branch/lab-transfers',
          { batchNo: 'LAB-1', date: '2026-09-06', items: [{ materialId: beeswax, qty: '1' }] },
          storeKeeper,
        )
      ).status,
    ).toBe(409);
  });

  it('produces a finished product from lab material (pharmacy only) and adds product stock', async () => {
    const labBatches = await request(app).get('/api/v1/branch/lab-transfers/options').set(bearer(pharmacy));
    const labBatchId = labBatches.body.data[0].id;

    expect(
      (
        await post(
          '/branch/productions',
          { labBatchId, date: '2026-09-07', items: [{ materialId: almondOil, qty: '1' }] },
          storeKeeper,
        )
      ).status,
    ).toBe(403);

    const tooMuch = await post(
      '/branch/productions',
      { labBatchId, date: '2026-09-07', items: [{ materialId: almondOil, qty: '901' }] },
      pharmacy,
    );
    expect(tooMuch.status).toBe(422);

    const production = await post(
      '/branch/productions',
      {
        labBatchId,
        date: '2026-09-07',
        items: [
          { materialId: almondOil, qty: '900' },
          { materialId: beeswax, qty: '100' },
        ],
        productId,
        producedQty: '9',
      },
      pharmacy,
    );
    expect(production.status).toBe(201);
    expect(production.body.data).toMatchObject({
      batchNo: 'LAB-1',
      stage: 'finished_product',
      producedQty: '9.000',
    });
    expect(await material(almondOil)).toMatchObject({ labQuantity: '0.000' });

    const stock = await request(app).get('/api/v1/branch/inventory/stock').set(bearer(admin));
    expect(stock.body.data.find((r: { productId: string }) => r.productId === productId).quantity).toBe(
      '9.000',
    );

    const finished = await request(app)
      .get('/api/v1/branch/manufacturing/finished-goods')
      .set(bearer(pharmacy));
    expect(finished.body.data[0]).toMatchObject({
      batchNo: 'LAB-1',
      materialUsed: '1000.000',
      finishedQty: '9.000',
      sizeGrams: '100.000',
      lossGrams: '100.000',
      lossPercent: '10.00',
    });

    const blocked = await request(app)
      .delete(`/api/v1/branch/lab-transfers/${labBatchId}`)
      .set(bearer(admin));
    expect(blocked.status).toBe(409);

    const removed = await request(app)
      .delete(`/api/v1/branch/productions/${production.body.data.id}`)
      .set(bearer(admin));
    expect(removed.status).toBe(204);
    expect(await material(almondOil)).toMatchObject({ labQuantity: '900.000' });
    const after = await request(app).get('/api/v1/branch/inventory/stock').set(bearer(admin));
    expect(after.body.data.find((r: { productId: string }) => r.productId === productId).quantity).toBe(
      '0.000',
    );
  });

  it('reports material levels with posSoft minimum / bare-minimum alerts', async () => {
    const store = await request(app)
      .get('/api/v1/branch/manufacturing/material-report')
      .set(bearer(storeKeeper));
    const byName = Object.fromEntries(store.body.data.map((r: { name: string }) => [r.name, r]));
    expect(byName['Almond Oil']).toMatchObject({
      in: '2000.000',
      out: '900.000',
      closing: '1100.000',
      alert: 'ok',
    });
    expect(byName['Beeswax']).toMatchObject({ closing: '200.000', alert: 'ok' });

    await post(
      '/branch/lab-transfers',
      { batchNo: 'LAB-2', date: '2026-09-08', items: [{ materialId: beeswax, qty: '120' }] },
      storeKeeper,
    );
    const low = await request(app)
      .get('/api/v1/branch/manufacturing/material-report?level=minimum')
      .set(bearer(storeKeeper));
    expect(low.body.data.map((r: { name: string }) => r.name)).toEqual(['Beeswax']);

    const lab = await request(app)
      .get('/api/v1/branch/manufacturing/material-report?location=lab')
      .set(bearer(pharmacy));
    const labBeeswax = lab.body.data.find((r: { name: string }) => r.name === 'Beeswax');
    expect(labBeeswax).toMatchObject({ in: '220.000', out: '0.000', closing: '220.000', alert: null });
  });

  it('stores recipes as rows with optional quantities', async () => {
    const recipe = await post(
      '/branch/recipes',
      { productId, items: [{ materialId: almondOil, qty: '90' }, { materialId: beeswax }] },
      pharmacy,
    );
    expect(recipe.status).toBe(201);
    expect(recipe.body.data.items).toEqual([
      { materialId: almondOil, materialName: 'Almond Oil', qty: '90.000' },
      { materialId: beeswax, materialName: 'Beeswax', qty: null },
    ]);
    const updated = await request(app)
      .patch(`/api/v1/branch/recipes/${recipe.body.data.id}`)
      .set(bearer(pharmacy))
      .send({ items: [{ materialId: beeswax, qty: '10' }] });
    expect(updated.body.data.items).toHaveLength(1);
  });

  it('keeps the material ledger append-only', async () => {
    await expect(AppDataSource.query(`DELETE FROM material_movements`)).rejects.toThrow(/append-only/);
  });

  it('isolates branches', async () => {
    expect(
      (await request(app).get(`/api/v1/branch/materials/${almondOil}`).set(bearer(islamabadAdmin))).status,
    ).toBe(404);
    const foreign = await post(
      '/branch/lab-transfers',
      { batchNo: 'X', date: '2026-09-09', items: [{ materialId: almondOil, qty: '1' }] },
      islamabadAdmin,
    );
    expect(foreign.status).toBe(400);
    const report = await request(app)
      .get('/api/v1/branch/manufacturing/material-report')
      .set(bearer(islamabadAdmin));
    expect(report.body.data).toHaveLength(0);
  });
});
