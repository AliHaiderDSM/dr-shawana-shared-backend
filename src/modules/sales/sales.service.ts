import { In, type EntityManager, type SelectQueryBuilder } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo, withTransaction } from '../../database/transaction';
import { AppDataSource } from '../../database/data-source';
import { Decimal, toMoney, toQuantity, type DecimalInput } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { removeQuietly, uploadMany, withUploads, type UploadedFile } from '../../lib/file-uploads';
import { withoutInternals } from '../../lib/http';
import { applyListQuery, escapeLike, pageMeta } from '../../lib/pagination';
import { BUCKETS, createSignedUrl } from '../../lib/storage';
import { today } from '../../lib/validation';
import { accountSheetsRepository } from '../accounts/accounts.repository';
import { auditService } from '../audit/audit.service';
import { Branch } from '../branches/branch.entity';
import { BundleItem } from '../bundles/bundle-item.entity';
import { Bundle } from '../bundles/bundle.entity';
import {
  inventoryItemsService,
  normalizeSerials,
  type TakenItem,
} from '../inventory/inventory-items.service';
import { stockLedger } from '../inventory/stock-ledger';
import { StockMovement } from '../inventory/stock-movement.entity';
import { patientsService } from '../patients/patients.service';
import { returnsService } from '../returns/returns.service';
import { Product } from '../products/product.entity';
import { nextSequence } from '../sequences/sequences';
import { SaleItem } from './sale-item.entity';
import { SalePaymentProof } from './sale-payment-proof.entity';
import { SalePayment } from './sale-payment.entity';
import { lineTotal, saleTotals } from './sale-totals';
import { Sale, type DeliveryStatus } from './sale.entity';
import {
  type CreateSaleInput,
  type SaleItemInput,
  type SaleListQuery,
  type SalePaymentInput,
  type UpdateSaleInput,
  type UpdateSalePaymentInput,
} from './sales.schemas';

const sales = branchScopedRepository(Sale, 'sale');
const saleItems = branchScopedRepository(SaleItem, 'si');
const salePayments = branchScopedRepository(SalePayment, 'sp');
const paymentProofs = branchScopedRepository(SalePaymentProof, 'proof');

const OWN_ONLY_ROLES = new Set(['front_desk', 'team_manager']);
const REFERENCE = 'sale';

interface Line {
  productId: string;
  bundleId: string | null;
  qty: Decimal;
  unitPrice: Decimal;
}

const CASH_CLEARED = {
  senderBank: null,
  senderAccountTitle: null,
  senderAccountNo: null,
};

const MAX_PROOFS = 5;

function proofIndexesOf(input: SalePaymentInput) {
  return [
    ...new Set([
      ...(input.proofIndexes ?? []),
      ...(input.proofIndex === undefined ? [] : [input.proofIndex]),
    ]),
  ];
}

const liveProofs = (p: SalePayment) =>
  (p.proofs ?? []).filter((f) => !f.deletedAt).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

export function toSalePaymentDto(p: SalePayment) {
  return {
    id: p.id,
    saleId: p.saleId,
    method: p.method,
    amount: p.amount,
    date: p.date,
    accountSheetId: p.accountSheetId,
    accountSheet: p.accountSheet
      ? {
          id: p.accountSheet.id,
          accountName: p.accountSheet.accountName,
          accountCode: p.accountSheet.accountCode,
        }
      : null,
    senderBank: p.senderBank,
    senderAccountTitle: p.senderAccountTitle,
    senderAccountNo: p.senderAccountNo,
    hasProof: liveProofs(p).length > 0,
    proofOriginalName: liveProofs(p)[0]?.originalName ?? null,
    proofs: liveProofs(p).map((f) => ({
      id: f.id,
      originalName: f.originalName,
      contentType: f.contentType,
    })),
    createdBy: p.createdBy,
    createdAt: p.createdAt,
  };
}

