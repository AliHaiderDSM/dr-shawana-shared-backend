import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { approvedRequest, confirmReceipts } from '../../../tests/helpers/stock-requests';
import { AppDataSource } from '../../database/data-source';

const fake = installFakeSupabase();
const app = createApp();

const verifyPayments = (saleId: string) =>
  AppDataSource.query(`UPDATE sale_payments SET approved_at = now() WHERE sale_id = $1`, [saleId]);

describe('Dispatch Department ships every online order from its own stock', () => {
  let superAdmin: { id: string };
  let lahoreDesk: { id: string };
  let lahoreAdmin: { id: string };
  let isbDesk: { id: string };
  let dispatcher: { id: string };
  let keeper: { id: string };
  let warehouseId: string;
  let lahoreId: string;
  let isbId: string;
  let dispatchId: string;
  let serum: string;
  let toner: string;
  let serials: string[];
  let patientId: string;
  let lahoreCash: string;
  let isbCash: string;
  let legacyOrder: string;

  const as = (who: { id: string }, method: 'get' | 'post' | 'patch', path: string, branchId?: string) =>
    request(app)
      [method](`/api/v1${path}${branchId ? `${path.includes('?') ? '&' : '?'}branchId=${branchId}` : ''}`)
      .set(bearer(who));

  const stock = async (productId: string, branchId: string) => {
    const res = await as(superAdmin, 'get', '/branch/inventory/stock?pageSize=100', branchId);
    return res.body.data.find(
      (r: { productId: string; name: string }) => r.productId === productId || r.name === productId,
    ) as { productId: string; quantity: string; reservedQuantity: string } | undefined;
  };

  const productIn = async (branchId: string, name: string) => {
    const res = await as(superAdmin, 'get', '/branch/products?pageSize=100', branchId);
    return (res.body.data as { id: string; name: string }[]).find((p) => p.name === name)!.id;
  };

  const transfer = async (toBranchId: string, items: object[]) => {
    const res = await as(keeper, 'post', '/branch/stock-outs').send({
      date: '2026-10-02',
      toBranchId,
      items,
      stockRequestId: await approvedRequest(
        app,
        superAdmin,
        toBranchId,
        items as { productId: string; qty: string }[],
      ),
    });
    if (res.status === 201) {
      const done = await as(
        superAdmin,
        'post',
        `/branch/incoming-stock/${res.body.data[0].transferNo}/receive`,
        toBranchId,
      ).send({ date: '2026-10-02' });
      expect(done.status).toBe(200);
    }
    return res;
  };

  const online = (who: { id: string }, items: object[], sheet: string) =>
    as(who, 'post', '/branch/sales').send({
      patientId,
      saleType: 'online',
      date: '2026-10-03',
      items,
      payments: [{ method: 'cash', amount: '100', accountSheetId: sheet, date: '2026-10-03' }],
    });

  beforeAll(async () => {
    warehouseId = (await createBranch({ code: 'MAINWH', name: 'Main Warehouse', kind: 'warehouse' })).id;
    lahoreId = (await createBranch({ code: 'LHR', name: 'Lahore' })).id;
    isbId = (await createBranch({ code: 'ISB', name: 'Islamabad', city: 'Islamabad' })).id;
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
    lahoreDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
    lahoreAdmin = await createStaff(fake, { role: 'branch_admin', branchId: lahoreId });
    isbDesk = await createStaff(fake, { role: 'front_desk', branchId: isbId });
    lahoreCash = (
      await as(superAdmin, 'post', '/branch/account-sheets', lahoreId).send({
        accountName: 'Cash',
        accountCode: 'CASH',
        type: 'cash',
      })
    ).body.data.id;
    isbCash = (
      await as(superAdmin, 'post', '/branch/account-sheets', isbId).send({
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
        name: 'Vitamin C Serum',
        categoryId,
        salePrice: '1500',
      })
    ).body.data.id;
    toner = (
      await as(superAdmin, 'post', '/branch/products', warehouseId).send({
        name: 'Rose Toner',
        categoryId,
        salePrice: '900',
      })
    ).body.data.id;
    await as(superAdmin, 'post', '/branch/stock-ins', warehouseId).send({
      date: '2026-10-01',
      items: [
        { productId: serum, qty: '10', batch: 'S-1', expiryDate: '2028-01-31', labels: 'generate' },
        { productId: toner, qty: '60', batch: 'T-1', expiryDate: '2028-01-31' },
      ],
    });
    keeper = await createStaff(fake, { role: 'warehouse_keeper', branchId: warehouseId });
    await confirmReceipts(app, keeper);
    serials = (
      await as(superAdmin, 'get', `/branch/inventory/items?productId=${serum}`, warehouseId)
    ).body.data.map((i: { serial: string }) => i.serial);
    patientId = (
      await as(lahoreDesk, 'post', '/branch/patients').send({
        name: 'Sana',
        phone: '923001112223',
        city: 'Lahore',
      })
    ).body.data.id;

    expect(
      (
        await transfer(lahoreId, [
          { productId: toner, qty: '10' },
          { productId: serum, qty: '2', serials: serials.slice(0, 2) },
        ])
      ).status,
    ).toBe(201);
    expect((await transfer(isbId, [{ productId: toner, qty: '5' }])).status).toBe(201);
  });

  it('moves the waiting online orders to the Dispatch Department when it is created', async () => {
    const lahoreToner = await productIn(lahoreId, 'Rose Toner');
    const before = await online(lahoreDesk, [{ productId: lahoreToner, qty: '1' }], lahoreCash);
    expect(before.status).toBe(201);
    expect(before.body.data.fulfillmentBranchId).toBeNull();
    legacyOrder = before.body.data.id;

    const created = await as(superAdmin, 'post', '/admin/branches').send({
      name: 'Dispatch Department',
      code: 'DSP',
      city: 'Lahore',
      address: '45 Ferozpur Road',
      kind: 'dispatch',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.kind).toBe('dispatch');
    dispatchId = created.body.data.id;
    const again = await as(superAdmin, 'post', '/admin/branches').send({
      name: 'Second Dispatch',
      code: 'DSP2',
      city: 'Lahore',
      kind: 'dispatch',
    });
    expect(again.status).toBe(409);

    const moved = await as(lahoreDesk, 'get', `/branch/sales/${legacyOrder}`);
    expect(moved.body.data.fulfillmentBranchId).toBe(dispatchId);
    expect((await stock(lahoreToner, lahoreId))!.reservedQuantity).toBe('0.000');
    dispatcher = await createStaff(fake, { role: 'dispatcher', branchId: dispatchId });
  });

  it('books online orders against the Dispatch Department stock only', async () => {
    const lahoreToner = await productIn(lahoreId, 'Rose Toner');
    const lahoreSerum = await productIn(lahoreId, 'Vitamin C Serum');
    const empty = await online(lahoreDesk, [{ productId: lahoreToner, qty: '1' }], lahoreCash);
    expect(empty.status).toBe(422);

    expect(
      (
        await transfer(dispatchId, [
          { productId: toner, qty: '20' },
          { productId: serum, qty: '5', serials: serials.slice(2, 7) },
        ])
      ).status,
    ).toBe(201);
    const dspToner = await productIn(dispatchId, 'Rose Toner');

    const order = await online(
      lahoreDesk,
      [
        { productId: lahoreToner, qty: '2' },
        { productId: lahoreSerum, qty: '1' },
      ],
      lahoreCash,
    );
    expect(order.status).toBe(201);
    expect(order.body.data.fulfillmentBranchId).toBe(dispatchId);
    expect((await stock(dspToner, dispatchId))!.reservedQuantity).toBe('3.000');
    expect((await stock(lahoreToner, lahoreId))!).toMatchObject({
      quantity: '10.000',
      reservedQuantity: '0.000',
    });

    const isbToner = await productIn(isbId, 'Rose Toner');
    const tooMuch = await online(isbDesk, [{ productId: isbToner, qty: '18' }], isbCash);
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.details.shortages[0]).toMatchObject({ available: '17.000', reserved: '3.000' });

    const office = await as(lahoreDesk, 'post', '/branch/sales').send({
      patientId,
      saleType: 'office',
      items: [{ productId: lahoreToner, qty: '10' }],
      payments: [{ method: 'cash', amount: '9000', accountSheetId: lahoreCash }],
    });
    expect(office.status).toBe(201);
    expect((await stock(lahoreToner, lahoreId))!.quantity).toBe('0.000');

    const local = (
      await as(superAdmin, 'post', '/branch/products', lahoreId).send({
        name: 'Lahore Only Cream',
        categoryId: (await as(superAdmin, 'post', '/branch/categories', lahoreId).send({ name: 'Local' }))
          .body.data.id,
      })
    ).body;
    expect(local.data).toBeDefined();
    expect((await as(lahoreAdmin, 'post', '/branch/categories').send({ name: 'Mine' })).status).toBe(403);
    {
      const notStocked = await online(lahoreDesk, [{ productId: local.data.id, qty: '1' }], lahoreCash);
      expect(notStocked.status).toBe(422);
    }
  });

  it('shows booked online orders and the total of every product in the inventory report', async () => {
    const lab = await createStaff(fake, { role: 'lab_officer', branchId: warehouseId });
    const query = '/branch/inventory/report?from=2026-01-01&to=2099-12-31';
    const report = await as(superAdmin, 'get', query, warehouseId);
    expect(report.status).toBe(200);
    type Row = { name: string; booked: string; total: string; inBranch: string; closing: string };
    const row = (name: string) => (report.body.data.rows as Row[]).find((r) => r.name === name)!;
    expect(row('Rose Toner').booked).toBe('3.000');
    expect(row('Vitamin C Serum').booked).toBe('1.000');
    for (const r of report.body.data.rows as Row[]) {
      expect(Number(r.total)).toBe(Number(r.inBranch) + Number(r.closing));
    }
    expect(report.body.data.totals.booked).toBe('4.000');
    const lahoreShare = (
      report.body.data.rows as (Row & { branches: { branchId: string; booked: string }[] })[]
    )
      .find((r) => r.name === 'Rose Toner')!
      .branches.find((b) => b.branchId === lahoreId);
    expect(lahoreShare?.booked).toBe('3.000');
    for (const who of [keeper, lab]) {
      expect((await as(who, 'get', query)).body.data.totals.booked).toBe('4.000');
    }
  });

  it('keeps the dispatcher to dispatch work and reports every transfer with its labels', async () => {
    const someId = '00000000-0000-4000-8000-000000000000';
    expect((await as(dispatcher, 'post', '/branch/stock-ins').send({})).status).toBe(403);
    expect((await as(dispatcher, 'patch', `/branch/stock-ins/${someId}`).send({})).status).toBe(403);
    expect((await as(dispatcher, 'patch', `/branch/stock-outs/${someId}`).send({})).status).toBe(403);
    expect((await as(dispatcher, 'post', '/branch/stock-requests').send({ items: [] })).status).toBe(403);
    expect(
      (await as(dispatcher, 'post', '/branch/incoming-stock/DSP-TR-000001/receive').send({})).status,
    ).toBe(403);
    expect((await as(dispatcher, 'post', '/branch/inventory/write-offs').send({ items: [] })).status).toBe(
      400,
    );

    const all = await as(superAdmin, 'get', '/branch/inventory/stock-out-report');
    expect(all.status).toBe(200);
    const sent = (all.body.data as { to: { id: string } | null }[]).find((t) => t.to?.id === dispatchId);
    expect(sent).toMatchObject({
      transferNo: expect.stringMatching(/-TR-/),
      requestNo: expect.stringMatching(/-SR-/),
      products: 2,
      qty: '25.000',
      serials: 5,
      sentBy: { name: expect.any(String) },
      receivedAt: expect.any(String),
    });

    const seenByDispatch = await as(dispatcher, 'get', '/branch/inventory/stock-out-report');
    expect(seenByDispatch.body.data.map((t: { to: { id: string } }) => t.to.id)).toContain(dispatchId);
    const onTheWay = await as(
      superAdmin,
      'get',
      `/branch/inventory/stock-out-report?status=on_the_way&toBranchId=${dispatchId}`,
    );
    expect(onTheWay.body.data).toEqual([]);
    const lahore = await as(lahoreAdmin, 'get', '/branch/inventory/stock-out-report');
    expect(lahore.body.data.map((t: { to: { id: string } }) => t.to.id)).not.toContain(dispatchId);
  });

  it('lets the dispatcher see every branch order, scan its stock and print from the department', async () => {
    const list = await as(dispatcher, 'get', '/branch/sales/deliveries?status=pending');
    expect(list.status).toBe(200);
    const orders = list.body.data as {
      id: string;
      branch: { name: string };
      items: { productId: string; name: string; tracked: boolean }[];
    }[];
    expect(orders.map((o) => o.branch.name)).toEqual(['Lahore', 'Lahore']);
    const order = orders.find((o) => o.items.length === 2)!;
    const dspSerum = await productIn(dispatchId, 'Vitamin C Serum');
    expect(order.items.find((i) => i.name === 'Vitamin C Serum')).toMatchObject({
      productId: dspSerum,
      tracked: true,
    });

    const calendar = await as(dispatcher, 'get', '/branch/sales/delivery-calendar?month=2026-10');
    expect(calendar.body.data.awaiting.orders).toBe(2);

    expect(
      (await as(lahoreAdmin, 'post', `/branch/sales/${order.id}/dispatch`).send({ serials: [serials[2]] }))
        .status,
    ).toBe(403);
    const unpaid = await as(dispatcher, 'post', `/branch/sales/${order.id}/dispatch`).send({
      serials: [serials[2]],
    });
    expect(unpaid.status).toBe(409);
    await verifyPayments(order.id);
    const wrongLabel = await as(dispatcher, 'post', `/branch/sales/${order.id}/dispatch`).send({
      date: '2026-10-04',
      serials: [serials[0]],
    });
    expect(wrongLabel.status).toBe(422);
    const sent = await as(dispatcher, 'post', `/branch/sales/${order.id}/dispatch`).send({
      date: '2026-10-04',
      serials: [serials[2]],
    });
    expect(sent.status).toBe(200);
    expect(sent.body.data.deliveryStatus).toBe('delivered');
    expect(sent.body.data.gdnNo).toMatch(/^DSP-GDN-\d{6}$/);
    const seen = (await as(lahoreAdmin, 'get', `/branch/sales/${order.id}`)).body.data;
    expect(seen.gdn).toMatchObject({
      gdnNo: sent.body.data.gdnNo,
      dispatchedOn: '2026-10-04',
      dispatchedBy: expect.any(String),
      from: { code: 'DSP' },
      bookedAt: { name: 'Lahore' },
      customer: { name: expect.any(String) },
    });
    const serumLine = seen.items.find(
      (i: { product: { name: string } | null }) => i.product?.name === 'Vitamin C Serum',
    );
    expect(seen.serials).toEqual([
      expect.objectContaining({ serial: serials[2], productId: serumLine.productId }),
    ]);

    const dspToner = await productIn(dispatchId, 'Rose Toner');
    expect((await stock(dspToner, dispatchId))!).toMatchObject({
      quantity: '18.000',
      reservedQuantity: '1.000',
    });
    expect((await stock(dspSerum, dispatchId))!.quantity).toBe('4.000');

    const slips = await as(dispatcher, 'get', `/branch/sales/delivery-slips?saleIds=${order.id}`);
    expect(slips.body.data.slips[0]).toMatchObject({
      branch: { name: 'Lahore' },
      from: { city: 'Lahore', address: '45 Ferozpur Road' },
    });
    expect((await as(dispatcher, 'post', '/branch/sales').send({})).status).toBe(403);
  });

  it('puts returned online stock back at the Dispatch Department', async () => {
    const list = await as(dispatcher, 'get', '/branch/sales/deliveries?status=delivered');
    const order = (list.body.data as { id: string }[])[0]!;
    const returned = await as(dispatcher, 'post', `/branch/sales/${order.id}/delivery`).send({
      status: 'returned',
    });
    expect(returned.status).toBe(200);

    const ret = (await as(lahoreAdmin, 'get', `/branch/returns?saleId=${order.id}`)).body.data[0];
    expect(ret).toBeDefined();
    const seen = (await as(dispatcher, 'get', '/branch/returns?stage=inspect')).body.data as { id: string }[];
    expect(seen.map((r) => r.id)).toContain(ret.id);
    for (const item of ret.items as { id: string }[]) {
      const proposed = await as(
        dispatcher,
        'post',
        `/branch/returns/${ret.id}/items/${item.id}/resolve`,
      ).send({
        disposition: 'restocked',
      });
      expect(proposed.status).toBe(200);
      const approved = await as(superAdmin, 'post', `/admin/returns/${ret.id}/items/${item.id}/approve`).send(
        {},
      );
      expect(approved.status).toBe(200);
    }
    const dspToner = await productIn(dispatchId, 'Rose Toner');
    const dspSerum = await productIn(dispatchId, 'Vitamin C Serum');
    expect((await stock(dspToner, dispatchId))!.quantity).toBe('20.000');
    expect((await stock(dspSerum, dispatchId))!.quantity).toBe('5.000');
    const lahoreToner = await productIn(lahoreId, 'Rose Toner');
    expect((await stock(lahoreToner, lahoreId))!.quantity).toBe('0.000');
  });

  it('lets any branch book online from the Dispatch Department catalog without holding the product', async () => {
    const catalog = await as(isbDesk, 'get', '/branch/sales/online-catalog?search=serum');
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.dispatch).toMatchObject({ id: dispatchId });
    const serumRow = (catalog.body.data.items as { id: string; name: string; available: string }[]).find(
      (i) => i.name === 'Vitamin C Serum',
    )!;
    expect(serumRow.available).toBe('5.000');
    const isbProducts = (await as(isbDesk, 'get', '/branch/products?pageSize=100')).body.data as {
      name: string;
    }[];
    expect(isbProducts.map((p) => p.name)).not.toContain('Vitamin C Serum');

    const order = await online(isbDesk, [{ productId: serumRow.id, qty: '2' }], isbCash);
    expect(order.status).toBe(201);
    expect(order.body.data.fulfillmentBranchId).toBe(dispatchId);
    const after = (await as(isbDesk, 'get', '/branch/sales/online-catalog?search=serum')).body.data.items as {
      name: string;
      available: string;
    }[];
    expect(after.find((i) => i.name === 'Vitamin C Serum')!.available).toBe('3.000');

    await verifyPayments(order.body.data.id);
    const sent = await as(dispatcher, 'post', `/branch/sales/${order.body.data.id}/dispatch`).send({
      serials: [serials[3], serials[4]],
    });
    expect(sent.status).toBe(200);
    expect((await stock(serumRow.id, dispatchId))!.quantity).toBe('3.000');
    expect((await as(isbDesk, 'get', '/branch/sales/online-catalog', undefined)).status).toBe(200);
  });

  it('keeps only the dispatch roles in the Dispatch Department', async () => {
    const person = (role: string, n: number) => ({
      firstName: 'Ali',
      lastName: 'Khan',
      email: `dsp${n}@dsm.pk`,
      username: `dsp${n}`,
      password: 'Password123',
      role,
    });
    const desk = await as(superAdmin, 'post', '/branch/staff', dispatchId).send(person('front_desk', 1));
    expect(desk.status).toBe(422);
    const keeper = await as(superAdmin, 'post', '/branch/staff', dispatchId).send(person('store_keeper', 2));
    expect(keeper.status).toBe(201);
    const branchDispatcher = await as(superAdmin, 'post', '/branch/staff', lahoreId).send(
      person('dispatcher', 3),
    );
    expect(branchDispatcher.status).toBe(422);
    expect(branchDispatcher.body.error.message).toContain('Dispatch Department');
    const branchKeeper = await as(superAdmin, 'post', '/branch/staff', lahoreId).send(
      person('store_keeper', 4),
    );
    expect(branchKeeper.status).toBe(422);
  });
});
