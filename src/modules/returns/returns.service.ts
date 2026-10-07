import { type EntityManager, type SelectQueryBuilder } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo, withTransaction } from '../../database/transaction';
import { Decimal, toMoney, toQuantity } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { escapeLike, paginate } from '../../lib/pagination';
import { today } from '../../lib/validation';
import { accountSheetsRepository } from '../accounts/accounts.repository';
import { auditService } from '../audit/audit.service';
import { Branch } from '../branches/branch.entity';
import { inventoryItemsService } from '../inventory/inventory-items.service';
import { stockLedger } from '../inventory/stock-ledger';
import { Sale } from '../sales/sale.entity';
import { nextSequence } from '../sequences/sequences';
import { SaleReturnItem } from './sale-return-item.entity';
import { SaleReturn, type ReturnReason } from './sale-return.entity';
import {
  type CreateReturnInput,
  type RefundInput,
  type ResolveItemInput,
  type ReturnListQuery,
} from './returns.schemas';

const returns = branchScopedRepository(SaleReturn, 'sr');
const returnItems = branchScopedRepository(SaleReturnItem, 'ri');
const REFERENCE = 'sale_return';
const SALE_REFERENCE = 'sale';

const PIECE_STATUS = {
  quarantined: 'quarantined',
  restocked: 'in_stock',
  damaged: 'damaged',
  expired: 'expired',
  supplier: 'supplier_returned',
} as const;

const PIECE_EVENT = {
  quarantined: 'quarantined',
  restocked: 'restocked',
  damaged: 'damaged',
  expired: 'expired',
  supplier: 'supplier_returned',
} as const;

async function restoreSources(manager: EntityManager, saleId: string) {
  const siblings = await repo(SaleReturn, manager).find({ where: { saleId }, select: { id: true } });
  return [
    { referenceType: SALE_REFERENCE, referenceIds: [saleId] },
    { referenceType: REFERENCE, referenceIds: siblings.map((r) => r.id) },
  ];
}
const SEQUENCE_KEY = 'sale_return';

interface SaleLine {
  productId: string;
  name: string | null;
  barcode: string | null;
  sold: Decimal;
  returned: Decimal;
}

function toReturnDto(r: SaleReturn) {
  const { sale, items, refundAccountSheet, branch: _branch, ...rest } = withoutInternals(r);
  const liveItems = (items ?? []).filter((i) => !i.deletedAt);
  return {
    ...rest,
    sale: sale
      ? {
          id: sale.id,
          invoiceNo: sale.invoiceNo,
          date: sale.date,
          saleType: sale.saleType,
          patient: sale.patient
            ? { id: sale.patient.id, name: sale.patient.name, phone: sale.patient.phone }
            : null,
        }
      : null,
    totalQty: toQuantity(liveItems.reduce((sum, i) => sum.plus(i.qty), new Decimal(0))),
    refundAccountSheet: refundAccountSheet
      ? { id: refundAccountSheet.id, accountName: refundAccountSheet.accountName }
      : null,
    items: liveItems.map((i) => ({
      id: i.id,
      productId: i.productId,
      product: i.product ? { id: i.product.id, name: i.product.name, barcode: i.product.barcode } : null,
      qty: i.qty,
      disposition: i.disposition,
      resolvedAt: i.resolvedAt,
      resolvedBy: i.resolvedBy,
      resolutionNote: i.resolutionNote,
    })),
  };
}

function detailed(branchId: string, manager?: EntityManager) {
  return returns
    .query(branchId, manager)
    .leftJoinAndSelect('sr.sale', 'sale')
    .leftJoinAndSelect('sale.patient', 'patient')
    .leftJoinAndSelect('sr.items', 'item', 'item.deletedAt IS NULL')
    .leftJoinAndSelect('item.product', 'product')
    .leftJoinAndSelect('sr.refundAccountSheet', 'sheet');
}

async function getReturn(branchId: string, id: string, manager?: EntityManager) {
  const found = await detailed(branchId, manager).andWhere('sr.id = :id', { id }).getOne();
  if (!found) throw AppError.notFound('Return');
  return found;
}

async function lockSale(manager: EntityManager, branchId: string, saleId: string) {
  const sale = await repo(Sale, manager)
    .createQueryBuilder('s')
    .setLock('pessimistic_write')
    .where('s.id = :saleId AND s.branchId = :branchId', { saleId, branchId })
    .getOne();
  if (!sale) throw AppError.notFound('Sale');
  return sale;
}

