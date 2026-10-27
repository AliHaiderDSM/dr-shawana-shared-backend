import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn } from '../../database/transformers';
import { AccountSheet } from '../accounts/account-sheet.entity';
import { Appointment } from './appointment.entity';
import { PAYMENT_METHODS, type PaymentMethod } from './appointment-payment.entity';

@Entity('appointment_refunds')
@Check('CHK_appointment_refunds_amount', `"amount" > 0`)
export class AppointmentRefund extends BranchScopedEntity {
  @Index('IDX_appointment_refunds_appointment')
  @Column({ name: 'appointment_id', type: 'uuid' })
  appointmentId: string;

  @ManyToOne(() => Appointment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Appointment;

  @Column(moneyColumn())
  amount: Decimal;

  @Column({ type: 'enum', enum: PAYMENT_METHODS, enumName: 'payment_method' })
  method: PaymentMethod;

  @Column({ name: 'account_sheet_id', type: 'uuid' })
  accountSheetId: string;

  @ManyToOne(() => AccountSheet, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_sheet_id' })
  accountSheet?: AccountSheet;

  @Index('IDX_appointment_refunds_date')
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;
}
