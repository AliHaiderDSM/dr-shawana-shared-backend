import Decimal from 'decimal.js';
import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { type TakenItem } from './inventory-items.service';
import { productBatchesService } from './product-batches.service';
import { StockIn } from './stock-in.entity';
import { stockLedger } from './stock-ledger';
import { type StockOut } from './stock-out.entity';

const stockIns = branchScopedRepository(StockIn, 'si');

interface BranchRow {
  id: string;
  name: string;
  kind: 'branch' | 'warehouse';
  status: string;
}

async function branchOf(manager: EntityManager, id: string) {
  const [row] = (await manager.query(
    'SELECT id, name, kind, status FROM branches WHERE id = $1 AND deleted_at IS NULL',
    [id],
  )) as BranchRow[];
  return row ?? null;
}

async function categoryIn(manager: EntityManager, actor: Actor, branchId: string, sourceCategoryId: string) {
  const [source] = (await manager.query('SELECT name FROM categories WHERE id = $1', [sourceCategoryId])) as {
    name: string;
  }[];
  const name = source?.name ?? 'General';
  const [found] = (await manager.query(
    'SELECT id FROM categories WHERE branch_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL',
    [branchId, name],
  )) as { id: string }[];
  if (found) return found.id;
  const [created] = (await manager.query(
    'INSERT INTO categories (branch_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
    [branchId, name, actor.userId],
  )) as { id: string }[];
  return created!.id;
}

async function productIn(manager: EntityManager, actor: Actor, branchId: string, sourceProductId: string) {
  const [linked] = (await manager.query(
    'SELECT id FROM products WHERE branch_id = $1 AND origin_product_id = $2 AND deleted_at IS NULL',
    [branchId, sourceProductId],
  )) as { id: string }[];
  if (linked) return linked.id;
  const [source] = (await manager.query('SELECT * FROM products WHERE id = $1', [sourceProductId])) as Record<
    string,
    unknown
  >[];
  if (!source) throw AppError.notFound('Product');
  const [sameName] = (await manager.query(
    `SELECT id FROM products WHERE branch_id = $1 AND lower(name) = lower($2)
        AND origin_product_id IS NULL AND deleted_at IS NULL LIMIT 1`,
    [branchId, source.name],
  )) as { id: string }[];
  if (sameName) {
    await manager.query('UPDATE products SET origin_product_id = $2 WHERE id = $1', [
      sameName.id,
      sourceProductId,
    ]);
    return sameName.id;
  }
  const categoryId = await categoryIn(manager, actor, branchId, source.category_id as string);
  const free = async (column: 'sku' | 'barcode') => {
    if (!source[column]) return null;
    const [taken] = (await manager.query(
      `SELECT 1 FROM products WHERE branch_id = $1 AND ${column} = $2 AND deleted_at IS NULL`,
      [branchId, source[column]],
    )) as unknown[];
    return taken ? null : source[column];
  };
  const [created] = (await manager.query(
    `INSERT INTO products (branch_id, name, category_id, sku, barcode, batch_no, size_grams, image_path, unit,
                           low_stock_threshold, sale_price, status, origin_product_id, created_by, size_unit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12, $13, $14) RETURNING id`,
    [
      branchId,
      source.name,
      categoryId,
      await free('sku'),
      await free('barcode'),
      source.batch_no,
      source.size_grams,
      source.image_path,
      source.unit,
      source.low_stock_threshold,
      source.sale_price,
      sourceProductId,
      actor.userId,
      source.size_unit,
    ],
  )) as { id: string }[];
  return created!.id;
}

async function batchIn(
  manager: EntityManager,
  actor: Actor,
  branchId: string,
  productId: string,
  sourceBatchId: string | null,
) {
  if (!sourceBatchId) return null;
  const [source] = (await manager.query(
    `SELECT batch_no AS "batchNo", to_char(manufacturing_date, 'YYYY-MM-DD') AS "manufacturingDate",
            to_char(expiry_date, 'YYYY-MM-DD') AS "expiryDate", unit_cost::text AS "unitCost"
       FROM product_batches WHERE id = $1`,
    [sourceBatchId],
  )) as {
    batchNo: string;
    manufacturingDate: string | null;
    expiryDate: string | null;
    unitCost: string | null;
  }[];
  if (!source) return null;
  return productBatchesService.resolve(manager, actor, branchId, productId, source);
}

