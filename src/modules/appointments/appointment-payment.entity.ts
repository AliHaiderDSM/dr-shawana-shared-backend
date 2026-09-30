import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn } from '../../database/transformers';
import { AccountSheet } from '../accounts/account-sheet.entity';
import { Appointment } from './appointment.entity';

export const PAYMENT_METHODS = ['cash', 'online'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

@Entity('appointment_payments')
@Check('CHK_appointment_payments_amount', `"amount" > 0`)
@Check(
  'CHK_appointment_payments_cash_fields',
  `"method" = 'online' OR ("sender_bank" IS NULL AND "sender_account_title" IS NULL AND "sender_account_no" IS NULL AND "proof_file_path" IS NULL)`,
)
export class AppointmentPayment extends BranchScopedEntity {
  @Index()
  @Column({ name: 'appointment_id', type: 'uuid' })
  appointmentId: string;

  @ManyToOne(() => Appointment, (appointment) => appointment.payments, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Appointment;

  @Index()
  @Column({ type: 'enum', enum: PAYMENT_METHODS, enumName: 'payment_method' })
  method: PaymentMethod;

  @Column(moneyColumn())
  amount: Decimal;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Index()
  @Column({ name: 'account_sheet_id', type: 'uuid' })
  accountSheetId: string;

  @ManyToOne(() => AccountSheet, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_sheet_id' })
  accountSheet?: AccountSheet;

  @Column({ name: 'sender_bank', type: 'varchar', length: 150, nullable: true })
  senderBank: string | null;

  @Column({ name: 'sender_account_title', type: 'varchar', length: 150, nullable: true })
  senderAccountTitle: string | null;

  @Column({ name: 'sender_account_no', type: 'varchar', length: 100, nullable: true })
  senderAccountNo: string | null;

  @Column({ name: 'proof_file_path', type: 'text', nullable: true })
  proofFilePath: string | null;

  @Column({ name: 'proof_original_name', type: 'varchar', length: 255, nullable: true })
  proofOriginalName: string | null;

  @Column({ name: 'proof_content_type', type: 'varchar', length: 100, nullable: true })
  proofContentType: string | null;
}
