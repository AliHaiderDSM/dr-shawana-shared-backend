import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { Product } from '../products/product.entity';
import { ProductBatch } from './product-batch.entity';

export const ITEM_STATUSES = [
  'in_stock',
  'sold',
  'returned',
  'quarantined',
  'damaged',
  'expired',
  'supplier_returned',
  'dispatched',
  'written_off',
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_SOURCES = ['stock_in', 'production', 'labelled'] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

@Entity('inventory_items')
@Index('UQ_inventory_items_serial', ['serial'], { unique: true })
@Index(['branchId', 'productId', 'status'])
@Index(['sourceType', 'sourceId'])
export class InventoryItem extends BranchScopedEntity {
  @Column({ type: 'varchar', length: 30 })
  serial: string;

  @Column({ name: 'serial_no', type: 'bigint' })
  serialNo: string;

  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Index()
  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId: string | null;

  @ManyToOne(() => ProductBatch, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'batch_id' })
  batch?: ProductBatch | null;

  @Index()
  @Column({ type: 'enum', enum: ITEM_STATUSES, enumName: 'inventory_item_status', default: 'in_stock' })
  status: ItemStatus;

  @Column({ name: 'source_type', type: 'enum', enum: ITEM_SOURCES, enumName: 'inventory_item_source' })
  sourceType: ItemSource;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId: string | null;

  @Column({ name: 'received_on', type: 'date' })
  receivedOn: string;

  @Index()
  @Column({ name: 'sale_id', type: 'uuid', nullable: true })
  saleId: string | null;

  @Column({ name: 'sold_on', type: 'date', nullable: true })
  soldOn: string | null;

  @Index()
  @Column({ name: 'sale_return_item_id', type: 'uuid', nullable: true })
  saleReturnItemId: string | null;

  @Index()
  @Column({ name: 'stock_out_id', type: 'uuid', nullable: true })
  stockOutId: string | null;
}
