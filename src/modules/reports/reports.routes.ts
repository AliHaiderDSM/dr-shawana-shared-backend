import { Router, type Request, type RequestHandler } from 'express';
import { type z } from 'zod';
import { actorFrom } from '../../lib/actor';
import { sendOk } from '../../lib/http';
import { AppError } from '../../lib/errors';
import { periodProblem, sendReport, type Report } from '../../lib/report';
import { today } from '../../lib/validation';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { requireRole } from '../../middleware/requireRole';
import { validate, validQuery } from '../../middleware/validate';
import { doctorsService } from '../doctors/doctors.service';
import { dashboardService } from './dashboard.service';
import {
  accountsBalanceQuerySchema,
  appointmentPaymentsReportQuerySchema,
  appointmentsReportQuerySchema,
  branchStockQuerySchema,
  dashboardQuerySchema,
  doctorSalesQuerySchema,
  expensesReportQuerySchema,
  financeQuerySchema,
  patientHistoryQuerySchema,
  purchasesQuerySchema,
  saleProductsQuerySchema,
  stockReportQuerySchema,
  appointmentPaymentsQuerySchema,
  profitLossQuerySchema,
  topProductsQuerySchema,
} from './reports.schemas';
import { appointmentPaymentsReportService } from './appointment-payments-report.service';
import { profitLossService } from './profit-loss.service';
import { reportsService, type ReportScope } from './reports.service';

export const reportsRouter = Router();

const scoped = [authenticate, branchScope({ allowAllForSuperAdmin: true })];

async function scopeOf(req: Request): Promise<ReportScope> {
  const branchId = req.branchId ?? null;
  const doctorId = branchId ? (await doctorsService.viewer(actorFrom(req), branchId)).doctorId : null;
  return { branchId, doctorId };
}

function mount<S extends z.ZodObject>(
  name: string,
  guard: RequestHandler,
  schema: S,
  run: (scope: ReportScope, query: z.output<S>) => Promise<Report>,
) {
  reportsRouter.get(
    `/branch/reports/${name}`,
    ...scoped,
    guard,
    validate({ query: schema }),
    async (req, res) => {
      const query = validQuery(req, schema) as z.output<S> & { format: 'json' | 'csv' };
      const problem = periodProblem(query as { month?: string; from?: string; to?: string }, today());
      if (problem)
        throw AppError.validation([{ path: 'query.from', message: problem, code: 'custom' }], problem);
      sendReport(res, await run(await scopeOf(req), query), query.format);
    },
  );
}

const adminOrAccountant = requireRole('branch_admin', 'accountant');

mount('sale-products', requirePermission('sales.view'), saleProductsQuerySchema, reportsService.saleProducts);
mount('purchases', adminOrAccountant, purchasesQuerySchema, reportsService.purchases);
mount('stock', adminOrAccountant, stockReportQuerySchema, reportsService.stock);
mount('branch-stock', adminOrAccountant, branchStockQuerySchema, reportsService.branchStock);
mount(
  'appointments',
  requirePermission('appointments.view'),
  appointmentsReportQuerySchema,
  reportsService.appointments,
);
mount(
  'appointment-payments',
  requirePermission('appointmentPayments.view'),
  appointmentPaymentsReportQuerySchema,
  reportsService.appointmentPayments,
);
mount(
  'doctor-sales',
  requireRole('branch_admin', 'accountant', 'doctor'),
  doctorSalesQuerySchema,
  reportsService.doctorSales,
);
mount(
  'patient-history',
  requirePermission('consultations.view'),
  patientHistoryQuerySchema,
  reportsService.patientHistory,
);
mount('finance', requirePermission('accounts.view'), financeQuerySchema, reportsService.finance);
mount(
  'accounts-balance',
  requirePermission('accounts.view'),
  accountsBalanceQuerySchema,
  reportsService.accountsBalance,
);
mount('expenses', requirePermission('expenses.view'), expensesReportQuerySchema, reportsService.expenses);

reportsRouter.get(
  '/admin/reports/appointment-payments',
  authenticate,
  requireRole('super_admin'),
  validate({ query: appointmentPaymentsQuerySchema }),
  async (req, res) => {
    const query = validQuery(req, appointmentPaymentsQuerySchema);
    const from = query.from ?? today();
    const to = query.to ?? from;
    const problem = periodProblem({ from, to }, today());
    if (problem)
      throw AppError.validation([{ path: 'query.from', message: problem, code: 'custom' }], problem);
    sendOk(res, await appointmentPaymentsReportService.entries(from, to, query.branchId ?? null));
  },
);

reportsRouter.get(
  '/admin/reports/profit-loss',
  authenticate,
  requireRole('super_admin'),
  validate({ query: profitLossQuerySchema }),
  async (req, res) => {
    const { year, month, branchId } = validQuery(req, profitLossQuerySchema);
    sendOk(res, await profitLossService.report(year, month ?? null, branchId ?? null));
  },
);

reportsRouter.get(
  '/branch/dashboard/top-products',
  ...scoped,
  requirePermission('dashboard.view'),
  requirePermission('sales.view'),
  validate({ query: topProductsQuerySchema }),
  async (req, res) => {
    const { range } = validQuery(req, topProductsQuerySchema);
    sendOk(res, await dashboardService.topProducts(await scopeOf(req), range));
  },
);

reportsRouter.get(
  '/branch/dashboard',
  ...scoped,
  requirePermission('dashboard.view'),
  validate({ query: dashboardQuerySchema }),
  async (req, res) => {
    const { year, from, to } = validQuery(req, dashboardQuerySchema);
    const problem = periodProblem({ from, to }, today());
    if (problem)
      throw AppError.validation([{ path: 'query.from', message: problem, code: 'custom' }], problem);
    sendOk(res, await dashboardService.kpis(actorFrom(req), await scopeOf(req), year, { from, to }));
  },
);
