import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../../database/data-source';
import { manufacturingReportsService } from '../manufacturing/manufacturing-reports.service';
import type { MaterialReportQuery } from '../manufacturing/manufacturing.schemas';
import { readDump } from './dump-reader';
import { POSSOFT_MATERIAL_TABLES, importPossoftMaterials } from './import-materials';

function table(name: string, columns: string[], rows: (string | number)[][]): string {
  const create = `CREATE TABLE \`${name}\` (\n${columns.map((c) => `  \`${c}\` text`).join(',\n')}\n) ENGINE=InnoDB;`;
  const values = rows
    .map(
      (row) =>
        `(${row.map((v) => (typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`)).join(',')})`,
    )
    .join(',\n');
  return `${create}\nINSERT INTO \`${name}\` VALUES\n${values};\n`;
}

const DUMP = [
  table(
    'material_categories',
    ['mat_cat_id', 'mat_cat_name', 'close', 'status', 'crt_date', 'del_date'],
    [
      [1, 'API', 1, 1, '2026-06-08 11:15:55', '2026-06-08 11:15:55'],
      [2, 'Excepients', 1, 1, '2026-06-09 10:56:36', '2026-06-09 10:56:36'],
    ],
  ),
  table(
    'materials',
    ['mat_id', 'mat_name', 'mat_cat_id', 'mat_minimum', 'mat_bear_minimum', 'close', 'status', 'crt_date', 'del_date'],
    [
      [1, 'Estradiol', 1, '2500', '1000', 1, 1, '2026-06-08 11:16:11', '2026-06-08 11:16:11'],
      [2, 'Allantoin', 2, '248', '124', 1, 1, '2026-06-09 11:45:24', '2026-06-09 11:45:24'],
      [3, 'Old Material', 1, '', '', 0, 1, '2026-06-01 10:00:00', '2026-06-02 10:00:00'],
    ],
  ),
  table(
    'materials_details',
    ['mat_det_id', 'material_id', 'mat_det_date', 'mat_det_quantity', 'mat_det_note', 'mat_det_place', 'close', 'status', 'crt_date'],
    [
      [1, 1, '2026-06-08', '10000', '', '', 1, 1, '2026-06-08 11:16:11'],
      [2, 2, '2026-06-09', '500', '', '', 1, 1, '2026-06-09 11:45:24'],
      [3, 1, '2026-06-10', '200', 'deleted in', '', 0, 1, '2026-06-10 11:00:00'],
    ],
  ),
  table(
    'materials_out',
    ['mat_out_id', 'mat_out_batch', 'mat_out_date', 'mat_out_note', 'mat_out_status', 'close', 'status', 'crt_date', 'del_date'],
    [
      [1, 'DSM-001', '2026-08-04', '', 'Pharmacy Lab', 1, 1, '2026-08-05 15:03:06', '2026-08-05 15:03:06'],
      [2, 'DSM-001', '2026-08-11', '', 'Pharmacy Lab', 1, 1, '2026-08-11 13:22:03', '2026-08-11 13:22:03'],
    ],
  ),
  table(
    'materials_out_details',
    ['mat_out_det_id', 'material_out_id', 'mat_out_mat_id', 'mat_out_det_date', 'mat_out_quantity', 'mat_out_status', 'close', 'status'],
    [
      [1, 1, 1, '2026-08-04', '8000', 'Pharmacy Lab', 1, 1],
      [2, 1, 2, '2026-08-04', '400', 'Pharmacy Lab', 1, 1],
      [3, 2, 1, '2026-08-11', '500', 'Pharmacy Lab', 1, 1],
    ],
  ),
].join('\n');

describe('posSoft material import', () => {
  let dir: string;
  let file: string;
  let branchId: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'possoft-mat-'));
    file = join(dir, 'pos.sql');
    writeFileSync(file, DUMP);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    branchId = randomUUID();
    await AppDataSource.query(
      `INSERT INTO branches (id, name, code, city, kind, status) VALUES ($1,'Super Admin Stock','MAINWH','Lahore','warehouse','active')`,
      [branchId],
    );
  });

  it('imports categories, materials with thresholds, stock in and out, and lights the report warning', async () => {
    const dump = await readDump(file, POSSOFT_MATERIAL_TABLES);

    const dry = await importPossoftMaterials(AppDataSource, dump, { dryRun: true });
    expect(dry).toMatchObject({ branch: 'MAINWH', categories: 2, materials: 3, receipts: 2, batches: 1, batchItems: 2 });
    const [afterDry] = (await AppDataSource.query(`SELECT COUNT(*)::int AS count FROM materials`)) as {
      count: number;
    }[];
    expect(afterDry?.count).toBe(0);

    const summary = await importPossoftMaterials(AppDataSource, dump);
    expect(summary).toMatchObject({ categories: 2, materials: 3, receipts: 2, batches: 1, batchItems: 2 });

    const materials = (await AppDataSource.query(
      `SELECT name, minimum::text AS minimum, bare_minimum::text AS bare, deleted_at IS NOT NULL AS deleted
         FROM materials ORDER BY name`,
    )) as Record<string, unknown>[];
    expect(materials).toEqual([
      { name: 'Allantoin', minimum: '248.000', bare: '124.000', deleted: false },
      { name: 'Estradiol', minimum: '2500.000', bare: '1000.000', deleted: false },
      { name: 'Old Material', minimum: '0.000', bare: '0.000', deleted: true },
    ]);

    const [batch] = (await AppDataSource.query(
      `SELECT batch_no, stage, (SELECT COUNT(*)::int FROM material_batch_items i WHERE i.batch_id = b.id) AS items
         FROM material_batches b`,
    )) as Record<string, unknown>[];
    expect(batch).toMatchObject({ batch_no: 'DSM-001', stage: 'pharmacy_lab', items: 2 });

    const report = await manufacturingReportsService.materialReport(branchId, {
      location: 'store',
      level: 'all',
    } as MaterialReportQuery);
    const byName = Object.fromEntries(
      report.map((r) => [
        r.name,
        { in: r.in.toString(), out: r.out.toString(), closing: r.closing.toString(), alert: r.alert },
      ]),
    );
    expect(byName.Estradiol).toEqual({ in: '10000', out: '8500', closing: '1500', alert: 'minimum' });
    expect(byName.Allantoin).toEqual({ in: '500', out: '400', closing: '100', alert: 'bare_minimum' });
    expect(byName['Old Material']).toBeUndefined();

    const before = (await AppDataSource.query(`SELECT COUNT(*)::int AS count FROM material_movements`)) as {
      count: number;
    }[];
    await importPossoftMaterials(AppDataSource, dump);
    const after = (await AppDataSource.query(`SELECT COUNT(*)::int AS count FROM material_movements`)) as {
      count: number;
    }[];
    expect(after[0]?.count).toBe(before[0]?.count);
  });
});
