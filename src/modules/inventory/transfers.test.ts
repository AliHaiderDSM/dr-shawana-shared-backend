import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

describe('Main Warehouse transfers to branches', () => {
  let superAdmin: { id: string };
  let lahoreAdmin: { id: string };
  let lahoreDesk: { id: string };
  let warehouseId: string;
  let lahoreId: string;
  let serum: string;
  let toner: string;
  let lahoreToner: string;
  let serials: string[];
  let patientId: string;

  const asAdmin = (method: 'get' | 'post' | 'patch' | 'delete', path: string, branchId = warehouseId) =>
    request(app)
      [method](`/api/v1${path}${path.includes('?') ? '&' : '?'}branchId=${branchId}`)
      .set(bearer(superAdmin));
  const asBranch = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who = lahoreAdmin) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));

  const stockOf = async (productId: string, branchId: string) => {
    const res = await asAdmin('get', '/branch/inventory/stock?pageSize=100', branchId);
    return res.body.data.find((r: { productId: string }) => r.productId === productId)?.quantity as string;
  };

  beforeAll(async () => {
    const warehouse = await createBranch({ code: 'MAINWH', name: 'Main Warehouse', kind: 'warehouse' });
    const lahore = await createBranch({ code: 'LHR', name: 'Lahore' });
    warehouseId = warehouse.id;
    lahoreId = lahore.id;
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
    lahoreAdmin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    lahoreDesk = await createStaff(fake, { role: 'front_desk', branchId: lahore.id });

    const categoryId = (await asAdmin('post', '/branch/categories').send({ name: 'Skin' })).body.data.id;
    serum = (
      await asAdmin('post', '/branch/products').send({
        name: 'Vitamin C Serum',
        categoryId,
        salePrice: '1500',
      })
    ).body.data.id;
    toner = (
      await asAdmin('post', '/branch/products').send({ name: 'Rose Toner', categoryId, salePrice: '900' })
    ).body.data.id;
    const lahoreCategory = (await asBranch('post', '/branch/categories').send({ name: 'Face' })).body.data.id;
    lahoreToner = (
      await asBranch('post', '/branch/products').send({ name: 'rose toner', categoryId: lahoreCategory })
    ).body.data.id;
    patientId = (
      await asBranch('post', '/branch/patients', lahoreDesk).send({
        name: 'Sana',
        phone: '923001112223',
        city: 'Lahore',
      })
    ).body.data.id;

    const received = await asAdmin('post', '/branch/stock-ins').send({
      date: '2026-10-01',
      items: [
        { productId: serum, qty: '10', batch: 'B-001', expiryDate: '2028-01-31', labels: 'generate' },
        { productId: toner, qty: '100', batch: 'T-01', expiryDate: '2027-06-30' },
      ],
    });
    expect(received.status).toBe(201);
    serials = (await asAdmin('get', `/branch/inventory/items?productId=${serum}`)).body.data.map(
      (i: { serial: string }) => i.serial,
    );
  });

  it('keeps the warehouse to the Super Admin and out of selling', async () => {
    const options = await request(app).get('/api/v1/admin/branches/options').set(bearer(superAdmin));
    expect(options.body.data[0]).toMatchObject({ id: warehouseId, kind: 'warehouse' });
    const list = await request(app).get('/api/v1/admin/branches').set(bearer(superAdmin));
    expect(list.body.data.map((b: { id: string }) => b.id)).toEqual([lahoreId]);
    expect((await asBranch('get', `/branch/inventory/stock?branchId=${warehouseId}`)).status).toBe(403);
    const sale = await asAdmin('post', '/branch/sales').send({
      patientId,
      saleType: 'office',
      items: [{ productId: toner, qty: '1' }],
      payments: [],
    });
    expect(sale.status).toBe(409);
    const staff = await asAdmin('post', '/branch/staff').send({
      firstName: 'W',
      lastName: 'H',
      email: 'w.h@test.dsm',
      username: 'w.h',
      role: 'front_desk',
      password: 'Secret123!',
    });
    expect(staff.status).toBe(409);
  });

  it('moves stock and labelled pieces to the chosen branch in one step', async () => {
    const missing = await asAdmin('post', '/branch/stock-outs').send({
      date: '2026-10-02',
      toBranchId: lahoreId,
      items: [{ productId: serum, qty: '4' }],
    });
    expect(missing.status).toBe(422);

    const res = await asAdmin('post', '/branch/stock-outs').send({
      date: '2026-10-02',
      toBranchId: lahoreId,
      note: 'Weekly supply',
      items: [
        { productId: serum, qty: '4', serials: serials.slice(0, 4) },
        { productId: toner, qty: '30' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data[0]).toMatchObject({
      destination: 'Lahore',
      toBranch: { id: lahoreId, name: 'Lahore' },
    });

    expect(await stockOf(serum, warehouseId)).toBe('6.000');
    expect(await stockOf(toner, warehouseId)).toBe('70.000');

    const lahoreProducts = (await asBranch('get', '/branch/products?pageSize=100')).body.data as {
      id: string;
      name: string;
      trackSerials: boolean;
      category: { name: string } | null;
    }[];
    const lahoreSerum = lahoreProducts.find((p) => p.name === 'Vitamin C Serum')!;
    expect(lahoreSerum).toMatchObject({ trackSerials: true, category: { name: 'Skin' } });
    expect(lahoreProducts.filter((p) => p.name.toLowerCase() === 'rose toner')).toHaveLength(1);
    expect(await stockOf(lahoreSerum.id, lahoreId)).toBe('4.000');
    expect(await stockOf(lahoreToner, lahoreId)).toBe('30.000');

    const batches = (await asBranch('get', `/branch/inventory/batches?productId=${lahoreToner}`)).body.data;
    expect(batches[0]).toMatchObject({ batchNo: 'T-01', expiryDate: '2027-06-30', quantity: '30.000' });

    const stockIns = (await asBranch('get', '/branch/stock-ins')).body.data as {
      id: string;
      transferOutId: string;
    }[];
    expect(stockIns).toHaveLength(2);
    expect(
      stockIns.every(
        (s) => s.transferOutId === res.body.data[0].id || s.transferOutId === res.body.data[1].id,
      ),
    ).toBe(true);
    expect((await asBranch('delete', `/branch/stock-ins/${stockIns[0]!.id}`)).status).toBe(409);
    expect((await asBranch('patch', `/branch/stock-ins/${stockIns[0]!.id}`).send({ note: 'x' })).status).toBe(
      409,
    );

    const piece = await asBranch('get', `/branch/inventory/items/serial/${serials[0]}`);
    expect(piece.body.data).toMatchObject({ status: 'in_stock', branchName: 'Lahore', batchNo: 'B-001' });
    expect(
      piece.body.data.history.map((h: { type: string; branchName: string }) => `${h.type}@${h.branchName}`),
    ).toEqual(['received@Main Warehouse', 'dispatched@Main Warehouse', 'received@Lahore']);
    expect((await asAdmin('get', `/branch/inventory/items/serial/${serials[0]}`)).status).toBe(404);
  });

  it('lets the branch sell the transferred pieces and reuses its product on the next transfer', async () => {
    const lahoreSerum = (await asBranch('get', '/branch/products?search=Vitamin')).body.data[0].id;
    const sale = await asBranch('post', '/branch/sales', lahoreDesk).send({
      patientId,
      saleType: 'office',
      items: [{ productId: lahoreSerum, qty: '1' }],
      serials: [serials[0]],
      payments: [],
    });
    expect(sale.status).toBe(201);
    expect(sale.body.data.invoiceNo).toMatch(/^LHR-/);

    const again = await asAdmin('post', '/branch/stock-outs').send({
      date: '2026-10-03',
      toBranchId: lahoreId,
      items: [{ productId: serum, qty: '2', serials: serials.slice(4, 6) }],
    });
    expect(again.status).toBe(201);
    const products = (await asBranch('get', '/branch/products?search=Vitamin')).body.data;
    expect(products).toHaveLength(1);
    expect(await stockOf(lahoreSerum, lahoreId)).toBe('5.000');
  });

  it('cancels a transfer only while the branch has not touched it', async () => {
    const outs = (await asAdmin('get', '/branch/stock-outs?sort=date')).body.data as {
      id: string;
      date: string;
      productId: string;
    }[];
    const first = outs.find((o) => o.date === '2026-10-02' && o.productId === serum)!;
    const second = outs.find((o) => o.date === '2026-10-03')!;
    expect((await asAdmin('delete', `/branch/stock-outs/${first.id}`)).status).toBe(409);
    expect((await asAdmin('patch', `/branch/stock-outs/${second.id}`).send({ qty: '1' })).status).toBe(409);

    expect((await asAdmin('delete', `/branch/stock-outs/${second.id}`)).status).toBe(204);
    expect(await stockOf(serum, warehouseId)).toBe('6.000');
    const back = await asAdmin('get', `/branch/inventory/items/serial/${serials[4]}`);
    expect(back.body.data).toMatchObject({ status: 'in_stock', branchName: 'Main Warehouse' });
  });

  it('lets branches get stock only from the Main Warehouse', async () => {
    const stockIn = await asBranch('post', '/branch/stock-ins').send({
      date: '2026-10-04',
      items: [{ productId: lahoreToner, qty: '5' }],
    });
    expect(stockIn.status).toBe(409);
    const purchase = await asBranch('post', `/branch/products/${lahoreToner}/purchases`).send({
      date: '2026-10-04',
      quantity: '5',
      unitPrice: '500',
    });
    expect(purchase.status).toBe(409);
    const filtered = await asAdmin('get', `/branch/inventory/stock?productId=${toner}`);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0]).toMatchObject({ productId: toner, quantity: '70.000' });
  });

  it('warns about batches that expire within three months, everywhere for the Super Admin', async () => {
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await asAdmin('post', '/branch/stock-ins').send({
      date: '2026-10-04',
      items: [{ productId: toner, qty: '10', batch: 'SOON-1', expiryDate: soon }],
    });
    await asAdmin('post', '/branch/stock-outs').send({
      date: '2026-10-04',
      toBranchId: lahoreId,
      items: [{ productId: toner, qty: '75' }],
    });

    const all = await request(app).get('/api/v1/branch/inventory/expiry-alerts').set(bearer(superAdmin));
    expect(all.status).toBe(200);
    const rows = all.body.data as {
      branchName: string;
      batchNo: string;
      quantity: string;
      daysLeft: number;
    }[];
    expect(rows.map((r) => `${r.branchName}:${r.batchNo}:${r.quantity}`).sort()).toEqual([
      'Lahore:SOON-1:10.000',
    ]);
    expect(rows[0]!.daysLeft).toBe(30);

    const branch = await asBranch('get', '/branch/inventory/expiry-alerts');
    expect(branch.body.data.map((r: { branchName: string }) => r.branchName)).toEqual(['Lahore']);
    const longer = await asBranch('get', '/branch/inventory/expiry-alerts?days=365');
    expect(longer.body.data.map((r: { batchNo: string }) => r.batchNo)).toEqual(['SOON-1', 'T-01']);
  });

  it('only transfers from the warehouse to an active branch', async () => {
    const fromBranch = await asBranch('post', '/branch/stock-outs').send({
      date: '2026-10-04',
      toBranchId: warehouseId,
      items: [{ productId: lahoreToner, qty: '1' }],
    });
    expect(fromBranch.status).toBe(409);
    const dispatch = await asBranch('post', '/branch/stock-outs').send({
      date: '2026-10-04',
      items: [{ productId: lahoreToner, qty: '1', destination: 'Karachi Office' }],
    });
    expect(dispatch.status).toBe(409);
    const toWarehouse = await asAdmin('post', '/branch/stock-outs').send({
      date: '2026-10-04',
      toBranchId: warehouseId,
      items: [{ productId: toner, qty: '1' }],
    });
    expect(toWarehouse.status).toBe(400);
    const plain = await asAdmin('post', '/branch/stock-outs').send({
      date: '2026-10-04',
      items: [{ productId: toner, qty: '1' }],
    });
    expect(plain.status).toBe(400);
  });
});
