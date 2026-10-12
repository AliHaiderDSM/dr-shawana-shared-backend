import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

describe('Branch stock requests, Super Admin approval and branch receipt', () => {
  let superAdmin: { id: string };
  let lahoreAdmin: { id: string };
  let lahoreDesk: { id: string };
  let warehouseId: string;
  let lahoreId: string;
  let otherId: string;
  let serum: string;
  let toner: string;

  const as = (who: { id: string }, method: 'get' | 'post', path: string, branchId?: string) =>
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
        { productId: serum, qty: '20', batch: 'S-1', expiryDate: '2028-01-31' },
        { productId: toner, qty: '50', batch: 'T-1', expiryDate: '2028-06-30' },
      ],
    });
    expect(stocked.status).toBe(201);
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
    const asked = await as(lahoreAdmin, 'post', '/branch/stock-requests').send({
      note: 'Weekend rush',
      items: [
        { productId: serum, qty: '5' },
        { productId: toner, qty: '10', note: 'Big bottles' },
      ],
    });
    expect(asked.status).toBe(201);
    expect(asked.body.data).toMatchObject({
      requestNo: 'LHR-SR-000001',
      status: 'pending',
      requestedBy: { id: lahoreAdmin.id, role: 'branch_admin' },
      branch: { id: lahoreId },
    });
    const requestId = asked.body.data.id as string;
    const tonerLine = (asked.body.data.items as { id: string; productName: string }[]).find(
      (i) => i.productName === 'Rose Toner',
    )!;

    const early = await as(superAdmin, 'post', '/branch/stock-outs', warehouseId).send({
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
    const approved = await as(superAdmin, 'post', `/admin/stock-requests/${requestId}/approve`).send({
      note: 'Only 6 toners this week',
      items: [{ id: tonerLine.id, approvedQty: '6' }],
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('approved');
    expect(approved.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productName: 'Rose Toner', qty: '10.000', approvedQty: '6.000' }),
        expect.objectContaining({ productName: 'Vitamin C Serum', approvedQty: '5.000' }),
      ]),
    );

    const wrongBranch = await as(superAdmin, 'post', '/branch/stock-outs', warehouseId).send({
      date: '2026-10-02',
      toBranchId: otherId,
      stockRequestId: requestId,
      items: [{ productId: serum, qty: '5' }],
    });
    expect(wrongBranch.status).toBe(400);
    const overApproved = await as(superAdmin, 'post', '/branch/stock-outs', warehouseId).send({
      date: '2026-10-02',
      toBranchId: lahoreId,
      stockRequestId: requestId,
      items: [{ productId: toner, qty: '7' }],
    });
    expect(overApproved.status).toBe(422);
    expect(overApproved.body.error.message).toContain('only 6');
    const sent = await as(superAdmin, 'post', '/branch/stock-outs', warehouseId).send({
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
    const list = await as(lahoreAdmin, 'post', '/branch/inventory/write-offs').send({
      items: [{ batchId: batches[0]!.id, qty: '1', reason: 'expired' }],
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
});
