import Decimal from 'decimal.js';
import { AppDataSource } from '../../database/data-source';
import { repo } from '../../database/transaction';
import { breakdown, SqlFilter, sumBy, type Report, type ReportColumn } from '../../lib/report';
import { today } from '../../lib/validation';
import { BloodWorkResult } from '../clinical-records/blood-work-result.entity';
import { Consultation } from '../consultations/consultation.entity';
import { mrsScores } from '../consultations/section-schemas';
import { PrescriptionItem } from '../prescriptions/prescription-item.entity';
import {
  type AccountsBalanceQuery,
  type AppointmentPaymentsReportQuery,
  type AppointmentsReportQuery,
  type DoctorSalesQuery,
  type ExpensesReportQuery,
  type FinanceQuery,
  type PatientHistoryQuery,
  type PurchasesQuery,
  type SaleProductsQuery,
  type StockReportQuery,
  type BranchStockQuery,
} from './reports.schemas';

export interface ReportScope {
  branchId: string | null;
  doctorId: string | null;
}

type Row = Record<string, unknown>;

const query = (sql: string, params: unknown[]) => AppDataSource.query(sql, params) as Promise<Row[]>;

function build(
  scope: ReportScope,
  title: string,
  columns: ReportColumn[],
  rows: Row[],
  totalKeys: string[] = [],
  scale = 2,
): Report {
  const all = scope.branchId === null;
  return {
    title,
    columns: all ? [{ key: 'branch', label: 'Branch' }, ...columns] : columns,
    rows,
    ...(totalKeys.length > 0 ? { totals: sumBy(rows, totalKeys, scale) } : {}),
    ...(all && totalKeys.length > 0 ? { byBranch: breakdown(rows, totalKeys, scale) } : {}),
  };
}

function scoped(scope: ReportScope, column: string) {
  return new SqlFilter().when(scope.branchId, `${column} = ?`, scope.branchId);
}

function currentMonth() {
  return today().slice(0, 7);
}

