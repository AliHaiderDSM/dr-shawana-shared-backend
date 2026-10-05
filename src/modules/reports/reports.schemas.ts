import { z } from 'zod';
import { dataEnvelope, errorResponses, jsonContent } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { periodFilters, reportFormat } from '../../lib/report';
import { dateInput } from '../../lib/validation';
import { APPOINTMENT_MODES, APPOINTMENT_STATUSES, VISIT_TYPES } from '../appointments/appointment.entity';
import { PAYMENT_METHODS } from '../appointments/appointment-payment.entity';
import { JOURNAL_SOURCES } from '../journal/journal-entry.entity';
import { BHRT_STATUSES } from '../patients/patient.entity';
import { SALE_TYPES } from '../sales/sale.entity';

const base = { ...reportFormat, ...periodFilters };

export const saleProductsQuerySchema = z.object({
  ...base,
  patientId: z.uuid().optional(),
  productId: z.uuid().optional(),
  saleType: z.enum(SALE_TYPES).optional(),
  city: z.string().trim().max(100).optional().openapi({ description: 'Sale city' }),
  patientCity: z.string().trim().max(100).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  accountSheetId: z.uuid().optional(),
  createdFrom: dateInput.optional(),
  createdTo: dateInput.optional(),
  createdBy: z.uuid().optional(),
});

export const purchasesQuerySchema = z.object({
  ...base,
  supplierId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  productId: z.uuid().optional(),
});

export const stockReportQuerySchema = z.object({
  ...base,
  categoryId: z.uuid().optional(),
  productId: z.uuid().optional(),
});

export const branchStockQuerySchema = z.object({
  ...base,
  productId: z
    .uuid()
    .optional()
    .openapi({ description: 'A Super Admin Stock product matches the branch products made from it' }),
});

export const appointmentsReportQuerySchema = z.object({
  ...base,
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  patientId: z.uuid().optional(),
  doctorId: z.uuid().optional(),
  city: z.string().trim().max(100).optional(),
  mode: z.enum(APPOINTMENT_MODES).optional(),
  visitType: z.enum(VISIT_TYPES).optional(),
  bhrtStatus: z.enum(BHRT_STATUSES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
});

export const appointmentPaymentsReportQuerySchema = appointmentsReportQuerySchema.extend({
  accountSheetId: z.uuid().optional(),
});

export const doctorSalesQuerySchema = z.object({
  ...base,
  doctorId: z.uuid().optional(),
  productId: z.uuid().optional(),
});

export const patientHistoryQuerySchema = z.object({
  ...base,
  patientId: z.uuid().optional(),
  doctorId: z.uuid().optional(),
});

export const financeQuerySchema = z.object({
  ...base,
  accountSheetId: z.uuid().optional(),
  source: z.enum(JOURNAL_SOURCES).optional(),
});

export const accountsBalanceQuerySchema = z.object({
  ...base,
  accountSheetId: z
    .uuid()
    .optional()
    .openapi({ description: 'One account: a dated ledger with a running balance' }),
});

export const expensesReportQuerySchema = z.object({
  ...base,
  categoryId: z.uuid().optional(),
  accountSheetId: z.uuid().optional(),
});

export const dashboardQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    from: dateInput
      .optional()
      .openapi({ description: 'Start of the KPI period (default: first day of this month)' }),
    to: dateInput.optional().openapi({ description: 'End of the KPI period (default: today)' }),
    branchId: z.uuid().optional(),
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    message: '"to" must not be before "from"',
    path: ['to'],
  });

export type SaleProductsQuery = z.output<typeof saleProductsQuerySchema>;
export type PurchasesQuery = z.output<typeof purchasesQuerySchema>;
export type StockReportQuery = z.output<typeof stockReportQuerySchema>;
export type BranchStockQuery = z.output<typeof branchStockQuerySchema>;
export type AppointmentsReportQuery = z.output<typeof appointmentsReportQuerySchema>;
export type AppointmentPaymentsReportQuery = z.output<typeof appointmentPaymentsReportQuerySchema>;
export type DoctorSalesQuery = z.output<typeof doctorSalesQuerySchema>;
export type PatientHistoryQuery = z.output<typeof patientHistoryQuerySchema>;
export type FinanceQuery = z.output<typeof financeQuerySchema>;
export type AccountsBalanceQuery = z.output<typeof accountsBalanceQuerySchema>;
export type ExpensesReportQuery = z.output<typeof expensesReportQuerySchema>;
export type DashboardQuery = z.output<typeof dashboardQuerySchema>;

const reportSchema = registry.register(
  'Report',
  z.object({
    title: z.string(),
    columns: z.array(z.object({ key: z.string(), label: z.string() })),
    rows: z.array(z.record(z.string(), z.unknown())),
    totals: z.record(z.string(), z.unknown()).optional(),
    byBranch: z.array(z.record(z.string(), z.unknown())).optional(),
    summary: z.record(z.string(), z.unknown()).optional(),
  }),
);

const reports: [string, string, z.ZodObject][] = [
  [
    'sale-products',
    'Sale products (posSoft Monthly Sale Products): one row per sold item',
    saleProductsQuerySchema,
  ],
  ['purchases', 'Buy products: purchase entries with supplier and amount', purchasesQuerySchema],
  [
    'stock',
    'Stock report: per product and day, bought, stocked in/out, manufactured, sold and returned',
    stockReportQuerySchema,
  ],
  [
    'branch-stock',
    'Branch stock (posSoft inventory report): per branch and product, stock transferred in, sold, returned and now in the branch',
    branchStockQuerySchema,
  ],
  ['appointments', 'Appointment report (doctors see only their own)', appointmentsReportQuerySchema],
  [
    'appointment-payments',
    'Appointment payment report: one row per appointment',
    appointmentPaymentsReportQuerySchema,
  ],
  [
    'doctor-sales',
    'Doctor sale report: sales of patients who had an appointment with the doctor, with the doctor commission',
    doctorSalesQuerySchema,
  ],
  [
    'patient-history',
    'Patient history report: one row per consultation (MRS, BMI, labs, treatments)',
    patientHistoryQuerySchema,
  ],
  ['finance', 'Finance report: journal lines (current month by default)', financeQuerySchema],
  [
    'accounts-balance',
    'Accounts balance: every account with opening, debit, credit and closing, or one account ledger',
    accountsBalanceQuerySchema,
  ],
  ['expenses', 'Expenses report with a per-category summary', expensesReportQuerySchema],
];

const docs = securedDocs('Reports');
for (const [path, summary, query] of reports) {
  registry.registerPath({
    ...docs,
    method: 'get',
    path: `/branch/reports/${path}`,
    summary: `${summary}. Add format=csv to download. super_admin without branchId gets every branch with a branch breakdown.`,
    request: { query },
    responses: {
      200: {
        description: 'Report (JSON) or CSV file',
        content: {
          'application/json': { schema: dataEnvelope(reportSchema) },
          'text/csv': { schema: z.string() },
        },
      },
      ...errorResponses,
    },
  });
}

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/dashboard',
  summary:
    "Dashboard KPIs for the user's role: today/month sales and appointments, revenue split, low stock, pending deliveries, stock in/out and yearly chart series",
  request: { query: dashboardQuerySchema },
  responses: {
    200: { description: 'KPIs', ...jsonContent(dataEnvelope(z.record(z.string(), z.unknown()))) },
    ...errorResponses,
  },
});
