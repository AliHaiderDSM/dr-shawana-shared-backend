import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { quantityColumn } from '../../database/transformers';
import { Product } from '../products/product.entity';
import { Supplier } from '../suppliers/supplier.entity';

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

  @Column({ type: 'text', nullable: true })
  note: string | null;
}