export const transfersService = {
  async assertSendsFromWarehouse(manager: EntityManager, branchId: string) {
    const [row] = (await manager.query(
      `SELECT b.kind,
              EXISTS (SELECT 1 FROM branches w WHERE w.kind = 'warehouse' AND w.deleted_at IS NULL) AS "hasWarehouse"
         FROM branches b WHERE b.id = $1`,
      [branchId],
    )) as { kind: string; hasWarehouse: boolean }[];
    if (row?.kind === 'branch' && row.hasWarehouse) {
      throw AppError.conflict('Branches do not send stock out. Only the Super Admin stock transfers stock.');
    }
  },

  async assertReceivesFromWarehouse(manager: EntityManager, branchId: string) {
    const [row] = (await manager.query(
      `SELECT b.kind,
              EXISTS (SELECT 1 FROM branches w WHERE w.kind = 'warehouse' AND w.deleted_at IS NULL) AS "hasWarehouse"
         FROM branches b WHERE b.id = $1`,
      [branchId],
    )) as { kind: string; hasWarehouse: boolean }[];
    if (row?.kind === 'branch' && row.hasWarehouse) {
      throw AppError.conflict(
        'Branches get their stock from the Super Admin stock. Ask the Super Admin to transfer it.',
      );
    }
  },

  async assertRoute(manager: EntityManager, fromBranchId: string, toBranchId: string) {
    const from = await branchOf(manager, fromBranchId);
    if (from?.kind !== 'warehouse') {
      throw AppError.badRequest('Stock is transferred to branches from the Super Admin stock only');
    }
    const to = await branchOf(manager, toBranchId);
    if (!to || to.kind !== 'branch') throw AppError.badRequest('Choose a branch to transfer to');
    if (to.status !== 'active') throw AppError.badRequest(`${to.name} is inactive`);
    return to;
  },

  async receive(
    manager: EntityManager,
    actor: Actor,
    stockOut: StockOut,
    toBranch: { id: string; name: string },
    pieces: TakenItem[],
  ) {
    const productId = await productIn(manager, actor, toBranch.id, stockOut.productId);
    const movements = await stockLedger.movementsFor(manager, stockOut.branchId, 'stock_out', [stockOut.id]);
    const byBatch = new Map<string | null, Decimal>();
    for (const m of movements) byBatch.set(m.batchId, (byBatch.get(m.batchId) ?? new Decimal(0)).plus(m.qty));
    const received: StockIn[] = [];
    for (const [sourceBatchId, qty] of byBatch) {
      if (!qty.isNegative()) continue;
      const batch = await batchIn(manager, actor, toBranch.id, productId, sourceBatchId);
      const stockIn = await stockIns.create(
        toBranch.id,
        actor.userId,
        {
          productId,
          supplierId: null,
          date: stockOut.date,
          qty: qty.negated(),
          batch: batch?.batchNo ?? null,
          batchId: batch?.id ?? null,
          manufacturingDate: batch?.manufacturingDate ?? null,
          expiryDate: batch?.expiryDate ?? null,
          unitCost: batch?.unitCost ?? null,
          note: ['From Super Admin', stockOut.note].filter(Boolean).join(' · '),
          transferOutId: stockOut.id,
        },
        manager,
      );
      await stockLedger.apply(
        manager,
        { branchId: toBranch.id, referenceType: 'stock_in', referenceId: stockIn.id, actorId: actor.userId },
        [
          {
            productId,
            batchId: batch?.id ?? null,
            type: 'stock_in',
            qty: qty.negated(),
            date: stockOut.date,
            note: 'From Super Admin',
          },
        ],
      );
      const moving = pieces.filter((p) => p.batchId === sourceBatchId).map((p) => p.id);
      if (moving.length > 0) {
        await manager.query(
          `UPDATE inventory_items SET branch_id = $2, product_id = $3, batch_id = $4, status = 'in_stock',
                  updated_by = $5, updated_at = now()
            WHERE id = ANY($1)`,
          [moving, toBranch.id, productId, batch?.id ?? null, actor.userId],
        );
        await manager.query(
          `INSERT INTO inventory_item_events (item_id, branch_id, type, reference_type, reference_id, reference_label, created_by, created_at)
           SELECT id, branch_id, 'received', 'stock_in', $2, 'From Super Admin', $3, clock_timestamp() FROM inventory_items WHERE id = ANY($1)`,
          [moving, stockIn.id, actor.userId],
        );
        await manager.query('UPDATE products SET track_serials = true WHERE id = $1', [productId]);
      }
      received.push(stockIn);
    }
    return received;
  },

  async undo(manager: EntityManager, actor: Actor, stockOut: StockOut) {
    if (!stockOut.toBranchId) return;
    const received = await stockIns
      .query(stockOut.toBranchId, manager)
      .andWhere('si.transferOutId = :id', { id: stockOut.id })
      .getMany();
    const pieces: { id: string; status: string; branchId: string; batchNo: string | null }[] =
      await manager.query(
        `SELECT i.id, i.status, i.branch_id AS "branchId", b.batch_no AS "batchNo"
         FROM inventory_items i LEFT JOIN product_batches b ON b.id = i.batch_id
        WHERE i.stock_out_id = $1 FOR UPDATE OF i`,
        [stockOut.id],
      );
    if (pieces.some((p) => p.status !== 'in_stock' || p.branchId !== stockOut.toBranchId)) {
      throw AppError.conflict('The branch already sold or moved some of these pieces');
    }
    for (const stockIn of received) {
      await stockLedger.reverse(
        manager,
        {
          branchId: stockIn.branchId,
          referenceType: 'stock_in',
          referenceId: stockIn.id,
          actorId: actor.userId,
        },
        'Transfer cancelled',
      );
      await stockIns.softDelete(stockIn, actor.userId, manager);
    }
    for (const piece of pieces) {
      const [batch] = (await manager.query(
        'SELECT id FROM product_batches WHERE product_id = $1 AND batch_no = $2',
        [stockOut.productId, piece.batchNo],
      )) as { id: string }[];
      await manager.query(
        `UPDATE inventory_items SET branch_id = $2, product_id = $3, batch_id = $4, status = 'dispatched',
                updated_by = $5, updated_at = now() WHERE id = $1`,
        [piece.id, stockOut.branchId, stockOut.productId, batch?.id ?? null, actor.userId],
      );
    }
  },

  async isTransferIn(manager: EntityManager, stockInId: string) {
    const [row] = (await manager.query(
      'SELECT transfer_out_id AS "transferOutId" FROM stock_ins WHERE id = $1',
      [stockInId],
    )) as { transferOutId: string | null }[];
    return Boolean(row?.transferOutId);
  },
};