function toSaleDto(sale: Sale) {
  const { patient, items, payments, branch: _branch, ...rest } = withoutInternals(sale);
  const livePayments = (payments ?? []).filter((p) => !p.deletedAt);
  return {
    ...rest,
    patient: patient ? { id: patient.id, name: patient.name, phone: patient.phone } : null,
    paymentMethods: [...new Set(livePayments.map((p) => p.method))],
    items: (items ?? [])
      .filter((i) => !i.deletedAt)
      .map((i) => ({
        id: i.id,
        productId: i.productId,
        product: i.product ? { id: i.product.id, name: i.product.name } : null,
        bundleId: i.bundleId,
        bundle: i.bundle ? { id: i.bundle.id, name: i.bundle.name } : null,
        qty: i.qty,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      })),
    payments: livePayments.map(toSalePaymentDto),
  };
}

function detailed(branchId: string, manager?: EntityManager) {
  return sales
    .query(branchId, manager)
    .leftJoinAndSelect('sale.patient', 'patient')
    .leftJoinAndSelect('sale.items', 'item', 'item.deletedAt IS NULL')
    .leftJoinAndSelect('item.product', 'product')
    .leftJoinAndSelect('item.bundle', 'bundle')
    .leftJoinAndSelect('sale.payments', 'payment', 'payment.deletedAt IS NULL')
    .leftJoinAndSelect('payment.accountSheet', 'sheet')
    .leftJoinAndSelect('payment.proofs', 'proof', 'proof.deletedAt IS NULL');
}

async function getSale(branchId: string, id: string, manager?: EntityManager) {
  const sale = await detailed(branchId, manager).andWhere('sale.id = :id', { id }).getOne();
  if (!sale) throw AppError.notFound('Sale');
  return sale;
}

function assertCanChange(actor: Actor, sale: Sale) {
  if (OWN_ONLY_ROLES.has(actor.role) && sale.createdBy !== actor.userId) {
    throw AppError.forbidden('You can only change sales you created');
  }
}

async function resolveLines(
  branchId: string,
  inputs: SaleItemInput[],
  manager: EntityManager,
): Promise<Line[]> {
  const productIds = inputs.map((i) => i.productId).filter((id): id is string => Boolean(id));
  const bundleIds = inputs.map((i) => i.bundleId).filter((id): id is string => Boolean(id));
  const products = productIds.length
    ? await repo(Product, manager).findBy(productIds.map((id) => ({ id, branchId })))
    : [];
  const bundles = bundleIds.length
    ? await repo(Bundle, manager).findBy(bundleIds.map((id) => ({ id, branchId })))
    : [];
  const bundleItems = bundleIds.length
    ? await repo(BundleItem, manager).find({ where: bundleIds.map((bundleId) => ({ bundleId })) })
    : [];

  const lines: Line[] = [];
  inputs.forEach((input, index) => {
    const qty = new Decimal(input.qty);
    if (input.productId) {
      const product = products.find((p) => p.id === input.productId);
      if (!product) throw AppError.badRequest(`Item ${index + 1}: the product was not found in this branch`);
      if (product.status !== 'active')
        throw AppError.badRequest(`Item ${index + 1}: "${product.name}" is not active`);
      lines.push({ productId: product.id, bundleId: null, qty, unitPrice: toMoney(product.salePrice) });
      return;
    }
    const bundle = bundles.find((b) => b.id === input.bundleId);
    if (!bundle) throw AppError.badRequest(`Item ${index + 1}: the bundle was not found in this branch`);
    const parts = bundleItems.filter((b) => b.bundleId === bundle.id);
    if (parts.length === 0)
      throw AppError.badRequest(`Item ${index + 1}: the bundle "${bundle.name}" has no products`);
    for (const part of parts) {
      lines.push({
        productId: part.productId,
        bundleId: bundle.id,
        qty: qty.times(part.qty),
        unitPrice: toMoney(part.price),
      });
    }
  });
  return lines;
}

async function assertAccountSheet(branchId: string, id: string, manager: EntityManager) {
  if (!(await accountSheetsRepository.findById(branchId, id, manager))) {
    throw AppError.badRequest('The selected receiving account was not found in this branch');
  }
}

