import type { DataSource, EntityManager } from 'typeorm';
import type { DumpTables } from './dump-reader';
import { amount, dateOf, deterministicId, text, timestampOf } from './possoft-values';

export const POSSOFT_MATERIAL_TABLES = [
  'material_categories',
  'materials',
  'materials_details',
  'materials_out',
  'materials_out_details',
];

export interface MaterialSummary {
  branch: string;
  categories: number;
  materials: number;
  receipts: number;
  batches: number;
  batchItems: number;
  skipped: {
    materialsNoCategory: number;
    receiptsNoMaterial: number;
    receiptsNoQty: number;
    outNoMaterial: number;
    outNoQty: number;
    outNoBatch: number;
  };
}

class DryRunRollback extends Error {}

async function insertIgnore(em: EntityManager, table: string, columns: string[], rows: unknown[][]) {
  if (rows.length === 0) return;
  const perChunk = Math.max(1, Math.floor(60000 / columns.length));
  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const marks = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${marks.join(', ')})`;
    });
    await em.query(
      `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')})
       VALUES ${tuples.join(', ')} ON CONFLICT (id) DO NOTHING`,
      params,
    );
  }
}

const placeOf = (value: string | null | undefined) => (/pharm/i.test(text(value)) ? 'pharmacy' : 'falcon');

const activeMat = (row: { close?: string | null; status?: string | null }) =>
  text(row.close) === '1' && text(row.status) === '1';

export async function importPossoftMaterials(
  source: DataSource,
  dump: DumpTables,
  options: { dryRun?: boolean; branchCode?: string } = {},
): Promise<MaterialSummary> {
  const rows = (table: string) => dump.get(table) ?? [];
  const summary: MaterialSummary = {
    branch: '',
    categories: 0,
    materials: 0,
    receipts: 0,
    batches: 0,
    batchItems: 0,
    skipped: {
      materialsNoCategory: 0,
      receiptsNoMaterial: 0,
      receiptsNoQty: 0,
      outNoMaterial: 0,
      outNoQty: 0,
      outNoBatch: 0,
    },
  };

  try {
    await source.transaction(async (em) => {
      const [branch] = (
        options.branchCode
          ? ((await em.query(`SELECT id, code FROM branches WHERE code = $1 AND deleted_at IS NULL LIMIT 1`, [
              options.branchCode,
            ])) as { id: string; code: string }[])
          : ((await em.query(
              `SELECT id, code FROM branches WHERE kind = 'warehouse' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
            )) as { id: string; code: string }[])
      );
      if (!branch)
        throw new Error(
          options.branchCode
            ? `No branch with code ${options.branchCode} exists.`
            : 'No warehouse (MAINWH) branch exists. Run the sales import or seed first.',
        );
      const branchId = branch.id;
      summary.branch = branch.code;

      await em.query(`ALTER TABLE material_movements DISABLE TRIGGER "TRG_material_movements_append_only"`);
      try {
        await em.query(`DELETE FROM material_movements WHERE branch_id = $1`, [branchId]);
      } finally {
        await em.query(`ALTER TABLE material_movements ENABLE TRIGGER "TRG_material_movements_append_only"`);
      }
      await em.query(
        `DELETE FROM material_batch_items WHERE batch_id IN (SELECT id FROM material_batches WHERE branch_id = $1)`,
        [branchId],
      );
      await em.query(`DELETE FROM material_batches WHERE branch_id = $1`, [branchId]);
      await em.query(`DELETE FROM material_receipts WHERE branch_id = $1`, [branchId]);
      await em.query(`DELETE FROM materials WHERE branch_id = $1`, [branchId]);
      await em.query(`DELETE FROM material_categories WHERE branch_id = $1`, [branchId]);

      const categoryMap = new Map<string, string>();
      const categoryRows: unknown[][] = [];
      for (const cat of rows('material_categories')) {
        const posId = text(cat.mat_cat_id);
        const id = deterministicId(`material_category:${branchId}:${posId}`);
        categoryMap.set(posId, id);
        categoryRows.push([
          id,
          branchId,
          text(cat.mat_cat_name).slice(0, 150) || `posSoft category ${posId}`,
          activeMat(cat) ? null : (timestampOf(cat.del_date) ?? new Date().toISOString()),
        ]);
      }
      await insertIgnore(em, 'material_categories', ['id', 'branch_id', 'name', 'deleted_at'], categoryRows);
      summary.categories = categoryRows.length;

      const materialMap = new Map<string, string>();
      const materialRows: unknown[][] = [];
      for (const mat of rows('materials')) {
        const posId = text(mat.mat_id);
        const categoryId = categoryMap.get(text(mat.mat_cat_id));
        if (!categoryId) {
          summary.skipped.materialsNoCategory += 1;
          continue;
        }
        const id = deterministicId(`material:${branchId}:${posId}`);
        materialMap.set(posId, id);
        materialRows.push([
          id,
          branchId,
          text(mat.mat_name).slice(0, 200) || `posSoft material ${posId}`,
          categoryId,
          'g',
          amount(mat.mat_minimum).toFixed(3),
          amount(mat.mat_bear_minimum).toFixed(3),
          activeMat(mat) ? null : (timestampOf(mat.del_date) ?? new Date().toISOString()),
        ]);
      }
      await insertIgnore(
        em,
        'materials',
        ['id', 'branch_id', 'name', 'category_id', 'unit', 'minimum', 'bare_minimum', 'deleted_at'],
        materialRows,
      );
      summary.materials = materialRows.length;

      const receiptRows: unknown[][] = [];
      const inMovementRows: unknown[][] = [];
      for (const det of rows('materials_details')) {
        if (!activeMat(det)) continue;
        const materialId = materialMap.get(text(det.material_id));
        if (!materialId) {
          summary.skipped.receiptsNoMaterial += 1;
          continue;
        }
        const qty = amount(det.mat_det_quantity);
        if (qty.lte(0)) {
          summary.skipped.receiptsNoQty += 1;
          continue;
        }
        const posId = text(det.mat_det_id);
        const receiptId = deterministicId(`material_receipt:${posId}`);
        const date = dateOf(det.mat_det_date, det.crt_date) ?? new Date().toISOString().slice(0, 10);
        const note = text(det.mat_det_note) || null;
        receiptRows.push([
          receiptId,
          branchId,
          materialId,
          date,
          qty.toFixed(3),
          placeOf(det.mat_det_place),
          note,
        ]);
        inMovementRows.push([
          deterministicId(`material_in:${posId}`),
          branchId,
          materialId,
          'store',
          'material_in',
          qty.toFixed(3),
          'material_receipt',
          receiptId,
          date,
          note,
        ]);
      }
      await insertIgnore(
        em,
        'material_receipts',
        ['id', 'branch_id', 'material_id', 'date', 'quantity', 'place', 'note'],
        receiptRows,
      );
      await insertIgnore(
        em,
        'material_movements',
        ['id', 'branch_id', 'material_id', 'location', 'type', 'qty', 'reference_type', 'reference_id', 'date', 'note'],
        inMovementRows,
      );
      summary.receipts = receiptRows.length;

      const batchByNo = new Map<string, { id: string; date: string; note: string | null }>();
      const headerBatch = new Map<string, string>();
      for (const head of rows('materials_out')) {
        if (!activeMat(head)) continue;
        const batchNo = text(head.mat_out_batch).slice(0, 100) || `posSoft out ${text(head.mat_out_id)}`;
        const id = deterministicId(`material_batch:${branchId}:${batchNo.toLowerCase()}`);
        headerBatch.set(text(head.mat_out_id), batchNo);
        const date = dateOf(head.mat_out_date, head.crt_date) ?? new Date().toISOString().slice(0, 10);
        const existing = batchByNo.get(batchNo);
        if (!existing || date < existing.date) {
          batchByNo.set(batchNo, { id, date, note: text(head.mat_out_note) || existing?.note || null });
        }
      }

      const itemQty = new Map<string, { batchNo: string; materialId: string; qty: ReturnType<typeof amount> }>();
      for (const det of rows('materials_out_details')) {
        if (!activeMat(det) || !/pharmacy lab/i.test(text(det.mat_out_status))) continue;
        const batchNo = headerBatch.get(text(det.material_out_id));
        if (!batchNo) {
          summary.skipped.outNoBatch += 1;
          continue;
        }
        const materialId = materialMap.get(text(det.mat_out_mat_id));
        if (!materialId) {
          summary.skipped.outNoMaterial += 1;
          continue;
        }
        const qty = amount(det.mat_out_quantity);
        if (qty.lte(0)) {
          summary.skipped.outNoQty += 1;
          continue;
        }
        const key = `${batchNo}:${materialId}`;
        const current = itemQty.get(key);
        itemQty.set(key, { batchNo, materialId, qty: (current?.qty ?? amount('0')).plus(qty) });
      }

      const batchRows: unknown[][] = [];
      for (const [batchNo, b] of batchByNo) {
        batchRows.push([b.id, branchId, batchNo, 'pharmacy_lab', b.date, b.note]);
      }

      const itemRows: unknown[][] = [];
      const outMovementRows: unknown[][] = [];
      let position = 0;
      for (const { batchNo, materialId, qty } of itemQty.values()) {
        const batch = batchByNo.get(batchNo)!;
        itemRows.push([
          deterministicId(`material_batch_item:${batch.id}:${materialId}`),
          batch.id,
          materialId,
          qty.toFixed(3),
          (position += 1),
        ]);
        outMovementRows.push([
          deterministicId(`material_out_store:${batch.id}:${materialId}`),
          branchId,
          materialId,
          'store',
          'material_out_to_lab',
          qty.negated().toFixed(3),
          'material_batch',
          batch.id,
          batch.date,
          null,
        ]);
        outMovementRows.push([
          deterministicId(`material_out_lab:${batch.id}:${materialId}`),
          branchId,
          materialId,
          'lab',
          'material_out_to_lab',
          qty.toFixed(3),
          'material_batch',
          batch.id,
          batch.date,
          null,
        ]);
      }
      await insertIgnore(
        em,
        'material_batches',
        ['id', 'branch_id', 'batch_no', 'stage', 'date', 'note'],
        batchRows,
      );
      await insertIgnore(
        em,
        'material_batch_items',
        ['id', 'batch_id', 'material_id', 'qty', 'position'],
        itemRows,
      );
      await insertIgnore(
        em,
        'material_movements',
        ['id', 'branch_id', 'material_id', 'location', 'type', 'qty', 'reference_type', 'reference_id', 'date', 'note'],
        outMovementRows,
      );
      summary.batches = batchRows.length;
      summary.batchItems = itemRows.length;

      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }

  return summary;
}
