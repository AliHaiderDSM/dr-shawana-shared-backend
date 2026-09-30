import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../database/base.entity';

@Entity('company_info')
@Index('UQ_company_info_singleton', { synchronize: false })
export class CompanyInfo extends BaseEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ name: 'logo_path', type: 'text', nullable: true })
  logoPath: string | null;
}
