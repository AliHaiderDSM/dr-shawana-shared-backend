import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Branch } from '../branches/branch.entity';

@Entity('document_sequences')
export class DocumentSequence {
  @PrimaryColumn({ name: 'branch_id', type: 'uuid' })
  branchId: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @PrimaryColumn({ type: 'varchar', length: 30 })
  key: string;

  @Column({ name: 'last_value', type: 'integer', default: 0 })
  lastValue: number;
}