function assertProofIndexes(inputs: SalePaymentInput[], proofCount: number) {
  inputs.forEach((p, i) => {
    const indexes = proofIndexesOf(p);
    if (indexes.length === 0) return;
    if (p.method !== 'online')
      throw AppError.badRequest(`Payment ${i + 1}: only online payments take a screenshot`);
    if (indexes.length > MAX_PROOFS)
      throw AppError.badRequest(`Payment ${i + 1}: attach at most ${MAX_PROOFS} screenshots`);
    const missing = indexes.find((index) => index >= proofCount);
    if (missing !== undefined)
      throw AppError.badRequest(`Payment ${i + 1}: screenshot ${missing} was not uploaded`);
  });
}

async function saveProofs(
  manager: EntityManager,
  actor: Actor,
  payment: Pick<SalePayment, 'id' | 'branchId'>,
  files: UploadedFile[],
) {
  for (const file of files) {
    await paymentProofs.create(
      payment.branchId,
      actor.userId,
      {
        paymentId: payment.id,
        filePath: file.path,
        originalName: file.originalName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
      },
      manager,
    );
  }
}

async function dropProofs(manager: EntityManager, actor: Actor, branchId: string, paymentId: string) {
  const proofs = await paymentProofs
    .query(branchId, manager)
    .andWhere('proof.paymentId = :paymentId', { paymentId })
    .getMany();
  for (const proof of proofs) await paymentProofs.softDelete(proof, actor.userId, manager);
  return proofs.map((p) => p.filePath);
}

const uploadProofs = (branchId: string, files: Express.Multer.File[]) =>
  uploadMany(BUCKETS.paymentProofs, `${branchId}/sales`, files);

async function insertPayment(
  manager: EntityManager,
  actor: Actor,
  sale: Pick<Sale, 'id' | 'branchId' | 'date'>,
  input: Omit<SalePaymentInput, 'proofIndex' | 'proofIndexes'>,
  proofs: UploadedFile[],
) {
  await assertAccountSheet(sale.branchId, input.accountSheetId, manager);
  const details =
    input.method === 'cash'
      ? CASH_CLEARED
      : {
          senderBank: input.senderBank ?? null,
          senderAccountTitle: input.senderAccountTitle ?? null,
          senderAccountNo: input.senderAccountNo ?? null,
        };
  const payment = await salePayments.create(
    sale.branchId,
    actor.userId,
    {
      saleId: sale.id,
      method: input.method,
      amount: input.amount as never,
      date: input.date ?? sale.date,
      accountSheetId: input.accountSheetId,
      ...details,
    } as Partial<SalePayment>,
    manager,
  );
  if (input.method === 'online') await saveProofs(manager, actor, payment, proofs);
  return payment;
}

async function insertItems(manager: EntityManager, actor: Actor, sale: Sale, lines: Line[]) {
  for (const line of lines) {
    await saleItems.create(
      sale.branchId,
      actor.userId,
      {
        saleId: sale.id,
        productId: line.productId,
        bundleId: line.bundleId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        lineTotal: lineTotal(line),
      },
      manager,
    );
  }
}

function soldByProduct(lines: { productId: string; qty: DecimalInput }[]) {
  const sold = new Map<string, Decimal>();
  for (const l of lines) sold.set(l.productId, (sold.get(l.productId) ?? new Decimal(0)).plus(l.qty));
  return sold;
}

async function netStock(manager: EntityManager, sale: Sale) {
  const movements = await manager.getRepository(StockMovement).find({
    where: { branchId: sale.branchId, referenceType: REFERENCE, referenceId: sale.id },
  });
  const net = new Map<string, Decimal>();
  for (const m of movements) net.set(m.productId, (net.get(m.productId) ?? new Decimal(0)).plus(m.qty));
  return net;
}

async function takeForSale(
  manager: EntityManager,
  actor: Actor,
  sale: Sale,
  serials: string[],
  tracked: Set<string>,
  date: string = sale.date,
) {
  if (serials.length === 0) return [];
  return inventoryItemsService.take(manager, actor, {
    branchId: sale.branchId,
    serials,
    from: ['in_stock'],
    to: 'sold',
    event: 'sold',
    ref: { type: REFERENCE, id: sale.id, label: sale.invoiceNo },
    date,
    sellableOnly: true,
    productIds: tracked,
  });
}

