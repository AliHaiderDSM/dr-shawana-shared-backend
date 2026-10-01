import { type Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn, quantityColumn } from '../../database/transformers';
import { Category } from '../categories/category.entity';

export const PRODUCT_STATUSES = ['active', 'inactive'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

@Entity('products')
@Index('UQ_products_branch_sku', ['branchId', 'sku'], {
  unique: true,
  where: '"sku" IS NOT NULL AND "deleted_at" IS NULL',
})
@Index('UQ_products_branch_barcode', ['branchId', 'barcode'], {
  unique: true,
  where: '"barcode" IS NOT NULL AND "deleted_at" IS NULL',
})
export class Product extends BranchScopedEntity {
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Index()
  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => Category, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category?: Category;

  @Column({ type: 'varchar', length: 60, nullable: true })
  sku: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  barcode: string | null;

  @Column({ name: 'batch_no', type: 'varchar', length: 100, nullable: true })
  batchNo: string | null;

  @Column({ name: 'size_grams', ...quantityColumn({ nullable: true }) })
  sizeGrams: Decimal | null;

  @Column({ name: 'image_path', type: 'text', nullable: true })
  imagePath: string | null;

  @Column({ type: 'varchar', length: 30, default: 'pcs' })
  unit: string;

  @Column({ name: 'low_stock_threshold', ...quantityColumn({ default: '10' }) })
  lowStockThreshold: Decimal;

  @Column({ name: 'sale_price', ...moneyColumn({ default: '0' }) })
  salePrice: Decimal;

  @Index()
  @Column({ type: 'enum', enum: PRODUCT_STATUSES, enumName: 'product_status', default: 'active' })
  status: ProductStatus;
}
