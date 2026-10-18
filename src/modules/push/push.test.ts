import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { env } from '../../config/env';
import { AppDataSource } from '../../database/data-source';
import { staffPush, ExpiredSubscriptionError, type PushMessage, type PushTarget } from './push.service';

const fake = installFakeSupabase();
const app = createApp();

describe('staff web push', () => {
  let owner: { id: string };
  let frontDesk: { id: string };
  let lahoreId: string;
  let serum: string;

  const api = (method: 'get' | 'post', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));
  const subscription = (endpoint: string) => ({
    endpoint,
    keys: { p256dh: 'BPublicKeyOfTheBrowser', auth: 'AuthSecret' },
  });

  const keys = { publicKey: env.WEB_PUSH_PUBLIC_KEY, privateKey: env.WEB_PUSH_PRIVATE_KEY };

  afterAll(() => {
    env.WEB_PUSH_PUBLIC_KEY = keys.publicKey;
    env.WEB_PUSH_PRIVATE_KEY = keys.privateKey;
  });

  beforeAll(async () => {
    env.WEB_PUSH_PUBLIC_KEY = undefined;
    env.WEB_PUSH_PRIVATE_KEY = undefined;
    lahoreId = (await createBranch({ code: 'LHR', city: 'Lahore' })).id;
    owner = await createStaff(fake, { role: 'super_admin', branchId: null });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
    const categoryId = (
      await api('post', `/branch/categories?branchId=${lahoreId}`, owner).send({ name: 'Skin' })
    ).body.data.id;
    serum = (
      await api('post', `/branch/products?branchId=${lahoreId}`, owner).send({
        name: 'Serum',
        categoryId,
        initialPurchase: { date: '2026-09-01', quantity: '10', unitPrice: '1000' },
      })
    ).body.data.id;
  });

  it('returns no public key when web push is not configured', async () => {
    const res = await api('get', '/branch/push/public-key', frontDesk);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('saves a browser and pushes only the badges that went up for that person', async () => {
    expect(
      (
        await api('post', '/branch/push/subscriptions', owner).send(
          subscription('https://push.example/owner'),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await api('post', '/branch/push/subscriptions', frontDesk).send(
          subscription('https://push.example/desk'),
        )
      ).status,
    ).toBe(204);
    expect((await api('post', '/branch/push/subscriptions', owner).send({ endpoint: 'nope' })).status).toBe(
      400,
    );

    const sent: { target: PushTarget; message: PushMessage }[] = [];
    const sender = async (target: PushTarget, message: PushMessage) => {
      sent.push({ target, message });
    };

    await staffPush.notifyChanges(sender);
    expect(sent).toEqual([]);

    const asked = await api('post', '/branch/discount-requests', frontDesk).send({
      productId: serum,
      qty: '1',
      discountPercent: '10',
    });
    expect(asked.status).toBe(201);
    await staffPush.notifyChanges(sender);

    const toOwner = sent.filter((s) => s.target.endpoint === 'https://push.example/owner');
    expect(toOwner).toEqual([
      expect.objectContaining({
        message: {
          title: 'DSM Clinic',
          body: 'Discount requests: 1 waiting',
          url: '/discount-requests',
          tag: 'discountRequests',
        },
      }),
    ]);
    expect(sent.filter((s) => s.target.endpoint === 'https://push.example/desk')).toEqual([
      expect.objectContaining({ message: expect.objectContaining({ tag: 'discountRequests' }) }),
    ]);

    sent.length = 0;
    await staffPush.notifyChanges(sender);
    expect(sent).toEqual([]);
  });

  it('forgets an expired browser and lets the owner unsubscribe', async () => {
    await api('post', '/branch/discount-requests', frontDesk).send({
      productId: serum,
      qty: '1',
      discountPercent: '5',
    });
    await staffPush.notifyChanges(async (target) => {
      if (target.endpoint === 'https://push.example/desk') throw new ExpiredSubscriptionError();
    });
    const left = (await AppDataSource.query(
      `SELECT endpoint FROM staff_push_subscriptions ORDER BY endpoint`,
    )) as {
      endpoint: string;
    }[];
    expect(left.map((r) => r.endpoint)).toEqual(['https://push.example/owner']);

    expect(
      (await api('post', '/branch/push/unsubscribe', owner).send({ endpoint: 'https://push.example/owner' }))
        .status,
    ).toBe(204);
    expect(await AppDataSource.query(`SELECT 1 FROM staff_push_subscriptions`)).toEqual([]);
  });
});
