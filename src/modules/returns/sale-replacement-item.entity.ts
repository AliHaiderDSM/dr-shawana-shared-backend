import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { quantityColumn } from '../../database/transformers';
import { Product } from '../products/product.entity';
import { SaleReplacement } from './sale-replacement.entity';

@Entity('sale_replacement_items')
@Check('CHK_sale_replacement_items_qty', `"qty" > 0`)
export class SaleReplacementItem extends BranchScopedEntity {
  @Index()
  @Column({ name: 'sale_replacement_id', type: 'uuid' })
  saleReplacementId: string;

  @ManyToOne(() => SaleReplacement, (r) => r.items, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sale_replacement_id' })
  replacement?: SaleReplacement;

  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column(quantityColumn())
  qty: Decimal;
}
