import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { withTransaction } from '../../database/transaction';
import { Decimal, toMoney } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { today } from '../../lib/validation';
import { accountSheetsRepository } from '../accounts/accounts.repository';
import { auditService } from '../audit/audit.service';
import { type Viewer } from '../doctors/doctors.service';
import { getAppointmentRecord } from './appointment-access';
import { paymentsFor } from './appointment-payments.service';
import { AppointmentRefund } from './appointment-refund.entity';
import { type RefundInput } from './appointments.schemas';

const refunds = branchScopedRepository(AppointmentRefund, 'ref');

export function toRefundDto(refund: AppointmentRefund) {
  const { accountSheet, appointment: _appointment, ...rest } = withoutInternals(refund);
  return {
    ...rest,
    accountSheet: accountSheet
      ? { id: accountSheet.id, accountName: accountSheet.accountName, accountCode: accountSheet.accountCode }
      : null,
  };
}

export async function refundsFor(branchId: string, appointmentIds: string[], manager?: EntityManager) {
  const grouped = new Map<string, AppointmentRefund[]>();
  if (appointmentIds.length === 0) return grouped;
  const rows = await refunds
    .query(branchId, manager)
    .leftJoinAndSelect('ref.accountSheet', 'sheet')
    .andWhere('ref.appointmentId IN (:...appointmentIds)', { appointmentIds })
    .orderBy('ref.date', 'ASC')
    .addOrderBy('ref.createdAt', 'ASC')
    .getMany();
  for (const row of rows) grouped.set(row.appointmentId, [...(grouped.get(row.appointmentId) ?? []), row]);
  return grouped;
}

export const refundedOf = (rows: AppointmentRefund[] = []) =>
  toMoney(rows.reduce((sum, r) => sum.plus(r.amount), new Decimal(0)));

async function receivedOf(branchId: string, appointmentId: string, manager: EntityManager) {
  const paid = (await paymentsFor(branchId, [appointmentId], manager)).get(appointmentId) ?? [];
  return paid.reduce((sum, p) => sum.plus(p.amount), new Decimal(0));
}

export async function assertRefundsCovered(
  branchId: string,
  appointmentId: string,
  manager: EntityManager,
  removingPayment = new Decimal(0),
) {
  const refunded = refundedOf((await refundsFor(branchId, [appointmentId], manager)).get(appointmentId));
  if (refunded.isZero()) return;
  const received = (await receivedOf(branchId, appointmentId, manager)).minus(removingPayment);
  if (received.lt(refunded)) {
    throw AppError.conflict(
      `${refunded.toFixed(2)} was refunded on this appointment. Remove the refund before taking the payment below it.`,
    );
  }
}

export const appointmentRefundsService = {
  async list(viewer: Viewer, appointmentId: string) {
    await getAppointmentRecord(viewer, appointmentId);
    return ((await refundsFor(viewer.branchId, [appointmentId])).get(appointmentId) ?? []).map(toRefundDto);
  },

  async add(actor: Actor, viewer: Viewer, appointmentId: string, input: RefundInput) {
    return withTransaction(async (em) => {
      const appointment = await getAppointmentRecord(viewer, appointmentId, em);
      if (appointment.status !== 'cancelled') {
        throw AppError.conflict('Only a cancelled appointment can be refunded. Cancel it first.');
      }
      const sheet = await accountSheetsRepository.findById(viewer.branchId, input.accountSheetId, em);
      if (!sheet) throw AppError.badRequest('The selected account was not found in this branch');
      const received = await receivedOf(viewer.branchId, appointmentId, em);
      const refunded = refundedOf(
        (await refundsFor(viewer.branchId, [appointmentId], em)).get(appointmentId),
      );
      const left = received.minus(refunded);
      if (new Decimal(input.amount).gt(left)) {
        throw AppError.unprocessable(
          left.lte(0)
            ? 'Nothing is left to refund on this appointment'
            : `At most ${toMoney(left).toFixed(2)} can be refunded on this appointment`,
        );
      }
      const date = input.date ?? today();
      if (date < appointment.createdAt.toISOString().slice(0, 10)) {
        throw AppError.badRequest('The refund date cannot be before the booking');
      }
      const saved = await refunds.create(
        viewer.branchId,
        actor.userId,
        {
          appointmentId,
          amount: toMoney(input.amount),
          method: input.method,
          accountSheetId: input.accountSheetId,
          date,
          note: input.note ?? null,
        },
        em,
      );
      const row = (await refundsFor(viewer.branchId, [appointmentId], em))
        .get(appointmentId)!
        .find((r) => r.id === saved.id)!;
      const dto = toRefundDto(row);
      await auditService.record(
        {
          actor,
          branchId: viewer.branchId,
          action: 'create',
          entity: 'appointment_refund',
          entityId: saved.id,
          after: dto,
        },
        em,
      );
      return dto;
    });
  },

  async remove(actor: Actor, viewer: Viewer, appointmentId: string, refundId: string) {
    await withTransaction(async (em) => {
      await getAppointmentRecord(viewer, appointmentId, em);
      const refund = (await refundsFor(viewer.branchId, [appointmentId], em))
        .get(appointmentId)
        ?.find((r) => r.id === refundId);
      if (!refund) throw AppError.notFound('Refund');
      await refunds.softDelete(refund, actor.userId, em);
      await auditService.record(
        {
          actor,
          branchId: viewer.branchId,
          action: 'delete',
          entity: 'appointment_refund',
          entityId: refundId,
          before: toRefundDto(refund),
        },
        em,
      );
    });
  },

  async removeAllFor(actor: Actor, branchId: string, appointmentId: string, manager: EntityManager) {
    const rows = (await refundsFor(branchId, [appointmentId], manager)).get(appointmentId) ?? [];
    for (const row of rows) await refunds.softDelete(row, actor.userId, manager);
  },
};
