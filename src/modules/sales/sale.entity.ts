import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn } from '../../database/transformers';
import { Patient } from '../patients/patient.entity';
import { SaleItem } from './sale-item.entity';
import { SalePayment } from './sale-payment.entity';

export const SALE_TYPES = ['office', 'online'] as const;
export type SaleType = (typeof SALE_TYPES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DELIVERY_STATUSES = ['pending', 'dispatched', 'delivered', 'returned', 'cancelled'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

@Entity('sales')
@Index('UQ_sales_branch_invoice', ['branchId', 'invoiceSeq'], { unique: true })
@Index(['branchId', 'date'])
@Check('CHK_sales_delivery', `("sale_type" = 'online') = ("delivery_status" IS NOT NULL)`)
@Check('CHK_sales_discount', `"discount_percent" >= 0 AND "discount_percent" <= 100`)
export class Sale extends BranchScopedEntity {
  @Column({ name: 'invoice_seq', type: 'integer' })
  invoiceSeq: number;

  @Index()
  @Column({ name: 'invoice_no', type: 'varchar', length: 30 })
  invoiceNo: string;

  @Index()
  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'patient_id' })
  patient?: Patient;

  @Column({ name: 'patient_city', type: 'varchar', length: 100, nullable: true })
  patientCity: string | null;

  @Index()
  @Column({ name: 'sale_type', type: 'enum', enum: SALE_TYPES, enumName: 'sale_type' })
  saleType: SaleType;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'total_qty', type: 'numeric', precision: 12, scale: 3, default: 0 })
  totalQty: string;

  @Column({ ...moneyColumn(), name: 'subtotal' })
  subtotal: Decimal;

  @Column({ name: 'discount_percent', type: 'numeric', precision: 5, scale: 2, default: 0 })
  discountPercent: string;

  @Column({ ...moneyColumn({ default: '0' }), name: 'discount_amount' })
  discountAmount: Decimal;

  @Column({ ...moneyColumn(), name: 'total' })
  total: Decimal;

  @Column({ ...moneyColumn({ default: '0' }), name: 'received' })
  received: Decimal;

  @Column({ ...moneyColumn({ default: '0' }), name: 'remaining' })
  remaining: Decimal;

  @Index()
  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PAYMENT_STATUSES,
    enumName: 'sale_payment_status',
    default: 'unpaid',
  })
  paymentStatus: PaymentStatus;

  @Index()
  @Column({
    name: 'delivery_status',
    type: 'enum',
    enum: DELIVERY_STATUSES,
    enumName: 'sale_delivery_status',
    nullable: true,
  })
  deliveryStatus: DeliveryStatus | null;

  @Index()
  @Column({ name: 'dispatched_on', type: 'date', nullable: true })
  dispatchedOn: string | null;

  @Column({ name: 'dispatched_by', type: 'uuid', nullable: true })
  dispatchedBy: string | null;

  @Column({ name: 'delivered_on', type: 'date', nullable: true })
  deliveredOn: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @OneToMany(() => SaleItem, (item) => item.sale)
  items?: SaleItem[];

  @OneToMany(() => SalePayment, (payment) => payment.sale)
  payments?: SalePayment[];
}
