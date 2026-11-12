import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo, withTransaction } from '../../database/transaction';
import { Decimal, toQuantity } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { escapeLike, paginate } from '../../lib/pagination';
import { today } from '../../lib/validation';
import { auditService } from '../audit/audit.service';
import { Branch } from '../branches/branch.entity';
import { inventoryItemsService, normalizeSerials } from '../inventory/inventory-items.service';
import { stockLedger } from '../inventory/stock-ledger';
import { Sale } from '../sales/sale.entity';
import { mapQuantities, stockBranchOf, stockProducts } from '../sales/fulfilment';
import { nextSequence } from '../sequences/sequences';
import {
  type CreateReplacementInput,
  type ReplacementListQuery,
  type SendReplacementInput,
} from './replacements.schemas';
import { SaleReplacementItem } from './sale-replacement-item.entity';
import { SaleReplacement } from './sale-replacement.entity';
import { SaleReturn } from './sale-return.entity';

export const REPLACEMENT_REFERENCE = 'sale_replacement';
const SEQUENCE_KEY = 'sale_replacement';

const replacements = branchScopedRepository(SaleReplacement, 'rp');
const replacementItems = branchScopedRepository(SaleReplacementItem, 'rpi');

function toReplacementDto(r: SaleReplacement, serials?: string[]) {
  const { sale, items, saleReturn, branch: _branch, ...rest } = withoutInternals(r);
  const liveItems = (items ?? []).filter((i) => !i.deletedAt);
  return {
    ...rest,
    returnNo: saleReturn?.returnNo ?? null,
    sale: sale
      ? {
          id: sale.id,
          invoiceNo: sale.invoiceNo,
          date: sale.date,
          saleType: sale.saleType,
          fulfillmentBranchId: sale.fulfillmentBranchId,
          patient: sale.patient
            ? { id: sale.patient.id, name: sale.patient.name, phone: sale.patient.phone }
            : null,
        }
      : null,
    items: liveItems.map((i) => ({
      id: i.id,
      productId: i.productId,
      product: i.product ? { id: i.product.id, name: i.product.name, barcode: i.product.barcode } : null,
      qty: i.qty,
    })),
    totalQty: toQuantity(liveItems.reduce((sum, i) => sum.plus(i.qty), new Decimal(0))),
    ...(serials ? { serials } : {}),
  };
}

function detailed(branchId: string | null, manager?: EntityManager) {
  const qb = repo(SaleReplacement, manager)
    .createQueryBuilder('rp')
    .leftJoinAndSelect('rp.sale', 'sale')
    .leftJoinAndSelect('rp.saleReturn', 'ret');
  if (branchId) {
    qb.where('(rp.branchId = :branchId OR sale.fulfillmentBranchId = :branchId)', { branchId });
  }
  return qb
    .leftJoinAndSelect('sale.patient', 'patient')
    .leftJoinAndSelect('rp.items', 'item', 'item.deletedAt IS NULL')
    .leftJoinAndSelect('item.product', 'product');
}

async function getReplacement(branchId: string | null, id: string, manager?: EntityManager) {
  const found = await detailed(branchId, manager).andWhere('rp.id = :id', { id }).getOne();
  if (!found) throw AppError.notFound('Replacement');
  return found;
}

async function serialsOf(manager: EntityManager, id: string) {
  const rows = (await manager.query(
    `SELECT DISTINCT i.serial, i.serial_no FROM inventory_item_events e JOIN inventory_items i ON i.id = e.item_id
      WHERE e.reference_type = $1 AND e.reference_id = $2 AND e.type = 'sold'
      ORDER BY i.serial_no`,
    [REPLACEMENT_REFERENCE, id],
  )) as { serial: string }[];
  return rows.map((r) => r.serial);
}

async function lockSale(manager: EntityManager, saleId: string) {
  const sale = await repo(Sale, manager)
    .createQueryBuilder('s')
    .setLock('pessimistic_write')
    .where('s.id = :saleId', { saleId })
    .getOne();
  if (!sale) throw AppError.notFound('Sale');
  return sale;
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
    {
      actor,
      branchId: record.branchId,
      action,
      entity: 'sale_replacement',
      entityId: record.id,
      before,
      after,
    },
    manager,
  );
}

async function assertScanned(
  manager: EntityManager,
  wanted: Map<string, Decimal>,
  tracked: Set<string>,
  counts: Map<string, number>,
) {
  const short = [...tracked].filter((id) => !(wanted.get(id) ?? new Decimal(0)).equals(counts.get(id) ?? 0));
  if (short.length === 0) return;
  const names = (await manager.query('SELECT id, name FROM products WHERE id = ANY($1)', [short])) as {
    id: string;
    name: string;
  }[];
  const labels = short.map((productId) => ({
    productId,
    productName: names.find((n) => n.id === productId)?.name ?? productId,
    required: (wanted.get(productId) ?? new Decimal(0)).toString(),
    scanned: String(counts.get(productId) ?? 0),
  }));
  throw AppError.unprocessable(
    labels.length === 1
      ? `Scan the label of every ${labels[0]!.productName} (${labels[0]!.scanned} of ${labels[0]!.required} scanned)`
      : 'Scan the label of every labelled product',
    { labels },
  );
}

