import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn } from '../../database/transformers';
import { AccountSheet } from '../accounts/account-sheet.entity';
import { PAYMENT_METHODS, type PaymentMethod } from '../appointments/appointment-payment.entity';
import { Sale } from '../sales/sale.entity';
import { SaleReturnItem } from './sale-return-item.entity';

export const RETURN_REASONS = [
  'damaged',
  'expired',
  'wrong_item',
  'customer_refused',
  'not_delivered',
  'other',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const RETURN_STATUSES = ['pending', 'completed'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

@Entity('sale_returns')
@Index('UQ_sale_returns_branch_seq', ['branchId', 'returnSeq'], { unique: true })
@Index(['branchId', 'date'])
@Check('CHK_sale_returns_refund_amount', `"refund_amount" >= 0`)
@Check(
  'CHK_sale_returns_refund_fields',
  `("refund_amount" = 0) = ("refund_method" IS NULL AND "refund_account_sheet_id" IS NULL AND "refund_date" IS NULL)`,
)
export class SaleReturn extends BranchScopedEntity {
  @Column({ name: 'return_seq', type: 'integer' })
  returnSeq: number;

  @Index()
  @Column({ name: 'return_no', type: 'varchar', length: 30 })
  returnNo: string;

  @Index()
  @Column({ name: 'sale_id', type: 'uuid' })
  saleId: string;

  @ManyToOne(() => Sale, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sale_id' })
  sale?: Sale;

  @Column({ type: 'date' })
  date: string;

  @Index()
  @Column({ type: 'enum', enum: RETURN_REASONS, enumName: 'sale_return_reason' })
  reason: ReturnReason;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Index()
  @Column({ type: 'enum', enum: RETURN_STATUSES, enumName: 'sale_return_status', default: 'pending' })
  status: ReturnStatus;

  @Column({ ...moneyColumn({ default: '0' }), name: 'refund_amount' })
  refundAmount: Decimal;

  @Column({
    name: 'refund_method',
    type: 'enum',
    enum: PAYMENT_METHODS,
    enumName: 'payment_method',
    nullable: true,
  })
  refundMethod: PaymentMethod | null;

  @Index()
  @Column({ name: 'refund_account_sheet_id', type: 'uuid', nullable: true })
  refundAccountSheetId: string | null;

  @ManyToOne(() => AccountSheet, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'refund_account_sheet_id' })
  refundAccountSheet?: AccountSheet | null;

  @Column({ name: 'refund_date', type: 'date', nullable: true })
  refundDate: string | null;

  @OneToMany(() => SaleReturnItem, (item) => item.saleReturn)
  items?: SaleReturnItem[];
}
