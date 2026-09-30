import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { Consultation } from './consultation.entity';

export const SECTION_KEYS = [
  'basic_info',
  'follow_up',
  'medical_history',
  'mrs_scale',
  'additional_symptoms',
  'imaging_results',
  'clinical_assessment',
  'referral',
  'plans',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

@Entity('consultation_sections')
@Index('UQ_consultation_sections_key', ['consultationId', 'sectionKey'], {
  unique: true,
  where: `"deleted_at" IS NULL`,
})
export class ConsultationSection extends BranchScopedEntity {
  @Index()
  @Column({ name: 'consultation_id', type: 'uuid' })
  consultationId: string;

  @ManyToOne(() => Consultation, (consultation) => consultation.sections, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'consultation_id' })
  consultation?: Consultation;

  @Index()
  @Column({ name: 'section_key', type: 'enum', enum: SECTION_KEYS, enumName: 'consultation_section_key' })
  sectionKey: SectionKey;

  @Column({ type: 'jsonb' })
  data: Record<string, unknown>;
}
