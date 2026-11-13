import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo, withTransaction } from '../../database/transaction';
import { Decimal, toQuantity } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { uploadMany, withUploads, type UploadedFile } from '../../lib/file-uploads';
import { withoutInternals } from '../../lib/http';
import { escapeLike, paginate } from '../../lib/pagination';
import { BUCKETS, createSignedUrl } from '../../lib/storage';
import { today } from '../../lib/validation';
import { auditService } from '../audit/audit.service';
import { inventoryItemsService, normalizeSerials } from '../inventory/inventory-items.service';
import { stockLedger } from '../inventory/stock-ledger';
import { Sale } from '../sales/sale.entity';
import { mapQuantities, stockBranchOf, stockProducts } from '../sales/fulfilment';
import {
  type CreateDirectReplacementInput,
  type CreateReplacementInput,
  type ReplacementListQuery,
  type SendReplacementInput,
} from './replacements.schemas';
import { SaleReplacementFile } from './sale-replacement-file.entity';
import { SaleReplacementItem } from './sale-replacement-item.entity';
import { SaleReplacement } from './sale-replacement.entity';
import { SaleReturn, type ReturnReason } from './sale-return.entity';

export const REPLACEMENT_REFERENCE = 'sale_replacement';

const replacements = branchScopedRepository(SaleReplacement, 'rp');
const replacementItems = branchScopedRepository(SaleReplacementItem, 'rpi');
const replacementFiles = branchScopedRepository(SaleReplacementFile, 'rpf');

