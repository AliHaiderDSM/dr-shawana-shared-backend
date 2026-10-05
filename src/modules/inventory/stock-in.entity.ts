import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn, quantityColumn } from '../../database/transformers';
import { Product } from '../products/product.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { ProductBatch } from './product-batch.entity';

@Entity('stock_ins')
@Check('CHK_stock_ins_qty', `"qty" > 0`)
export class StockIn extends BranchScopedEntity {
  @Index()
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId: string | null;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'supplier_id' })
  supplier?: Supplier | null;

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
  @Column({ type: 'varchar', length: 100, nullable: true })
  batch: string | null;

  @Index()
  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId: string | null;

  @ManyToOne(() => ProductBatch, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'batch_id' })
  productBatch?: ProductBatch | null;

  @Column({ name: 'manufacturing_date', type: 'date', nullable: true })
  manufacturingDate: string | null;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate: string | null;

  @Column({ name: 'unit_cost', ...moneyColumn({ nullable: true }) })
  unitCost: Decimal | null;

  @Index()
  @Column({ name: 'transfer_out_id', type: 'uuid', nullable: true })
  transferOutId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}
