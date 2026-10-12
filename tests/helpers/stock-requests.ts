import { type Express } from 'express';
import request from 'supertest';
import { bearer } from './fixtures';

export async function approvedRequest(
  app: Express,
  superAdmin: { id: string },
  toBranchId: string,
  items: { productId: string; qty: string }[],
) {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(item.productId, (totals.get(item.productId) ?? 0) + Number(item.qty));
  const asked = await request(app)
    .post(`/api/v1/branch/stock-requests?branchId=${toBranchId}`)
    .set(bearer(superAdmin))
    .send({ items: [...totals].map(([productId, qty]) => ({ productId, qty: String(qty) })) });
  if (asked.status !== 201) throw new Error(`Stock request failed: ${JSON.stringify(asked.body)}`);
  const approved = await request(app)
    .post(`/api/v1/admin/stock-requests/${asked.body.data.id}/approve`)
    .set(bearer(superAdmin))
    .send({});
  if (approved.status !== 200) throw new Error(`Approval failed: ${JSON.stringify(approved.body)}`);
  return asked.body.data.id as string;
}
