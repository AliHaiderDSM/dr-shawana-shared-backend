import { type Decimal } from 'decimal.js';
import { Column, Entity, OneToMany } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn } from '../../database/transformers';
import { BundleItem } from './bundle-item.entity';

@Entity('bundles')
export class Bundle extends BranchScopedEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'image_path', type: 'text', nullable: true })
  imagePath: string | null;

  @Column({ name: 'total_price', ...moneyColumn({ default: '0' }) })
  totalPrice: Decimal;

  @OneToMany(() => BundleItem, (item) => item.bundle)
  items?: BundleItem[];
}
