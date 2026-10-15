import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { type Decimal, moneyColumn, quantityColumn } from '../../database/transformers';
import { Bundle } from '../bundles/bundle.entity';
import { Product } from '../products/product.entity';

export const DISCOUNT_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'used'] as const;
export type DiscountRequestStatus = (typeof DISCOUNT_REQUEST_STATUSES)[number];

@Entity('discount_requests')
export class DiscountRequest extends BranchScopedEntity {
  @Column({ name: 'request_no', type: 'varchar', length: 30 })
  requestNo: string;

  @Index()
  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'product_id' })
  product?: Product | null;

  @Column({ name: 'bundle_id', type: 'uuid', nullable: true })
  bundleId: string | null;

  @ManyToOne(() => Bundle, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'bundle_id' })
  bundle?: Bundle | null;

  @Column(quantityColumn())
  qty: Decimal;

  @Column({ ...moneyColumn(), name: 'unit_price' })
  unitPrice: Decimal;

  @Column({ name: 'discount_percent', type: 'numeric', precision: 5, scale: 2 })
  discountPercent: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: DISCOUNT_REQUEST_STATUSES,
    enumName: 'discount_request_status',
    default: 'pending',
  })
  status: DiscountRequestStatus;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'decision_note', type: 'varchar', length: 500, nullable: true })
  decisionNote: string | null;

  @Index()
  @Column({ name: 'sale_id', type: 'uuid', nullable: true })
  saleId: string | null;

  @Index('IDX_discount_requests_patient')
  @Column({ name: 'patient_id', type: 'uuid', nullable: true })
  patientId: string | null;

  @Column({ name: 'customer_name', type: 'varchar', length: 200, nullable: true })
  customerName: string | null;
}
