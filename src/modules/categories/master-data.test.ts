import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

describe('master data', () => {
  let admin: { id: string };
  let otherAdmin: { id: string };
  let frontDesk: { id: string };
  let pharmacy: { id: string };
  let superAdmin: { id: string };
  let lahoreId: string;
  let islamabadId: string;

  beforeAll(async () => {
    lahoreId = (await createBranch({ code: 'LHR' })).id;
    const islamabad = await createBranch({ code: 'ISB' });
    islamabadId = islamabad.id;
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahoreId });
    otherAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
    pharmacy = await createStaff(fake, { role: 'pharmacy', branchId: lahoreId });
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
  });

  const asOwner = (method: 'get' | 'post' | 'patch' | 'delete', path: string, branchId = lahoreId) =>
    request(app)
      [method](`/api/v1${path}${path.includes('?') ? '&' : '?'}branchId=${branchId}`)
      .set(bearer(superAdmin));

  describe('categories', () => {
    it('rejects a duplicate name (case-insensitive) within a branch only', async () => {
      expect((await asOwner('post', '/branch/categories').send({ name: 'Supplements' })).status).toBe(201);
      const dup = await asOwner('post', '/branch/categories').send({ name: 'SUPPLEMENTS' });
      expect(dup.status).toBe(409);
      expect(
        (await asOwner('post', '/branch/categories', islamabadId).send({ name: 'Supplements' })).status,
      ).toBe(201);
    });

    it('blocks deleting a category that products use', async () => {
      const category = (await asOwner('post', '/branch/categories').send({ name: 'Creams' })).body.data;
      await asOwner('post', '/branch/products').send({ name: 'Night Cream', categoryId: category.id });
      const res = await asOwner('delete', `/branch/categories/${category.id}`);
      expect(res.status).toBe(409);
    });

    it('is managed by the Super Admin only; branches can read their own', async () => {
      for (const who of [admin, frontDesk]) {
        expect(
          (await request(app).post('/api/v1/branch/categories').set(bearer(who)).send({ name: 'X' })).status,
        ).toBe(403);
      }
      const lahore = await request(app).get('/api/v1/branch/categories/options').set(bearer(admin));
      expect(lahore.status).toBe(200);
      const islamabad = await request(app).get('/api/v1/branch/categories/options').set(bearer(otherAdmin));
      const lahoreIds = new Set(lahore.body.data.map((c: { id: string }) => c.id));
      expect(islamabad.body.data.some((c: { id: string }) => lahoreIds.has(c.id))).toBe(false);
    });

    it('lets super admin work on a chosen branch', async () => {
      const res = await asOwner('post', '/branch/categories').send({ name: 'Super category' });
      expect(res.status).toBe(201);
      expect(res.body.data.branchId).toBe(lahoreId);
    });
  });

  describe('suppliers', () => {
    it('separates suppliers and dispatchers', async () => {
      await asOwner('post', '/branch/suppliers').send({
        name: 'Supplier A',
        phone: '923001111111',
        type: 'supplier',
      });
      await asOwner('post', '/branch/suppliers').send({
        name: 'TCS Courier',
        phone: '923002222222',
        type: 'dispatcher',
      });
      const dispatchers = await request(app)
        .get('/api/v1/branch/suppliers/options?type=dispatcher')
        .set(bearer(admin));
      expect(dispatchers.body.data.map((d: { name: string }) => d.name)).toEqual(['TCS Courier']);
      const invalid = await asOwner('post', '/branch/suppliers').send({
        name: 'X',
        phone: '1',
        type: 'vendor',
      });
      expect(invalid.status).toBe(400);
    });

    it('is readable by pharmacy and branch admin but not writable', async () => {
      for (const who of [pharmacy, admin]) {
        expect((await request(app).get('/api/v1/branch/suppliers').set(bearer(who))).status).toBe(200);
        expect(
          (
            await request(app)
              .post('/api/v1/branch/suppliers')
              .set(bearer(who))
              .send({ name: 'X', phone: '923003333333', type: 'supplier' })
          ).status,
        ).toBe(403);
      }
    });
  });

  describe('bundles', () => {
    it('stores items as rows and computes the total on the server', async () => {
      const category = (await asOwner('post', '/branch/categories').send({ name: 'Kits' })).body.data;
      const make = async (name: string) =>
        (await asOwner('post', '/branch/products').send({ name, categoryId: category.id })).body.data
          .id as string;
      const shampoo = await make('Shampoo');
      const conditioner = await make('Conditioner');

      const created = await asOwner('post', '/branch/bundles').send({
        name: 'Hair Kit',
        items: [
          { productId: shampoo, price: '500' },
          { productId: conditioner, price: '300.25', qty: '2' },
        ],
      });
      expect(created.status).toBe(201);
      expect(created.body.data.totalPrice).toBe('1100.50');
      expect(created.body.data.items.map((i: { productName: string }) => i.productName)).toEqual([
        'Shampoo',
        'Conditioner',
      ]);

      const updated = await asOwner('patch', `/branch/bundles/${created.body.data.id}`).send({
        items: [{ productId: shampoo, price: '450' }],
      });
      expect(updated.body.data).toMatchObject({ totalPrice: '450.00' });
      expect(updated.body.data.items).toHaveLength(1);

      const dup = await asOwner('post', '/branch/bundles').send({
        name: 'Dup',
        items: [
          { productId: shampoo, price: '1' },
          { productId: shampoo, price: '2' },
        ],
      });
      expect(dup.status).toBe(400);

      const foreign = await asOwner('post', '/branch/bundles', islamabadId).send({
        name: 'Stolen',
        items: [{ productId: shampoo, price: '1' }],
      });
      expect(foreign.status).toBe(400);

      const byAdmin = await request(app)
        .post('/api/v1/branch/bundles')
        .set(bearer(admin))
        .send({ name: 'Mine', items: [{ productId: shampoo, price: '1' }] });
      expect(byAdmin.status).toBe(403);

      expect((await request(app).get('/api/v1/branch/bundles').set(bearer(frontDesk))).status).toBe(200);
    });
  });

  describe('account sheets', () => {
    it('needs a bank name for bank accounts and adds a new bank on the way', async () => {
      const noBank = await request(app)
        .post('/api/v1/branch/account-sheets')
        .set(bearer(admin))
        .send({ accountName: 'Clinic Meezan', accountCode: '0101', type: 'bank' });
      expect(noBank.status).toBe(400);

      const sheet = await request(app).post('/api/v1/branch/account-sheets').set(bearer(admin)).send({
        accountName: 'Clinic Meezan',
        accountCode: '0101',
        type: 'bank',
        bankName: 'Meezan Bank',
      });
      expect(sheet.status).toBe(201);
      expect(sheet.body.data).toMatchObject({ bank: { name: 'Meezan Bank' } });

      const second = await request(app).post('/api/v1/branch/account-sheets').set(bearer(admin)).send({
        accountName: 'Clinic Meezan 2',
        accountCode: '0102',
        type: 'bank',
        bankName: 'meezan bank',
      });
      expect(second.body.data.bankId).toBe(sheet.body.data.bankId);

      const cash = await request(app)
        .post('/api/v1/branch/account-sheets')
        .set(bearer(admin))
        .send({ accountName: 'Cash in hand', accountCode: 'CASH', type: 'cash' });
      expect(cash.body.data).toMatchObject({ bankId: null });

      const moved = await request(app)
        .patch(`/api/v1/branch/account-sheets/${second.body.data.id}`)
        .set(bearer(admin))
        .send({ bankName: 'HBL' });
      expect(moved.status).toBe(200);
      expect(moved.body.data).toMatchObject({ type: 'bank', bank: { name: 'HBL' } });
      const toCash = await request(app)
        .patch(`/api/v1/branch/account-sheets/${second.body.data.id}`)
        .set(bearer(admin))
        .send({ type: 'cash' });
      expect(toCash.body.data).toMatchObject({ type: 'cash', bankId: null, bank: null });

      expect((await request(app).get('/api/v1/branch/banks').set(bearer(admin))).status).toBe(404);

      const options = await request(app).get('/api/v1/branch/account-sheets/options').set(bearer(admin));
      expect(options.body.data.map((o: { bankName: string | null }) => o.bankName)).toEqual([
        null,
        null,
        'Meezan Bank',
      ]);

      const deskOptions = await request(app)
        .get('/api/v1/branch/account-sheets/options')
        .set(bearer(frontDesk));
      expect(deskOptions.status).toBe(200);
      expect(deskOptions.body.data).toHaveLength(3);
      expect((await request(app).get('/api/v1/branch/account-sheets').set(bearer(frontDesk))).status).toBe(
        403,
      );
    });

    it('keeps banks per branch', async () => {
      const mine = await request(app)
        .post('/api/v1/branch/account-sheets')
        .set(bearer(admin))
        .send({ accountName: 'A', accountCode: '1', type: 'bank', bankName: 'Alfalah' });
      const theirs = await request(app)
        .post('/api/v1/branch/account-sheets')
        .set(bearer(otherAdmin))
        .send({ accountName: 'B', accountCode: '1', type: 'bank', bankName: 'Alfalah' });
      expect(theirs.status).toBe(201);
      expect(theirs.body.data.bankId).not.toBe(mine.body.data.bankId);
    });
  });
});
