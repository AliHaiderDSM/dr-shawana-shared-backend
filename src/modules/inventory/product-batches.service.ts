import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { type EntityManager } from 'typeorm';
import { AppDataSource } from '../../database/data-source';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo, withTransaction } from '../../database/transaction';
import { toMoney, toQuantity, type DecimalInput } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { escapeLike, pageMeta } from '../../lib/pagination';
import { today } from '../../lib/validation';
import { auditService } from '../audit/audit.service';
import { type BatchListQuery, type WriteOffInput, type WriteOffListQuery } from './product-batches.schemas';
import { StockWriteOff } from './stock-write-off.entity';
import { nextSequence } from '../sequences/sequences';
import { ProductBatch } from './product-batch.entity';
import { inventoryItemsService, normalizeSerials } from './inventory-items.service';
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

  async writeOffs(branchId: string | null, query: WriteOffListQuery) {
    const params: unknown[] = [];
    const where = ['w.deleted_at IS NULL'];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', () => `$${params.length}`));
    };
    if (branchId) add('w.branch_id = ?', branchId);
    if (query.reason) add('w.reason = ?', query.reason);
    if (query.status) add('w.status = ?', query.status);
    if (query.from) add('w.date >= ?', query.from);
    if (query.to) add('w.date <= ?', query.to);
    if (query.search) {
      params.push(`%${escapeLike(query.search)}%`);
      where.push(
        `(p.name ILIKE $${params.length} OR w.write_off_no ILIKE $${params.length} OR b.batch_no ILIKE $${params.length})`,
      );
    }
    const rows: (Record<string, unknown> & { id: string; qty: string })[] = await AppDataSource.query(
      `SELECT w.id, w.status, w.decision_note AS "decisionNote", w.decided_at AS "decidedAt",
              CASE WHEN d.id IS NULL THEN NULL ELSE json_build_object(
                'id', d.id, 'name', TRIM(CONCAT(d.first_name, ' ', d.last_name)), 'role', d.role) END AS "decidedBy",
              w.write_off_no AS "writeOffNo", to_char(w.date, 'YYYY-MM-DD') AS date, w.reason, w.note,
              w.qty::text AS qty, w.product_id AS "productId", p.name AS "productName", p.unit,
              w.batch_id AS "batchId", b.batch_no AS "batchNo", to_char(b.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
              json_build_object('id', br.id, 'name', br.name, 'code', br.code, 'kind', br.kind) AS branch,
              CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object(
                'id', s.id, 'name', TRIM(CONCAT(s.first_name, ' ', s.last_name)), 'role', s.role) END AS "createdBy",
              CASE WHEN cardinality(w.serials) > 0 THEN w.serials ELSE
              COALESCE((SELECT array_agg(DISTINCT i.serial) FROM inventory_item_events e
                          JOIN inventory_items i ON i.id = e.item_id WHERE e.reference_id = w.id), '{}') END AS serials,
              w.created_at AS "createdAt"
         FROM stock_write_offs w
         JOIN branches br ON br.id = w.branch_id
         JOIN products p ON p.id = w.product_id
         LEFT JOIN product_batches b ON b.id = w.batch_id
         LEFT JOIN staff_profiles s ON s.id = w.created_by
         LEFT JOIN staff_profiles d ON d.id = w.decided_by
        WHERE ${where.join(' AND ')}
        ORDER BY (w.status = 'pending') DESC, w.date DESC, w.created_at DESC
        LIMIT 500`,
      params,
    );
    return rows.map((r) => ({ ...r, qty: toQuantity(r.qty) }));
  },

  async writeOff(actor: Actor, branchId: string, id: string, input: WriteOffInput) {
    return withTransaction(async (em) => {
      await requestWriteOff(em, actor, branchId, id, input);
      return this.get(branchId, id, em);
    });
  },

  async reportWriteOffs(actor: Actor, branchId: string, items: (WriteOffInput & { batchId: string })[]) {
    const ids = await withTransaction(async (em) => {
      const created: string[] = [];
      for (const [index, item] of items.entries()) {
        try {
          created.push((await requestWriteOff(em, actor, branchId, item.batchId, item)).id);
        } catch (err) {
          if (err instanceof AppError) {
            throw new AppError(err.status, err.code, `Line ${index + 1}: ${err.message}`, err.details);
          }
          throw err;
        }
      }
      return created;
    });
    return (await this.writeOffs(branchId, {})).filter((w) => ids.includes(w.id as string));
  },

  async pendingWriteOffs() {
    const [row] = (await AppDataSource.query(
      `SELECT COUNT(*)::int AS pending FROM stock_write_offs WHERE status = 'pending' AND deleted_at IS NULL`,
    )) as { pending: number }[];
    return { pending: row?.pending ?? 0 };
  },

  async decideWriteOff(actor: Actor, id: string, approve: boolean, note: string | null | undefined) {
    await withTransaction(async (em) => {
      const record = await repo(StockWriteOff, em)
        .createQueryBuilder('w')
        .setLock('pessimistic_write')
        .where('w.id = :id AND w.deletedAt IS NULL', { id })
        .getOne();
      if (!record) throw AppError.notFound('Write-off');
      if (record.status !== 'pending')
        throw AppError.conflict(`${record.writeOffNo} is already ${record.status}`);
      if (approve) {
        await applyWriteOff(em, actor, record);
      } else if (record.serials.length) {
        await inventoryItemsService.take(em, actor, {
          branchId: record.branchId,
          serials: record.serials,
          from: ['quarantined'],
          to: 'in_stock',
          event: 'restocked',
          ref: { type: WRITE_OFF_REFERENCE, id: record.id, label: `${record.writeOffNo} rejected` },
          date: today(),
        });
      }
      Object.assign(record, {
        status: approve ? 'approved' : 'rejected',
        decidedBy: actor.userId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
        updatedBy: actor.userId,
      });
      await repo(StockWriteOff, em).save(record);
      await auditService.record(
        {
          actor,
          branchId: record.branchId,
          action: approve ? 'approve_write_off' : 'reject_write_off',
          entity: 'stock_write_off',
          entityId: record.id,
          after: { writeOffNo: record.writeOffNo, status: record.status, note: note ?? null },
        },
        em,
      );
    });
    return (await this.writeOffs(null, {})).find((w) => w.id === id) ?? null;
  },
};

