import { type EntityManager, type SelectQueryBuilder } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo, withTransaction } from '../../database/transaction';
import { Decimal, toMoney } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { removeQuietly, uploadMany, withUploads, type UploadedFile } from '../../lib/file-uploads';
import { withoutInternals } from '../../lib/http';
import { escapeLike, pageMeta } from '../../lib/pagination';
import { BUCKETS, createSignedUrl } from '../../lib/storage';
import { today } from '../../lib/validation';
import { accountSheetsRepository } from '../accounts/accounts.repository';
import { auditService } from '../audit/audit.service';
import { type Viewer } from '../doctors/doctors.service';
import { getAppointmentRecord } from './appointment-access';
import { AppointmentPayment } from './appointment-payment.entity';
import { type PaymentInput, type PaymentReportQuery, type UpdatePaymentInput } from './appointments.schemas';

const payments = branchScopedRepository(AppointmentPayment, 'pay');

export function toPaymentDto(payment: AppointmentPayment) {
  const {
    accountSheet,
    proofFilePath,
    proofContentType: _contentType,
    appointment: _appointment,
    ...rest
  } = withoutInternals(payment);
  return {
    ...rest,
    accountSheet: accountSheet
      ? { id: accountSheet.id, accountName: accountSheet.accountName, accountCode: accountSheet.accountCode }
      : null,
    hasProof: proofFilePath !== null,
  };
}

export const uploadProofs = (branchId: string, files: Express.Multer.File[]) =>
  uploadMany(BUCKETS.paymentProofs, `${branchId}/appointments`, files);

const CASH_CLEARED = {
  senderBank: null,
  senderAccountTitle: null,
  senderAccountNo: null,
  proofFilePath: null,
  proofOriginalName: null,
  proofContentType: null,
};

const proofFields = (file: UploadedFile | undefined) =>
  file
    ? { proofFilePath: file.path, proofOriginalName: file.originalName, proofContentType: file.contentType }
    : {};

async function assertAccountSheet(branchId: string, id: string, manager: EntityManager) {
  const sheet = await accountSheetsRepository.findById(branchId, id, manager);
  if (!sheet) throw AppError.badRequest('The selected receiving account was not found in this branch');
}

export function assertProofIndexes(inputs: PaymentInput[], proofCount: number) {
  inputs.forEach((p, i) => {
    if (p.proofIndex === undefined) return;
    if (p.method !== 'online')
      throw AppError.badRequest(`Payment ${i + 1}: only online payments take a screenshot`);
    if (p.proofIndex >= proofCount)
      throw AppError.badRequest(`Payment ${i + 1}: screenshot ${p.proofIndex} was not uploaded`);
  });
}

function withSheet(branchId: string, manager?: EntityManager) {
  return payments.query(branchId, manager).leftJoinAndSelect('pay.accountSheet', 'sheet');
}

export async function paymentsFor(branchId: string, appointmentIds: string[], manager?: EntityManager) {
  const grouped = new Map<string, AppointmentPayment[]>();
  if (appointmentIds.length === 0) return grouped;
  const rows = await withSheet(branchId, manager)
    .andWhere('pay.appointmentId IN (:...appointmentIds)', { appointmentIds })
    .orderBy('pay.date', 'ASC')
    .addOrderBy('pay.createdAt', 'ASC')
    .getMany();
  for (const row of rows) grouped.set(row.appointmentId, [...(grouped.get(row.appointmentId) ?? []), row]);
  return grouped;
}

export function paymentTotals(rows: AppointmentPayment[] = []) {
  return {
    receivedAmount: toMoney(rows.reduce((sum, p) => sum.plus(p.amount), new Decimal(0))),
    paymentMethods: [...new Set(rows.map((p) => p.method))],
  };
}

