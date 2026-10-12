import { type Decimal } from 'decimal.js';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { quantityColumn } from '../../database/transformers';
import { Product } from '../products/product.entity';
import { ProductBatch } from './product-batch.entity';

export const WRITE_OFF_REASON_VALUES = ['expired', 'damaged', 'lost', 'adjustment'] as const;
export type WriteOffReason = (typeof WRITE_OFF_REASON_VALUES)[number];

export const WRITE_OFF_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type WriteOffStatus = (typeof WRITE_OFF_STATUSES)[number];

@Entity('stock_write_offs')
export class StockWriteOff extends BranchScopedEntity {
  @Column({ name: 'write_off_no', type: 'varchar', length: 30 })
  writeOffNo: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId: string | null;

  @ManyToOne(() => ProductBatch, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'batch_id' })
  batch?: ProductBatch | null;

  @Column(quantityColumn())
  qty: Decimal;

  @Column({ type: 'enum', enum: WRITE_OFF_REASON_VALUES, enumName: 'write_off_reason' })
  reason: WriteOffReason;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: WRITE_OFF_STATUSES, enumName: 'write_off_status', default: 'pending' })
  status: WriteOffStatus;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  serials: string[];

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'decision_note', type: 'varchar', length: 500, nullable: true })
  decisionNote: string | null;
}