const finalStatus = (reason: WriteOffInput['reason']) =>
  reason === 'expired' ? 'expired' : reason === 'damaged' ? 'damaged' : 'written_off';

async function batchOnHand(manager: EntityManager, branchId: string, batchId: string) {
  const [row] = (await manager.query(
    `SELECT COALESCE(SUM(qty), 0)::text AS qty FROM stock_movements WHERE branch_id = $1 AND batch_id = $2`,
    [branchId, batchId],
  )) as { qty: string }[];
  return new Decimal(row?.qty ?? 0);
}

async function waitingUnlabelled(manager: EntityManager, batchId: string, excludeId?: string) {
  const [row] = (await manager.query(
    `SELECT COALESCE(SUM(qty), 0)::text AS qty FROM stock_write_offs
      WHERE batch_id = $1 AND status = 'pending' AND deleted_at IS NULL AND cardinality(serials) = 0
        AND ($2::uuid IS NULL OR id <> $2)`,
    [batchId, excludeId ?? null],
  )) as { qty: string }[];
  return new Decimal(row?.qty ?? 0);
}

async function requestWriteOff(
  em: EntityManager,
  actor: Actor,
  branchId: string,
  batchId: string,
  input: WriteOffInput,
) {
  const batch = await batches.findById(branchId, batchId, em);
  if (!batch) throw AppError.notFound('Batch');
  const serials = input.serials ?? [];
  const tracked = await inventoryItemsService.trackedProducts(em, branchId, [batch.productId]);
  if (serials.length > 0) {
    if (tracked.size === 0) throw AppError.badRequest('This product is not tracked by label');
    if (!new Decimal(input.qty).equals(serials.length)) {
      throw AppError.unprocessable(`Scan ${input.qty} labels (${serials.length} scanned)`);
    }
  } else {
    if (tracked.size > 0) {
      const free = await inventoryItemsService.unlabelled(em, branchId, batch.productId, batch.id);
      if (free.minus(await waitingUnlabelled(em, batch.id)).lt(input.qty)) {
        throw AppError.unprocessable('Scan the label of every piece you write off');
      }
    }
    const left = (await batchOnHand(em, branchId, batch.id)).minus(await waitingUnlabelled(em, batch.id));
    if (left.lt(input.qty)) {
      throw AppError.unprocessable(
        `Batch ${batch.batchNo} has only ${toQuantity(Decimal.max(left, 0)).toString()} left to write off`,
      );
    }
  }
  const id = randomUUID();
  const date = input.date ?? today();
  const [branch] = (await em.query('SELECT code FROM branches WHERE id = $1', [branchId])) as {
    code: string;
  }[];
  const seq = await nextSequence(em, branchId, 'write_off');
  const writeOffs = repo(StockWriteOff, em);
  const record = await writeOffs.save(
    writeOffs.create({
      id,
      branchId,
      writeOffNo: `${branch?.code ?? 'WO'}-WO-${String(seq).padStart(6, '0')}`,
      productId: batch.productId,
      batchId: batch.id,
      qty: new Decimal(input.qty),
      reason: input.reason,
      note: input.note ?? null,
      date,
      status: 'pending',
      serials: normalizeSerials(serials),
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }),
  );
  if (serials.length > 0) {
    await inventoryItemsService.take(em, actor, {
      branchId,
      serials,
      from: ['in_stock'],
      to: 'quarantined',
      event: 'quarantined',
      ref: { type: WRITE_OFF_REFERENCE, id, label: `${record.writeOffNo} waiting for approval` },
      date,
      batchId: batch.id,
      note: input.note ?? null,
    });
  }
  if (actor.isSuperAdmin) {
    await applyWriteOff(em, actor, record);
    Object.assign(record, { status: 'approved', decidedBy: actor.userId, decidedAt: new Date() });
    await writeOffs.save(record);
  }
  await auditService.record(
    {
      actor,
      branchId,
      action: actor.isSuperAdmin ? 'write_off' : 'request_write_off',
      entity: 'stock_write_off',
      entityId: id,
      after: {
        writeOffNo: record.writeOffNo,
        batchNo: batch.batchNo,
        qty: input.qty,
        reason: input.reason,
        note: input.note ?? null,
        status: record.status,
      },
    },
    em,
  );
  return record;
}