export const reportsService = {
  async saleProducts(scope: ReportScope, q: SaleProductsQuery) {
    const f = scoped(scope, 's.branch_id')
      .add('s.deleted_at IS NULL')
      .add('si.deleted_at IS NULL')
      .period('s.date', q)
      .when(q.patientId, 's.patient_id = ?', q.patientId)
      .when(
        q.productId,
        'si.product_id IN (SELECT id FROM products WHERE id = ? OR origin_product_id = ?)',
        q.productId,
        q.productId,
      )
      .when(q.saleType, 's.sale_type = ?', q.saleType)
      .when(q.city, 's.city ILIKE ?', q.city)
      .when(q.patientCity, 's.patient_city ILIKE ?', q.patientCity)
      .when(q.createdBy, 's.created_by = ?', q.createdBy)
      .when(q.createdFrom, 's.created_at::date >= ?', q.createdFrom)
      .when(q.createdTo, 's.created_at::date <= ?', q.createdTo)
      .when(
        q.method,
        'EXISTS (SELECT 1 FROM sale_payments y WHERE y.sale_id = s.id AND y.deleted_at IS NULL AND y.method = ?)',
        q.method,
      )
      .when(
        q.accountSheetId,
        'EXISTS (SELECT 1 FROM sale_payments y WHERE y.sale_id = s.id AND y.deleted_at IS NULL AND y.account_sheet_id = ?)',
        q.accountSheetId,
      );
    const rows = await query(
      `SELECT b.code AS branch, s.invoice_no AS "invoiceNo", to_char(s.date, 'YYYY-MM-DD') AS date,
              p.name AS patient, p.phone, s.sale_type AS "saleType", s.city, pr.name AS product, bu.name AS bundle,
              si.qty::text AS qty, si.unit_price::text AS "unitPrice", si.line_total::text AS "lineTotal",
              s.discount_percent::text AS "discountPercent", s.total::text AS "saleTotal", s.payment_status AS "paymentStatus"
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN patients p ON p.id = s.patient_id
         JOIN products pr ON pr.id = si.product_id
         LEFT JOIN bundles bu ON bu.id = si.bundle_id
         JOIN branches b ON b.id = s.branch_id
        ${f.where}
        ORDER BY s.date DESC, s.invoice_seq DESC, si.created_at`,
      f.params,
    );
    const report = build(
      scope,
      'Sale Products Report',
      [
        { key: 'invoiceNo', label: 'Invoice' },
        { key: 'date', label: 'Date' },
        { key: 'patient', label: 'Customer' },
        { key: 'phone', label: 'Phone' },
        { key: 'saleType', label: 'Sale Type' },
        { key: 'city', label: 'Sale City' },
        { key: 'product', label: 'Product' },
        { key: 'bundle', label: 'Bundle' },
        { key: 'qty', label: 'Qty' },
        { key: 'unitPrice', label: 'Price' },
        { key: 'lineTotal', label: 'Amount' },
      ],
      rows,
      ['lineTotal'],
    );
    return { ...report, totals: { ...report.totals, ...sumBy(rows, ['qty'], 3) } };
  },

  async purchases(scope: ReportScope, q: PurchasesQuery) {
    const f = scoped(scope, 'pr.branch_id')
      .add('pe.deleted_at IS NULL')
      .add('pr.deleted_at IS NULL')
      .period('pe.date', q)
      .when(q.supplierId, 'pe.supplier_id = ?', q.supplierId)
      .when(q.categoryId, 'pr.category_id = ?', q.categoryId)
      .when(
        q.productId,
        'pe.product_id IN (SELECT id FROM products WHERE id = ? OR origin_product_id = ?)',
        q.productId,
        q.productId,
      );
    const rows = await query(
      `SELECT b.code AS branch, to_char(pe.date, 'YYYY-MM-DD') AS date, sup.name AS supplier, sup.phone AS "supplierPhone",
              pr.batch_no AS batch, pr.name AS product, c.name AS category, pe.quantity::text AS qty,
              pe.unit_price::text AS "unitPrice", (pe.quantity * pe.unit_price)::numeric(12,2)::text AS amount
         FROM product_purchase_entries pe
         JOIN products pr ON pr.id = pe.product_id
         JOIN categories c ON c.id = pr.category_id
         LEFT JOIN suppliers sup ON sup.id = pe.supplier_id
         JOIN branches b ON b.id = pr.branch_id
        ${f.where}
        ORDER BY pe.date DESC, pe.created_at DESC`,
      f.params,
    );
    const report = build(
      scope,
      'Buy Products Report',
      [
        { key: 'date', label: 'Date' },
        { key: 'supplier', label: 'Supplier' },
        { key: 'batch', label: 'Batch' },
        { key: 'product', label: 'Name' },
        { key: 'category', label: 'Category' },
        { key: 'qty', label: 'Qty' },
        { key: 'unitPrice', label: 'Price' },
        { key: 'amount', label: 'Amount' },
      ],
      rows,
      ['amount'],
    );
    return { ...report, totals: { ...report.totals, ...sumBy(rows, ['qty'], 3) } };
  },

  async stock(scope: ReportScope, q: StockReportQuery) {
    const f = scoped(scope, 'm.branch_id')
      .period('m.date', q)
      .when(q.categoryId, 'pr.category_id = ?', q.categoryId)
      .when(
        q.productId,
        'm.product_id IN (SELECT id FROM products WHERE id = ? OR origin_product_id = ?)',
        q.productId,
        q.productId,
      );
    const rows = await query(
      `SELECT b.code AS branch, pr.batch_no AS batch, pr.name AS product, c.name AS category,
              to_char(m.date, 'YYYY-MM-DD') AS date,
              COALESCE(SUM(m.qty) FILTER (WHERE m.type = 'purchase_in'), 0)::numeric(12,3)::text AS bought,
              COALESCE(SUM(m.qty) FILTER (WHERE m.type = 'stock_in'), 0)::numeric(12,3)::text AS "stockIn",
              COALESCE(SUM(m.qty) FILTER (WHERE m.type = 'manufacturing_in'), 0)::numeric(12,3)::text AS manufactured,
              COALESCE(-SUM(m.qty) FILTER (WHERE m.type = 'stock_out'), 0)::numeric(12,3)::text AS "stockOut",
              COALESCE(-SUM(m.qty) FILTER (WHERE m.type IN ('sale', 'sale_edit_adjust')), 0)::numeric(12,3)::text AS sold,
              COALESCE(SUM(m.qty) FILTER (WHERE m.type = 'sale_return'), 0)::numeric(12,3)::text AS returned
         FROM stock_movements m
         JOIN products pr ON pr.id = m.product_id
         JOIN categories c ON c.id = pr.category_id
         JOIN branches b ON b.id = m.branch_id
        ${f.where}
        GROUP BY b.code, pr.id, c.name, m.date
        ORDER BY m.date DESC, pr.name`,
      f.params,
    );
    return build(
      scope,
      'Stock Report',
      [
        { key: 'batch', label: 'Batch' },
        { key: 'product', label: 'Name' },
        { key: 'category', label: 'Category' },
        { key: 'date', label: 'Date' },
        { key: 'bought', label: 'Buy Qty' },
        { key: 'stockIn', label: 'Stock In' },
        { key: 'manufactured', label: 'Manufactured' },
        { key: 'stockOut', label: 'Stock Out' },
        { key: 'sold', label: 'Sale Qty' },
        { key: 'returned', label: 'Returned' },
      ],
      rows,
      ['bought', 'stockIn', 'manufactured', 'stockOut', 'sold', 'returned'],
      3,
    );
  },

  async branchStock(scope: ReportScope, q: BranchStockQuery) {
    const month = q.month ?? (q.from || q.to ? null : currentMonth());
    const from = q.from ?? (month ? `${month}-01` : '2000-01-01');
    const to =
      q.to ??
      (month
        ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
            .toISOString()
            .slice(0, 10)
        : today());
    const f = new SqlFilter()
      .add("b.kind = 'branch'")
      .add('b.deleted_at IS NULL')
      .add('pr.deleted_at IS NULL')
      .when(scope.branchId, 'pr.branch_id = ?', scope.branchId)
      .when(q.productId, '(pr.id = ? OR pr.origin_product_id = ?)', q.productId, q.productId);
    const params = [...f.params, from, to];
    const p = params.length;
    const range = `m.date BETWEEN $${p - 1} AND $${p}`;
    const rows = await query(
      `SELECT * FROM (
         SELECT b.code AS branch, pr.name AS product,
                COALESCE((SELECT SUM(si.qty) FROM stock_ins si
                           WHERE si.product_id = pr.id AND si.deleted_at IS NULL AND si.transfer_out_id IS NOT NULL
                             AND si.date BETWEEN $${p - 1} AND $${p}), 0)::numeric(12,3)::text AS transferred,
                COALESCE((SELECT -SUM(m.qty) FROM stock_movements m
                           WHERE m.product_id = pr.id AND m.type IN ('sale', 'sale_edit_adjust') AND ${range}), 0)::numeric(12,3)::text AS sold,
                COALESCE((SELECT SUM(m.qty) FROM stock_movements m
                           WHERE m.product_id = pr.id AND m.type = 'sale_return' AND ${range}), 0)::numeric(12,3)::text AS returned,
                COALESCE((SELECT SUM(m.qty) FROM stock_movements m
                           WHERE m.product_id = pr.id AND m.date <= $${p}), 0)::numeric(12,3)::text AS "inBranch"
           FROM products pr
           JOIN branches b ON b.id = pr.branch_id
          ${f.where}) t
        WHERE t.transferred::numeric <> 0 OR t.sold::numeric <> 0 OR t.returned::numeric <> 0 OR t."inBranch"::numeric <> 0
        ORDER BY t.branch, t.product`,
      params,
    );
    return build(
      scope,
      'Branch Stock Report',
      [
        { key: 'product', label: 'Product Name' },
        { key: 'transferred', label: 'Stock Out (received)' },
        { key: 'sold', label: 'Sale Qty' },
        { key: 'returned', label: 'Returned' },
        { key: 'inBranch', label: 'In Branch' },
      ],
      rows,
      ['transferred', 'sold', 'returned', 'inBranch'],
      3,
    );
  },

  async appointments(scope: ReportScope, q: AppointmentsReportQuery) {
    const f = scoped(scope, 'a.branch_id')
      .add('a.deleted_at IS NULL')
      .period('a.date', q)
      .when(scope.doctorId, 'a.doctor_id = ?', scope.doctorId)
      .when(q.doctorId, 'a.doctor_id = ?', q.doctorId)
      .when(q.status, 'a.status = ?', q.status)
      .when(q.patientId, 'a.patient_id = ?', q.patientId)
      .when(q.city, 'a.patient_city ILIKE ?', q.city)
      .when(q.mode, 'a.mode = ?', q.mode)
      .when(q.visitType, 'a.visit_type = ?', q.visitType)
      .when(q.bhrtStatus, 'p.bhrt_status = ?', q.bhrtStatus)
      .when(
        q.method,
        'EXISTS (SELECT 1 FROM appointment_payments y WHERE y.appointment_id = a.id AND y.deleted_at IS NULL AND y.method = ?)',
        q.method,
      );
    const methodParam = f.params.length + 1;
    const rows = await query(
      `SELECT b.code AS branch, 'APP#' || a.appointment_no AS "appointmentNo", to_char(a.date, 'YYYY-MM-DD') AS date,
              to_char(a.time_from, 'HH24:MI') AS "timeFrom", to_char(a.time_to, 'HH24:MI') AS "timeTo",
              p.name AS patient, p.phone, d.display_name AS doctor, a.mode, a.visit_type AS "visitType", a.status,
              a.patient_city AS city, p.bhrt_status AS "bhrtStatus", a.issues,
              COALESCE((SELECT string_agg(DISTINCT y.method::text, ', ') FROM appointment_payments y
                         WHERE y.appointment_id = a.id AND y.deleted_at IS NULL), '') AS methods,
              COALESCE((SELECT SUM(y.amount) FROM appointment_payments y
                         WHERE y.appointment_id = a.id AND y.deleted_at IS NULL
                           AND ($${methodParam}::text IS NULL OR y.method::text = $${methodParam})), 0)::numeric(12,2)::text AS amount
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors d ON d.id = a.doctor_id
         JOIN branches b ON b.id = a.branch_id
        ${f.where}
        ORDER BY a.date DESC, a.appointment_no DESC`,
      [...f.params, q.method ?? null],
    );
    return build(
      scope,
      'Appointment Report',
      [
        { key: 'appointmentNo', label: 'App. #' },
        { key: 'patient', label: 'Patient Name' },
        { key: 'phone', label: 'Phone' },
        { key: 'doctor', label: 'Doctor Name' },
        { key: 'date', label: 'Date' },
        { key: 'timeFrom', label: 'Time From' },
        { key: 'timeTo', label: 'Time To' },
        { key: 'mode', label: 'Online / Physical' },
        { key: 'visitType', label: 'New / Followup' },
        { key: 'methods', label: 'Payment' },
        { key: 'amount', label: 'Amount' },
        { key: 'issues', label: 'Issues' },
        { key: 'status', label: 'Status' },
      ],
      rows,
      ['amount'],
    );
  },

  async appointmentPayments(scope: ReportScope, q: AppointmentPaymentsReportQuery) {
    const f = scoped(scope, 'a.branch_id')
      .add('a.deleted_at IS NULL')
      .add('y.deleted_at IS NULL')
      .period('y.date', q)
      .when(scope.doctorId, 'a.doctor_id = ?', scope.doctorId)
      .when(q.doctorId, 'a.doctor_id = ?', q.doctorId)
      .when(q.status, 'a.status = ?', q.status)
      .when(q.patientId, 'a.patient_id = ?', q.patientId)
      .when(q.city, 'a.patient_city ILIKE ?', q.city)
      .when(q.mode, 'a.mode = ?', q.mode)
      .when(q.visitType, 'a.visit_type = ?', q.visitType)
      .when(q.bhrtStatus, 'p.bhrt_status = ?', q.bhrtStatus)
      .when(q.method, 'y.method = ?', q.method)
      .when(q.accountSheetId, 'y.account_sheet_id = ?', q.accountSheetId);
    const rows = await query(
      `SELECT b.code AS branch, 'APP#' || a.appointment_no AS "appointmentNo", to_char(a.date, 'YYYY-MM-DD') AS date,
              p.name AS patient, p.phone, d.display_name AS doctor, a.mode, a.status, a.patient_city AS city,
              string_agg(DISTINCT y.method::text, ', ') AS methods,
              to_char(MAX(y.date), 'YYYY-MM-DD') AS "lastPaymentDate", SUM(y.amount)::numeric(12,2)::text AS amount
         FROM appointment_payments y
         JOIN appointments a ON a.id = y.appointment_id
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors d ON d.id = a.doctor_id
         JOIN branches b ON b.id = a.branch_id
        ${f.where}
        GROUP BY b.code, a.id, p.id, d.id
        ORDER BY a.date DESC, a.appointment_no DESC`,
      f.params,
    );
    return build(
      scope,
      'Appointment Payment Report',
      [
        { key: 'appointmentNo', label: 'App. #' },
        { key: 'patient', label: 'Patient Name' },
        { key: 'phone', label: 'Phone' },
        { key: 'doctor', label: 'Doctor Name' },
        { key: 'date', label: 'Date' },
        { key: 'mode', label: 'Online / Physical' },
        { key: 'status', label: 'Status' },
        { key: 'methods', label: 'Payment' },
        { key: 'lastPaymentDate', label: 'Paid On' },
        { key: 'amount', label: 'Amount' },
      ],
      rows,
      ['amount'],
    );
  },

  async doctorSales(scope: ReportScope, q: DoctorSalesQuery) {
    const f = scoped(scope, 's.branch_id')
      .add('s.deleted_at IS NULL')
      .add('d.deleted_at IS NULL')
      .period('s.date', q)
      .when(scope.doctorId, 'd.id = ?', scope.doctorId)
      .when(q.doctorId, 'd.id = ?', q.doctorId);
    const productParam = f.params.length + 1;
    const rows = await query(
      `SELECT b.code AS branch, d.display_name AS doctor, d.commission_percent::text AS "commissionPercent",
              s.invoice_no AS "invoiceNo", to_char(s.date, 'YYYY-MM-DD') AS date, p.name AS patient, p.phone,
              SUM(si.qty)::numeric(12,3)::text AS qty, s.discount_amount::text AS discount, s.total::text AS total,
              ROUND(s.total * d.commission_percent / 100, 2)::numeric(12,2)::text AS commission
         FROM sales s
         JOIN doctors d ON d.branch_id = s.branch_id
          AND EXISTS (SELECT 1 FROM appointments a
                       WHERE a.patient_id = s.patient_id AND a.doctor_id = d.id AND a.deleted_at IS NULL)
         JOIN patients p ON p.id = s.patient_id
         JOIN sale_items si ON si.sale_id = s.id AND si.deleted_at IS NULL
          AND ($${productParam}::uuid IS NULL OR si.product_id IN (
                SELECT id FROM products WHERE id = $${productParam} OR origin_product_id = $${productParam}))
         JOIN branches b ON b.id = s.branch_id
        ${f.where}
        GROUP BY b.code, d.id, s.id, p.id
        ORDER BY s.date DESC, s.invoice_seq DESC, d.display_name`,
      [...f.params, q.productId ?? null],
    );
    return build(
      scope,
      'Doctor Sale Report',
      [
        { key: 'doctor', label: 'Doctor' },
        { key: 'date', label: 'Date' },
        { key: 'invoiceNo', label: 'Invoice' },
        { key: 'patient', label: 'Customer' },
        { key: 'phone', label: 'Phone' },
        { key: 'qty', label: 'Qty' },
        { key: 'discount', label: 'Discount' },
        { key: 'total', label: 'Total' },
        { key: 'commissionPercent', label: 'Commission %' },
        { key: 'commission', label: 'Commission' },
      ],
      rows,
      ['total', 'commission'],
    );
  },

  async patientHistory(scope: ReportScope, q: PatientHistoryQuery) {
    const qb = repo(Consultation)
      .createQueryBuilder('c')
      .innerJoinAndSelect('c.patient', 'patient')
      .innerJoinAndSelect('c.appointment', 'appointment')
      .innerJoinAndSelect('c.doctor', 'doctor')
      .innerJoinAndSelect('c.branch', 'branch')
      .leftJoinAndSelect('c.sections', 'section');
    if (scope.branchId) qb.andWhere('c.branchId = :branchId', { branchId: scope.branchId });
    if (scope.doctorId) qb.andWhere('c.doctorId = :viewerDoctor', { viewerDoctor: scope.doctorId });
    if (q.doctorId) qb.andWhere('c.doctorId = :doctorId', { doctorId: q.doctorId });
    if (q.patientId) qb.andWhere('c.patientId = :patientId', { patientId: q.patientId });
    if (q.month) qb.andWhere(`to_char(appointment.date, 'YYYY-MM') = :month`, { month: q.month });
    if (q.from) qb.andWhere('appointment.date >= :from', { from: q.from });
    if (q.to) qb.andWhere('appointment.date <= :to', { to: q.to });
    const consultations = await qb.orderBy('appointment.date', 'DESC').getMany();

    const ids = consultations.map((c) => c.id);
    const patientIds = [...new Set(consultations.map((c) => c.patientId))];
    const items = ids.length
      ? await repo(PrescriptionItem)
          .createQueryBuilder('item')
          .innerJoinAndSelect('item.prescription', 'rx')
          .leftJoinAndSelect('item.catalogItem', 'catalog')
          .where('rx.consultationId IN (:...ids)', { ids })
          .andWhere('rx.deletedAt IS NULL')
          .getMany()
      : [];
    const blood = patientIds.length
      ? await repo(BloodWorkResult)
          .createQueryBuilder('bw')
          .where('bw.patientId IN (:...patientIds)', { patientIds })
          .andWhere("bw.test IN ('fsh', 'estradiol', 'testosterone_total')")
          .orderBy('bw.testDate', 'DESC')
          .getMany()
      : [];

    const treatment = (consultationId: string, codes: RegExp) =>
      items
        .filter(
          (i) => i.prescription?.consultationId === consultationId && codes.test(i.catalogItem?.code ?? ''),
        )
        .map((i) => i.dose ?? i.name)
        .join('; ');
    const latest = (patientId: string, test: string, date: string) =>
      blood
        .find((b) => b.patientId === patientId && b.test === test && b.testDate <= date)
        ?.value.toString() ?? '';

    const rows = consultations.map((c) => {
      const section = (key: string) => (c.sections ?? []).find((s) => s.sectionKey === key)?.data ?? {};
      const mrs = section('mrs_scale');
      const scores = mrsScores(mrs);
      const hasMrs = Object.keys(mrs).length > 0;
      const date = c.appointment?.date ?? '';
      return {
        branch: c.branch?.code,
        patientId: c.patientId,
        patient: c.patient?.name,
        phone: c.patient?.phone,
        age: c.patient?.age,
        city: c.patient?.city,
        country: c.patient?.country,
        date,
        doctor: c.doctor?.displayName,
        bmi: section('basic_info').bmi ?? '',
        menopauseStage: ((section('clinical_assessment').menopauseStage as string[] | undefined) ?? []).join(
          ', ',
        ),
        menopauseAge: section('medical_history').menopauseDiagnosedAge ?? '',
        ...Object.fromEntries(
          [
            'hotFlushes',
            'heartDiscomfort',
            'sleepProblems',
            'jointMuscleDiscomfort',
            'depressiveMood',
            'irritability',
            'anxiety',
            'exhaustion',
            'sexualProblems',
            'bladderProblems',
            'vaginalDryness',
          ].map((k) => [k, mrs[k] ?? '']),
        ),
        somaticMrs: hasMrs ? scores.somatic : '',
        psychologicalMrs: hasMrs ? scores.psychological : '',
        urogenitalMrs: hasMrs ? scores.urogenital : '',
        totalMrs: hasMrs ? scores.total : '',
        fsh: latest(c.patientId, 'fsh', date),
        estradiol: latest(c.patientId, 'estradiol', date),
        totalTestosterone: latest(c.patientId, 'testosterone_total', date),
        progesteroneTreatment: treatment(c.id, /^pres_progest/),
        estradiolTreatment: treatment(c.id, /^pres_estradiol[12]$/),
        vaginalTreatment: treatment(c.id, /^pres_(estradiolVaginal|dheaVaginal|mixVaginal)$/),
        testosteroneTreatment: treatment(c.id, /^pres_testostest$/),
        stillOnTreatment: section('follow_up').usingHormoneTherapy ?? '',
      };
    });
    return build(
      scope,
      'Patient History Report',
      [
        { key: 'patient', label: 'Name' },
        { key: 'phone', label: 'Phone' },
        { key: 'age', label: 'Age' },
        { key: 'city', label: 'City' },
        { key: 'country', label: 'Country' },
        { key: 'date', label: 'Date' },
        { key: 'doctor', label: 'Doctor' },
        { key: 'bmi', label: 'BMI' },
        { key: 'menopauseStage', label: 'Menopause Status' },
        { key: 'menopauseAge', label: 'Age at Menopause' },
        { key: 'hotFlushes', label: 'Hot flushes' },
        { key: 'heartDiscomfort', label: 'Heart discomfort' },
        { key: 'sleepProblems', label: 'Sleep problems' },
        { key: 'jointMuscleDiscomfort', label: 'Joint and muscle discomfort' },
        { key: 'somaticMrs', label: 'Somatic MRS' },
        { key: 'depressiveMood', label: 'Depressive mood' },
        { key: 'irritability', label: 'Irritability' },
        { key: 'anxiety', label: 'Anxiety' },
        { key: 'exhaustion', label: 'Physical and mental exhaustion' },
        { key: 'psychologicalMrs', label: 'Psychological MRS' },
        { key: 'sexualProblems', label: 'Sexual problems' },
        { key: 'bladderProblems', label: 'Bladder problems' },
        { key: 'vaginalDryness', label: 'Vaginal dryness' },
        { key: 'urogenitalMrs', label: 'Urogenital MRS' },
        { key: 'totalMrs', label: 'Total MRS' },
        { key: 'fsh', label: 'FSH' },
        { key: 'estradiol', label: 'Estradiol' },
        { key: 'totalTestosterone', label: 'Total Testosterone' },
        { key: 'progesteroneTreatment', label: 'Progesterone Treatment' },
        { key: 'estradiolTreatment', label: 'Estradiol Treatment' },
        { key: 'vaginalTreatment', label: 'Vaginal Treatment' },
        { key: 'testosteroneTreatment', label: 'Testosterone Treatment' },
        { key: 'stillOnTreatment', label: 'Still on Treatment' },
      ],
      rows,
    );
  },

  async finance(scope: ReportScope, q: FinanceQuery) {
    const period = q.month || q.from || q.to ? q : { month: currentMonth() };
    const f = scoped(scope, 'je.branch_id')
      .add('je.deleted_at IS NULL')
      .add('jl.deleted_at IS NULL')
      .period('je.date', period)
      .when(q.accountSheetId, 'jl.account_sheet_id = ?', q.accountSheetId)
      .when(q.source, 'je.source = ?', q.source);
    const rows = await query(
      `SELECT b.code AS branch, je.entry_no AS "entryNo", to_char(je.date, 'YYYY-MM-DD') AS date,
              COALESCE(sh.account_name || ' / ' || sh.account_code, 'Expense: ' || ec.name) AS account,
              je.narration, jl.description, jl.debit::text AS debit, jl.credit::text AS credit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         LEFT JOIN account_sheets sh ON sh.id = jl.account_sheet_id
         LEFT JOIN expense_categories ec ON ec.id = jl.expense_category_id
         JOIN branches b ON b.id = je.branch_id
        ${f.where}
        ORDER BY je.date DESC, je.entry_seq DESC, jl.created_at`,
      f.params,
    );
    return {
      ...build(
        scope,
        'Finance Report',
        [
          { key: 'entryNo', label: 'Entry' },
          { key: 'date', label: 'Date' },
          { key: 'account', label: 'Account' },
          { key: 'narration', label: 'Narration' },
          { key: 'description', label: 'Description' },
          { key: 'debit', label: 'Debit' },
          { key: 'credit', label: 'Credit' },
        ],
        rows,
        ['debit', 'credit'],
      ),
      summary: { period },
    };
  },

  async accountsBalance(scope: ReportScope, q: AccountsBalanceQuery) {
    const start = q.month ? `${q.month}-01` : q.from;
    const end = q.month
      ? new Date(Date.UTC(Number(q.month.slice(0, 4)), Number(q.month.slice(5, 7)), 0))
          .toISOString()
          .slice(0, 10)
      : q.to;
    const f = scoped(scope, 'sh.branch_id')
      .add('sh.deleted_at IS NULL')
      .when(q.accountSheetId, 'sh.id = ?', q.accountSheetId);
    const startParam = f.params.length + 1;
    const endParam = f.params.length + 2;
    const params = [...f.params, start ?? null, end ?? null];

    if (q.accountSheetId) {
      const [sheet] = await query(
        `SELECT sh.account_name AS "accountName", sh.account_code AS "accountCode", sh.opening_balance::text AS "openingBalance",
                (sh.opening_balance + COALESCE((SELECT SUM(m.debit - m.credit) FROM account_movements m
                  WHERE m.account_sheet_id = sh.id AND $${startParam}::date IS NOT NULL AND m.date < $${startParam}::date), 0))::numeric(12,2)::text AS opening
           FROM account_sheets sh ${f.where}`,
        [...f.params, start ?? null],
      );
      if (!sheet) return build(scope, 'Account Ledger', [], []);
      const movements = await query(
        `SELECT to_char(m.date, 'YYYY-MM-DD') AS date, m.source, m.reference, m.narration,
                m.debit::text AS debit, m.credit::text AS credit
           FROM account_movements m
          WHERE m.account_sheet_id = $1
            AND ($2::date IS NULL OR m.date >= $2::date) AND ($3::date IS NULL OR m.date <= $3::date)
          ORDER BY m.date, m.source, m.reference`,
        [q.accountSheetId, start ?? null, end ?? null],
      );
      let balance = new Decimal(String(sheet.opening));
      const rows = movements.map((m) => {
        balance = balance.plus(String(m.debit)).minus(String(m.credit));
        return { ...m, balance: balance.toFixed(2) };
      });
      const report = build(
        { ...scope, branchId: scope.branchId ?? 'one' },
        `Account Ledger: ${String(sheet.accountName)} / ${String(sheet.accountCode)}`,
        [
          { key: 'date', label: 'Date' },
          { key: 'source', label: 'Source' },
          { key: 'reference', label: 'Reference' },
          { key: 'narration', label: 'Narration' },
          { key: 'debit', label: 'Debit' },
          { key: 'credit', label: 'Credit' },
          { key: 'balance', label: 'Balance' },
        ],
        rows,
        ['debit', 'credit'],
      );
      return { ...report, summary: { opening: sheet.opening, closing: balance.toFixed(2) } };
    }

    const rows = await query(
      `SELECT b.code AS branch, sh.account_name AS "accountName", sh.account_code AS "accountCode", sh.type,
              (sh.opening_balance + COALESCE(SUM(m.debit - m.credit) FILTER (WHERE $${startParam}::date IS NOT NULL AND m.date < $${startParam}::date), 0))::numeric(12,2)::text AS opening,
              COALESCE(SUM(m.debit) FILTER (WHERE ($${startParam}::date IS NULL OR m.date >= $${startParam}::date) AND ($${endParam}::date IS NULL OR m.date <= $${endParam}::date)), 0)::numeric(12,2)::text AS debit,
              COALESCE(SUM(m.credit) FILTER (WHERE ($${startParam}::date IS NULL OR m.date >= $${startParam}::date) AND ($${endParam}::date IS NULL OR m.date <= $${endParam}::date)), 0)::numeric(12,2)::text AS credit,
              (sh.opening_balance + COALESCE(SUM(m.debit - m.credit) FILTER (WHERE $${endParam}::date IS NULL OR m.date <= $${endParam}::date), 0))::numeric(12,2)::text AS closing
         FROM account_sheets sh
         LEFT JOIN account_movements m ON m.account_sheet_id = sh.id
         JOIN branches b ON b.id = sh.branch_id
        ${f.where}
        GROUP BY b.code, sh.id
        ORDER BY b.code, sh.account_name`,
      params,
    );
    return build(
      scope,
      'Accounts Balance',
      [
        { key: 'accountName', label: 'Account' },
        { key: 'accountCode', label: 'Code' },
        { key: 'type', label: 'Type' },
        { key: 'opening', label: 'Opening' },
        { key: 'debit', label: 'Debit' },
        { key: 'credit', label: 'Credit' },
        { key: 'closing', label: 'Balance' },
      ],
      rows,
      ['opening', 'debit', 'credit', 'closing'],
    );
  },

  async expenses(scope: ReportScope, q: ExpensesReportQuery) {
    const f = scoped(scope, 'ex.branch_id')
      .add('ex.deleted_at IS NULL')
      .period('ex.date', q)
      .when(q.categoryId, 'ex.category_id = ?', q.categoryId)
      .when(q.accountSheetId, 'ex.account_sheet_id = ?', q.accountSheetId);
    const rows = await query(
      `SELECT b.code AS branch, to_char(ex.date, 'YYYY-MM-DD') AS date, ec.name AS category,
              sh.account_name || ' / ' || sh.account_code AS account, ex.note, ex.amount::text AS amount
         FROM expenses ex
         JOIN expense_categories ec ON ec.id = ex.category_id
         JOIN account_sheets sh ON sh.id = ex.account_sheet_id
         JOIN branches b ON b.id = ex.branch_id
        ${f.where}
        ORDER BY ex.date DESC, ex.created_at DESC`,
      f.params,
    );
    const categories = [...new Set(rows.map((r) => String(r.category)))];
    return {
      ...build(
        scope,
        'Expenses Report',
        [
          { key: 'date', label: 'Date' },
          { key: 'category', label: 'Category' },
          { key: 'account', label: 'Paid From' },
          { key: 'note', label: 'Note' },
          { key: 'amount', label: 'Amount' },
        ],
        rows,
        ['amount'],
      ),
      summary: {
        byCategory: categories.map((category) => ({
          category,
          ...sumBy(
            rows.filter((r) => r.category === category),
            ['amount'],
          ),
        })),
      },
    };
  },
};
