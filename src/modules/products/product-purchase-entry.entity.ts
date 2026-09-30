import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn, quantityColumn } from '../../database/transformers';
import { Supplier } from '../suppliers/supplier.entity';
import { Product } from './product.entity';

@Entity('product_purchase_entries')
@Check('CHK_product_purchase_entries_quantity', `"quantity" > 0`)
export class ProductPurchaseEntry extends BranchScopedEntity {
  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Index()
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId: string | null;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'supplier_id' })
  supplier?: Supplier | null;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column(quantityColumn())
  quantity: Decimal;

  @Column({ name: 'unit_price', ...moneyColumn() })
  unitPrice: Decimal;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}
