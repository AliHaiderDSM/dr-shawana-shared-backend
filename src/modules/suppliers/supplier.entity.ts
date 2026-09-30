import { Column, Entity, Index } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';

export const SUPPLIER_TYPES = ['supplier', 'dispatcher'] as const;
export type SupplierType = (typeof SUPPLIER_TYPES)[number];

@Entity('suppliers')
export class Supplier extends BranchScopedEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 30 })
  phone: string;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Index()
  @Column({ type: 'enum', enum: SUPPLIER_TYPES, enumName: 'supplier_type' })
  type: SupplierType;
}
