import { type EntityManager } from 'typeorm';
import { AppDataSource } from '../../database/data-source';
import { repo, withTransaction } from '../../database/transaction';
import { Decimal, toMoney, toQuantity } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { auditService } from '../audit/audit.service';
import { Bundle } from '../bundles/bundle.entity';
import { Product } from '../products/product.entity';
import { dispatchDepartment } from '../sales/fulfilment';
import { DiscountRequest } from './discount-request.entity';
import { type CreateDiscountRequestInput, type DiscountRequestListQuery } from './discount-requests.schemas';

interface Row {
  id: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  requesterId: string | null;
  requesterName: string | null;
  requesterRole: string | null;
  productId: string | null;
  bundleId: string | null;
  itemName: string;
  qty: string;
  unitPrice: string;
  discountPercent: string;
  note: string | null;
  status: DiscountRequest['status'];
  deciderId: string | null;
  deciderName: string | null;
  deciderRole: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  saleId: string | null;
  invoiceNo: string | null;
  createdAt: Date;
}

const SELECT = `
  SELECT r.id, r.branch_id AS "branchId", b.name AS "branchName", b.code AS "branchCode",
         r.created_by AS "requesterId", NULLIF(TRIM(CONCAT(rq.first_name, ' ', rq.last_name)), '') AS "requesterName",
         rq.role::text AS "requesterRole",
         r.product_id AS "productId", r.bundle_id AS "bundleId", COALESCE(p.name, bu.name, 'Item') AS "itemName",
         r.qty::text AS qty, r.unit_price::text AS "unitPrice", r.discount_percent::text AS "discountPercent",
         r.note, r.status, r.decided_by AS "deciderId",
         NULLIF(TRIM(CONCAT(dc.first_name, ' ', dc.last_name)), '') AS "deciderName", dc.role::text AS "deciderRole",
         r.decided_at AS "decidedAt", r.decision_note AS "decisionNote", r.sale_id AS "saleId",
         s.invoice_no AS "invoiceNo", r.created_at AS "createdAt"
    FROM discount_requests r
    JOIN branches b ON b.id = r.branch_id
    LEFT JOIN staff_profiles rq ON rq.id = r.created_by
    LEFT JOIN staff_profiles dc ON dc.id = r.decided_by
    LEFT JOIN products p ON p.id = r.product_id
    LEFT JOIN bundles bu ON bu.id = r.bundle_id
    LEFT JOIN sales s ON s.id = r.sale_id
   WHERE r.deleted_at IS NULL`;

function toDto(r: Row) {
  const gross = new Decimal(r.qty).times(r.unitPrice);
  return {
    id: r.id,
    branch: { id: r.branchId, name: r.branchName, code: r.branchCode },
    requestedBy: r.requesterId
      ? { id: r.requesterId, name: r.requesterName ?? 'Staff', role: r.requesterRole ?? '' }
      : null,
    productId: r.productId,
    bundleId: r.bundleId,
    itemName: r.itemName,
    qty: toQuantity(r.qty),
    unitPrice: toMoney(r.unitPrice),
    discountPercent: new Decimal(r.discountPercent).toFixed(2),
    discountAmount: toMoney(gross.times(r.discountPercent).div(100)),
    note: r.note,
    status: r.status,
    decidedBy: r.deciderId
      ? { id: r.deciderId, name: r.deciderName ?? 'Super Admin', role: r.deciderRole ?? '' }
      : null,
    decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
    decisionNote: r.decisionNote,
    saleId: r.saleId,
    invoiceNo: r.invoiceNo,
    createdAt: new Date(r.createdAt).toISOString(),
  };
}

async function findOne(id: string, manager?: EntityManager) {
  const [row] = (await (manager ?? AppDataSource.manager).query(`${SELECT} AND r.id = $1`, [id])) as Row[];
  if (!row) throw AppError.notFound('Discount request');
  return toDto(row);
}

async function lockRequest(manager: EntityManager, id: string) {
  const request = await repo(DiscountRequest, manager)
    .createQueryBuilder('r')
    .setLock('pessimistic_write')
    .where('r.id = :id', { id })
    .getOne();
  if (!request) throw AppError.notFound('Discount request');
  return request;
}

async function record(
  manager: EntityManager,
  actor: Actor,
  request: DiscountRequest,
  action: string,
  before: object | null,
) {
  await auditService.record(
    {
      actor,
      branchId: request.branchId,
      action,
      entity: 'discount_request',
      entityId: request.id,
      before,
      after: { status: request.status, discountPercent: request.discountPercent, qty: request.qty },
    },
    manager,
  );
}

export interface DiscountedLine {
  productId?: string;
  bundleId?: string;
  qty: string;
  discountPercent?: string;
  discountRequestId?: string;
}