async function assertScanned(
  manager: EntityManager,
  wanted: Map<string, Decimal>,
  tracked: Set<string>,
  items: TakenItem[],
) {
  const counts = inventoryItemsService.countByProduct(items);
  const short = [...tracked].filter((id) => !(wanted.get(id) ?? new Decimal(0)).equals(counts.get(id) ?? 0));
  if (short.length === 0) return;
  const names: { id: string; name: string }[] = await manager.query(
    'SELECT id, name FROM products WHERE id = ANY($1)',
    [short],
  );
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

const ledgerRef = (actor: Actor, sale: Sale) => ({
  branchId: sale.branchId,
  referenceType: REFERENCE,
  referenceId: sale.id,
  actorId: actor.userId,
});

async function recompute(
  manager: EntityManager,
  sale: Sale,
  discount: { autoDiscount?: boolean; discountPercent?: DecimalInput },
) {
  const items = await saleItems
    .query(sale.branchId, manager)
    .andWhere('si.saleId = :id', { id: sale.id })
    .getMany();
  const payments = await salePayments
    .query(sale.branchId, manager)
    .andWhere('sp.saleId = :id', { id: sale.id })
    .getMany();
  const received = payments.reduce((sum, p) => sum.plus(p.amount), new Decimal(0));
  const totals = saleTotals(items, received, discount);
  await repo(Sale, manager).update(
    { id: sale.id },
    {
      totalQty: totals.totalQty,
      subtotal: totals.subtotal,
      discountPercent: totals.discountPercent,
      discountAmount: totals.discountAmount,
      total: totals.total,
      received: totals.received,
      remaining: totals.remaining,
      paymentStatus: totals.paymentStatus,
    },
  );
}

function applyFilters(qb: SelectQueryBuilder<Sale>, query: SaleListQuery) {
  if (query.patientId) qb.andWhere('sale.patientId = :patientId', { patientId: query.patientId });
  if (query.createdBy) qb.andWhere('sale.createdBy = :createdBy', { createdBy: query.createdBy });
  if (query.saleType) qb.andWhere('sale.saleType = :saleType', { saleType: query.saleType });
  if (query.city) qb.andWhere('sale.city ILIKE :city', { city: escapeLike(query.city) });
  if (query.deliveryStatus) qb.andWhere('sale.deliveryStatus = :ds', { ds: query.deliveryStatus });
  if (query.paymentStatus) qb.andWhere('sale.paymentStatus = :ps', { ps: query.paymentStatus });
  if (query.from) qb.andWhere('sale.date >= :from', { from: query.from });
  if (query.to) qb.andWhere('sale.date <= :to', { to: query.to });
  if (query.productId) {
    qb.andWhere(
      `EXISTS (SELECT 1 FROM sale_items x WHERE x.sale_id = sale.id AND x.deleted_at IS NULL
          AND x.product_id IN (SELECT id FROM products WHERE id = :productId OR origin_product_id = :productId))`,
      { productId: query.productId },
    );
  }
  if (query.method || query.accountSheetId) {
    qb.andWhere(
      `EXISTS (SELECT 1 FROM sale_payments y WHERE y.sale_id = sale.id AND y.deleted_at IS NULL${query.method ? ' AND y.method = :method' : ''}${query.accountSheetId ? ' AND y.account_sheet_id = :sheet' : ''})`,
      { method: query.method, sheet: query.accountSheetId },
    );
  }
  if (query.search) {
    qb.andWhere('(sale.invoiceNo ILIKE :term OR patient.name ILIKE :term OR patient.phone ILIKE :term)', {
      term: `%${escapeLike(query.search)}%`,
    });
  }
  return qb;
}

async function audit(
  actor: Actor,
  sale: { id: string; branchId: string },
  action: string,
  manager: EntityManager,
  before?: object | null,
  after?: object | null,
) {
  await auditService.record(
    { actor, branchId: sale.branchId, action, entity: 'sale', entityId: sale.id, before, after },
    manager,
  );
}

export const salesService = {
  getRecord: getSale,
  toDto: toSaleDto,

  async list(branchId: string | null, query: SaleListQuery) {
    const base = () =>
      branchId
        ? sales.query(branchId)
        : repo(Sale)
            .createQueryBuilder('sale')
            .innerJoin('sale.branch', 'onlyBranches', "onlyBranches.kind = 'branch'");
    const qb = applyFilters(
      base().leftJoinAndSelect('sale.patient', 'patient').leftJoinAndSelect('sale.branch', 'saleBranch'),
      query,
    );
    const totalsQuery = applyFilters(base().leftJoin('sale.patient', 'patient'), query)
      .select('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(sale.totalQty), 0)', 'qty')
      .addSelect('COALESCE(SUM(sale.subtotal), 0)', 'subtotal')
      .addSelect('COALESCE(SUM(sale.discountAmount), 0)', 'discount')
      .addSelect('COALESCE(SUM(sale.total), 0)', 'total')
      .addSelect('COALESCE(SUM(sale.received), 0)', 'received')
      .addSelect('COALESCE(SUM(sale.remaining), 0)', 'remaining')
      .getRawOne<Record<string, string>>();
    applyListQuery(
      qb,
      { ...query, search: undefined },
      {
        sortMap: { date: 'sale.date', createdAt: 'sale.createdAt', invoiceSeq: 'sale.invoiceSeq' },
        toOneJoins: true,
      },
    );
    const [totals, rows] = await Promise.all([totalsQuery, qb.getMany()]);
    const withPayments = rows.length
      ? await repo(SalePayment).find({ where: { saleId: In(rows.map((r) => r.id)) } })
      : [];
    return {
      items: rows.map((r) => {
        const {
          items: _items,
          payments: _payments,
          ...rest
        } = toSaleDto({
          ...r,
          items: [],
          payments: withPayments.filter((p) => p.saleId === r.id),
        } as Sale);
        return {
          ...rest,
          branch: r.branch ? { id: r.branch.id, code: r.branch.code, name: r.branch.name } : null,
        };
      }),
      meta: {
        ...pageMeta(query, Number(totals?.count ?? 0)),
        totals: {
          qty: new Decimal(totals?.qty ?? 0).toFixed(3),
          subtotal: toMoney(totals?.subtotal ?? 0),
          discount: toMoney(totals?.discount ?? 0),
          total: toMoney(totals?.total ?? 0),
          received: toMoney(totals?.received ?? 0),
          remaining: toMoney(totals?.remaining ?? 0),
        },
      },
    };
  },

  async get(branchId: string, id: string) {
    const sale = await getSale(branchId, id);
    const batches = await stockLedger.batchesFor(AppDataSource.manager, branchId, [
      { referenceType: REFERENCE, referenceIds: [id] },
    ]);
    const pieces = await inventoryItemsService.itemsOf(AppDataSource.manager, { saleId: id });
    return {
      ...toSaleDto(sale),
      batches: batches.map((b) => ({ ...b, qty: toQuantity(b.qty.negated()) })),
      serials: pieces.map((p) => ({ serial: p.serial, productId: p.productId, status: p.status })),
    };
  },

  async create(actor: Actor, branchId: string, input: CreateSaleInput, proofs: Express.Multer.File[] = []) {
    assertProofIndexes(input.payments, proofs.length);
    const uploaded = await uploadProofs(branchId, proofs);
    return withUploads(uploaded, () =>
      withTransaction(async (em) => {
        const branch = await repo(Branch, em).findOneByOrFail({ id: branchId });
        if (branch.kind === 'warehouse') {
          throw AppError.conflict(
            'The Super Admin stock does not sell. Transfer the stock to a branch first.',
          );
        }
        const patient = input.patient
          ? await patientsService.createRecord(actor, branchId, input.patient, em)
          : await patientsService.require(input.patientId as string, em);
        const lines = await resolveLines(branchId, input.items, em);
        const received = input.payments.reduce((sum, p) => sum.plus(p.amount), new Decimal(0));
        const totals = saleTotals(lines, received, input);
        const seq = await nextSequence(em, branchId, 'sale');
        const date = input.date ?? today();

        const sale = await sales.create(
          branchId,
          actor.userId,
          {
            invoiceSeq: seq,
            invoiceNo: `${branch.code}-${String(seq).padStart(6, '0')}`,
            patientId: patient.id,
            patientCity: patient.city,
            saleType: input.saleType,
            city: input.city ?? branch.city,
            date,
            note: input.note ?? null,
            deliveryStatus: input.saleType === 'online' ? 'pending' : null,
            ...totals,
          },
          em,
        );
        await insertItems(em, actor, sale, lines);
        for (const payment of input.payments) {
          const proofs = proofIndexesOf(payment).flatMap((index) => uploaded[index] ?? []);
          await insertPayment(em, actor, sale, payment, proofs);
        }
        const wanted = soldByProduct(lines);
        const tracked = await inventoryItemsService.trackedProducts(em, branchId, [...wanted.keys()]);
        const taken = await takeForSale(em, actor, sale, input.serials ?? [], tracked);
        await assertScanned(em, wanted, tracked, taken);
        await stockLedger.apply(em, ledgerRef(actor, sale), [
          ...[...wanted]
            .filter(([productId]) => !tracked.has(productId))
            .map(([productId, qty]) => ({
              productId,
              type: 'sale' as const,
              qty: qty.negated(),
              date,
              note: sale.invoiceNo,
            })),
          ...inventoryItemsService.movements(taken, -1, { type: 'sale', date, note: sale.invoiceNo }),
        ]);
        const dto = toSaleDto(await getSale(branchId, sale.id, em));
        await audit(actor, sale, 'create', em, null, dto);
        return dto;
      }),
    );
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateSaleInput) {
    return withTransaction(async (em) => {
      const sale = await getSale(branchId, id, em);
      assertCanChange(actor, sale);
      const before = toSaleDto(sale);
      if (
        (input.items || input.saleType) &&
        (sale.deliveryStatus === 'returned' || (await returnsService.hasReturns(em, sale.id)))
      ) {
        throw AppError.conflict('A sale with returns cannot change its items or type');
      }

      if (input.items) {
        const lines = await resolveLines(branchId, input.items, em);
        for (const old of sale.items ?? []) await saleItems.softDelete(old, actor.userId, em);
        await insertItems(em, actor, sale, lines);
        const wanted = soldByProduct(lines);
        const net = await netStock(em, sale);
        const editDate = input.date ?? sale.date;
        const note = `${sale.invoiceNo} edited`;
        const old = (await inventoryItemsService.itemsOf(em, { saleId: sale.id })).filter(
          (i) => i.status === 'sold',
        );
        const tracked = await inventoryItemsService.trackedProducts(em, branchId, [
          ...new Set([...wanted.keys(), ...net.keys(), ...old.map((i) => i.productId)]),
        ]);
        const keep = new Set(input.serials ? normalizeSerials(input.serials) : old.map((i) => i.serial));
        const oldSerials = new Set(old.map((i) => i.serial));
        const released = await inventoryItemsService.release(em, actor, {
          where: { ids: old.filter((i) => !keep.has(i.serial)).map((i) => i.id) },
          from: ['sold'],
          to: 'in_stock',
          event: 'sale_edited',
          ref: { type: REFERENCE, id: sale.id, label: sale.invoiceNo },
          clear: ['sale'],
        });
        const added = await takeForSale(
          em,
          actor,
          sale,
          [...keep].filter((serial) => !oldSerials.has(serial)),
          tracked,
          editDate,
        );
        await assertScanned(em, wanted, tracked, [...old.filter((i) => keep.has(i.serial)), ...added]);
        const productIds = new Set([...wanted.keys(), ...net.keys()].filter((id) => !tracked.has(id)));
        const adjustments = [...productIds]
          .map((productId) => ({
            productId,
            type: 'sale_edit_adjust' as const,
            qty: (wanted.get(productId) ?? new Decimal(0)).negated().minus(net.get(productId) ?? 0),
            date: input.date ?? sale.date,
            note: `${sale.invoiceNo} edited`,
            restoreFrom: [{ referenceType: REFERENCE, referenceIds: [sale.id] }],
          }))
          .filter((m) => !m.qty.isZero());
        const pieceMoves = [
          ...inventoryItemsService.movements(released, 1, { type: 'sale_edit_adjust', date: editDate, note }),
          ...inventoryItemsService.movements(added, -1, { type: 'sale_edit_adjust', date: editDate, note }),
        ];
        if (adjustments.length + pieceMoves.length > 0) {
          await stockLedger.apply(em, ledgerRef(actor, sale), [...adjustments, ...pieceMoves]);
        }
      }
      if (input.patientId && input.patientId !== sale.patientId) {
        const patient = await patientsService.require(input.patientId, em);
        sale.patientCity = patient.city;
      }
      if (input.saleType && input.saleType !== sale.saleType) {
        sale.deliveryStatus = input.saleType === 'online' ? 'pending' : null;
      }
      const { items: _items, discountPercent, ...fields } = input;
      Object.assign(sale, fields, { updatedBy: actor.userId });
      delete sale.items;
      delete sale.payments;
      delete sale.patient;
      await sales.save(sale, em);
      await recompute(em, sale, { discountPercent: discountPercent ?? sale.discountPercent });
      const after = toSaleDto(await getSale(branchId, id, em));
      await audit(actor, sale, 'update', em, before, after);
      return after;
    });
  },

  async setDelivery(actor: Actor, branchId: string, id: string, status: DeliveryStatus) {
    return withTransaction(async (em) => {
      const sale = await getSale(branchId, id, em);
      assertCanChange(actor, sale);
      if (sale.saleType !== 'online')
        throw AppError.unprocessable('Only online sales have a delivery status');
      if (sale.deliveryStatus === status) return toSaleDto(sale);
      if (sale.deliveryStatus === 'returned') throw AppError.conflict('This sale was already returned');
      if (status === 'returned') await returnsService.createForReturnedDelivery(em, actor, sale);
      const before = { deliveryStatus: sale.deliveryStatus };
      await repo(Sale, em).update({ id }, { deliveryStatus: status, updatedBy: actor.userId });
      await audit(actor, sale, `delivery:${status}`, em, before, { deliveryStatus: status });
      return toSaleDto(await getSale(branchId, id, em));
    });
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const sale = await getSale(branchId, id, em);
      assertCanChange(actor, sale);
      if (await returnsService.hasReturns(em, sale.id)) {
        throw AppError.conflict('A sale with returns cannot be deleted; delete its returns first');
      }
      const before = toSaleDto(sale);
      await inventoryItemsService.release(em, actor, {
        where: { saleId: sale.id },
        from: ['sold'],
        to: 'in_stock',
        event: 'sale_deleted',
        ref: { type: REFERENCE, id: sale.id, label: sale.invoiceNo },
        clear: ['sale'],
      });
      await stockLedger.reverse(em, ledgerRef(actor, sale), `${sale.invoiceNo} removed`);
      for (const item of sale.items ?? []) await saleItems.softDelete(item, actor.userId, em);
      for (const payment of sale.payments ?? []) await salePayments.softDelete(payment, actor.userId, em);
      await sales.softDelete(sale, actor.userId, em);
      await audit(actor, sale, 'delete', em, before);
    });
  },

  async addPayment(
    actor: Actor,
    branchId: string,
    id: string,
    input: Omit<SalePaymentInput, 'proofIndex' | 'proofIndexes'>,
    proofs: Express.Multer.File[] = [],
  ) {
    if (proofs.length > 0 && input.method !== 'online')
      throw AppError.badRequest('Only online payments take a screenshot');
    if (proofs.length > MAX_PROOFS) throw AppError.badRequest(`Attach at most ${MAX_PROOFS} screenshots`);
    const existing = await getSale(branchId, id);
    assertCanChange(actor, existing);
    const uploaded = await uploadProofs(branchId, proofs);
    return withUploads(uploaded, () =>
      withTransaction(async (em) => {
        const sale = await getSale(branchId, id, em);
        const payment = await insertPayment(em, actor, sale, input, uploaded);
        await recompute(em, sale, { discountPercent: sale.discountPercent });
        await audit(actor, sale, 'add_payment', em, null, { paymentId: payment.id, amount: payment.amount });
        return toSaleDto(await getSale(branchId, id, em));
      }),
    );
  },

  async updatePayment(
    actor: Actor,
    branchId: string,
    id: string,
    paymentId: string,
    input: UpdateSalePaymentInput,
  ) {
    let removedProofs: string[] = [];
    const dto = await withTransaction(async (em) => {
      const sale = await getSale(branchId, id, em);
      assertCanChange(actor, sale);
      const payment = await salePayments.findOneBy(branchId, { id: paymentId, saleId: id }, em);
      if (!payment) throw AppError.notFound('Payment');
      if (input.accountSheetId) await assertAccountSheet(branchId, input.accountSheetId, em);
      const before = toSalePaymentDto(payment);
      Object.assign(payment, input, { updatedBy: actor.userId });
      if (payment.method === 'cash') {
        removedProofs = await dropProofs(em, actor, branchId, payment.id);
        Object.assign(payment, CASH_CLEARED);
      }
      await salePayments.save(payment, em);
      await recompute(em, sale, { discountPercent: sale.discountPercent });
      await audit(actor, sale, 'update_payment', em, before, input);
      return toSaleDto(await getSale(branchId, id, em));
    });
    if (removedProofs.length) await removeQuietly(BUCKETS.paymentProofs, removedProofs);
    return dto;
  },

  async addPaymentProofs(
    actor: Actor,
    branchId: string,
    id: string,
    paymentId: string,
    files: Express.Multer.File[],
  ) {
    if (files.length === 0) throw AppError.badRequest('Attach at least one screenshot');
    const sale = await getSale(branchId, id);
    assertCanChange(actor, sale);
    const payment = sale.payments?.find((p) => p.id === paymentId);
    if (!payment) throw AppError.notFound('Payment');
    if (payment.method !== 'online') throw AppError.badRequest('Only online payments take a screenshot');
    if (liveProofs(payment).length + files.length > MAX_PROOFS)
      throw AppError.badRequest(`A payment keeps at most ${MAX_PROOFS} screenshots`);
    const uploaded = await uploadProofs(branchId, files);
    return withUploads(uploaded, () =>
      withTransaction(async (em) => {
        await saveProofs(em, actor, payment, uploaded);
        await audit(actor, sale, 'add_payment_proof', em, null, { paymentId, files: uploaded.length });
        return toSaleDto(await getSale(branchId, id, em));
      }),
    );
  },

  async removePaymentProof(actor: Actor, branchId: string, id: string, paymentId: string, proofId: string) {
    const sale = await getSale(branchId, id);
    assertCanChange(actor, sale);
    const proof = await paymentProofs.findOneBy(branchId, { id: proofId, paymentId });
    if (!proof || !sale.payments?.some((p) => p.id === paymentId))
      throw AppError.notFound('Payment screenshot');
    const dto = await withTransaction(async (em) => {
      await paymentProofs.softDelete(proof, actor.userId, em);
      await audit(actor, sale, 'remove_payment_proof', em, { paymentId, proof: proof.originalName });
      return toSaleDto(await getSale(branchId, id, em));
    });
    await removeQuietly(BUCKETS.paymentProofs, [proof.filePath]);
    return dto;
  },

  async paymentProofUrl(branchId: string, id: string, paymentId: string, proofId?: string) {
    const sale = await getSale(branchId, id);
    const payment = sale.payments?.find((p) => p.id === paymentId);
    const proofs = payment ? liveProofs(payment) : [];
    const proof = proofId ? proofs.find((p) => p.id === proofId) : proofs[0];
    if (!proof) throw AppError.notFound('Payment screenshot');
    return createSignedUrl(BUCKETS.paymentProofs, proof.filePath);
  },

  async removePayment(actor: Actor, branchId: string, id: string, paymentId: string) {
    await withTransaction(async (em) => {
      const sale = await getSale(branchId, id, em);
      assertCanChange(actor, sale);
      const payment = await salePayments.findOneBy(branchId, { id: paymentId, saleId: id }, em);
      if (!payment) throw AppError.notFound('Payment');
      await salePayments.softDelete(payment, actor.userId, em);
      await recompute(em, sale, { discountPercent: sale.discountPercent });
      await audit(actor, sale, 'remove_payment', em, toSalePaymentDto(payment));
    });
  },
};
