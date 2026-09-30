import Decimal from 'decimal.js';
import { AppDataSource } from '../../database/data-source';
import { toQuantity } from '../../database/transformers';
import { type FinishedGoodsQuery, type MaterialReportQuery } from './manufacturing.schemas';
import { type MaterialLocation, type MaterialMovementType } from './material-movement.entity';

type AlertLevel = 'ok' | 'minimum' | 'bare_minimum';

const FLOW_TYPES: Record<MaterialLocation, [MaterialMovementType, MaterialMovementType]> = {
  store: ['material_in', 'material_out_to_lab'],
  lab: ['material_out_to_lab', 'used_in_production'],
};

function alertFor(closing: Decimal, minimum: Decimal, bareMinimum: Decimal): AlertLevel {
  if (closing.lessThan(bareMinimum)) return 'bare_minimum';
  if (closing.lessThan(minimum)) return 'minimum';
  return 'ok';
}

export const manufacturingReportsService = {
  async materialReport(branchId: string, query: MaterialReportQuery) {
    const [inType, outType] = FLOW_TYPES[query.location];
    const params: unknown[] = [
      branchId,
      query.location,
      query.from ?? null,
      query.to ?? null,
      inType,
      outType,
    ];
    const materialFilter = query.materialId ? `AND mat.id = $${params.push(query.materialId)}` : '';
    const rows: {
      materialId: string;
      name: string;
      categoryName: string | null;
      unit: string;
      opening: string;
      in: string;
      out: string;
      closing: string;
      minimum: string;
      bareMinimum: string;
    }[] = await AppDataSource.query(
      `SELECT mat.id AS "materialId", mat.name, mc.name AS "categoryName", mat.unit,
              mat.minimum::text AS minimum, mat.bare_minimum::text AS "bareMinimum",
              COALESCE(SUM(m.qty) FILTER (WHERE $3::date IS NOT NULL AND m.date < $3::date), 0)::text AS opening,
              COALESCE(SUM(m.qty) FILTER (WHERE m.type = $5::material_movement_type AND ($3::date IS NULL OR m.date >= $3::date)
                                           AND ($4::date IS NULL OR m.date <= $4::date)), 0)::text AS "in",
              COALESCE(-SUM(m.qty) FILTER (WHERE m.type = $6::material_movement_type AND ($3::date IS NULL OR m.date >= $3::date)
                                            AND ($4::date IS NULL OR m.date <= $4::date)), 0)::text AS "out",
              COALESCE(SUM(m.qty) FILTER (WHERE $4::date IS NULL OR m.date <= $4::date), 0)::text AS closing
         FROM materials mat
         LEFT JOIN material_categories mc ON mc.id = mat.category_id
         LEFT JOIN material_movements m ON m.material_id = mat.id AND m.branch_id = mat.branch_id AND m.location = $2
        WHERE mat.branch_id = $1 AND mat.deleted_at IS NULL ${materialFilter}
        GROUP BY mat.id, mat.name, mc.name, mat.unit, mat.minimum, mat.bare_minimum
        ORDER BY mat.name ASC`,
      params,
    );

    return rows
      .map((r) => {
        const closing = new Decimal(r.closing);
        return {
          materialId: r.materialId,
          name: r.name,
          categoryName: r.categoryName,
          unit: r.unit,
          opening: toQuantity(r.opening),
          in: toQuantity(r.in),
          out: toQuantity(r.out),
          closing: toQuantity(closing),
          minimum: toQuantity(r.minimum),
          bareMinimum: toQuantity(r.bareMinimum),
          alert:
            query.location === 'store'
              ? alertFor(closing, new Decimal(r.minimum), new Decimal(r.bareMinimum))
              : null,
        };
      })
      .filter((r) => query.level === 'all' || r.alert === query.level);
  },

  async finishedGoods(branchId: string, query: FinishedGoodsQuery) {
    const rows: {
      batchId: string;
      batchNo: string;
      date: string;
      productName: string | null;
      materialUsed: string;
      finishedQty: string;
      sizeGrams: string | null;
    }[] = await AppDataSource.query(
      `SELECT b.id AS "batchId", b.batch_no AS "batchNo", to_char(b.date, 'YYYY-MM-DD') AS date,
              COALESCE(p.name, sp.name) AS "productName",
              (SELECT COALESCE(SUM(i.qty), 0) FROM material_batch_items i WHERE i.batch_id = b.id)::text AS "materialUsed",
              (COALESCE(b.produced_qty, 0) + COALESCE((
                  SELECT SUM(si.qty) FROM stock_ins si
                   WHERE si.branch_id = b.branch_id AND si.batch = b.batch_no AND si.deleted_at IS NULL), 0))::text
                AS "finishedQty",
              COALESCE(p.size_grams, sp.size_grams)::text AS "sizeGrams"
         FROM material_batches b
         LEFT JOIN products p ON p.id = b.product_id
         LEFT JOIN LATERAL (
              SELECT pr.name, pr.size_grams FROM stock_ins si
                JOIN products pr ON pr.id = si.product_id
               WHERE si.branch_id = b.branch_id AND si.batch = b.batch_no AND si.deleted_at IS NULL
               ORDER BY si.created_at ASC LIMIT 1) sp ON true
        WHERE b.branch_id = $1 AND b.stage = 'finished_product' AND b.deleted_at IS NULL
          AND ($2::date IS NULL OR b.date >= $2::date) AND ($3::date IS NULL OR b.date <= $3::date)
        ORDER BY b.date DESC, b.created_at DESC`,
      [branchId, query.from ?? null, query.to ?? null],
    );

    return rows.map((r) => {
      const used = new Decimal(r.materialUsed);
      const size = r.sizeGrams === null ? null : new Decimal(r.sizeGrams);
      const loss = size === null ? null : used.minus(new Decimal(r.finishedQty).times(size));
      return {
        batchId: r.batchId,
        batchNo: r.batchNo,
        date: r.date,
        productName: r.productName,
        materialUsed: toQuantity(used),
        finishedQty: toQuantity(r.finishedQty),
        sizeGrams: size === null ? null : toQuantity(size),
        lossGrams: loss === null ? null : toQuantity(loss),
        lossPercent: loss === null || used.isZero() ? null : loss.dividedBy(used).times(100).toFixed(2),
      };
    });
  },
};
