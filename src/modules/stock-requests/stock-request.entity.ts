import { type Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { quantityColumn } from '../../database/transformers';
import { Product } from '../products/product.entity';

export const STOCK_REQUEST_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'sent',
  'received',
] as const;
export type StockRequestStatus = (typeof STOCK_REQUEST_STATUSES)[number];

@Entity('stock_requests')
export class StockRequest extends BranchScopedEntity {
  @Column({ name: 'request_no', type: 'varchar', length: 30 })
  requestNo: string;

  @Index()
  @Column({
    type: 'enum',
    enum: STOCK_REQUEST_STATUSES,
    enumName: 'stock_request_status',
    default: 'pending',
  })
  status: StockRequestStatus;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'decision_note', type: 'varchar', length: 500, nullable: true })
  decisionNote: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'received_at', type: 'timestamptz', nullable: true })
  receivedAt: Date | null;

  @Column({ name: 'received_by', type: 'uuid', nullable: true })
  receivedBy: string | null;

  @OneToMany(() => StockRequestItem, (item) => item.request)
  items?: StockRequestItem[];
}

@Entity('stock_request_items')
export class StockRequestItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @ManyToOne(() => StockRequest, (request) => request.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request?: StockRequest;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column(quantityColumn())
  qty: Decimal;

  @Column({ name: 'approved_qty', ...quantityColumn({ nullable: true }) })
  approvedQty: Decimal | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;
}