async function postStock(
  manager: EntityManager,
  actor: Actor,
  sale: Sale,
  record: { id: string; replacementNo: string },
  items: { productId: string; qty: Decimal }[],
  serials: string[],
  date: string,
) {
  const stockBranch = stockBranchOf(sale);
  const map = await stockProducts(
    manager,
    sale,
    items.map((i) => i.productId),
  );
  const wanted = mapQuantities(new Map(items.map((i) => [i.productId, i.qty])), map, (a, b) => a.plus(b));
  const tracked = await inventoryItemsService.trackedProducts(manager, stockBranch, [...wanted.keys()]);
  const ref = { type: REPLACEMENT_REFERENCE, id: record.id, label: record.replacementNo };
  const taken =
    serials.length > 0
      ? await inventoryItemsService.take(manager, actor, {
          branchId: stockBranch,
          serials,
          from: ['in_stock'],
          to: 'sold',
          event: 'sold',
          ref,
          date,
          sellableOnly: true,
          productIds: tracked,
          earliestBatchFirst: true,
          soldOnSaleId: sale.id,
        })
      : [];
  await assertScanned(manager, wanted, tracked, inventoryItemsService.countByProduct(taken));
  const note = `${record.replacementNo} for ${sale.invoiceNo}`;
  await stockLedger.apply(
    manager,
    {
      branchId: stockBranch,
      referenceType: REPLACEMENT_REFERENCE,
      referenceId: record.id,
      actorId: actor.userId,
    },
    [
      ...[...wanted]
        .filter(([productId]) => !tracked.has(productId))
        .map(([productId, qty]) => ({
          productId,
          type: 'replacement' as const,
          qty: qty.negated(),
          date,
          note,
        })),
      ...inventoryItemsService.movements(taken, -1, { type: 'replacement', date, note }),
    ],
  );
}

async function alreadyReplaced(manager: EntityManager, saleReturnId: string) {
  const rows = (await manager.query(
    `SELECT i.product_id AS "productId", SUM(i.qty)::text AS qty
       FROM sale_replacement_items i
       JOIN sale_replacements r ON r.id = i.sale_replacement_id AND r.deleted_at IS NULL
      WHERE r.sale_return_id = $1 AND i.deleted_at IS NULL
      GROUP BY i.product_id`,
    [saleReturnId],
  )) as { productId: string; qty: string }[];
  return new Map(rows.map((r) => [r.productId, new Decimal(r.qty)]));
}

const isOnline = (sale: Sale) => sale.saleType === 'online';

