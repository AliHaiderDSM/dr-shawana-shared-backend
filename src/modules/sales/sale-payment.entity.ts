import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn } from '../../database/transformers';
import { AccountSheet } from '../accounts/account-sheet.entity';
import { PAYMENT_METHODS, type PaymentMethod } from '../appointments/appointment-payment.entity';
import { SalePaymentProof } from './sale-payment-proof.entity';
import { Sale } from './sale.entity';

@Entity('sale_payments')
@Check('CHK_sale_payments_amount', `"amount" > 0`)
@Check(
  'CHK_sale_payments_cash_fields',
  `"method" = 'online' OR ("sender_bank" IS NULL AND "sender_account_title" IS NULL AND "sender_account_no" IS NULL)`,
)
export class SalePayment extends BranchScopedEntity {
  @Index()
  @Column({ name: 'sale_id', type: 'uuid' })
  saleId: string;

  @ManyToOne(() => Sale, (sale) => sale.payments, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sale_id' })
  sale?: Sale;

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

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @OneToMany(() => SalePaymentProof, (proof) => proof.payment)
  proofs?: SalePaymentProof[];
}
