import { Column, Entity, Index } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';

export interface ReportSummary {
  patient: { label: string; value: string }[];
  abnormal: { test: string; value: string; unit: string; range: string; flag: string }[];
  normal: { category: string; tests: string }[];
  overview: string;
  reviewPoints: string[];
  unreadable: string[];
}

@Entity('lab_report_summaries')
@Index(['patientId', 'createdAt'])
export class LabReportSummary extends BranchScopedEntity {
  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @Column({ name: 'test_date', type: 'date', nullable: true })
  testDate: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  fileName: string | null;

  @Column({ name: 'values_found', type: 'integer', default: 0 })
  valuesFound: number;

  @Column({ type: 'jsonb' })
  summary: ReportSummary;

  @Column({ type: 'varchar', length: 80, nullable: true })
  model: string | null;
}