async function insertPayment(
  manager: EntityManager,
  actor: Actor,
  branchId: string,
  appointmentId: string,
  input: PaymentInput,
  proof: UploadedFile | undefined,
) {
  await assertAccountSheet(branchId, input.accountSheetId, manager);
  const { proofIndex: _proofIndex, ...fields } = input;
  const details =
    fields.method === 'cash'
      ? CASH_CLEARED
      : {
          senderBank: fields.senderBank ?? null,
          senderAccountTitle: fields.senderAccountTitle ?? null,
          senderAccountNo: fields.senderAccountNo ?? null,
          ...proofFields(proof),
        };
  return payments.create(
    branchId,
    actor.userId,
    {
      ...fields,
      appointmentId,
      date: fields.date ?? today(),
      ...details,
    } as unknown as Partial<AppointmentPayment>,
    manager,
  );
}

export async function insertPayments(
  manager: EntityManager,
  actor: Actor,
  branchId: string,
  appointmentId: string,
  inputs: PaymentInput[],
  proofs: UploadedFile[],
) {
  for (const input of inputs) {
    const proof = input.proofIndex === undefined ? undefined : proofs[input.proofIndex];
    await insertPayment(manager, actor, branchId, appointmentId, input, proof);
  }
}

async function getPayment(
  branchId: string,
  appointmentId: string,
  paymentId: string,
  manager?: EntityManager,
) {
  const payment = await withSheet(branchId, manager)
    .andWhere('pay.id = :paymentId', { paymentId })
    .andWhere('pay.appointmentId = :appointmentId', { appointmentId })
    .getOne();
  if (!payment) throw AppError.notFound('Payment');
  return payment;
}

async function reloadDto(branchId: string, appointmentId: string, paymentId: string, manager: EntityManager) {
  return toPaymentDto(await getPayment(branchId, appointmentId, paymentId, manager));
}

function applyReportFilters(
  qb: SelectQueryBuilder<AppointmentPayment>,
  viewer: Viewer,
  query: PaymentReportQuery,
) {
  qb.where('pay.branchId = :branchId', { branchId: viewer.branchId });
  if (viewer.doctorId) qb.andWhere('a.doctorId = :viewerDoctorId', { viewerDoctorId: viewer.doctorId });
  if (query.month) qb.andWhere(`to_char(pay.date, 'YYYY-MM') = :month`, { month: query.month });
  if (query.from) qb.andWhere('pay.date >= :from', { from: query.from });
  if (query.to) qb.andWhere('pay.date <= :to', { to: query.to });
  if (query.method) qb.andWhere('pay.method = :method', { method: query.method });
  if (query.accountSheetId) qb.andWhere('pay.accountSheetId = :sheet', { sheet: query.accountSheetId });
  if (query.doctorId) qb.andWhere('a.doctorId = :doctorId', { doctorId: query.doctorId });
  if (query.patientId) qb.andWhere('a.patientId = :patientId', { patientId: query.patientId });
  if (query.status) qb.andWhere('a.status = :status', { status: query.status });
  if (query.mode) qb.andWhere('a.mode = :mode', { mode: query.mode });
  if (query.bhrtStatus) qb.andWhere('p.bhrtStatus = :bhrt', { bhrt: query.bhrtStatus });
  if (query.city) qb.andWhere('a.patientCity ILIKE :city', { city: escapeLike(query.city) });
  if (query.search) {
    qb.andWhere(
      `(p.name ILIKE :term OR p.phone ILIKE :term OR CONCAT('APP#', a.appointment_no) ILIKE :term)`,
      {
        term: `%${escapeLike(query.search)}%`,
      },
    );
  }
  return qb;
}

function reportBase(viewer: Viewer, query: PaymentReportQuery) {
  return applyReportFilters(
    repo(AppointmentPayment)
      .createQueryBuilder('pay')
      .innerJoin('pay.appointment', 'a')
      .innerJoin('a.patient', 'p')
      .innerJoin('a.doctor', 'd'),
    viewer,
    query,
  );
}

