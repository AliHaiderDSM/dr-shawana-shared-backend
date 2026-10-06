import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { type EntityManager } from 'typeorm';
import { AppDataSource } from '../../database/data-source';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { withTransaction } from '../../database/transaction';
import { toMoney, toQuantity, type DecimalInput } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { escapeLike, pageMeta } from '../../lib/pagination';
import { today } from '../../lib/validation';
import { auditService } from '../audit/audit.service';
import { type BatchListQuery, type WriteOffInput } from './product-batches.schemas';
import { ProductBatch } from './product-batch.entity';
import { inventoryItemsService } from './inventory-items.service';
import { stockLedger } from './stock-ledger';

export interface BatchDetails {
  batchNo: string;
  manufacturingDate?: string | null;
  expiryDate?: string | null;
  supplierId?: string | null;
  unitCost?: DecimalInput | null;
}

export const EXPIRING_SOON_DAYS = 90;
const WRITE_OFF_REFERENCE = 'stock_write_off';

const batches = branchScopedRepository(ProductBatch, 'b');

interface BatchRow {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  batchNo: string;
  manufacturingDate: string | null;
  expiryDate: string | null;
  supplierId: string | null;
  supplierName: string | null;
  unitCost: string | null;
  received: string;
  quantity: string;
  createdAt: string;
}

