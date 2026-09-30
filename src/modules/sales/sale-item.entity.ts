import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn, quantityColumn } from '../../database/transformers';
import { Bundle } from '../bundles/bundle.entity';
import { Product } from '../products/product.entity';
import { Sale } from './sale.entity';

@Entity('sale_items')
@Check('CHK_sale_items_qty', `"qty" > 0`)
export class SaleItem extends BranchScopedEntity {
  @Index()
  @Column({ name: 'sale_id', type: 'uuid' })
  saleId: string;

  @ManyToOne(() => Sale, (sale) => sale.items, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sale_id' })
  sale?: Sale;

  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Index()
  @Column({ name: 'bundle_id', type: 'uuid', nullable: true })
  bundleId: string | null;

  @ManyToOne(() => Bundle, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'bundle_id' })
  bundle?: Bundle | null;

  @Column(quantityColumn())
  qty: Decimal;

  @Column({ ...moneyColumn(), name: 'unit_price' })
  unitPrice: Decimal;

  @Column({ ...moneyColumn(), name: 'line_total' })
  lineTotal: Decimal;
}