async function applyWriteOff(em: EntityManager, actor: Actor, record: StockWriteOff) {
  const batch = record.batchId ? await batches.findById(record.branchId, record.batchId, em) : null;
  const note = [
    `${record.writeOffNo}: write-off (${record.reason})${batch ? ` of batch ${batch.batchNo}` : ''}`,
    record.note,
  ]
    .filter(Boolean)
    .join(': ');
  const ref = {
    branchId: record.branchId,
    referenceType: WRITE_OFF_REFERENCE,
    referenceId: record.id,
    actorId: actor.userId,
  };
  const date = today() < record.date ? record.date : today();
  if (record.serials.length > 0) {
    const pieces = await inventoryItemsService.take(em, actor, {
      branchId: record.branchId,
      serials: record.serials,
      from: ['quarantined'],
      to: finalStatus(record.reason),
      event: finalStatus(record.reason),
      ref: { type: WRITE_OFF_REFERENCE, id: record.id, label: record.reason },
      date,
      ...(record.batchId ? { batchId: record.batchId } : {}),
      note: record.note,
    });
    await stockLedger.apply(
      em,
      ref,
      inventoryItemsService.movements(pieces, -1, { type: 'adjustment', date, note }),
    );
    return;
  }
  if (record.batchId) {
    const left = (await batchOnHand(em, record.branchId, record.batchId)).minus(
      await waitingUnlabelled(em, record.batchId, record.id),
    );
    if (left.lt(record.qty)) {
      throw AppError.unprocessable(
        `${record.writeOffNo}: the batch has only ${toQuantity(Decimal.max(left, 0)).toString()} left`,
      );
    }
  }
  await stockLedger.apply(em, ref, [
    {
      productId: record.productId,
      batchId: record.batchId,
      type: 'adjustment',
      qty: new Decimal(record.qty).negated(),
      date,
      note,
    },
  ]);
}