function statusOf(expiryDate: string | null, on: string) {
  if (!expiryDate) return 'no_expiry' as const;
  if (expiryDate < on) return 'expired' as const;
  const soon = new Date(`${on}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + EXPIRING_SOON_DAYS);
  return expiryDate <= soon.toISOString().slice(0, 10) ? ('expiring' as const) : ('ok' as const);
}

function toBatchDto(row: BatchRow, on = today()) {
  return {
    ...row,
    unitCost: row.unitCost === null ? null : toMoney(row.unitCost),
    received: toQuantity(row.received),
    quantity: toQuantity(row.quantity),
    status: statusOf(row.expiryDate, on),
  };
}

function mergeDate(
  batch: ProductBatch,
  key: 'manufacturingDate' | 'expiryDate',
  value: string | null | undefined,
  overwrite: boolean,
) {
  if (!value) return;
  if (batch[key] && batch[key] !== value && !overwrite) {
    const label = key === 'expiryDate' ? 'expiry' : 'manufacturing date';
    throw AppError.conflict(`Batch ${batch.batchNo} already has ${label} ${batch[key]}`);
  }
  batch[key] = value;
}

async function syncBatchDates(manager: EntityManager, batch: ProductBatch) {
  const dates = [batch.manufacturingDate, batch.expiryDate];
  await manager.query(
    `UPDATE product_batches c SET manufacturing_date = $3, expiry_date = $4, updated_at = now()
       FROM products p
      WHERE c.product_id = p.id AND p.origin_product_id = $1 AND c.batch_no = $2 AND c.deleted_at IS NULL`,
    [batch.productId, batch.batchNo, ...dates],
  );
  await manager.query(
    `UPDATE stock_ins s SET manufacturing_date = $3, expiry_date = $4
      WHERE s.deleted_at IS NULL AND s.batch_id IN (
        SELECT $1::uuid
        UNION
        SELECT c.id FROM product_batches c JOIN products p ON p.id = c.product_id
         WHERE p.origin_product_id = $2 AND c.batch_no = $5 AND c.deleted_at IS NULL)`,
    [batch.id, batch.productId, ...dates, batch.batchNo],
  );
}

const BATCH_SELECT = `
  SELECT b.id, b.product_id AS "productId", p.name AS "productName", p.unit, b.batch_no AS "batchNo",
         to_char(b.manufacturing_date, 'YYYY-MM-DD') AS "manufacturingDate",
         to_char(b.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
         b.supplier_id AS "supplierId", s.name AS "supplierName", b.unit_cost::text AS "unitCost",
         COALESCE(SUM(m.qty) FILTER (WHERE m.qty > 0 AND m.reversal_of_id IS NULL), 0)::text AS received,
         COALESCE(SUM(m.qty), 0)::text AS quantity, b.created_at AS "createdAt"
    FROM product_batches b
    JOIN products p ON p.id = b.product_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN stock_movements m ON m.batch_id = b.id`;

const BATCH_GROUP = 'GROUP BY b.id, p.name, p.unit, s.name';

export const productBatchesService = {
  async resolve(
    manager: EntityManager,
    actor: Actor,
    branchId: string,
    productId: string,
    details: BatchDetails,
    options: { overwrite?: boolean } = {},
  ) {
    const overwrite = options.overwrite ?? false;
    const batchNo = details.batchNo.trim();
    await manager.query('SELECT id FROM products WHERE id = $1 AND branch_id = $2 FOR NO KEY UPDATE', [
      productId,
      branchId,
    ]);
    const existing = await batches.findOneBy(branchId, { productId, batchNo }, manager);
    if (!existing) {
      return batches.create(
        branchId,
        actor.userId,
        {
          productId,
          batchNo,
          manufacturingDate: details.manufacturingDate ?? null,
          expiryDate: details.expiryDate ?? null,
          supplierId: details.supplierId ?? null,
          unitCost:
            details.unitCost === undefined || details.unitCost === null ? null : toMoney(details.unitCost),
        },
        manager,
      );
    }
    mergeDate(existing, 'manufacturingDate', details.manufacturingDate, overwrite);
    mergeDate(existing, 'expiryDate', details.expiryDate, overwrite);
    if (
      existing.manufacturingDate &&
      existing.expiryDate &&
      existing.expiryDate < existing.manufacturingDate
    ) {
      throw AppError.badRequest('Expiry date must be on or after the manufacturing date');
    }
    existing.supplierId ??= details.supplierId ?? null;
    if (existing.unitCost === null && details.unitCost !== undefined && details.unitCost !== null) {
      existing.unitCost = toMoney(details.unitCost);
    }
    existing.updatedBy = actor.userId;
    const saved = await batches.save(existing, manager);
    if (overwrite) await syncBatchDates(manager, saved);
    return saved;
  },

  async list(branchId: string, query: BatchListQuery) {
    const on = today();
    const params: unknown[] = [branchId];
    const where = ['b.branch_id = $1', 'b.deleted_at IS NULL'];
    if (query.productId) {
      params.push(query.productId);
      where.push(`b.product_id = $${params.length}`);
    }
    if (query.search) {
      params.push(`%${escapeLike(query.search)}%`);
      where.push(`(b.batch_no ILIKE $${params.length} OR p.name ILIKE $${params.length})`);
    }
    if (query.status) params.push(on);
    const onParam = `$${params.length}`;
    if (query.status === 'expired') where.push(`b.expiry_date < ${onParam}`);
    if (query.status === 'expiring') {
      where.push(`b.expiry_date >= ${onParam} AND b.expiry_date <= ${onParam}::date + ${EXPIRING_SOON_DAYS}`);
    }
    if (query.status === 'active') where.push(`(b.expiry_date IS NULL OR b.expiry_date >= ${onParam})`);
    const having = query.inStockOnly ? 'HAVING COALESCE(SUM(m.qty), 0) > 0' : '';

    const [{ total }] = (await AppDataSource.query(
      `SELECT COUNT(*)::int AS total FROM (${BATCH_SELECT} WHERE ${where.join(' AND ')} ${BATCH_GROUP} ${having}) t`,
      params,
    )) as [{ total: number }];
    const rows: BatchRow[] = await AppDataSource.query(
      `${BATCH_SELECT} WHERE ${where.join(' AND ')} ${BATCH_GROUP} ${having}
        ORDER BY b.expiry_date ASC NULLS LAST, p.name ASC, b.batch_no ASC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      params,
    );
    return { items: rows.map((r) => toBatchDto(r, on)), meta: pageMeta(query, total) };
  },

  async get(branchId: string, id: string, manager?: EntityManager) {
    const [row] = (await (manager ?? AppDataSource).query(
      `${BATCH_SELECT} WHERE b.branch_id = $1 AND b.id = $2 ${BATCH_GROUP}`,
      [branchId, id],
    )) as BatchRow[];
    if (!row) throw AppError.notFound('Batch');
    const movements: {
      id: string;
      date: string;
      type: string;
      qty: string;
      referenceType: string;
      referenceId: string;
      reference: string | null;
      note: string | null;
      createdAt: string;
    }[] = await (manager ?? AppDataSource).query(
      `SELECT m.id, to_char(m.date, 'YYYY-MM-DD') AS date, m.type, m.qty::text AS qty,
              m.reference_type AS "referenceType", m.reference_id AS "referenceId",
              COALESCE(s.invoice_no, r.return_no) AS reference, m.note, m.created_at AS "createdAt"
         FROM stock_movements m
         LEFT JOIN sales s ON m.reference_type = 'sale' AND s.id = m.reference_id
         LEFT JOIN sale_returns r ON m.reference_type = 'sale_return' AND r.id = m.reference_id
        WHERE m.branch_id = $1 AND m.batch_id = $2
        ORDER BY m.date ASC, m.created_at ASC`,
      [branchId, id],
    );
    return {
      ...toBatchDto(row),
      movements: movements.map((m) => ({ ...m, qty: toQuantity(m.qty) })),
    };
  },

  async writeOff(actor: Actor, branchId: string, id: string, input: WriteOffInput) {
    return withTransaction(async (em) => {
      const batch = await batches.findById(branchId, id, em);
      if (!batch) throw AppError.notFound('Batch');
      const referenceId = randomUUID();
      const date = input.date ?? today();
      const note = [`Write-off (${input.reason}) of batch ${batch.batchNo}`, input.note]
        .filter(Boolean)
        .join(': ');
      const ref = { branchId, referenceType: WRITE_OFF_REFERENCE, referenceId, actorId: actor.userId };
      const serials = input.serials ?? [];
      const tracked = await inventoryItemsService.trackedProducts(em, branchId, [batch.productId]);
      if (serials.length > 0) {
        if (tracked.size === 0) throw AppError.badRequest('This product is not tracked by label');
        if (!new Decimal(input.qty).equals(serials.length)) {
          throw AppError.unprocessable(`Scan ${input.qty} labels (${serials.length} scanned)`);
        }
        const pieces = await inventoryItemsService.take(em, actor, {
          branchId,
          serials,
          from: ['in_stock'],
          to: input.reason === 'expired' ? 'expired' : input.reason === 'damaged' ? 'damaged' : 'written_off',
          event:
            input.reason === 'expired' ? 'expired' : input.reason === 'damaged' ? 'damaged' : 'written_off',
          ref: { type: WRITE_OFF_REFERENCE, id: referenceId, label: input.reason },
          date,
          batchId: batch.id,
          note: input.note ?? null,
        });
        await stockLedger.apply(
          em,
          ref,
          inventoryItemsService.movements(pieces, -1, { type: 'adjustment', date, note }),
        );
      } else {
        if (tracked.size > 0) {
          const free = await inventoryItemsService.unlabelled(em, branchId, batch.productId, batch.id);
          if (free.lt(input.qty)) {
            throw AppError.unprocessable('Scan the label of every piece you write off');
          }
        }
        await stockLedger.apply(em, ref, [
          {
            productId: batch.productId,
            batchId: batch.id,
            type: 'adjustment',
            qty: new Decimal(input.qty).negated(),
            date,
            note,
          },
        ]);
      }
      const after = await this.get(branchId, id, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'write_off',
          entity: 'product_batch',
          entityId: id,
          after: { referenceId, qty: input.qty, reason: input.reason, note: input.note ?? null },
        },
        em,
      );
      return after;
    });
  },
};
