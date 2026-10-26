import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

describe('Editing a GRN', () => {
  let superAdmin: { id: string };
  let lab: { id: string };
  let keeper: { id: string };
  let warehouseId: string;
  let toner: string;
  let serum: string;
  let cream: string;

  const as = (who: { id: string }, method: 'get' | 'post' | 'put', path: string, branchId?: string) =>
    request(app)
      [method](`/api/v1${path}${branchId ? `${path.includes('?') ? '&' : '?'}branchId=${branchId}` : ''}`)
      .set(bearer(who));

  const stockOf = async (name: string) => {
    const res = await as(superAdmin, 'get', '/branch/inventory/stock?pageSize=100', warehouseId);
    return Number(
      (res.body.data as { name: string; quantity: string }[]).find((r) => r.name === name)?.quantity ?? 0,
    );
  };

  const receipt = async (grnNo: string) =>
    (await as(lab, 'get', `/branch/stock-receipts?grnNo=${grnNo}`)).body.data[0] as {
      status: string;
      pendingEdit: { id: string } | null;
      lines: { id: string; productName: string; qty: string; batch: string | null; labels: number }[];
    };

  beforeAll(async () => {
    warehouseId = (await createBranch({ code: 'MAINWH', name: 'Main Warehouse', kind: 'warehouse' })).id;
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
    lab = await createStaff(fake, { role: 'lab_officer', branchId: warehouseId });
    keeper = await createStaff(fake, { role: 'warehouse_keeper', branchId: warehouseId });
    const categoryId = (
      await as(superAdmin, 'post', '/branch/categories', warehouseId).send({ name: 'Skin' })
    ).body.data.id;
    const product = async (name: string, trackSerials = false) =>
      (
        await as(superAdmin, 'post', '/branch/products', warehouseId).send({
          name,
          categoryId,
          salePrice: '1000',
          trackSerials,
        })
      ).body.data.id as string;
    toner = await product('Rose Toner');
    serum = await product('Vitamin C Serum', true);
    cream = await product('Night Cream');
  });

  it('lets the Lab Officer fix a GRN at once while it waits for the Warehouse Keeper', async () => {
    const entry = await as(lab, 'post', '/branch/stock-ins').send({
      date: '2026-10-05',
      items: [
        { unitCost: '100', productId: toner, qty: '17', batch: 'T-1', expiryDate: '2028-06-30' },
        {
          unitCost: '100',
          productId: serum,
          qty: '3',
          batch: 'S-1',
          expiryDate: '2028-06-30',
          labels: 'generate',
        },
      ],
    });
    expect(entry.status).toBe(201);
    const grn = entry.body.data[0].grnNo as string;
    const lines = (await receipt(grn)).lines;
    const tonerLine = lines.find((l) => l.productName === 'Rose Toner')!;
    const serumLine = lines.find((l) => l.productName === 'Vitamin C Serum')!;

    const edited = await as(lab, 'put', `/branch/stock-receipts/${grn}/lines`).send({
      update: [
        { id: tonerLine.id, qty: '18' },
        { id: serumLine.id, qty: '5' },
      ],
      add: [{ unitCost: '100', productId: cream, qty: '2', batch: 'C-1', expiryDate: '2028-06-30' }],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ applied: true, request: null });
    const after = await receipt(grn);
    expect(after.status).toBe('pending');
    expect(after.lines.map((l) => [l.productName, l.qty, l.labels])).toEqual([
      ['Night Cream', '2.000', 0],
      ['Rose Toner', '18.000', 0],
      ['Vitamin C Serum', '5.000', 5],
    ]);
    expect(await stockOf('Rose Toner')).toBe(0);

    await as(keeper, 'post', `/branch/stock-receipts/${grn}/confirm`)
      .send({ date: '2026-10-05' })
      .expect(200);
    expect(await stockOf('Rose Toner')).toBe(18);
    expect(await stockOf('Vitamin C Serum')).toBe(5);
  });

  it('sends a Lab Officer edit of a confirmed GRN to the Super Admin first', async () => {
    const [grn] = (await as(lab, 'get', '/branch/stock-receipts?status=confirmed')).body.data.map(
      (r: { grnNo: string }) => r.grnNo,
    ) as string[];
    const lines = (await receipt(grn!)).lines;
    const toneLine = lines.find((l) => l.productName === 'Rose Toner')!;
    const creamLine = lines.find((l) => l.productName === 'Night Cream')!;

    const asked = await as(lab, 'put', `/branch/stock-receipts/${grn}/lines`).send({
      note: 'One more toner came in the box',
      update: [{ id: toneLine.id, qty: '19' }],
      remove: [creamLine.id],
    });
    expect(asked.status).toBe(200);
    expect(asked.body.data).toMatchObject({
      applied: false,
      request: { grnNo: grn, status: 'pending', note: 'One more toner came in the box' },
    });
    expect(await stockOf('Rose Toner')).toBe(18);
    expect((await receipt(grn!)).pendingEdit).toMatchObject({ id: asked.body.data.request.id });
    expect(
      (
        await as(lab, 'put', `/branch/stock-receipts/${grn}/lines`).send({
          update: [{ id: toneLine.id, qty: '20' }],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await as(lab, 'put', `/branch/stock-receipts/${grn}/lines`).send({
          remove: ['00000000-0000-4000-8000-000000000000'],
        })
      ).status,
    ).toBe(409);

    const id = asked.body.data.request.id as string;
    expect((await as(lab, 'post', `/admin/stock-receipts/edit-requests/${id}/approve`).send({})).status).toBe(
      403,
    );
    const list = await as(superAdmin, 'get', '/branch/stock-receipts/edit-requests?status=pending');
    expect(list.body.data).toEqual([
      expect.objectContaining({ id, grnNo: grn, requestedBy: expect.objectContaining({ id: lab.id }) }),
    ]);
    const approved = await as(superAdmin, 'post', `/admin/stock-receipts/edit-requests/${id}/approve`).send(
      {},
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ status: 'approved', decidedBy: { id: superAdmin.id } });
    expect(await stockOf('Rose Toner')).toBe(19);
    expect(await stockOf('Night Cream')).toBe(0);
    const after = await receipt(grn!);
    expect(after.status).toBe('confirmed');
    expect(after.pendingEdit).toBeNull();
    expect(after.lines.map((l) => l.productName)).toEqual(['Rose Toner', 'Vitamin C Serum']);
  });

  it('leaves the GRN as it was when the Super Admin rejects the edit', async () => {
    const [grn] = (await as(lab, 'get', '/branch/stock-receipts?status=confirmed')).body.data.map(
      (r: { grnNo: string }) => r.grnNo,
    ) as string[];
    const line = (await receipt(grn!)).lines.find((l) => l.productName === 'Rose Toner')!;
    const asked = await as(lab, 'put', `/branch/stock-receipts/${grn}/lines`).send({
      update: [{ id: line.id, batch: 'T-9' }],
      add: [],
      remove: [],
    });
    const id = asked.body.data.request.id as string;
    const rejected = await as(superAdmin, 'post', `/admin/stock-receipts/edit-requests/${id}/reject`).send({
      note: 'Batch is right',
    });
    expect(rejected.body.data).toMatchObject({ status: 'rejected', decisionNote: 'Batch is right' });
    expect((await receipt(grn!)).lines.find((l) => l.productName === 'Rose Toner')).toMatchObject({
      batch: 'T-1',
    });
    expect(await stockOf('Rose Toner')).toBe(19);
    expect(
      (await as(superAdmin, 'post', `/admin/stock-receipts/edit-requests/${id}/approve`).send({})).status,
    ).toBe(409);
  });

  it('deletes a whole confirmed entry only after the Super Admin approves', async () => {
    const entry = await as(lab, 'post', '/branch/stock-ins').send({
      date: '2026-10-06',
      items: [{ unitCost: '100', productId: cream, qty: '4', batch: 'C-2', expiryDate: '2028-06-30' }],
    });
    const grn = entry.body.data[0].grnNo as string;
    await as(keeper, 'post', `/branch/stock-receipts/${grn}/confirm`)
      .send({ date: '2026-10-06' })
      .expect(200);
    const before = await stockOf('Night Cream');
    const asked = await as(lab, 'put', `/branch/stock-receipts/${grn}/lines`).send({
      update: [],
      add: [],
      remove: [entry.body.data[0].id],
    });
    expect(asked.body.data).toMatchObject({ applied: false });
    expect(await stockOf('Night Cream')).toBe(before);
    await as(superAdmin, 'post', `/admin/stock-receipts/edit-requests/${asked.body.data.request.id}/approve`)
      .send({})
      .expect(200);
    expect(await stockOf('Night Cream')).toBe(before - 4);
    expect((await as(lab, 'get', `/branch/stock-receipts?grnNo=${grn}`)).body.data).toEqual([]);
  });

  it('lets the Super Admin edit a confirmed GRN directly and keeps others out', async () => {
    const [grn] = (await as(lab, 'get', '/branch/stock-receipts?status=confirmed')).body.data.map(
      (r: { grnNo: string }) => r.grnNo,
    ) as string[];
    const line = (await receipt(grn!)).lines.find((l) => l.productName === 'Rose Toner')!;
    const direct = await as(superAdmin, 'put', `/branch/stock-receipts/${grn}/lines`, warehouseId).send({
      update: [{ id: line.id, qty: '15' }],
    });
    expect(direct.body.data).toMatchObject({ applied: true });
    expect(await stockOf('Rose Toner')).toBe(15);
    expect(
      (
        await as(keeper, 'put', `/branch/stock-receipts/${grn}/lines`).send({
          update: [{ id: line.id, qty: '9' }],
        })
      ).status,
    ).toBe(403);
  });
});