async function saleLines(manager: EntityManager, saleId: string): Promise<Map<string, SaleLine>> {
  const rows: { productId: string; name: string; barcode: string | null; sold: string; returned: string }[] =
    await manager.query(
      `SELECT si.product_id AS "productId", p.name, p.barcode,
              SUM(si.qty)::text AS sold,
              COALESCE((SELECT SUM(ri.qty) FROM sale_return_items ri
                          JOIN sale_returns r ON r.id = ri.sale_return_id AND r.deleted_at IS NULL
                         WHERE r.sale_id = $1 AND ri.product_id = si.product_id AND ri.deleted_at IS NULL), 0)::text AS returned
         FROM sale_items si JOIN products p ON p.id = si.product_id
        WHERE si.sale_id = $1 AND si.deleted_at IS NULL
        GROUP BY si.product_id, p.name, p.barcode
        ORDER BY p.name`,
      [saleId],
    );
  return new Map(
    rows.map((r) => [
      r.productId,
      {
        productId: r.productId,
        name: r.name,
        barcode: r.barcode,
        sold: new Decimal(r.sold),
        returned: new Decimal(r.returned),
      },
    ]),
  );
}

async function refundedFor(manager: EntityManager, saleId: string, excludeReturnId?: string) {
  const qb = repo(SaleReturn, manager)
    .createQueryBuilder('r')
    .select('COALESCE(SUM(r.refundAmount), 0)', 'total')
    .where('r.saleId = :saleId', { saleId });
  if (excludeReturnId) qb.andWhere('r.id <> :excludeReturnId', { excludeReturnId });
  const row = await qb.getRawOne<{ total: string }>();
  return new Decimal(row?.total ?? 0);
}

async function refundFields(
  manager: EntityManager,
  branchId: string,
  sale: Sale,
  refund: RefundInput | null | undefined,
  excludeReturnId?: string,
) {
  if (!refund) {
    return { refundAmount: toMoney(0), refundMethod: null, refundAccountSheetId: null, refundDate: null };
  }
  if (!(await accountSheetsRepository.findById(branchId, refund.accountSheetId, manager))) {
    throw AppError.badRequest('The refund account does not exist in this branch');
  }
  const available = new Decimal(sale.received).minus(await refundedFor(manager, sale.id, excludeReturnId));
  if (new Decimal(refund.amount).greaterThan(available)) {
    throw AppError.unprocessable(
      `The refund cannot be more than the ${toMoney(available).toFixed(2)} received`,
      {
        available: toMoney(available).toFixed(2),
      },
    );
  }
  return {
    refundAmount: toMoney(refund.amount),
    refundMethod: refund.method,
    refundAccountSheetId: refund.accountSheetId,
    refundDate: refund.date ?? today(),
  };
}

async function audit(
  actor: Actor,
  record: { id: string; branchId: string },
  action: string,
  manager: EntityManager,
  before?: object | null,
  after?: object | null,
) {
  await auditService.record(
    { actor, branchId: record.branchId, action, entity: 'sale_return', entityId: record.id, before, after },
    manager,
  );
}

async function insertReturn(
  manager: EntityManager,
  actor: Actor,
  sale: Sale,
  fields: { date: string; reason: ReturnReason; note: string | null },
  items: { productId: string; qty: Decimal; serials?: string[] }[],
  refund: Awaited<ReturnType<typeof refundFields>>,
) {
  const branch = await repo(Branch, manager).findOneByOrFail({ id: sale.branchId });
  const seq = await nextSequence(manager, sale.branchId, SEQUENCE_KEY);
  const created = await returns.create(
    sale.branchId,
    actor.userId,
    {
      returnSeq: seq,
      returnNo: `${branch.code}-RET-${String(seq).padStart(6, '0')}`,
      saleId: sale.id,
      ...fields,
      ...refund,
      status: 'pending',
    },
    manager,
  );
  const ref = { type: REFERENCE, id: created.id, label: created.returnNo };
  for (const item of items) {
    if (!item.serials?.length) {
      await returnItems.create(
        sale.branchId,
        actor.userId,
        {
          saleReturnId: created.id,
          productId: item.productId,
          qty: toQuantity(item.qty),
          disposition: 'pending',
        },
        manager,
      );
      continue;
    }
    const pieces = await inventoryItemsService.take(manager, actor, {
      branchId: sale.branchId,
      serials: item.serials,
      from: ['sold'],
      to: 'returned',
      event: 'returned',
      ref,
      date: fields.date,
      saleId: sale.id,
      productIds: new Set([item.productId]),
    });
    for (const piece of pieces) {
      const line = await returnItems.create(
        sale.branchId,
        actor.userId,
        { saleReturnId: created.id, productId: item.productId, qty: toQuantity(1), disposition: 'pending' },
        manager,
      );
      await inventoryItemsService.linkReturnItem(manager, piece.id, line.id);
    }
  }
  const saved = await getReturn(sale.branchId, created.id, manager);
  await audit(actor, saved, 'create', manager, null, toReturnDto(saved));
  return saved;
}