interface ReportRow {
  appointmentId: string;
  appointmentNo: number;
  date: string;
  timeFrom: string;
  timeTo: string;
  status: string;
  mode: string;
  patientCity: string | null;
  patientId: string;
  patientName: string;
  patientPhone: string;
  bhrtStatus: string;
  doctorId: string;
  doctorName: string;
  methods: string[];
  lastPaymentDate: string;
  amount: string;
}

export const appointmentPaymentsService = {
  async list(viewer: Viewer, appointmentId: string) {
    await getAppointmentRecord(viewer, appointmentId);
    return ((await paymentsFor(viewer.branchId, [appointmentId])).get(appointmentId) ?? []).map(toPaymentDto);
  },

  async add(
    actor: Actor,
    viewer: Viewer,
    appointmentId: string,
    input: PaymentInput,
    proof?: Express.Multer.File,
  ) {
    if (proof && input.method !== 'online')
      throw AppError.badRequest('Only online payments take a screenshot');
    await getAppointmentRecord(viewer, appointmentId);
    const uploaded = proof ? await uploadProofs(viewer.branchId, [proof]) : [];
    return withUploads(uploaded, () =>
      withTransaction(async (em) => {
        const created = await insertPayment(em, actor, viewer.branchId, appointmentId, input, uploaded[0]);
        const dto = await reloadDto(viewer.branchId, appointmentId, created.id, em);
        await auditService.record(
          {
            actor,
            branchId: viewer.branchId,
            action: 'create',
            entity: 'appointment_payment',
            entityId: created.id,
            after: dto,
          },
          em,
        );
        return dto;
      }),
    );
  },

  async update(
    actor: Actor,
    viewer: Viewer,
    appointmentId: string,
    paymentId: string,
    input: UpdatePaymentInput,
  ) {
    let removedProof: string | null = null;
    const dto = await withTransaction(async (em) => {
      await getAppointmentRecord(viewer, appointmentId, em);
      const payment = await getPayment(viewer.branchId, appointmentId, paymentId, em);
      if (input.accountSheetId) await assertAccountSheet(viewer.branchId, input.accountSheetId, em);
      const before = toPaymentDto(payment);
      Object.assign(payment, input, { updatedBy: actor.userId });
      if (payment.method === 'cash') {
        removedProof = payment.proofFilePath;
        Object.assign(payment, CASH_CLEARED);
      }
      delete payment.accountSheet;
      await payments.save(payment, em);
      const after = await reloadDto(viewer.branchId, appointmentId, paymentId, em);
      await auditService.record(
        {
          actor,
          branchId: viewer.branchId,
          action: 'update',
          entity: 'appointment_payment',
          entityId: paymentId,
          before,
          after,
        },
        em,
      );
      return after;
    });
    if (removedProof) await removeQuietly(BUCKETS.paymentProofs, [removedProof]);
    return dto;
  },

  async setProof(
    actor: Actor,
    viewer: Viewer,
    appointmentId: string,
    paymentId: string,
    file: Express.Multer.File,
  ) {
    await getAppointmentRecord(viewer, appointmentId);
    const existing = await getPayment(viewer.branchId, appointmentId, paymentId);
    if (existing.method !== 'online') throw AppError.badRequest('Only online payments take a screenshot');
    const uploaded = await uploadProofs(viewer.branchId, [file]);
    const previous = existing.proofFilePath;
    const dto = await withUploads(uploaded, () =>
      withTransaction(async (em) => {
        const payment = await getPayment(viewer.branchId, appointmentId, paymentId, em);
        Object.assign(payment, proofFields(uploaded[0]), { updatedBy: actor.userId });
        delete payment.accountSheet;
        await payments.save(payment, em);
        await auditService.record(
          {
            actor,
            branchId: viewer.branchId,
            action: 'replace_proof',
            entity: 'appointment_payment',
            entityId: paymentId,
          },
          em,
        );
        return reloadDto(viewer.branchId, appointmentId, paymentId, em);
      }),
    );
    if (previous) await removeQuietly(BUCKETS.paymentProofs, [previous]);
    return dto;
  },

  async proofUrl(viewer: Viewer, appointmentId: string, paymentId: string) {
    await getAppointmentRecord(viewer, appointmentId);
    const payment = await getPayment(viewer.branchId, appointmentId, paymentId);
    if (!payment.proofFilePath) throw AppError.notFound('Payment screenshot');
    return createSignedUrl(BUCKETS.paymentProofs, payment.proofFilePath);
  },

  async remove(actor: Actor, viewer: Viewer, appointmentId: string, paymentId: string) {
    await withTransaction(async (em) => {
      await getAppointmentRecord(viewer, appointmentId, em);
      const payment = await getPayment(viewer.branchId, appointmentId, paymentId, em);
      await payments.softDelete(payment, actor.userId, em);
      await auditService.record(
        {
          actor,
          branchId: viewer.branchId,
          action: 'delete',
          entity: 'appointment_payment',
          entityId: paymentId,
          before: toPaymentDto(payment),
        },
        em,
      );
    });
  },

  async removeAllFor(actor: Actor, branchId: string, appointmentId: string, manager: EntityManager) {
    const rows = await payments
      .query(branchId, manager)
      .andWhere('pay.appointmentId = :appointmentId', { appointmentId })
      .getMany();
    for (const row of rows) await payments.softDelete(row, actor.userId, manager);
  },

  async report(viewer: Viewer, query: PaymentReportQuery) {
    const direction = query.sort.startsWith('-') ? 'DESC' : 'ASC';
    const rows = await reportBase(viewer, query)
      .select('a.id', 'appointmentId')
      .addSelect('a.appointment_no', 'appointmentNo')
      .addSelect(`to_char(a.date, 'YYYY-MM-DD')`, 'date')
      .addSelect('a.time_from', 'timeFrom')
      .addSelect('a.time_to', 'timeTo')
      .addSelect('a.status', 'status')
      .addSelect('a.mode', 'mode')
      .addSelect('a.patient_city', 'patientCity')
      .addSelect('p.id', 'patientId')
      .addSelect('p.name', 'patientName')
      .addSelect('p.phone', 'patientPhone')
      .addSelect('p.bhrt_status', 'bhrtStatus')
      .addSelect('d.id', 'doctorId')
      .addSelect('d.display_name', 'doctorName')
      .addSelect('array_agg(DISTINCT pay.method::text)', 'methods')
      .addSelect(`to_char(MAX(pay.date), 'YYYY-MM-DD')`, 'lastPaymentDate')
      .addSelect('SUM(pay.amount)', 'amount')
      .groupBy('a.id')
      .addGroupBy('p.id')
      .addGroupBy('d.id')
      .orderBy('a.date', direction)
      .addOrderBy('a.appointment_no', direction)
      .offset((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .getRawMany<ReportRow>();

    const totals = await reportBase(viewer, query)
      .select('COUNT(DISTINCT a.id)', 'count')
      .addSelect('COALESCE(SUM(pay.amount), 0)', 'amount')
      .getRawOne<{ count: string; amount: string }>();

    return {
      items: rows.map((r) => ({
        appointmentId: r.appointmentId,
        appointmentNo: Number(r.appointmentNo),
        date: r.date,
        timeFrom: r.timeFrom,
        timeTo: r.timeTo,
        status: r.status,
        mode: r.mode,
        patientCity: r.patientCity,
        patient: { id: r.patientId, name: r.patientName, phone: r.patientPhone, bhrtStatus: r.bhrtStatus },
        doctor: { id: r.doctorId, name: r.doctorName },
        methods: r.methods,
        lastPaymentDate: r.lastPaymentDate,
        amount: toMoney(r.amount),
      })),
      meta: { ...pageMeta(query, Number(totals?.count ?? 0)), totalAmount: toMoney(totals?.amount ?? 0) },
    };
  },
};
