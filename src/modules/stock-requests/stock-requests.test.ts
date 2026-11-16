import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { realtime } from '../../lib/realtime';

const fake = installFakeSupabase();
const app = createApp();

describe('Branch stock requests, Super Admin approval and branch receipt', () => {
  let superAdmin: { id: string };
  let lahoreAdmin: { id: string };
  let lahoreDesk: { id: string };
  let keeper: { id: string };
  let warehouseId: string;
  let lahoreId: string;
  let otherId: string;
  let serum: string;
  let toner: string;

  const as = (who: { id: string }, method: 'get' | 'post' | 'patch', path: string, branchId?: string) =>
    request(app)
      [method](`/api/v1${path}${branchId ? `${path.includes('?') ? '&' : '?'}branchId=${branchId}` : ''}`)
      .set(bearer(who));

  const stockOf = async (name: string, branchId: string) => {
    const res = await as(superAdmin, 'get', '/branch/inventory/stock?pageSize=100', branchId);
    return (res.body.data as { name: string; quantity: string }[]).find((r) => r.name === name)?.quantity;
  };

  beforeAll(async () => {
    warehouseId = (await createBranch({ code: 'MAINWH', name: 'Main Warehouse', kind: 'warehouse' })).id;
    lahoreId = (await createBranch({ code: 'LHR', name: 'Lahore' })).id;
    otherId = (await createBranch({ code: 'ISB', name: 'Islamabad' })).id;
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
    lahoreAdmin = await createStaff(fake, { role: 'branch_admin', branchId: lahoreId });
    lahoreDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
    keeper = await createStaff(fake, { role: 'warehouse_keeper', branchId: warehouseId });
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
    const stocked = await as(superAdmin, 'post', '/branch/stock-ins', warehouseId).send({
      date: '2026-10-01',
      items: [
        { unitCost: '100', productId: serum, qty: '20', batch: 'S-1', expiryDate: '2028-01-31' },
        { unitCost: '100', productId: toner, qty: '50', batch: 'T-1', expiryDate: '2028-06-30' },
      ],
    });
    expect(stocked.status).toBe(201);
    expect(stocked.body.data[0]).toMatchObject({ grnNo: 'MAINWH-GRN-000001', receiptStatus: 'confirmed' });
    expect(await stockOf('Vitamin C Serum', warehouseId)).toBe('20.000');
    expect((await as(keeper, 'get', '/branch/stock-receipts?status=pending')).body.data).toEqual([]);
  });

  it('runs a request from the branch to the Super Admin, the transfer, and the branch receipt', async () => {
    const catalog = await as(lahoreAdmin, 'get', '/branch/stock-requests/catalog?search=serum');
    expect(catalog.body.data).toEqual([expect.objectContaining({ id: serum, available: '20.000' })]);

    expect(
      (
        await as(lahoreDesk, 'post', '/branch/stock-requests').send({
          items: [{ productId: serum, qty: '1' }],
        })
      ).status,
    ).toBe(403);
    const pinged = jest.spyOn(realtime, 'publish');
    const tooMuch = await as(lahoreAdmin, 'post', '/branch/stock-requests').send({
      items: [{ productId: serum, qty: '100000' }],
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.message).toContain('only');
    expect(pinged).not.toHaveBeenCalled();
    const asked = await as(lahoreAdmin, 'post', '/branch/stock-requests').send({
      note: 'Weekend',
      items: [{ productId: serum, qty: '3' }],
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(pinged).toHaveBeenCalledWith('staff', 'all', 'badges', {});
    pinged.mockClear();
    await as(lahoreAdmin, 'get', '/branch/stock-requests');
    await new Promise((resolve) => setImmediate(resolve));
    expect(pinged).not.toHaveBeenCalled();
    pinged.mockRestore();
    expect(asked.status).toBe(201);
    expect(asked.body.data).toMatchObject({
      requestNo: 'LHR-SR-000001',
      status: 'pending',
      requestedBy: { id: lahoreAdmin.id, role: 'branch_admin' },
      branch: { id: lahoreId },
    });
    const requestId = asked.body.data.id as string;
    const corrected = {
      note: 'Weekend rush',
      items: [
        { productId: serum, qty: '5' },
        { productId: toner, qty: '10', note: 'Big bottles' },
      ],
    };
    expect(
      (
        await as(lahoreAdmin, 'patch', `/branch/stock-requests/${requestId}`).send({
          items: [{ productId: serum, qty: '500' }],
        })
      ).status,
    ).toBe(422);
    expect(
      (await as(keeper, 'patch', `/branch/stock-requests/${requestId}`, lahoreId).send(corrected)).status,
    ).toBe(403);
    const fixed = await as(lahoreAdmin, 'patch', `/branch/stock-requests/${requestId}`).send(corrected);
    expect(fixed.status).toBe(200);
    expect(fixed.body.data).toMatchObject({
      requestNo: 'LHR-SR-000001',
      status: 'pending',
      note: 'Weekend rush',
    });
    expect(fixed.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productName: 'Vitamin C Serum', qty: '5.000' }),
        expect.objectContaining({ productName: 'Rose Toner', qty: '10.000', note: 'Big bottles' }),
      ]),
    );
    const tonerLine = (fixed.body.data.items as { id: string; productName: string }[]).find(
      (i) => i.productName === 'Rose Toner',
    )!;

    const early = await as(keeper, 'post', '/branch/stock-outs').send({
      date: '2026-10-02',
      toBranchId: lahoreId,
      stockRequestId: requestId,
      items: [{ productId: serum, qty: '5' }],
    });
    expect(early.status).toBe(409);

    expect(
      (await as(lahoreAdmin, 'post', `/admin/stock-requests/${requestId}/approve`).send({})).status,
    ).toBe(403);
    expect((await as(superAdmin, 'get', '/admin/stock-requests/pending-count')).body.data).toEqual({
      pending: 1,
      toSend: 0,
    });
    const all = await as(superAdmin, 'get', '/branch/stock-requests?status=pending');
    expect(all.body.data.map((r: { requestNo: string }) => r.requestNo)).toEqual(['LHR-SR-000001']);
    const overAsked = await as(superAdmin, 'post', `/admin/stock-requests/${requestId}/approve`).send({
      items: [{ id: tonerLine.id, approvedQty: '1111' }],
    });
    expect(overAsked.status).toBe(422);
    expect(overAsked.body.error.message).toContain('Rose Toner 10');
    expect((await as(superAdmin, 'get', `/branch/stock-requests/${requestId}`)).body.data.status).toBe(
      'pending',
    );
    const approved = await as(superAdmin, 'post', `/admin/stock-requests/${requestId}/approve`).send({
      note: 'Only 6 toners this week',
      items: [{ id: tonerLine.id, approvedQty: '6' }],
    });
    expect(approved.status).toBe(200);
    expect(
      (await as(lahoreAdmin, 'patch', `/branch/stock-requests/${requestId}`).send(corrected)).status,
    ).toBe(409);
    expect(approved.body.data.status).toBe('approved');
    expect(approved.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productName: 'Rose Toner', qty: '10.000', approvedQty: '6.000' }),
        expect.objectContaining({ productName: 'Vitamin C Serum', approvedQty: '5.000' }),
      ]),
    );

    const bySuperAdmin = await as(superAdmin, 'post', '/branch/stock-outs', warehouseId).send({
      date: '2026-10-02',
      toBranchId: lahoreId,
      stockRequestId: requestId,
      items: [{ productId: serum, qty: '5' }],
    });
    expect(bySuperAdmin.status).toBe(403);
    expect(bySuperAdmin.body.error.message).toContain('Warehouse Keeper');
    const wrongBranch = await as(keeper, 'post', '/branch/stock-outs').send({
      date: '2026-10-02',
      toBranchId: otherId,
      stockRequestId: requestId,
      items: [{ productId: serum, qty: '5' }],
    });
    expect(wrongBranch.status).toBe(400);
    const overApproved = await as(keeper, 'post', '/branch/stock-outs').send({
      date: '2026-10-02',
      toBranchId: lahoreId,
      stockRequestId: requestId,
      items: [{ productId: toner, qty: '7' }],
    });
    expect(overApproved.status).toBe(422);
    expect(overApproved.body.error.message).toContain('only 6');
    const keeperList = (await as(keeper, 'get', '/branch/stock-requests?status=approved')).body.data;
    expect(keeperList.map((r: { requestNo: string }) => r.requestNo)).toEqual(['LHR-SR-000001']);
    expect((await as(keeper, 'get', '/branch/badges')).body.data.stockRequests).toBe(1);
    expect((await as(keeper, 'post', `/admin/stock-requests/${requestId}/reject`).send({})).status).toBe(403);
    const sent = await as(keeper, 'post', '/branch/stock-outs').send({
      date: '2026-10-02',
      toBranchId: lahoreId,
      stockRequestId: requestId,
      items: [
        { productId: serum, qty: '5' },
        { productId: toner, qty: '6' },
      ],
    });
    expect(sent.status).toBe(201);
    const transferNo = sent.body.data[0].transferNo as string;
    expect(transferNo).toBe('MAINWH-TR-000001');
    const onTheWay = (await as(lahoreAdmin, 'get', `/branch/stock-requests/${requestId}`)).body.data;
    expect(onTheWay.transfers).toEqual([
      expect.objectContaining({ transferNo: 'MAINWH-TR-000001', received: false }),
    ]);
    expect((await as(keeper, 'get', `/branch/trace/${transferNo}`)).status).toBe(200);
    expect(onTheWay).toMatchObject({ status: 'sent', transferNos: [transferNo] });
    expect(await stockOf('Vitamin C Serum', warehouseId)).toBe('15.000');
    expect(await stockOf('Vitamin C Serum', lahoreId)).toBeUndefined();

    expect((await as(lahoreAdmin, 'get', '/branch/badges')).body.data).toMatchObject({
      incomingStock: 1,
      stockRequests: 1,
    });
    expect((await as(superAdmin, 'get', '/branch/badges')).body.data).toMatchObject({
      incomingStock: 1,
      stockRequests: 0,
    });
    const incoming = (await as(lahoreAdmin, 'get', '/branch/incoming-stock?status=waiting')).body.data;
    expect(incoming).toEqual([
      expect.objectContaining({
        transferNo,
        received: false,
        request: { id: requestId, requestNo: 'LHR-SR-000001' },
      }),
    ]);
    const got = await as(lahoreAdmin, 'post', `/branch/incoming-stock/${transferNo}/receive`).send({
      date: '2026-10-03',
    });
    expect(got.status).toBe(200);
    expect(await stockOf('Vitamin C Serum', lahoreId)).toBe('5.000');
    const receipt = (
      await as(lahoreAdmin, 'get', '/branch/incoming-stock?transferNo=' + transferNo.toLowerCase())
    ).body.data;
    expect(receipt).toEqual([
      expect.objectContaining({
        transferNo,
        received: true,
        receivedBy: expect.objectContaining({ id: lahoreAdmin.id }),
      }),
    ]);
    expect((await as(lahoreAdmin, 'get', '/branch/incoming-stock?transferNo=NOPE-1')).body.data).toEqual([]);
    expect(await stockOf('Rose Toner', lahoreId)).toBe('6.000');
    const done = (await as(lahoreAdmin, 'get', `/branch/stock-requests/${requestId}`)).body.data;
    expect(done).toMatchObject({ status: 'received', receivedBy: { id: lahoreAdmin.id } });
    expect(done.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ productName: 'Rose Toner', receivedQty: '6.000' })]),
    );
    const traced = await as(lahoreAdmin, 'get', '/branch/trace/lhr-sr-000001');
    expect(traced.status).toBe(200);
    expect(traced.body.data).toMatchObject({
      kind: 'stock_request',
      number: 'LHR-SR-000001',
      status: 'received',
      links: [{ kind: 'transfer', number: transferNo, status: 'received' }],
    });
    expect(traced.body.data.timeline.map((t: { action: string }) => t.action)).toEqual(
      expect.arrayContaining(['create', 'approve', 'receive']),
    );
    const viaTransfer = await as(superAdmin, 'get', `/branch/trace/${transferNo}`);
    expect(viaTransfer.body.data).toMatchObject({
      kind: 'transfer',
      links: [{ kind: 'stock_request', number: 'LHR-SR-000001' }],
    });
    expect((await as(lahoreDesk, 'get', '/branch/trace/NOPE-000001')).status).toBe(404);
    const stockIns = (await as(lahoreAdmin, 'get', '/branch/stock-ins')).body.data as { date: string }[];
    expect(stockIns.map((s) => s.date)).toEqual(['2026-10-03', '2026-10-03']);
  });

  it('lists write-offs with their number, reason and who made them', async () => {
    const batches = (await as(lahoreAdmin, 'get', '/branch/inventory/batches?search=Toner')).body.data as {
      id: string;
    }[];
    const off = await as(lahoreAdmin, 'post', `/branch/inventory/batches/${batches[0]!.id}/write-off`).send({
      qty: '2',
      reason: 'damaged',
      note: 'Broken in transit',
    });
    expect(off.status).toBe(200);
    expect(await stockOf('Rose Toner', lahoreId)).toBe('6.000');
    const pending = (await as(lahoreAdmin, 'get', '/branch/inventory/write-offs?status=pending')).body.data;
    expect(pending).toEqual([expect.objectContaining({ writeOffNo: 'LHR-WO-000001', status: 'pending' })]);
    expect((await as(superAdmin, 'get', '/admin/write-offs/pending-count')).body.data).toEqual({
      pending: 1,
    });
    expect(
      (await as(lahoreAdmin, 'post', `/admin/write-offs/${pending[0].id}/approve`).send({})).status,
    ).toBe(403);
    const approved = await as(superAdmin, 'post', `/admin/write-offs/${pending[0].id}/approve`).send({
      note: 'Checked photos',
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ status: 'approved', decisionNote: 'Checked photos' });
    expect(await stockOf('Rose Toner', lahoreId)).toBe('4.000');
    const notExpired = await as(lahoreAdmin, 'post', '/branch/inventory/write-offs').send({
      items: [{ batchId: batches[0]!.id, qty: '1', reason: 'expired' }],
    });
    expect(notExpired.status).toBe(400);
    const list = await as(lahoreAdmin, 'post', '/branch/inventory/write-offs').send({
      items: [{ batchId: batches[0]!.id, qty: '1', reason: 'lost' }],
    });
    expect(list.status).toBe(201);
    const rejected = await as(superAdmin, 'post', `/admin/write-offs/${list.body.data[0].id}/reject`).send(
      {},
    );
    expect(rejected.body.data.status).toBe('rejected');
    expect(await stockOf('Rose Toner', lahoreId)).toBe('4.000');
    const tooMuch = await as(lahoreAdmin, 'post', '/branch/inventory/write-offs').send({
      items: [{ batchId: batches[0]!.id, qty: '5', reason: 'lost' }],
    });
    expect(tooMuch.status).toBe(422);
    const all = await as(lahoreAdmin, 'get', '/branch/inventory/write-offs?status=approved');
    expect(all.body.data).toEqual([
      expect.objectContaining({
        writeOffNo: 'LHR-WO-000001',
        reason: 'damaged',
        qty: '2.000',
        productName: 'Rose Toner',
        note: 'Broken in transit',
        createdBy: expect.objectContaining({ id: lahoreAdmin.id }),
      }),
    ]);
    const everywhere = await as(superAdmin, 'get', '/branch/inventory/write-offs?reason=damaged');
    expect(everywhere.body.data).toHaveLength(1);
    expect(list.body.data[0].writeOffNo).toBe('LHR-WO-000002');
  });

  it('puts Warehouse Keepers only at the Super Admin stock and Store Keepers only in the Dispatch Department', async () => {
    const person = (role: string, n: number) => ({
      firstName: 'Naseer',
      lastName: 'Ahmad',
      email: `keeper${n}@dsm.pk`,
      username: `keeper${n}`,
      password: 'Password123',
      role,
    });
    expect(
      (await as(superAdmin, 'post', '/branch/staff', lahoreId).send(person('warehouse_keeper', 1))).status,
    ).toBe(422);
    expect(
      (await as(superAdmin, 'post', '/branch/staff', lahoreId).send(person('store_keeper', 2))).status,
    ).toBe(422);
    expect(
      (await as(superAdmin, 'post', '/branch/staff', warehouseId).send(person('front_desk', 3))).status,
    ).toBe(409);
    const ok = await as(superAdmin, 'post', '/branch/staff', warehouseId).send(person('warehouse_keeper', 4));
    expect(ok.status).toBe(201);
  });

  it('takes Lab Officer stock in only after the Warehouse Keeper confirms it, short lines included', async () => {
    const lab = await createStaff(fake, { role: 'lab_officer', branchId: warehouseId });
    expect((await as(lab, 'get', '/branch/sales')).status).toBe(403);
    const before = Number(await stockOf('Rose Toner', warehouseId));
    const entry = await as(lab, 'post', '/branch/stock-ins').send({
      date: '2026-10-05',
      items: [{ unitCost: '100', productId: toner, qty: '10', batch: 'T-2', expiryDate: '2028-06-30' }],
    });
    expect(entry.status).toBe(201);
    const grn = entry.body.data[0].grnNo as string;
    expect(Number(await stockOf('Rose Toner', warehouseId))).toBe(before);
    expect((await as(keeper, 'get', '/branch/badges')).body.data.stockReceipts).toBe(1);
    expect((await as(lab, 'post', `/branch/stock-receipts/${grn}/confirm`).send({})).status).toBe(403);
    const short = await as(keeper, 'post', `/branch/stock-receipts/${grn}/confirm`).send({
      date: '2026-10-05',
      lines: [{ id: entry.body.data[0].id, receivedQty: '8', note: '2 broken' }],
    });
    expect(short.status).toBe(200);
    expect(short.body.data).toMatchObject({
      status: 'confirmed',
      enteredBy: { id: lab.id },
      lines: [expect.objectContaining({ qty: '10.000', receivedQty: '8.000', receiptNote: '2 broken' })],
    });
    expect(Number(await stockOf('Rose Toner', warehouseId))).toBe(before + 8);
    const out = await as(lab, 'post', '/branch/stock-outs').send({
      date: '2026-10-05',
      items: [{ productId: toner, qty: '1', destination: 'Karachi' }],
    });
    expect(out.status).toBe(403);
  });

  it('holds missing or damaged labelled pieces of a Lab Officer stock in for the Super Admin', async () => {
    const lab = await createStaff(fake, { role: 'lab_officer', branchId: warehouseId });
    const before = Number(await stockOf('Rose Toner', warehouseId));
    const entry = await as(lab, 'post', '/branch/stock-ins').send({
      date: '2026-10-06',
      items: [
        {
          unitCost: '100',
          productId: toner,
          qty: '4',
          batch: 'T-3',
          expiryDate: '2028-07-31',
          labels: 'generate',
        },
      ],
    });
    expect(entry.status).toBe(201);
    const grn = entry.body.data[0].grnNo as string;
    const pending = (await as(keeper, 'get', `/branch/stock-receipts?grnNo=${grn}`)).body.data[0];
    const serials = pending.lines[0].serials as string[];
    expect(serials).toHaveLength(4);
    expect(
      (
        await as(keeper, 'post', `/branch/stock-receipts/${grn}/confirm`).send({
          issues: [{ serial: 'DSM-999999', reason: 'missing' }],
        })
      ).status,
    ).toBe(422);
    const done = await as(keeper, 'post', `/branch/stock-receipts/${grn}/confirm`).send({
      date: '2026-10-06',
      issues: [
        { serial: serials[0], reason: 'missing', note: 'Not in the box' },
        { serial: serials[1], reason: 'damaged' },
      ],
    });
    expect(done.status).toBe(200);
    expect(done.body.data.lines[0]).toMatchObject({ receivedQty: '3.000' });
    expect(done.body.data.lines[0].issues.map((i: { reason: string }) => i.reason).sort()).toEqual([
      'damaged',
      'missing',
    ]);
    expect(Number(await stockOf('Rose Toner', warehouseId))).toBe(before + 4);
    const held = (await as(superAdmin, 'get', '/branch/stock-holds?status=open')).body.data.filter(
      (h: { transferNo: string }) => h.transferNo === grn,
    );
    expect(held.map((h: { serial: string }) => h.serial).sort()).toEqual([serials[0], serials[1]].sort());
    expect(held[0].canDecide).toBe(true);
  });

  it('moves stock from one branch to another after the Super Admin approves it', async () => {
    const isbAdmin = await createStaff(fake, { role: 'branch_admin', branchId: otherId });
    const sources = (await as(isbAdmin, 'get', '/branch/stock-requests/sources')).body.data as {
      id: string;
    }[];
    expect(sources.map((b) => b.id)).toContain(lahoreId);
    expect(sources.map((b) => b.id)).not.toContain(otherId);
    const catalog = await as(
      isbAdmin,
      'get',
      `/branch/stock-requests/catalog?search=serum&fromBranchId=${lahoreId}`,
    );
    expect(catalog.status).toBe(200);
    const lahoreSerum = catalog.body.data[0] as { id: string; available: string };
    expect(lahoreSerum.id).not.toBe(serum);
    const lahoreBefore = Number(await stockOf('Vitamin C Serum', lahoreId));
    expect(Number(lahoreSerum.available)).toBe(lahoreBefore);
    expect(
      (
        await as(isbAdmin, 'post', '/branch/stock-requests').send({
          fromBranchId: otherId,
          items: [{ productId: lahoreSerum.id, qty: '1' }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await as(isbAdmin, 'post', '/branch/stock-requests').send({
          fromBranchId: lahoreId,
          items: [{ productId: serum, qty: '1' }],
        })
      ).status,
    ).toBe(400);
    const asked = await as(isbAdmin, 'post', '/branch/stock-requests').send({
      fromBranchId: lahoreId,
      items: [{ productId: lahoreSerum.id, qty: '2' }],
    });
    expect(asked.status).toBe(201);
    expect(asked.body.data).toMatchObject({
      requestNo: 'ISB-SR-000001',
      status: 'pending',
      branch: { id: otherId },
      fromBranch: { id: lahoreId, code: 'LHR' },
    });
    const requestId = asked.body.data.id as string;
    const seen = (await as(lahoreAdmin, 'get', '/branch/stock-requests')).body.data as { id: string }[];
    expect(seen.map((r) => r.id)).toContain(requestId);
    expect((await as(lahoreAdmin, 'get', `/branch/stock-requests/${requestId}`)).status).toBe(200);
    const early = await as(lahoreAdmin, 'post', '/branch/stock-outs').send({
      date: '2026-10-10',
      toBranchId: otherId,
      stockRequestId: requestId,
      items: [{ productId: lahoreSerum.id, qty: '2' }],
    });
    expect(early.status).toBe(409);
    expect((await as(superAdmin, 'post', `/admin/stock-requests/${requestId}/approve`).send({})).status).toBe(
      200,
    );
    expect((await as(lahoreAdmin, 'get', '/branch/badges')).body.data.stockRequests).toBeGreaterThan(0);
    const byKeeper = await as(keeper, 'post', '/branch/stock-outs').send({
      date: '2026-10-10',
      toBranchId: otherId,
      stockRequestId: requestId,
      items: [{ productId: serum, qty: '2' }],
    });
    expect(byKeeper.status).toBe(403);
    const byDesk = await as(lahoreDesk, 'post', '/branch/stock-outs').send({
      date: '2026-10-10',
      toBranchId: otherId,
      stockRequestId: requestId,
      items: [{ productId: lahoreSerum.id, qty: '2' }],
    });
    expect(byDesk.status).toBe(403);
    const tooMany = await as(lahoreAdmin, 'post', '/branch/stock-outs').send({
      date: '2026-10-10',
      toBranchId: otherId,
      stockRequestId: requestId,
      items: [{ productId: lahoreSerum.id, qty: '3' }],
    });
    expect(tooMany.status).toBe(422);
    const sent = await as(lahoreAdmin, 'post', '/branch/stock-outs').send({
      date: '2026-10-10',
      toBranchId: otherId,
      stockRequestId: requestId,
      items: [{ productId: lahoreSerum.id, qty: '2' }],
    });
    expect(sent.status).toBe(201);
    const transferNo = sent.body.data[0].transferNo as string;
    expect(transferNo).toBe('LHR-TR-000001');
    expect(Number(await stockOf('Vitamin C Serum', lahoreId))).toBe(lahoreBefore - 2);
    const incoming = (await as(isbAdmin, 'get', '/branch/incoming-stock?status=waiting')).body.data;
    expect(incoming).toEqual([
      expect.objectContaining({
        transferNo,
        fromBranch: expect.objectContaining({ id: lahoreId }),
        request: { id: requestId, requestNo: 'ISB-SR-000001' },
      }),
    ]);
    expect(
      (await as(lahoreAdmin, 'post', `/branch/incoming-stock/${transferNo}/receive`).send({})).status,
    ).toBe(404);
    const got = await as(isbAdmin, 'post', `/branch/incoming-stock/${transferNo}/receive`).send({
      date: '2026-10-11',
    });
    expect(got.status).toBe(200);
    expect(await stockOf('Vitamin C Serum', otherId)).toBe('2.000');
    expect((await as(isbAdmin, 'get', `/branch/stock-requests/${requestId}`)).body.data.status).toBe(
      'received',
    );
    const fromWarehouse = await as(isbAdmin, 'get', '/branch/stock-requests/catalog?search=serum');
    expect(fromWarehouse.body.data).toEqual([expect.objectContaining({ id: serum })]);
  });
});
