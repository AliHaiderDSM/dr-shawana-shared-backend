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

  beforeAll(async () => {
    lahoreId = (await createBranch({ code: 'LHR' })).id;
    const islamabad = await createBranch({ code: 'ISB' });
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahoreId });
    otherAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
    pharmacy = await createStaff(fake, { role: 'pharmacy', branchId: lahoreId });
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
  });

  describe('categories', () => {
    it('rejects a duplicate name (case-insensitive) within a branch only', async () => {
      const url = '/api/v1/branch/categories';
      expect((await request(app).post(url).set(bearer(admin)).send({ name: 'Supplements' })).status).toBe(
        201,
      );
      const dup = await request(app).post(url).set(bearer(admin)).send({ name: 'SUPPLEMENTS' });
      expect(dup.status).toBe(409);
      expect(
        (await request(app).post(url).set(bearer(otherAdmin)).send({ name: 'Supplements' })).status,
      ).toBe(201);
    });

    it('blocks deleting a category that products use', async () => {
      const category = (
        await request(app).post('/api/v1/branch/categories').set(bearer(admin)).send({ name: 'Creams' })
      ).body.data;
      await request(app)
        .post('/api/v1/branch/products')
        .set(bearer(admin))
        .send({ name: 'Night Cream', categoryId: category.id });
      const res = await request(app).delete(`/api/v1/branch/categories/${category.id}`).set(bearer(admin));
      expect(res.status).toBe(409);
    });

    it('is read-only for front desk and hidden from other branches', async () => {
      expect(
        (await request(app).post('/api/v1/branch/categories').set(bearer(frontDesk)).send({ name: 'X' }))
          .status,
      ).toBe(403);
      const lahore = await request(app).get('/api/v1/branch/categories/options').set(bearer(admin));
      const islamabad = await request(app).get('/api/v1/branch/categories/options').set(bearer(otherAdmin));
      const lahoreIds = new Set(lahore.body.data.map((c: { id: string }) => c.id));
      expect(islamabad.body.data.some((c: { id: string }) => lahoreIds.has(c.id))).toBe(false);
    });

    it('lets super admin work on a chosen branch', async () => {
      const res = await request(app)
        .post(`/api/v1/branch/categories?branchId=${lahoreId}`)
        .set(bearer(superAdmin))
        .send({ name: 'Super category' });
      expect(res.status).toBe(201);
      expect(res.body.data.branchId).toBe(lahoreId);
    });
  });

  describe('suppliers', () => {
    it('separates suppliers and dispatchers', async () => {
      const url = '/api/v1/branch/suppliers';
      await request(app)
        .post(url)
        .set(bearer(admin))
        .send({ name: 'Supplier A', phone: '923001111111', type: 'supplier' });
      await request(app)
        .post(url)
        .set(bearer(admin))
        .send({ name: 'TCS Courier', phone: '923002222222', type: 'dispatcher' });
      const dispatchers = await request(app).get(`${url}/options?type=dispatcher`).set(bearer(admin));
      expect(dispatchers.body.data.map((d: { name: string }) => d.name)).toEqual(['TCS Courier']);
      const invalid = await request(app)
        .post(url)
        .set(bearer(admin))
        .send({ name: 'X', phone: '1', type: 'vendor' });
      expect(invalid.status).toBe(400);
    });

    it('is readable by pharmacy but not writable', async () => {
      expect((await request(app).get('/api/v1/branch/suppliers').set(bearer(pharmacy))).status).toBe(200);
      expect(
        (
          await request(app)
            .post('/api/v1/branch/suppliers')
            .set(bearer(pharmacy))
            .send({ name: 'X', phone: '923003333333', type: 'supplier' })
        ).status,
      ).toBe(403);
    });
  });

  describe('bundles', () => {
    it('stores items as rows and computes the total on the server', async () => {
      const category = (
        await request(app).post('/api/v1/branch/categories').set(bearer(admin)).send({ name: 'Kits' })
      ).body.data;
      const make = async (name: string) =>
        (
          await request(app)
            .post('/api/v1/branch/products')
            .set(bearer(admin))
            .send({ name, categoryId: category.id })
        ).body.data.id as string;
      const shampoo = await make('Shampoo');
      const conditioner = await make('Conditioner');

      const created = await request(app)
        .post('/api/v1/branch/bundles')
        .set(bearer(admin))
        .send({
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

      const updated = await request(app)
        .patch(`/api/v1/branch/bundles/${created.body.data.id}`)
        .set(bearer(admin))
        .send({ items: [{ productId: shampoo, price: '450' }] });
      expect(updated.body.data).toMatchObject({ totalPrice: '450.00' });
      expect(updated.body.data.items).toHaveLength(1);

      const dup = await request(app)
        .post('/api/v1/branch/bundles')
        .set(bearer(admin))
        .send({
          name: 'Dup',
          items: [
            { productId: shampoo, price: '1' },
            { productId: shampoo, price: '2' },
          ],
        });
      expect(dup.status).toBe(400);

      const foreign = await request(app)
        .post('/api/v1/branch/bundles')
        .set(bearer(otherAdmin))
        .send({ name: 'Stolen', items: [{ productId: shampoo, price: '1' }] });
      expect(foreign.status).toBe(400);

      expect((await request(app).get('/api/v1/branch/bundles').set(bearer(frontDesk))).status).toBe(200);
    });
  });

  describe('banks and account sheets', () => {
    it('requires a bank for bank accounts and blocks deleting a used bank', async () => {
      const bank = (
        await request(app).post('/api/v1/branch/banks').set(bearer(admin)).send({ name: 'Meezan Bank' })
      ).body.data;
      const noBank = await request(app)
        .post('/api/v1/branch/account-sheets')
        .set(bearer(admin))
        .send({ accountName: 'Clinic Meezan', accountCode: '0101', type: 'bank' });
      expect(noBank.status).toBe(400);

      const sheet = await request(app).post('/api/v1/branch/account-sheets').set(bearer(admin)).send({
        accountName: 'Clinic Meezan',
        accountCode: '0101',
        type: 'bank',
        bankId: bank.id,
        openingBalance: '5000',
      });
      expect(sheet.status).toBe(201);
      expect(sheet.body.data).toMatchObject({ openingBalance: '5000.00', bank: { name: 'Meezan Bank' } });

      const cash = await request(app)
        .post('/api/v1/branch/account-sheets')
        .set(bearer(admin))
        .send({ accountName: 'Cash in hand', accountCode: 'CASH', type: 'cash' });
      expect(cash.body.data).toMatchObject({ bankId: null, openingBalance: '0.00' });

      expect((await request(app).delete(`/api/v1/branch/banks/${bank.id}`).set(bearer(admin))).status).toBe(
        409,
      );

      const options = await request(app).get('/api/v1/branch/account-sheets/options').set(bearer(admin));
      expect(options.body.data.map((o: { bankName: string | null }) => o.bankName)).toEqual([
        null,
        'Meezan Bank',
      ]);
    });

    it('does not let another branch use this branch bank', async () => {
      const bank = (await request(app).post('/api/v1/branch/banks').set(bearer(admin)).send({ name: 'HBL' }))
        .body.data;
      const res = await request(app)
        .post('/api/v1/branch/account-sheets')
        .set(bearer(otherAdmin))
        .send({ accountName: 'X', accountCode: '1', type: 'bank', bankId: bank.id });
      expect(res.status).toBe(404);
    });
  });
});
