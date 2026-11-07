import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { approvedRequest, confirmReceipts } from '../../../tests/helpers/stock-requests';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';

const fake = installFakeSupabase();
const app = createApp();

describe('Pieces under observation', () => {
  let superAdmin: { id: string };
  let keeper: { id: string };
  let lahoreAdmin: { id: string };
  let lahoreDesk: { id: string };
  let dispatcher: { id: string };
  let nawab: { id: string };
  let warehouseId: string;
  let lahoreId: string;
  let dispatchId: string;
  let serum: string;
  let serials: string[];
  let patientId: string;
  let lahoreCash: string;

  const as = (who: { id: string }, method: 'get' | 'post', path: string, branchId?: string) =>
    request(app)
      [method](`/api/v1${path}${branchId ? `${path.includes('?') ? '&' : '?'}branchId=${branchId}` : ''}`)
      .set(bearer(who));

  const onHand = async (branchId: string, name: string) => {
    const [row] = (await AppDataSource.query(
      `SELECT COALESCE(SUM(m.qty), 0)::int AS n FROM stock_movements m JOIN products p ON p.id = m.product_id
        WHERE m.branch_id = $1 AND p.name = $2`,
      [branchId, name],
    )) as { n: number }[];
    return row!.n;
  };

  const labelStatus = async (serial: string) => {
    const [row] = (await AppDataSource.query('SELECT status FROM inventory_items WHERE serial = $1', [
      serial,
    ])) as { status: string }[];
    return row!.status;
  };

  const sendStock = async (
    toBranchId: string,
    items: { productId: string; qty: string; serials?: string[] }[],
  ) => {
    const stockRequestId = await approvedRequest(app, superAdmin, toBranchId, items);
    const sent = await as(keeper, 'post', '/branch/stock-outs').send({
      date: '2026-10-02',
      toBranchId,
      items,
      stockRequestId,
    });
    expect(sent.status).toBe(201);
    const done = await as(
      superAdmin,
      'post',
      `/branch/incoming-stock/${sent.body.data[0].transferNo}/receive`,
      toBranchId,
    ).send({ date: '2026-10-02' });
    expect(done.status).toBe(200);
  };

  beforeAll(async () => {
    warehouseId = (await createBranch({ code: 'HOLDWH', name: 'Super Admin Stock', kind: 'warehouse' })).id;
    lahoreId = (await createBranch({ code: 'HLHR', name: 'Lahore' })).id;
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
    lahoreAdmin = await createStaff(fake, { role: 'branch_admin', branchId: lahoreId });
    lahoreDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
    lahoreCash = (
      await as(superAdmin, 'post', '/branch/account-sheets', lahoreId).send({
        accountName: 'Cash',
        accountCode: 'CASH',
        type: 'cash',
      })
    ).body.data.id;
    const categoryId = (
      await as(superAdmin, 'post', '/branch/categories', warehouseId).send({ name: 'Skin' })
    ).body.data.id;
    serum = (
      await as(superAdmin, 'post', '/branch/products', warehouseId).send({
        name: 'Pmositol',
        categoryId,
        salePrice: '9000',
      })
    ).body.data.id;
    await as(superAdmin, 'post', '/branch/stock-ins', warehouseId).send({
      date: '2026-10-01',
      items: [
        {
          unitCost: '100',
          productId: serum,
          qty: '10',
          batch: 'P-1',
          expiryDate: '2028-01-31',
          labels: 'generate',
        },
      ],
    });
    keeper = await createStaff(fake, { role: 'warehouse_keeper', branchId: warehouseId });
    await confirmReceipts(app, keeper);
    serials = (
      await as(superAdmin, 'get', `/branch/inventory/items?productId=${serum}`, warehouseId)
    ).body.data.map((i: { serial: string }) => i.serial);
    patientId = (
      await as(lahoreDesk, 'post', '/branch/patients').send({
        name: 'Memona',
        phone: '923001112299',
        city: 'Lahore',
      })
    ).body.data.id;
    const created = await as(superAdmin, 'post', '/admin/branches').send({
      name: 'Falcon',
      code: 'HFLC',
      city: 'Lahore',
      kind: 'dispatch',
    });
    expect(created.status).toBe(201);
    dispatchId = created.body.data.id;
    dispatcher = await createStaff(fake, { role: 'dispatcher', branchId: dispatchId });
    nawab = await createStaff(fake, { role: 'branch_admin', branchId: dispatchId });
  });

  it('holds a piece while the Warehouse Keeper sends a request, shows it to the branch and releases it', async () => {
    const stockRequestId = await approvedRequest(app, superAdmin, lahoreId, [{ productId: serum, qty: '3' }]);
    const body = { serial: serials[0], reason: 'damaged', note: 'Box crushed', stockRequestId };
    expect((await as(superAdmin, 'post', '/branch/stock-holds', warehouseId).send(body)).status).toBe(403);
    expect((await as(lahoreAdmin, 'post', '/branch/stock-holds').send(body)).status).toBe(403);

    const held = await as(keeper, 'post', '/branch/stock-holds').send(body);
    expect(held.status).toBe(201);
    expect(held.body.data).toMatchObject({
      holdNo: 'HOLDWH-UO-000001',
      status: 'open',
      reason: 'damaged',
      note: 'Box crushed',
      serial: serials[0],
      itemStatus: 'quarantined',
      stockRequest: { id: stockRequestId, branchName: 'Lahore' },
      canDecide: true,
    });
    const again = await as(keeper, 'post', '/branch/stock-holds').send(body);
    expect(again.status).toBe(422);
    expect(again.body.error.message).toContain('under observation');

    const blocked = await as(keeper, 'post', '/branch/stock-outs').send({
      date: '2026-10-02',
      toBranchId: lahoreId,
      stockRequestId,
      items: [{ productId: serum, qty: '1', serials: [serials[0]] }],
    });
    expect(blocked.status).toBe(422);
    const sent = await as(keeper, 'post', '/branch/stock-outs').send({
      date: '2026-10-02',
      toBranchId: lahoreId,
      stockRequestId,
      items: [{ productId: serum, qty: '2', serials: [serials[1], serials[2]] }],
    });
    expect(sent.status).toBe(201);
    expect(
      (
        await as(
          superAdmin,
          'post',
          `/branch/incoming-stock/${sent.body.data[0].transferNo}/receive`,
          lahoreId,
        ).send({ date: '2026-10-02' })
      ).status,
    ).toBe(200);

    const seen = await as(lahoreAdmin, 'get', `/branch/stock-requests/${stockRequestId}`);
    expect(seen.body.data.status).toBe('received');
    expect(seen.body.data.holds).toEqual([
      expect.objectContaining({
        serial: serials[0],
        reason: 'damaged',
        status: 'open',
        productName: 'Pmositol',
      }),
    ]);
    const branchList = await as(lahoreAdmin, 'get', '/branch/stock-holds');
    expect(branchList.body.data).toHaveLength(1);
    expect(branchList.body.data[0].canDecide).toBe(false);
    expect((await as(dispatcher, 'get', '/branch/stock-holds')).body.data).toEqual([]);
    expect((await as(keeper, 'get', '/branch/badges')).body.data.observations).toBe(1);
    expect((await as(superAdmin, 'get', '/branch/badges')).body.data.observations).toBe(1);

    const id = held.body.data.id as string;
    const decision = { decision: 'release', note: 'Box only, product fine' };
    expect((await as(superAdmin, 'post', `/branch/stock-holds/${id}/decide`).send(decision)).status).toBe(
      403,
    );
    expect((await as(nawab, 'post', `/branch/stock-holds/${id}/decide`).send(decision)).status).toBe(403);
    expect(
      (await as(keeper, 'post', `/branch/stock-holds/${id}/decide`).send({ decision: 'release' })).status,
    ).toBe(400);
    const released = await as(keeper, 'post', `/branch/stock-holds/${id}/decide`).send(decision);
    expect(released.status).toBe(200);
    expect(released.body.data).toMatchObject({
      status: 'released',
      decisionNote: 'Box only, product fine',
      decidedBy: { id: keeper.id },
      itemStatus: 'in_stock',
      canDecide: false,
    });
    expect((await as(keeper, 'post', `/branch/stock-holds/${id}/decide`).send(decision)).status).toBe(409);
    expect((await as(keeper, 'get', '/branch/badges')).body.data.observations).toBe(0);
  });

  it('writes a held piece off and takes it out of the stock', async () => {
    const before = await onHand(warehouseId, 'Pmositol');
    const held = await as(keeper, 'post', '/branch/stock-holds').send({
      serial: serials[3],
      reason: 'expired',
    });
    expect(held.status).toBe(201);
    expect(await onHand(warehouseId, 'Pmositol')).toBe(before);
    const done = await as(keeper, 'post', `/branch/stock-holds/${held.body.data.id}/decide`).send({
      decision: 'write_off',
      note: 'Expired print on the box',
    });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({
      status: 'written_off',
      writeOffNo: expect.stringMatching(/-WO-/),
    });
    expect(await onHand(warehouseId, 'Pmositol')).toBe(before - 1);
    expect(await labelStatus(serials[3]!)).toBe('expired');
    const writeOffs = await as(superAdmin, 'get', '/branch/inventory/write-offs?status=approved');
    expect(writeOffs.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'expired', serials: [serials[3]] })]),
    );
  });

  it('holds a piece of an online order at the Dispatch Department and Falcon sends it back to the supplier', async () => {
    await sendStock(dispatchId, [{ productId: serum, qty: '2', serials: [serials[4]!, serials[5]!] }]);
    const lahoreSerum = (
      (await as(superAdmin, 'get', '/branch/products?pageSize=100', lahoreId)).body.data as {
        id: string;
        name: string;
      }[]
    ).find((p) => p.name === 'Pmositol')!.id;
    const order = await as(lahoreDesk, 'post', '/branch/sales').send({
      patientId,
      saleType: 'online',
      date: '2026-10-03',
      items: [{ productId: lahoreSerum, qty: '1' }],
      payments: [{ method: 'cash', amount: '100', accountSheetId: lahoreCash, date: '2026-10-03' }],
    });
    expect(order.status).toBe(201);
    const saleId = order.body.data.id as string;
    await AppDataSource.query('UPDATE sale_payments SET approved_at = now() WHERE sale_id = $1', [saleId]);

    const body = { serial: serials[4], reason: 'label_issue', note: 'Label torn', saleId };
    expect((await as(lahoreDesk, 'post', '/branch/stock-holds').send(body)).status).toBe(403);
    const held = await as(dispatcher, 'post', '/branch/stock-holds').send(body);
    expect(held.status).toBe(201);
    expect(held.body.data).toMatchObject({
      holdNo: 'HFLC-UO-000001',
      sale: { id: saleId },
      canDecide: false,
    });
    const wrong = await as(dispatcher, 'post', `/branch/sales/${saleId}/dispatch`).send({
      date: '2026-10-04',
      serials: [serials[4]],
    });
    expect(wrong.status).toBe(422);
    const onOrder = await as(dispatcher, 'get', `/branch/stock-holds?saleId=${saleId}`);
    expect(onOrder.body.data.map((h: { serial: string }) => h.serial)).toEqual([serials[4]]);
    expect((await as(nawab, 'get', '/branch/badges')).body.data.observations).toBe(1);
    expect((await as(lahoreAdmin, 'get', '/branch/stock-holds')).body.data).toHaveLength(1);

    const id = held.body.data.id as string;
    const decision = { decision: 'supplier_return', note: 'Send back for new label' };
    expect((await as(dispatcher, 'post', `/branch/stock-holds/${id}/decide`).send(decision)).status).toBe(
      403,
    );
    const listed = await as(nawab, 'get', '/branch/stock-holds?status=open');
    expect(listed.body.data[0].canDecide).toBe(true);
    const before = await onHand(dispatchId, 'Pmositol');
    const returned = await as(nawab, 'post', `/branch/stock-holds/${id}/decide`).send(decision);
    expect(returned.status).toBe(200);
    expect(returned.body.data.status).toBe('supplier_returned');
    expect(await labelStatus(serials[4]!)).toBe('supplier_returned');
    expect(await onHand(dispatchId, 'Pmositol')).toBe(before - 1);

    const sent = await as(dispatcher, 'post', `/branch/sales/${saleId}/dispatch`).send({
      date: '2026-10-04',
      serials: [serials[5]],
    });
    expect(sent.status).toBe(200);
  });
});