function toReplacementDto(r: SaleReplacement, serials?: string[]) {
  const { sale, items, files, saleReturn, branch: _branch, ...rest } = withoutInternals(r);
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
    files: (files ?? [])
      .filter((f) => !f.deletedAt)
      .map((f) => ({
        id: f.id,
        originalName: f.originalName,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
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
    .leftJoinAndSelect('item.product', 'product')
    .leftJoinAndSelect('rp.files', 'file', 'file.deletedAt IS NULL');
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

async function replacedOnReturn(manager: EntityManager, saleReturnId: string) {
  const rows = (await manager.query(
    `SELECT i.product_id AS "productId", SUM(i.qty)::text AS qty
       FROM sale_replacement_items i
       JOIN sale_replacements r ON r.id = i.sale_replacement_id AND r.deleted_at IS NULL AND r.status <> 'rejected'
      WHERE r.sale_return_id = $1 AND i.deleted_at IS NULL
      GROUP BY i.product_id`,
    [saleReturnId],
  )) as { productId: string; qty: string }[];
  return new Map(rows.map((r) => [r.productId, new Decimal(r.qty)]));
}

interface ReplaceableLine {
  productId: string;
  name: string;
  barcode: string | null;
  sold: Decimal;
  returned: Decimal;
  replaced: Decimal;
  replaceable: Decimal;
}

async function replaceableLines(manager: EntityManager, saleId: string): Promise<ReplaceableLine[]> {
  const rows = (await manager.query(
    `SELECT si.product_id AS "productId", p.name, p.barcode, SUM(si.qty)::text AS sold,
            COALESCE((SELECT SUM(ri.qty) FROM sale_return_items ri
                        JOIN sale_returns r ON r.id = ri.sale_return_id AND r.deleted_at IS NULL
                       WHERE r.sale_id = $1 AND ri.product_id = si.product_id AND ri.deleted_at IS NULL), 0)::text AS returned,
            COALESCE((SELECT SUM(pi.qty) FROM sale_replacement_items pi
                        JOIN sale_replacements rp ON rp.id = pi.sale_replacement_id AND rp.deleted_at IS NULL
                         AND rp.sale_return_id IS NULL AND rp.status <> 'rejected'
                       WHERE rp.sale_id = $1 AND pi.product_id = si.product_id AND pi.deleted_at IS NULL), 0)::text AS replaced
       FROM sale_items si JOIN products p ON p.id = si.product_id
      WHERE si.sale_id = $1 AND si.deleted_at IS NULL
      GROUP BY si.product_id, p.name, p.barcode
      ORDER BY p.name`,
    [saleId],
  )) as {
    productId: string;
    name: string;
    barcode: string | null;
    sold: string;
    returned: string;
    replaced: string;
  }[];
  return rows.map((r) => {
    const sold = new Decimal(r.sold);
    const returned = new Decimal(r.returned);
    const replaced = new Decimal(r.replaced);
    return {
      productId: r.productId,
      name: r.name,
      barcode: r.barcode,
      sold,
      returned,
      replaced,
      replaceable: Decimal.max(sold.minus(returned).minus(replaced), 0),
    };
  });
}

function assertReplaceableSale(sale: Sale) {
  if (sale.cancelledOn || sale.deliveryStatus === 'cancelled') {
    throw AppError.conflict('This sale was cancelled, so nothing can be replaced');
  }
  if (sale.saleType === 'online' && sale.deliveryStatus === 'pending') {
    throw AppError.conflict('This online order was not dispatched yet, so nothing can be replaced');
  }
}

function assertRequester(sale: Sale, branchId: string, what: string) {
  if (sale.branchId !== branchId && sale.fulfillmentBranchId !== branchId) throw AppError.notFound(what);
}

async function assertWithin(
  manager: EntityManager,
  items: { productId: string; qty: string }[],
  allowed: Map<string, Decimal>,
  message: string,
) {
  const names = new Map(
    (
      (await manager.query('SELECT id, name FROM products WHERE id = ANY($1)', [
        items.map((i) => i.productId),
      ])) as { id: string; name: string }[]
    ).map((p) => [p.id, p.name]),
  );
  const problems = items.flatMap((item) => {
    const left = allowed.get(item.productId) ?? new Decimal(0);
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
  if (problems.length) throw AppError.unprocessable(message, { items: problems });
}

async function nextSeq(manager: EntityManager, saleId: string) {
  const [row] = (await manager.query(
    `SELECT COALESCE(MAX(replacement_seq), 0) + 1 AS next FROM sale_replacements WHERE sale_id = $1`,
    [saleId],
  )) as { next: number }[];
  return Number(row?.next ?? 1);
}

async function insert(
  manager: EntityManager,
  actor: Actor,
  sale: Sale,
  input: {
    saleReturnId: string | null;
    reason: ReturnReason;
    note: string | null;
    date: string;
    items: { productId: string; qty: string }[];
  },
  uploaded: UploadedFile[],
) {
  const seq = await nextSeq(manager, sale.id);
  const created = await replacements.create(
    sale.branchId,
    actor.userId,
    {
      replacementSeq: seq,
      replacementNo: `${sale.invoiceNo}.${seq}`,
      saleReturnId: input.saleReturnId,
      saleId: sale.id,
      date: input.date,
      reason: input.reason,
      note: input.note,
      status: 'pending_approval',
    },
    manager,
  );
  for (const item of input.items) {
    await replacementItems.create(
      sale.branchId,
      actor.userId,
      { saleReplacementId: created.id, productId: item.productId, qty: toQuantity(item.qty) },
      manager,
    );
  }
  for (const file of uploaded) {
    await replacementFiles.create(
      sale.branchId,
      actor.userId,
      {
        saleReplacementId: created.id,
        filePath: file.path,
        originalName: file.originalName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
      },
      manager,
    );
  }
  const saved = await getReplacement(null, created.id, manager);
  const dto = toReplacementDto(saved);
  await audit(actor, saved, 'create', manager, null, dto);
  return dto;
}

const upload = (branchId: string, files: Express.Multer.File[]) =>
  files.length ? uploadMany(BUCKETS.stockFiles, `${branchId}/replacements`, files) : Promise.resolve([]);

export const replacementsService = {
  async list(branchId: string | null, query: ReplacementListQuery) {
    const qb = detailed(branchId);
    if (query.status) qb.andWhere('rp.status = :status', { status: query.status });
    if (query.kind === 'with_return') qb.andWhere('rp.saleReturnId IS NOT NULL');
    if (query.kind === 'without_return') qb.andWhere('rp.saleReturnId IS NULL');
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
      { sortMap: { date: 'rp.date', createdAt: 'rp.createdAt', replacementNo: 'rp.replacementNo' } },
    );
    return { items: items.map((r) => toReplacementDto(r)), meta };
  },

  async get(branchId: string | null, id: string) {
    const record = await getReplacement(branchId, id);
    return toReplacementDto(record, await serialsOf(repo(SaleReplacement).manager, id));
  },

  async replaceable(branchId: string, saleId: string) {
    const sale = await repo(Sale).findOne({ where: { id: saleId } });
    if (!sale) throw AppError.notFound('Sale');
    assertRequester(sale, branchId, 'Sale');
    const lines = await replaceableLines(repo(Sale).manager, saleId);
    return {
      saleId,
      invoiceNo: sale.invoiceNo,
      items: lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        barcode: l.barcode,
        sold: toQuantity(l.sold),
        returned: toQuantity(l.returned),
        replaced: toQuantity(l.replaced),
        replaceable: toQuantity(l.replaceable),
      })),
    };
  },

  async createForReturn(
    actor: Actor,
    branchId: string,
    saleReturnId: string,
    input: CreateReplacementInput,
    files: Express.Multer.File[] = [],
  ) {
    const uploaded = await upload(branchId, files);
    return withUploads(uploaded, () =>
      withTransaction(async (em) => {
        const saleReturn = await repo(SaleReturn, em).findOne({
          where: { id: saleReturnId },
          relations: { items: true },
        });
        if (!saleReturn) throw AppError.notFound('Return');
        const sale = await lockSale(em, saleReturn.saleId);
        assertRequester(sale, branchId, 'Return');
        const left = new Map<string, Decimal>();
        for (const item of (saleReturn.items ?? []).filter((i) => !i.deletedAt)) {
          left.set(item.productId, (left.get(item.productId) ?? new Decimal(0)).plus(item.qty));
        }
        const replaced = await replacedOnReturn(em, saleReturn.id);
        for (const [productId, qty] of replaced) {
          left.set(productId, (left.get(productId) ?? new Decimal(0)).minus(qty));
        }
        await assertWithin(
          em,
          input.items,
          left,
          left.size === 0
            ? 'This return has no products to replace'
            : 'Only the returned products can be replaced, up to the returned quantity',
        );
        return insert(
          em,
          actor,
          sale,
          {
            saleReturnId: saleReturn.id,
            reason: saleReturn.reason,
            note: input.note ?? null,
            date: input.date ?? today(),
            items: input.items,
          },
          uploaded,
        );
      }),
    );
  },

  async createForSale(
    actor: Actor,
    branchId: string,
    saleId: string,
    input: CreateDirectReplacementInput,
    files: Express.Multer.File[] = [],
  ) {
    const uploaded = await upload(branchId, files);
    return withUploads(uploaded, () =>
      withTransaction(async (em) => {
        const sale = await lockSale(em, saleId);
        assertRequester(sale, branchId, 'Sale');
        assertReplaceableSale(sale);
        const lines = await replaceableLines(em, sale.id);
        await assertWithin(
          em,
          input.items,
          new Map(lines.map((l) => [l.productId, l.replaceable])),
          'Only the products of this sale can be replaced, up to what was sold and not returned or replaced yet',
        );
        return insert(
          em,
          actor,
          sale,
          {
            saleReturnId: null,
            reason: input.reason,
            note: input.note ?? null,
            date: input.date ?? today(),
            items: input.items,
          },
          uploaded,
        );
      }),
    );
  },

  async decide(actor: Actor, id: string, approve: boolean, note?: string | null) {
    return withTransaction(async (em) => {
      const record = await getReplacement(null, id, em);
      await lockSale(em, record.saleId);
      if (record.status !== 'pending_approval') {
        throw AppError.conflict(`${record.replacementNo} was already ${record.status.replace('_', ' ')}`);
      }
      if (!approve && !note) throw AppError.badRequest('Write why the replacement is rejected');
      const status = approve ? 'approved' : 'rejected';
      await repo(SaleReplacement, em).update(
        { id },
        {
          status,
          decidedBy: actor.userId,
          decidedAt: new Date(),
          decisionNote: note ?? null,
          updatedBy: actor.userId,
        },
      );
      const saved = await getReplacement(null, id, em);
      await audit(
        actor,
        saved,
        approve ? 'approve' : 'reject',
        em,
        { status: record.status },
        {
          status,
          note: note ?? null,
        },
      );
      return toReplacementDto(saved);
    });
  },

  async send(actor: Actor, branchId: string, id: string, input: SendReplacementInput) {
    return withTransaction(async (em) => {
      const record = await getReplacement(branchId, id, em);
      const sale = await lockSale(em, record.saleId);
      if (record.status === 'sent') throw AppError.conflict(`${record.replacementNo} was already sent`);
      if (record.status !== 'approved') {
        throw AppError.conflict(`${record.replacementNo} needs the Super Admin's approval before it is sent`);
      }
      if (stockBranchOf(sale) !== branchId) {
        throw AppError.forbidden(
          sale.saleType === 'online'
            ? 'The Dispatch Department sends this replacement from its own stock'
            : 'Only the branch that made the sale hands over its replacement',
        );
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
      await audit(actor, saved, 'send', em, { status: 'approved' }, { status: 'sent', sentOn: date });
      return dto;
    });
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const record = await getReplacement(branchId, id, em);
      if (record.status !== 'pending_approval') {
        throw AppError.conflict('Only a replacement still waiting for approval can be deleted');
      }
      const before = toReplacementDto(record);
      for (const item of record.items ?? []) await replacementItems.softDelete(item, actor.userId, em);
      for (const file of record.files ?? []) await replacementFiles.softDelete(file, actor.userId, em);
      await replacements.softDelete(record, actor.userId, em);
      await audit(actor, record, 'delete', em, before);
    });
  },

  async fileUrl(branchId: string | null, id: string, fileId: string) {
    const record = await getReplacement(branchId, id);
    const file = (record.files ?? []).find((f) => f.id === fileId);
    if (!file) throw AppError.notFound('File');
    return createSignedUrl(BUCKETS.stockFiles, file.filePath);
  },

  async countFor(manager: EntityManager, saleReturnId: string) {
    return repo(SaleReplacement, manager)
      .createQueryBuilder('rp')
      .where('rp.saleReturnId = :saleReturnId', { saleReturnId })
      .andWhere(`rp.status <> 'rejected'`)
      .getCount();
  },

  async idsForSale(manager: EntityManager, saleId: string) {
    const rows = await repo(SaleReplacement, manager).find({
      where: { saleId, status: 'sent' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },
};
