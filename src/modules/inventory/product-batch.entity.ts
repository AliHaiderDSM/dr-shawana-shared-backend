import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn } from '../../database/transformers';
import { Product } from '../products/product.entity';
import { Supplier } from '../suppliers/supplier.entity';

@Entity('product_batches')
@Index('UQ_product_batches_product_batch_no', ['productId', 'batchNo'], { unique: true })
@Check(
  'CHK_product_batches_dates',
  `"expiry_date" IS NULL OR "manufacturing_date" IS NULL OR "expiry_date" >= "manufacturing_date"`,
)
export class ProductBatch extends BranchScopedEntity {
  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ name: 'batch_no', type: 'varchar', length: 100 })
  batchNo: string;

  @Column({ name: 'manufacturing_date', type: 'date', nullable: true })
  manufacturingDate: string | null;

  @Index()
  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate: string | null;

  @Index()
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId: string | null;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'supplier_id' })
  supplier?: Supplier | null;

  @Column({ name: 'unit_cost', ...moneyColumn({ nullable: true }) })
  unitCost: Decimal | null;
}