function assertDispatched(sale: Sale) {
  if (
    sale.saleType === 'online' &&
    (sale.deliveryStatus === 'pending' || sale.deliveryStatus === 'cancelled')
  ) {
    throw AppError.conflict(
      'This online order was never dispatched, so nothing can be returned. Cancel the order instead.',
    );
  }
}

function applyFilters(qb: SelectQueryBuilder<SaleReturn>, query: ReturnListQuery) {
  if (query.status) qb.andWhere('sr.status = :status', { status: query.status });
  if (query.reason) qb.andWhere('sr.reason = :reason', { reason: query.reason });
  if (query.saleId) qb.andWhere('sr.saleId = :saleId', { saleId: query.saleId });
  if (query.from) qb.andWhere('sr.date >= :from', { from: query.from });
  if (query.to) qb.andWhere('sr.date <= :to', { to: query.to });
  if (query.disposition || query.productId) {
    qb.andWhere(
      `EXISTS (SELECT 1 FROM sale_return_items x WHERE x.sale_return_id = sr.id AND x.deleted_at IS NULL${
        query.disposition ? ' AND x.disposition = :disposition' : ''
      }${query.productId ? ' AND x.product_id = :productId' : ''})`,
      { disposition: query.disposition, productId: query.productId },
    );
  }
  if (query.search) {
    qb.andWhere(
      '(sr.returnNo ILIKE :term OR sale.invoiceNo ILIKE :term OR patient.name ILIKE :term OR patient.phone ILIKE :term)',
      { term: `%${escapeLike(query.search)}%` },
    );
  }
  return qb;
}