export const replacementsService = {
  async list(branchId: string | null, query: ReplacementListQuery) {
    const qb = detailed(branchId);
    if (query.status) qb.andWhere('rp.status = :status', { status: query.status });
    if (query.saleId) qb.andWhere('rp.saleId = :saleId', { saleId: query.saleId });
    if (query.saleReturnId)
      qb.andWhere('rp.saleReturnId = :saleReturnId', { saleReturnId: query.saleReturnId });
    if (query.from) qb.andWhere('rp.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('rp.date <= :to', { to: query.to });
    if (query.search) {
      qb.andWhere(
        '(rp.replacementNo ILIKE :term OR ret.returnNo ILIKE :term OR sale.invoiceNo ILIKE :term OR patient.name ILIKE :term OR patient.phone ILIKE :term)',
        { term: `%${escapeLike(query.search)}%` },
      );
    }
    const { items, meta } = await paginate(
      qb,
      { ...query, search: undefined },
      { sortMap: { date: 'rp.date', createdAt: 'rp.createdAt', replacementSeq: 'rp.replacementSeq' } },
    );
    return { items: items.map((r) => toReplacementDto(r)), meta };
  },

  async get(branchId: string | null, id: string) {
    const record = await getReplacement(branchId, id);
    return toReplacementDto(record, await serialsOf(repo(SaleReplacement).manager, id));
  },

  async create(actor: Actor, branchId: string, saleReturnId: string, input: CreateReplacementInput) {
    return withTransaction(async (em) => {
      const saleReturn = await repo(SaleReturn, em).findOne({
        where: { id: saleReturnId },
        relations: { items: true },
      });
      if (!saleReturn) throw AppError.notFound('Return');
      const sale = await lockSale(em, saleReturn.saleId);
      if (sale.branchId !== branchId && sale.fulfillmentBranchId !== branchId) {
        throw AppError.notFound('Return');
      }
      const returned = new Map<string, Decimal>();
      for (const item of (saleReturn.items ?? []).filter((i) => !i.deletedAt)) {
        returned.set(item.productId, (returned.get(item.productId) ?? new Decimal(0)).plus(item.qty));
      }
      const replaced = await alreadyReplaced(em, saleReturn.id);
      const names = new Map(
        (
          (await em.query('SELECT id, name FROM products WHERE id = ANY($1)', [
            input.items.map((i) => i.productId),
          ])) as { id: string; name: string }[]
        ).map((p) => [p.id, p.name]),
      );
      const problems = input.items.flatMap((item) => {
        const left = (returned.get(item.productId) ?? new Decimal(0)).minus(
          replaced.get(item.productId) ?? 0,
        );
        return new Decimal(item.qty).greaterThan(left)
          ? [
              {
                productId: item.productId,
                productName: names.get(item.productId) ?? null,
                replaceable: toQuantity(Decimal.max(left, 0)).toFixed(3),
                requested: toQuantity(item.qty).toFixed(3),
              },
            ]
          : [];
      });
      if (problems.length) {
        throw AppError.unprocessable(
          returned.size === 0
            ? 'This return has no products to replace'
            : 'Only the returned products can be replaced, up to the returned quantity',
          { items: problems },
        );
      }
      const online = isOnline(sale);
      const serials = normalizeSerials(input.serials ?? []);
      if (online && serials.length) {
        throw AppError.badRequest(
          'An online replacement is sent by the Dispatch Department; it scans the labels when it sends it',
        );
      }
      if (!online && stockBranchOf(sale) !== branchId) {
        throw AppError.forbidden('Only the branch that made the sale hands over its replacement');
      }
      const date = input.date ?? today();
      const branch = await repo(Branch, em).findOneByOrFail({ id: sale.branchId });
      const seq = await nextSequence(em, sale.branchId, SEQUENCE_KEY);
      const created = await replacements.create(
        sale.branchId,
        actor.userId,
        {
          replacementSeq: seq,
          replacementNo: `${branch.code}-REP-${String(seq).padStart(6, '0')}`,
          saleReturnId: saleReturn.id,
          saleId: sale.id,
          date,
          note: input.note ?? null,
          status: online ? 'pending' : 'sent',
          sentOn: online ? null : date,
          sentBy: online ? null : actor.userId,
        },
        em,
      );
      for (const item of input.items) {
        await replacementItems.create(
          sale.branchId,
          actor.userId,
          { saleReplacementId: created.id, productId: item.productId, qty: toQuantity(item.qty) },
          em,
        );
      }
      if (!online) {
        await postStock(
          em,
          actor,
          sale,
          created,
          input.items.map((i) => ({ productId: i.productId, qty: new Decimal(i.qty) })),
          serials,
          date,
        );
      }
      const saved = await getReplacement(null, created.id, em);
      const dto = toReplacementDto(saved, await serialsOf(em, created.id));
      await audit(actor, saved, 'create', em, null, dto);
      return dto;
    });
  },

  async send(actor: Actor, branchId: string, id: string, input: SendReplacementInput) {
    return withTransaction(async (em) => {
      const record = await getReplacement(branchId, id, em);
      const sale = await lockSale(em, record.saleId);
      if (record.status !== 'pending') throw AppError.conflict(`${record.replacementNo} was already sent`);
      if (stockBranchOf(sale) !== branchId) {
        throw AppError.forbidden('The Dispatch Department sends this replacement from its own stock');
      }
      const date = input.date ?? today();
      if (date < record.date)
        throw AppError.badRequest('The send date cannot be before the replacement date');
      await postStock(
        em,
        actor,
        sale,
        record,
        (record.items ?? []).map((i) => ({ productId: i.productId, qty: new Decimal(i.qty) })),
        normalizeSerials(input.serials ?? []),
        date,
      );
      await repo(SaleReplacement, em).update(
        { id: record.id },
        { status: 'sent', sentOn: date, sentBy: actor.userId, updatedBy: actor.userId },
      );
      const saved = await getReplacement(null, id, em);
      const dto = toReplacementDto(saved, await serialsOf(em, id));
      await audit(actor, saved, 'send', em, { status: 'pending' }, { status: 'sent', sentOn: date });
      return dto;
    });
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const record = await getReplacement(branchId, id, em);
      if (record.status !== 'pending') {
        throw AppError.conflict('A replacement that was already sent cannot be deleted');
      }
      const before = toReplacementDto(record);
      for (const item of record.items ?? []) await replacementItems.softDelete(item, actor.userId, em);
      await replacements.softDelete(record, actor.userId, em);
      await audit(actor, record, 'delete', em, before);
    });
  },

  async countFor(manager: EntityManager, saleReturnId: string) {
    return repo(SaleReplacement, manager).count({ where: { saleReturnId } });
  },

  async idsForSale(manager: EntityManager, saleId: string) {
    const rows = await repo(SaleReplacement, manager).find({
      where: { saleId, status: 'sent' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },
};
