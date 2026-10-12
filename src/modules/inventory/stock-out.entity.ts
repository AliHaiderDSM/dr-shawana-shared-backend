import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { quantityColumn } from '../../database/transformers';
import { Branch } from '../branches/branch.entity';
import { Product } from '../products/product.entity';
import { Supplier } from '../suppliers/supplier.entity';

@Entity('stock_outs')
@Check('CHK_stock_outs_qty', `"qty" > 0`)
export class StockOut extends BranchScopedEntity {
  @Index()
  @Column({ name: 'dispatcher_id', type: 'uuid', nullable: true })
  dispatcherId: string | null;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'dispatcher_id' })
  dispatcher?: Supplier | null;

  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column(quantityColumn())
  qty: Decimal;

  @Index()
  @Column({ type: 'varchar', length: 150 })
  destination: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Index()
  @Column({ name: 'to_branch_id', type: 'uuid', nullable: true })
  toBranchId: string | null;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'to_branch_id' })
  toBranch?: Branch | null;

  @Column({ name: 'transfer_no', type: 'varchar', length: 30, nullable: true })
  transferNo: string | null;

  @Column({ name: 'stock_request_id', type: 'uuid', nullable: true })
  stockRequestId: string | null;

  @Column({ name: 'received_at', type: 'timestamptz', nullable: true })
  receivedAt: Date | null;

  @Column({ name: 'received_by', type: 'uuid', nullable: true })
  receivedBy: string | null;
}