export const returnsService = {
  async list(branchId: string, query: ReturnListQuery) {
    const { items, meta } = await paginate(
      applyFilters(detailed(branchId), query),
      { ...query, search: undefined },
      { sortMap: { date: 'sr.date', createdAt: 'sr.createdAt', returnSeq: 'sr.returnSeq' } },
    );
    return { items: items.map(toReturnDto), meta };
  },

  async get(branchId: string, id: string) {
    const record = await getReturn(branchId, id);
    const manager = repo(SaleReturn).manager;
    const sold = await stockLedger.batchesFor(manager, branchId, [
      { referenceType: SALE_REFERENCE, referenceIds: [record.saleId] },
    ]);
    const restocked = await stockLedger.batchesFor(manager, branchId, [
      { referenceType: REFERENCE, referenceIds: [record.id] },
    ]);
    const pieces = await inventoryItemsService.itemsOf(manager, {
      saleReturnItemIds: (record.items ?? []).map((i) => i.id),
    });
    const dto = toReturnDto(record);
    return {
      ...dto,
      items: dto.items.map((i) => ({
        ...i,
        serial: pieces.find((p) => p.saleReturnItemId === i.id)?.serial ?? null,
      })),
      soldBatches: sold.map((b) => ({ ...b, qty: toQuantity(b.qty.negated()) })),
      restockedBatches: restocked.map((b) => ({ ...b, qty: toQuantity(b.qty) })),
    };
  },

  async returnable(branchId: string, saleId: string) {
    const manager = repo(Sale).manager;
    const sale = await repo(Sale).findOneBy({ id: saleId, branchId });
    if (!sale) throw AppError.notFound('Sale');
    assertDispatched(sale);
    const lines = await saleLines(manager, saleId);
    const sold = (await inventoryItemsService.itemsOf(manager, { saleId })).filter(
      (i) => i.status === 'sold',
    );
    const tracked = await inventoryItemsService.trackedProducts(manager, branchId, [...lines.keys()]);
    return {
      saleId,
      invoiceNo: sale.invoiceNo,
      received: toMoney(sale.received),
      refunded: toMoney(await refundedFor(manager, saleId)),
      items: [...lines.values()].map((l) => ({
        productId: l.productId,
        product: { id: l.productId, name: l.name ?? '', barcode: l.barcode },
        sold: toQuantity(l.sold),
        returned: toQuantity(l.returned),
        returnable: toQuantity(Decimal.max(l.sold.minus(l.returned), 0)),
        trackSerials: tracked.has(l.productId),
        serials: sold.filter((i) => i.productId === l.productId).map((i) => i.serial),
      })),
    };
  },

  async create(actor: Actor, branchId: string, input: CreateReturnInput) {
    return withTransaction(async (em) => {
      const sale = await lockSale(em, branchId, input.saleId);
      assertDispatched(sale);
      const lines = await saleLines(em, sale.id);
      const problems = input.items.flatMap((item) => {
        const line = lines.get(item.productId);
        const returnable = line ? line.sold.minus(line.returned) : new Decimal(0);
        return new Decimal(item.qty).greaterThan(returnable)
          ? [
              {
                productId: item.productId,
                productName: line?.name ?? null,
                returnable: toQuantity(Decimal.max(returnable, 0)).toFixed(3),
                requested: toQuantity(item.qty).toFixed(3),
              },
            ]
          : [];
      });
      if (problems.length) {
        throw AppError.unprocessable('More was returned than the sale still holds', { items: problems });
      }
      const tracked = await inventoryItemsService.trackedProducts(
        em,
        branchId,
        input.items.map((i) => i.productId),
      );
      const unscanned = input.items.filter(
        (i) => tracked.has(i.productId) && !new Decimal(i.qty).equals(i.serials?.length ?? 0),
      );
      if (unscanned.length > 0) {
        throw AppError.unprocessable('Scan or pick the label of every returned piece', {
          items: unscanned.map((i) => ({
            productId: i.productId,
            productName: lines.get(i.productId)?.name ?? null,
            required: toQuantity(i.qty).toFixed(0),
            scanned: String(i.serials?.length ?? 0),
          })),
        });
      }
      const loose = input.items.filter((i) => !tracked.has(i.productId) && i.serials?.length);
      if (loose.length > 0) {
        throw AppError.badRequest(
          `${lines.get(loose[0]!.productId)?.name ?? 'This product'} is not tracked by label`,
        );
      }
      const refund = await refundFields(em, branchId, sale, input.refund);
      const saved = await insertReturn(
        em,
        actor,
        sale,
        { date: input.date ?? today(), reason: input.reason, note: input.note ?? null },
        input.items.map((i) => ({ productId: i.productId, qty: new Decimal(i.qty), serials: i.serials })),
        refund,
      );
      return toReturnDto(saved);
    });
  },

  async createForReturnedDelivery(manager: EntityManager, actor: Actor, sale: Sale) {
    const lines = await saleLines(manager, sale.id);
    const sold = (await inventoryItemsService.itemsOf(manager, { saleId: sale.id })).filter(
      (i) => i.status === 'sold',
    );
    const remaining = [...lines.values()]
      .map((l) => {
        const serials = sold.filter((i) => i.productId === l.productId).map((i) => i.serial);
        return {
          productId: l.productId,
          qty: l.sold.minus(l.returned),
          serials: serials.length ? serials : undefined,
        };
      })
      .filter((l) => l.qty.greaterThan(0));
    if (remaining.length === 0) return null;
    return insertReturn(
      manager,
      actor,
      sale,
      { date: today(), reason: 'customer_refused', note: `Delivery of ${sale.invoiceNo} came back` },
      remaining,
      await refundFields(manager, sale.branchId, sale, null),
    );
  },

  async refundCancelledOrder(manager: EntityManager, actor: Actor, sale: Sale, refund: RefundInput) {
    const created = await insertReturn(
      manager,
      actor,
      sale,
      {
        date: refund.date ?? today(),
        reason: 'customer_refused',
        note: `Order ${sale.invoiceNo} cancelled before dispatch`,
      },
      [],
      await refundFields(manager, sale.branchId, sale, refund),
    );
    await repo(SaleReturn, manager).update({ id: created.id }, { status: 'completed' });
    return created;
  },

  async hasReturns(manager: EntityManager, saleId: string) {
    return (await repo(SaleReturn, manager).count({ where: { saleId } })) > 0;
  },

  async resolveItem(actor: Actor, branchId: string, id: string, itemId: string, input: ResolveItemInput) {
    return withTransaction(async (em) => {
      const record = await getReturn(branchId, id, em);
      const item = record.items?.find((i) => i.id === itemId);
      if (!item) throw AppError.notFound('Return item');
      if (item.disposition !== 'pending' && item.disposition !== 'quarantined') {
        throw AppError.conflict('This item has already been inspected');
      }
      if (item.disposition === 'quarantined' && input.disposition === 'quarantined') {
        throw AppError.conflict('This item is already in quarantine');
      }
      const pieces = (await inventoryItemsService.itemsOf(em, { saleReturnItemIds: [item.id] })).filter((p) =>
        ['returned', 'quarantined'].includes(p.status),
      );
      const pieceRef = { type: REFERENCE, id: record.id, label: record.returnNo };
      if (pieces.length > 0) {
        await inventoryItemsService.setStatus(em, actor, {
          ids: pieces.map((p) => p.id),
          to: PIECE_STATUS[input.disposition],
          event: PIECE_EVENT[input.disposition],
          ref: pieceRef,
          note: input.note ?? null,
        });
        if (input.disposition === 'restocked') {
          await stockLedger.apply(
            em,
            { branchId, referenceType: REFERENCE, referenceId: record.id, actorId: actor.userId },
            inventoryItemsService.movements(pieces, 1, {
              type: 'sale_return',
              date: today(),
              note: `${record.returnNo} restocked`,
            }),
          );
        }
      } else if (input.disposition === 'restocked') {
        await stockLedger.apply(
          em,
          { branchId, referenceType: REFERENCE, referenceId: record.id, actorId: actor.userId },
          [
            {
              productId: item.productId,
              type: 'sale_return',
              qty: item.qty,
              restoreFrom: await restoreSources(em, record.saleId),
              date: today(),
              note: `${record.returnNo} restocked`,
            },
          ],
        );
      }
      await repo(SaleReturnItem, em).update(
        { id: item.id },
        {
          disposition: input.disposition,
          resolvedAt: new Date(),
          resolvedBy: actor.userId,
          resolutionNote: input.note ?? null,
          updatedBy: actor.userId,
        },
      );
      const open = (record.items ?? []).filter(
        (i) => i.id !== item.id && (i.disposition === 'pending' || i.disposition === 'quarantined'),
      );
      if (open.length === 0 && input.disposition !== 'quarantined') {
        await repo(SaleReturn, em).update(
          { id: record.id },
          { status: 'completed', updatedBy: actor.userId },
        );
      }
      const saved = await getReturn(branchId, id, em);
      await audit(
        actor,
        saved,
        `item:${input.disposition}`,
        em,
        { itemId, disposition: item.disposition },
        {
          itemId,
          disposition: input.disposition,
        },
      );
      return toReturnDto(saved);
    });
  },

  async setRefund(actor: Actor, branchId: string, id: string, refund: RefundInput | null) {
    return withTransaction(async (em) => {
      const record = await getReturn(branchId, id, em);
      const sale = await lockSale(em, branchId, record.saleId);
      const before = toReturnDto(record);
      const fields = await refundFields(em, branchId, sale, refund, record.id);
      await repo(SaleReturn, em).update({ id: record.id }, { ...fields, updatedBy: actor.userId });
      const saved = await getReturn(branchId, id, em);
      await audit(actor, saved, 'refund', em, before, toReturnDto(saved));
      return toReturnDto(saved);
    });
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const record = await getReturn(branchId, id, em);
      if ((record.items ?? []).some((i) => i.disposition !== 'pending')) {
        throw AppError.conflict('A return cannot be deleted after its items have been inspected');
      }
      const before = toReturnDto(record);
      for (const item of record.items ?? []) {
        await inventoryItemsService.release(em, actor, {
          where: { saleReturnItemId: item.id },
          from: ['returned'],
          to: 'sold',
          event: 'return_cancelled',
          ref: { type: REFERENCE, id: record.id, label: record.returnNo },
          clear: ['saleReturnItem'],
        });
      }
      for (const item of record.items ?? []) await returnItems.softDelete(item, actor.userId, em);
      await returns.softDelete(record, actor.userId, em);
      await audit(actor, record, 'delete', em, before);
    });
  },
};
