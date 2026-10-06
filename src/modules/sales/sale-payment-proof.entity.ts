import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { SalePayment } from './sale-payment.entity';

@Entity('sale_payment_proofs')
export class SalePaymentProof extends BranchScopedEntity {
  @Index()
  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId: string;

  @ManyToOne(() => SalePayment, (payment) => payment.proofs, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_id' })
  payment?: SalePayment;

  @Column({ name: 'file_path', type: 'text' })
  filePath: string;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @Column({ name: 'content_type', type: 'varchar', length: 100 })
  contentType: string;

  @Column({ name: 'size_bytes', type: 'integer', default: 0 })
  sizeBytes: number;
}