export const discountRequestsService = {
  async list(branchId: string | null, query: DiscountRequestListQuery) {
    const params: unknown[] = [];
    let where = '';
    if (branchId) {
      params.push(branchId);
      where += ` AND r.branch_id = $${params.length}`;
    }
    if (query.status) {
      params.push(query.status);
      where += ` AND r.status = $${params.length}`;
    }
    if (query.ids?.length) {
      params.push(query.ids);
      where += ` AND r.id = ANY($${params.length}::uuid[])`;
    }
    const rows = (await AppDataSource.query(
      `${SELECT}${where} ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 300`,
      params,
    )) as Row[];
    return rows.map(toDto);
  },

  async pendingCount() {
    const [row] = (await AppDataSource.query(
      `SELECT COUNT(*)::int AS count FROM discount_requests WHERE status = 'pending' AND deleted_at IS NULL`,
    )) as { count: number }[];
    return { pending: row?.count ?? 0 };
  },

  async create(actor: Actor, branchId: string, input: CreateDiscountRequestInput) {
    return withTransaction(async (em) => {
      let unitPrice: Decimal;
      if (input.productId) {
        const department = await dispatchDepartment(em);
        const product = await repo(Product, em).findOne({
          where: [
            { id: input.productId, branchId },
            ...(department ? [{ id: input.productId, branchId: department.id }] : []),
          ],
        });
        if (!product) throw AppError.badRequest('The product was not found');
        unitPrice = toMoney(product.salePrice);
      } else {
        const bundle = await repo(Bundle, em).findOneBy({ id: input.bundleId as string, branchId });
        if (!bundle) throw AppError.badRequest('The bundle was not found in this branch');
        unitPrice = toMoney(bundle.totalPrice);
      }
      const requests = repo(DiscountRequest, em);
      const saved = await requests.save(
        requests.create({
          branchId,
          productId: input.productId ?? null,
          bundleId: input.bundleId ?? null,
          qty: toQuantity(input.qty),
          unitPrice,
          discountPercent: new Decimal(input.discountPercent).toFixed(2),
          note: input.note ?? null,
          status: 'pending',
          createdBy: actor.userId,
          updatedBy: actor.userId,
        }),
      );
      await record(em, actor, saved, 'create', null);
      return findOne(saved.id, em);
    });
  },

  async cancel(actor: Actor, branchId: string, id: string) {
    return withTransaction(async (em) => {
      const request = await lockRequest(em, id);
      if (request.branchId !== branchId) throw AppError.notFound('Discount request');
      if (!['pending', 'approved'].includes(request.status)) {
        throw AppError.conflict(`This request is already ${request.status}`);
      }
      const before = { status: request.status };
      request.status = 'cancelled';
      request.updatedBy = actor.userId;
      await repo(DiscountRequest, em).save(request);
      await record(em, actor, request, 'cancel', before);
      return findOne(id, em);
    });
  },

  async decide(actor: Actor, id: string, approve: boolean, note: string | null | undefined) {
    return withTransaction(async (em) => {
      const request = await lockRequest(em, id);
      if (request.status !== 'pending') throw AppError.conflict(`This request is already ${request.status}`);
      const before = { status: request.status };
      Object.assign(request, {
        status: approve ? 'approved' : 'rejected',
        decidedBy: actor.userId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
        updatedBy: actor.userId,
      });
      await repo(DiscountRequest, em).save(request);
      await record(em, actor, request, approve ? 'approve' : 'reject', before);
      return findOne(id, em);
    });
  },

  async consume(
    manager: EntityManager,
    actor: Actor,
    branchId: string,
    saleId: string,
    inputs: DiscountedLine[],
  ) {
    const used = new Set<string>();
    const earlier = await repo(DiscountRequest, manager).findBy({ saleId, status: 'used' });
    for (const [index, input] of inputs.entries()) {
      const percent = new Decimal(input.discountPercent ?? 0);
      if (percent.lte(0) || actor.isSuperAdmin) continue;
      const label = `Item ${index + 1}`;
      const requestId =
        input.discountRequestId ??
        earlier.find(
          (r) =>
            !used.has(r.id) &&
            (r.productId ?? undefined) === input.productId &&
            (r.bundleId ?? undefined) === input.bundleId &&
            new Decimal(r.discountPercent).eq(percent),
        )?.id;
      if (!requestId) {
        throw AppError.unprocessable(
          `${label}: a product discount needs the Super Admin's approval. Send a discount request first.`,
          { index },
        );
      }
      if (used.has(requestId)) {
        throw AppError.unprocessable(`${label}: one approval covers one line only`, { index });
      }
      const request = await lockRequest(manager, requestId);
      const reusable = request.status === 'used' && request.saleId === saleId;
      if (request.branchId !== branchId) {
        throw AppError.unprocessable(`${label}: the approval is for another branch`, { index });
      }
      if (request.status === 'pending') {
        throw AppError.unprocessable(`${label}: the discount is still waiting for the Super Admin`, {
          index,
        });
      }
      if (request.status !== 'approved' && !reusable) {
        throw AppError.unprocessable(`${label}: the discount request was ${request.status}`, { index });
      }
      if (
        (request.productId ?? null) !== (input.productId ?? null) ||
        (request.bundleId ?? null) !== (input.bundleId ?? null)
      ) {
        throw AppError.unprocessable(`${label}: the approval is for a different item`, { index });
      }
      if (!new Decimal(request.discountPercent).eq(percent)) {
        throw AppError.unprocessable(
          `${label}: the approved discount is ${new Decimal(request.discountPercent).toFixed(2)}%`,
          { index },
        );
      }
      if (new Decimal(input.qty).gt(request.qty)) {
        throw AppError.unprocessable(
          `${label}: the approval covers at most ${toQuantity(request.qty).toString()}`,
          { index },
        );
      }
      used.add(request.id);
      if (!reusable) {
        request.status = 'used';
        request.saleId = saleId;
        request.updatedBy = actor.userId;
        await repo(DiscountRequest, manager).save(request);
      }
    }
    await manager.query(
      `UPDATE discount_requests SET status = 'approved', sale_id = NULL, updated_by = $3
        WHERE sale_id = $1 AND status = 'used' AND NOT (id = ANY($2::uuid[]))`,
      [saleId, [...used], actor.userId],
    );
  },
};
