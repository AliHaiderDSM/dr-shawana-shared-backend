import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { MedicalRecord } from './medical-record.entity';

@Entity('medical_record_files')
export class MedicalRecordFile extends BranchScopedEntity {
  @Index()
  @Column({ name: 'medical_record_id', type: 'uuid' })
  medicalRecordId: string;

  @ManyToOne(() => MedicalRecord, (record) => record.files, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'medical_record_id' })
  medicalRecord?: MedicalRecord;

  @Column({ name: 'file_path', type: 'text' })
  filePath: string;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @Column({ name: 'content_type', type: 'varchar', length: 100 })
  contentType: string;

  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes: number;
}
