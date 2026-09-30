import { type Decimal } from 'decimal.js';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { moneyColumn, quantityColumn } from '../../database/transformers';
import { Product } from '../products/product.entity';
import { Bundle } from './bundle.entity';

@Entity('bundle_items')
@Index('UQ_bundle_items_bundle_product', ['bundleId', 'productId'], { unique: true })
@Check('CHK_bundle_items_qty', `"qty" > 0`)
export class BundleItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'bundle_id', type: 'uuid' })
  bundleId: string;

  @ManyToOne(() => Bundle, (bundle) => bundle.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bundle_id' })
  bundle?: Bundle;

  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column(quantityColumn({ default: '1' }))
  qty: Decimal;

  @Column(moneyColumn())
  price: Decimal;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
