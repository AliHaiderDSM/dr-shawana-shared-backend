import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';
import { AuditLog } from '../audit/audit-log.entity';
import { StockMovement } from '../inventory/stock-movement.entity';

const fake = installFakeSupabase();
const app = createApp();

describe('POS sales', () => {
  let admin: { id: string };
  let frontDesk: { id: string };
  let otherFrontDesk: { id: string };
  let accountant: { id: string };
  let deliveryPrint: { id: string };
  let pharmacy: { id: string };
  let islamabadAdmin: { id: string };
  let serum: string;
  let toner: string;
  let bundleId: string;
  let cashSheet: string;
  let bankSheet: string;
  let patientId: string;
  let saleId: string;
  let onlineSaleId: string;

  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));

  const pay = (amount = '1') => [{ method: 'cash', amount, accountSheetId: cashSheet }];

  async function stock(productId: string) {
    const res = await api('get', '/branch/inventory/stock?pageSize=100', admin);
    return res.body.data.find((r: { productId: string }) => r.productId === productId)?.quantity as string;
  }

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR', city: 'Lahore' });
    const islamabad = await createBranch({ code: 'ISB', city: 'Islamabad' });
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahore.id });
    otherFrontDesk = await createStaff(fake, { role: 'team_manager', branchId: lahore.id });
    accountant = await createStaff(fake, { role: 'accountant', branchId: lahore.id });
    deliveryPrint = await createStaff(fake, { role: 'delivery_print', branchId: lahore.id });
    pharmacy = await createStaff(fake, { role: 'pharmacy', branchId: lahore.id });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });

    const categoryId = (await api('post', '/branch/categories', admin).send({ name: 'Skin' })).body.data.id;
    const product = (name: string, quantity: string, unitPrice: string) =>
      api('post', '/branch/products', admin).send({
        name,
        categoryId,
        initialPurchase: { date: '2026-09-01', quantity, unitPrice },
      });
    serum = (await product('Serum', '10', '1000')).body.data.id;
    toner = (await product('Toner', '5', '500')).body.data.id;
    bundleId = (
      await api('post', '/branch/bundles', admin).send({
        name: 'Glow Kit',
        items: [
          { productId: serum, price: '900' },
          { productId: toner, price: '400', qty: '2' },
        ],
      })
    ).body.data.id;
    cashSheet = (
      await api('post', '/branch/account-sheets', admin).send({
        accountName: 'Cash',
        accountCode: 'C1',
        type: 'cash',
      })
    ).body.data.id;
    const bankId = (await api('post', '/branch/banks', admin).send({ name: 'Meezan' })).body.data.id;
    bankSheet = (
      await api('post', '/branch/account-sheets', admin).send({
        accountName: 'Meezan',
        accountCode: 'M1',
        type: 'bank',
        bankId,
      })
    ).body.data.id;
    patientId = (
      await api('post', '/branch/patients', frontDesk).send({
        name: 'Ayesha',
        phone: '923001234567',
        city: 'Kasur',
        address: 'Main Road',
      })
    ).body.data.id;
  });

  it('prices items on the server, expands bundles, takes payments and reduces stock', async () => {
    const res = await request(app)
      .post('/api/v1/branch/sales')
      .set(bearer(frontDesk))
      .field(
        'data',
        JSON.stringify({
          patientId,
          date: '2026-09-10',
          saleType: 'office',
          discountPercent: '10',
          items: [
            { productId: serum, qty: '2' },
            { bundleId, qty: '1' },
          ],
          payments: [
            { method: 'cash', amount: '2000', accountSheetId: cashSheet },
            {
              method: 'online',
              amount: '500',
              accountSheetId: bankSheet,
              senderBank: 'HBL',
              proofIndex: 0,
            },
          ],
        }),
      )
      .attach('paymentProofs', Buffer.from('png'), { filename: 'p.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    saleId = res.body.data.id;
    expect(res.body.data).toMatchObject({
      invoiceNo: 'LHR-000001',
      saleType: 'office',
      city: 'Lahore',
      patientCity: 'Kasur',
      deliveryStatus: null,
      totalQty: '5.000',
      subtotal: '3700.00',
      discountPercent: '10.00',
      discountAmount: '370.00',
      total: '3330.00',
      received: '2500.00',
      remaining: '830.00',
      paymentStatus: 'awaiting_approval',
      paymentMethods: ['cash', 'online'],
    });
    expect(res.body.data.payments.every((p: { approvedAt: string | null }) => p.approvedAt === null)).toBe(
      true,
    );
    expect((await api('post', `/branch/sales/${saleId}/payments/approve`, frontDesk).send({})).status).toBe(
      403,
    );
    const approved = await api('post', `/branch/sales/${saleId}/payments/approve`, admin).send({});
    expect(approved.body.data.paymentStatus).toBe('partial');
    expect(
      approved.body.data.payments.every((p: { approvedAt: string | null }) => p.approvedAt !== null),
    ).toBe(true);
    expect((await api('post', `/branch/sales/${saleId}/payments/approve`, admin).send({})).status).toBe(409);
    expect(
      res.body.data.items.map((i: { unitPrice: string; bundleId: string | null }) => [
        i.unitPrice,
        !!i.bundleId,
      ]),
    ).toEqual([
      ['1000.00', false],
      ['900.00', true],
      ['400.00', true],
    ]);
    expect(await stock(serum)).toBe('7.000');
    expect(await stock(toner)).toBe('3.000');
  });

  it('ignores client prices and blocks a sale when stock is short', async () => {
    const short = await api('post', '/branch/sales', frontDesk).send({
      patientId,
      saleType: 'office',
      items: [{ productId: toner, qty: '4', unitPrice: '1' }],
      payments: pay(),
    });
    expect(short.status).toBe(422);
    expect(short.body.error.details.shortages[0]).toMatchObject({
      productName: 'Toner',
      available: '3',
      required: '4',
    });
    expect(await stock(toner)).toBe('3.000');
    const noItems = await api('post', '/branch/sales', frontDesk).send({
      patientId,
      saleType: 'office',
      items: [],
    });
    expect(noItems.status).toBe(400);
    const unpaid = await api('post', '/branch/sales', frontDesk).send({
      patientId,
      saleType: 'office',
      items: [{ productId: toner, qty: '1' }],
      payments: [],
    });
    expect(unpaid.status).toBe(400);
    expect(JSON.stringify(unpaid.body.error)).toContain('payment');
  });

  it('turns an underpayment into the discount with posSoft "Auto"', async () => {
    const before = await stock(serum);
    const res = await api('post', '/branch/sales', admin).send({
      patient: { name: 'Walk In', phone: '923331112222', city: 'Lahore' },
      saleType: 'online',
      autoDiscount: true,
      items: [{ productId: serum, qty: '1' }],
      payments: [{ method: 'cash', amount: '900', accountSheetId: cashSheet }],
    });
    expect(res.status).toBe(201);
    onlineSaleId = res.body.data.id;
    expect(res.body.data).toMatchObject({
      invoiceNo: 'LHR-000002',
      deliveryStatus: 'pending',
      discountAmount: '100.00',
      discountPercent: '10.00',
      total: '900.00',
      remaining: '0.00',
      paymentStatus: 'awaiting_approval',
    });
    expect(
      (await api('post', `/branch/sales/${onlineSaleId}/payments/approve`, admin).send({})).body.data
        .paymentStatus,
    ).toBe('paid');
    expect(await stock(serum)).toBe(before);
    const dispatched = await api('post', `/branch/sales/${onlineSaleId}/dispatch`, admin).send({});
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.data.deliveryStatus).toBe('dispatched');
    expect(Number(await stock(serum))).toBe(Number(before) - 1);
  });

  it('adjusts stock by the difference on edit and lets front desk edit only their own sales', async () => {
    expect((await api('patch', `/branch/sales/${saleId}`, otherFrontDesk).send({ note: 'x' })).status).toBe(
      403,
    );
    const res = await api('patch', `/branch/sales/${saleId}`, frontDesk).send({
      items: [{ productId: serum, qty: '1' }],
      discountPercent: '0',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ subtotal: '1000.00', total: '1000.00', remaining: '-1500.00' });
    expect(await stock(serum)).toBe('8.000');
    expect(await stock(toner)).toBe('5.000');
    const adjust = await AppDataSource.getRepository(StockMovement).find({
      where: { referenceId: saleId, type: 'sale_edit_adjust' },
    });
    expect(adjust.map((m) => m.qty.toString()).sort()).toEqual(['2', '2']);
    const log = await AppDataSource.getRepository(AuditLog).findOneBy({
      entity: 'sale',
      entityId: saleId,
      action: 'update',
    });
    expect(log).not.toBeNull();
  });

  it('recomputes totals when payments change', async () => {
    const payments = (await api('get', `/branch/sales/${saleId}`, frontDesk)).body.data.payments;
    const removed = await api('delete', `/branch/sales/${saleId}/payments/${payments[0].id}`, frontDesk);
    expect(removed.status).toBe(204);
    const after = await api('get', `/branch/sales/${saleId}`, frontDesk);
    expect(after.body.data).toMatchObject({
      received: '500.00',
      remaining: '500.00',
      paymentStatus: 'partial',
    });
    const proof = await api('get', `/branch/sales/${saleId}/payments/${payments[1].id}/proof-url`, frontDesk);
    expect(proof.status).toBe(200);
    const added = await api('post', `/branch/sales/${saleId}/payments`, frontDesk).send({
      method: 'cash',
      amount: '500',
      accountSheetId: cashSheet,
    });
    expect(added.body.data).toMatchObject({
      received: '1000.00',
      remaining: '0.00',
      paymentStatus: 'awaiting_approval',
    });
    expect(
      (await api('post', `/branch/sales/${saleId}/payments/approve`, admin).send({})).body.data.paymentStatus,
    ).toBe('paid');
  });

  it('keeps several screenshots on an online payment', async () => {
    const online = (await api('get', `/branch/sales/${saleId}`, frontDesk)).body.data.payments.find(
      (p: { method: string }) => p.method === 'online',
    );
    expect(online.proofs).toHaveLength(1);
    const png = (name: string) => [Buffer.from('png'), { filename: name, contentType: 'image/png' }] as const;
    const added = await request(app)
      .post(`/api/v1/branch/sales/${saleId}/payments/${online.id}/proof`)
      .set(bearer(frontDesk))
      .attach('proof', ...png('a.png'))
      .attach('proof', ...png('b.png'));
    expect(added.status).toBe(200);
    const proofs = added.body.data.payments.find((p: { id: string }) => p.id === online.id).proofs;
    expect(proofs.map((p: { originalName: string }) => p.originalName)).toEqual(['p.png', 'a.png', 'b.png']);

    const url = await api(
      'get',
      `/branch/sales/${saleId}/payments/${online.id}/proofs/${proofs[2].id}/url`,
      frontDesk,
    );
    expect(url.status).toBe(200);
    const removed = await api(
      'delete',
      `/branch/sales/${saleId}/payments/${online.id}/proofs/${proofs[0].id}`,
      frontDesk,
    );
    expect(removed.body.data.payments.find((p: { id: string }) => p.id === online.id)).toMatchObject({
      hasProof: true,
      proofOriginalName: 'a.png',
    });

    const tooMany = await request(app)
      .post(`/api/v1/branch/sales/${saleId}/payments/${online.id}/proof`)
      .set(bearer(frontDesk))
      .attach('proof', ...png('c.png'))
      .attach('proof', ...png('d.png'))
      .attach('proof', ...png('e.png'))
      .attach('proof', ...png('f.png'));
    expect(tooMany.status).toBe(400);

    const sale = await request(app)
      .post(`/api/v1/branch/sales/${saleId}/payments`)
      .set(bearer(frontDesk))
      .field(
        'data',
        JSON.stringify({ method: 'online', amount: '1', accountSheetId: bankSheet, senderBank: 'MCB' }),
      )
      .attach('proof', ...png('x.png'))
      .attach('proof', ...png('y.png'));
    expect(sale.status).toBe(201);
    const newest = sale.body.data.payments.find((p: { senderBank: string }) => p.senderBank === 'MCB');
    expect(newest.proofs).toHaveLength(2);
    await api('delete', `/branch/sales/${saleId}/payments/${newest.id}`, frontDesk);
  });

  it('returns an online sale into the returns section, once, and restocks it after inspection', async () => {
    expect(
      (await api('post', `/branch/sales/${saleId}/delivery`, admin).send({ status: 'delivered' })).status,
    ).toBe(422);
    const delivered = await api('post', `/branch/sales/${onlineSaleId}/delivery`, admin).send({
      status: 'delivered',
    });
    expect(delivered.body.data.deliveryStatus).toBe('delivered');
    expect(await stock(serum)).toBe('8.000');
    const returned = await api('post', `/branch/sales/${onlineSaleId}/delivery`, admin).send({
      status: 'returned',
    });
    expect(returned.body.data.deliveryStatus).toBe('returned');
    expect(await stock(serum)).toBe('8.000');
    const pending = await api('get', `/branch/returns?saleId=${onlineSaleId}`, admin);
    expect(pending.body.data).toHaveLength(1);
    const deliveryReturn = pending.body.data[0];
    expect(deliveryReturn).toMatchObject({
      status: 'pending',
      reason: 'customer_refused',
      totalQty: '1.000',
    });
    expect(deliveryReturn.returnNo).toMatch(/^LHR-RET-\d{6}$/);
    const restocked = await api(
      'post',
      `/branch/returns/${deliveryReturn.id}/items/${deliveryReturn.items[0].id}/resolve`,
      admin,
    ).send({ disposition: 'restocked' });
    expect(restocked.body.data.status).toBe('completed');
    expect(await stock(serum)).toBe('9.000');
    expect((await api('delete', `/branch/sales/${onlineSaleId}`, admin)).status).toBe(409);
    expect(
      (await api('post', `/branch/sales/${onlineSaleId}/delivery`, admin).send({ status: 'delivered' }))
        .status,
    ).toBe(409);
    expect(
      (
        await api('patch', `/branch/sales/${onlineSaleId}`, admin).send({
          items: [{ productId: serum, qty: '1' }],
        })
      ).status,
    ).toBe(409);

    const report = await api(
      'get',
      `/branch/inventory/report?from=2026-01-01&to=2030-12-31&productId=${serum}`,
      admin,
    );
    const row = report.body.data.rows[0];
    expect(row).toMatchObject({ returned: '1.000' });
  });

  it('lists with posSoft filters and totals, prints the bill and delivery slips', async () => {
    const list = await api('get', '/branch/sales?saleType=office', frontDesk);
    expect(list.body.data.map((s: { id: string }) => s.id)).toEqual([saleId]);
    expect(list.body.meta.totals).toMatchObject({ total: '1000.00', received: '1000.00' });
    expect(list.body.data[0].products).toEqual([{ name: 'Serum', qty: '1.000' }]);
    const byProduct = await api('get', `/branch/sales?productId=${toner}`, frontDesk);
    expect(byProduct.body.data).toEqual([]);
    const search = await api('get', '/branch/sales?search=LHR-000002', frontDesk);
    expect(search.body.data.map((s: { id: string }) => s.id)).toEqual([onlineSaleId]);
    expect(
      (await api('get', `/branch/sales?method=online&accountSheetId=${bankSheet}`, admin)).body.meta.total,
    ).toBe(1);

    const bill = await api('get', `/branch/sales/${saleId}/bill`, frontDesk);
    expect(bill.body.data).toMatchObject({
      branch: { code: 'LHR', city: 'Lahore' },
      customer: { name: 'Ayesha', address: 'Main Road' },
      sale: { invoiceNo: 'LHR-000001', total: '1000.00' },
      items: [{ sr: 1, product: 'Serum', qty: '1.000' }],
    });
    expect(bill.body.data.payments.cash).toHaveLength(1);
    expect(bill.body.data.payments.online).toHaveLength(1);

    const slips = await api(
      'get',
      '/branch/sales/delivery-slips?from=2026-01-01&to=2030-12-31&invoiceFrom=1&invoiceTo=1',
      deliveryPrint,
    );
    expect(slips.status).toBe(200);
    expect(slips.body.data.slips).toHaveLength(1);
    expect(slips.body.data.slips[0]).toMatchObject({
      invoiceNo: 'LHR-000001',
      to: { name: 'Ayesha', city: 'Kasur' },
      items: [{ name: 'Serum', qty: '1.000' }],
      from: { city: 'Lahore' },
    });
    expect((await api('get', '/branch/sales', deliveryPrint)).status).toBe(403);
    expect((await api('get', '/branch/sales/delivery-slips', frontDesk)).status).toBe(403);
  });

  it('keeps roles and branches apart', async () => {
    expect((await api('get', '/branch/sales', pharmacy)).status).toBe(403);
    expect((await api('patch', `/branch/sales/${saleId}`, accountant).send({ note: 'x' })).status).toBe(403);
    expect((await api('get', `/branch/sales/${saleId}`, islamabadAdmin)).status).toBe(404);
    const foreign = await api('post', '/branch/sales', islamabadAdmin).send({
      patientId,
      saleType: 'office',
      items: [{ productId: serum, qty: '1' }],
    });
    expect(foreign.status).toBe(400);
  });

  it('removes a sale, reversing its stock and payments', async () => {
    expect((await api('delete', `/branch/sales/${saleId}`, otherFrontDesk)).status).toBe(403);
    expect((await api('delete', `/branch/sales/${saleId}`, frontDesk)).status).toBe(204);
    expect(await stock(serum)).toBe('10.000');
    expect((await api('get', `/branch/sales/${saleId}`, admin)).status).toBe(404);
    const next = await api('post', '/branch/sales', admin).send({
      patientId,
      saleType: 'office',
      items: [{ productId: toner, qty: '1' }],
      payments: pay(),
    });
    expect(next.body.data.invoiceNo).toBe('LHR-000003');
  });

  it('takes a discount on one line and the sale discount on top', async () => {
    const res = await api('post', '/branch/sales', admin).send({
      patientId,
      saleType: 'office',
      discountPercent: '10',
      items: [
        { productId: serum, qty: '2', discountPercent: '25' },
        { productId: serum, qty: '1' },
      ],
      payments: pay(),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.items.map((i: { discountAmount: string; lineTotal: string }) => i)).toEqual([
      expect.objectContaining({ discountPercent: '25.00', discountAmount: '500.00', lineTotal: '1500.00' }),
      expect.objectContaining({ discountPercent: '0.00', discountAmount: '0.00', lineTotal: '1000.00' }),
    ]);
    expect(res.body.data).toMatchObject({
      subtotal: '2500.00',
      discountAmount: '250.00',
      total: '2250.00',
    });
    const bill = await api('get', `/branch/sales/${res.body.data.id}/bill`, admin);
    expect(bill.body.data.items[0]).toMatchObject({ discountPercent: '25.00', lineTotal: '1500.00' });
    const tooMuch = await api('post', '/branch/sales', admin).send({
      patientId,
      saleType: 'office',
      items: [{ productId: serum, qty: '1', discountPercent: '120' }],
      payments: pay(),
    });
    expect(tooMuch.status).toBe(400);
  });

  describe('online orders booked now and dispatched later', () => {
    const balance = async (productId: string) =>
      (await api('get', '/branch/inventory/stock?pageSize=100', admin)).body.data.find(
        (r: { productId: string }) => r.productId === productId,
      ) as { quantity: string; reservedQuantity: string };

    it('books stock on Saturday, takes it out on Monday and keeps the dates apart', async () => {
      const start = await balance(toner);
      const order = await api('post', '/branch/sales', admin).send({
        patientId,
        saleType: 'online',
        date: '2026-10-03',
        items: [{ productId: toner, qty: '2' }],
        payments: [{ method: 'online', amount: '1000', accountSheetId: bankSheet, date: '2026-10-03' }],
      });
      expect(order.status).toBe(201);
      expect(order.body.data).toMatchObject({ deliveryStatus: 'pending', dispatchedOn: null });
      const booked = await balance(toner);
      expect(booked.quantity).toBe(start.quantity);
      expect(booked.reservedQuantity).toBe('2.000');

      const free = Number(start.quantity) - 2;
      const office = await api('post', '/branch/sales', admin).send({
        patientId,
        saleType: 'office',
        items: [{ productId: toner, qty: String(free + 1) }],
        payments: pay(),
      });
      expect(office.status).toBe(422);
      expect(office.body.error.details.shortages[0]).toMatchObject({ reserved: '2.000' });
      const tooMuch = await api('post', '/branch/sales', admin).send({
        patientId,
        saleType: 'online',
        items: [{ productId: toner, qty: String(free + 1) }],
        payments: pay(),
      });
      expect(tooMuch.status).toBe(422);

      expect(
        (
          await api('post', `/branch/sales/${order.body.data.id}/delivery`, admin).send({
            status: 'delivered',
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await api('post', '/branch/returns', admin).send({
            saleId: order.body.data.id,
            date: '2026-10-04',
            reason: 'other',
            items: [{ productId: toner, qty: '1' }],
          })
        ).status,
      ).toBe(409);

      const calendar = await api('get', '/branch/sales/delivery-calendar?month=2026-10', admin);
      expect(calendar.status).toBe(200);
      expect(calendar.body.data.days.find((d: { date: string }) => d.date === '2026-10-03')).toMatchObject({
        orders: 1,
        awaiting: 1,
      });
      expect(calendar.body.data.awaiting).toEqual({ orders: 1, oldest: '2026-10-03' });
      const waiting = (await api('get', '/branch/sales?deliveryStatus=pending', admin)).body.data;
      expect(waiting.map((d: { invoiceNo: string }) => d.invoiceNo)).toEqual([order.body.data.invoiceNo]);
      const due = (await api('get', '/branch/sales?due=true', admin)).body.data;
      expect(due.every((d: { remaining: string }) => Number(d.remaining) > 0)).toBe(true);
      expect(due.map((d: { invoiceNo: string }) => d.invoiceNo)).not.toContain(order.body.data.invoiceNo);
      const notSent = await api('get', '/branch/sales/delivery-slips?dispatchedOn=2026-10-05', admin);
      expect(notSent.body.data.slips).toEqual([]);
      const day = await api('get', '/branch/sales/deliveries?date=2026-10-03', admin);
      expect(day.body.data).toEqual([
        expect.objectContaining({
          invoiceNo: order.body.data.invoiceNo,
          items: [expect.objectContaining({ name: 'Toner', qty: '2.000', tracked: false })],
        }),
      ]);

      expect(
        (
          await api('post', `/branch/sales/${order.body.data.id}/dispatch`, admin).send({
            date: '2026-10-01',
          })
        ).status,
      ).toBe(400);
      const sent = await api('post', `/branch/sales/${order.body.data.id}/dispatch`, admin).send({
        date: '2026-10-05',
      });
      expect(sent.status).toBe(200);
      expect(sent.body.data).toMatchObject({ deliveryStatus: 'dispatched', dispatchedOn: '2026-10-05' });
      const after = await balance(toner);
      expect(after.reservedQuantity).toBe('0.000');
      expect(Number(after.quantity)).toBe(Number(start.quantity) - 2);
      const moves = await AppDataSource.getRepository(StockMovement).find({
        where: { referenceId: order.body.data.id },
      });
      expect(moves.map((m) => m.date)).toEqual(['2026-10-05']);
      const monday = await api('get', '/branch/sales/delivery-calendar?month=2026-10', admin);
      expect(monday.body.data.days.find((d: { date: string }) => d.date === '2026-10-05')).toMatchObject({
        dispatchedOn: 1,
      });
      expect((await api('post', `/branch/sales/${order.body.data.id}/dispatch`, admin).send({})).status).toBe(
        409,
      );

      const delivered = await api('post', `/branch/sales/${order.body.data.id}/delivery`, admin).send({
        status: 'delivered',
      });
      expect(delivered.body.data.deliveryStatus).toBe('delivered');
      expect(delivered.body.data.deliveredOn).toEqual(expect.any(String));
    });

    it('cancels a booked order with a refund and frees its stock', async () => {
      const order = await api('post', '/branch/sales', admin).send({
        patientId,
        saleType: 'online',
        date: '2026-10-04',
        items: [{ productId: toner, qty: '1' }],
        payments: [{ method: 'online', amount: '500', accountSheetId: bankSheet, date: '2026-10-04' }],
      });
      expect((await balance(toner)).reservedQuantity).toBe('1.000');
      const tooBig = await api('post', `/branch/sales/${order.body.data.id}/cancel`, admin).send({
        refund: { amount: '600', method: 'online', accountSheetId: bankSheet },
      });
      expect(tooBig.status).toBe(422);
      const cancelled = await api('post', `/branch/sales/${order.body.data.id}/cancel`, admin).send({
        refund: { amount: '500', method: 'online', accountSheetId: bankSheet, date: '2026-10-05' },
      });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data.deliveryStatus).toBe('cancelled');
      expect((await balance(toner)).reservedQuantity).toBe('0.000');
      const refunds = (await api('get', `/branch/returns?saleId=${order.body.data.id}`, admin)).body.data;
      expect(refunds).toEqual([
        expect.objectContaining({ status: 'completed', refundAmount: '500.00', totalQty: '0.000' }),
      ]);
      expect((await api('post', `/branch/sales/${order.body.data.id}/cancel`, admin).send({})).status).toBe(
        409,
      );
      expect((await api('post', `/branch/sales/${order.body.data.id}/dispatch`, admin).send({})).status).toBe(
        409,
      );
    });
  });
});
