import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { quantityColumn } from '../../database/transformers';
import { Product } from '../products/product.entity';
import { SaleReturn } from './sale-return.entity';

export const RETURN_DISPOSITIONS = [
  'pending',
  'quarantined',
  'restocked',
  'damaged',
  'expired',
  'supplier',
] as const;
export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];

@Entity('sale_return_items')
@Check('CHK_sale_return_items_qty', `"qty" > 0`)
@Check('CHK_sale_return_items_resolved', `("disposition" = 'pending') = ("resolved_at" IS NULL)`)
export class SaleReturnItem extends BranchScopedEntity {
  @Index()
  @Column({ name: 'sale_return_id', type: 'uuid' })
  saleReturnId: string;

  @ManyToOne(() => SaleReturn, (r) => r.items, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sale_return_id' })
  saleReturn?: SaleReturn;

  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column(quantityColumn())
  qty: Decimal;

  @Index()
  @Column({
    type: 'enum',
    enum: RETURN_DISPOSITIONS,
    enumName: 'sale_return_disposition',
    default: 'pending',
  })
  disposition: ReturnDisposition;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;
}
