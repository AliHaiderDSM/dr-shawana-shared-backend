import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { AuditedEntity } from '../../database/base.entity';
import { ROLES, type Role } from '../../lib/permissions';
import { Branch } from '../branches/branch.entity';

export const STAFF_STATUSES = ['active', 'inactive'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

@Entity('staff_profiles')
@Check('CHK_staff_profiles_branch_matches_role', `("role" = 'super_admin') = ("branch_id" IS NULL)`)
@Check('CHK_staff_profiles_lowercase_login', `"email" = lower("email") AND "username" = lower("username")`)
@Index('UQ_staff_profiles_username', ['username'], { unique: true })
@Index('UQ_staff_profiles_email', ['email'], { unique: true })
export class StaffProfile extends AuditedEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Index()
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch | null;

  @Index()
  @Column({ type: 'enum', enum: ROLES, enumName: 'staff_role' })
  role: Role;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;

  @Column({ type: 'varchar', length: 150 })
  email: string;

  @Column({ type: 'varchar', length: 50 })
  username: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'enum', enum: GENDERS, enumName: 'gender', nullable: true })
  gender: Gender | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  designation: string | null;

  @Column({ name: 'avatar_path', type: 'text', nullable: true })
  avatarPath: string | null;

  @Index()
  @Column({ type: 'enum', enum: STAFF_STATUSES, enumName: 'staff_status', default: 'active' })
  status: StaffStatus;

  @Column({ name: 'must_change_password', type: 'boolean', default: true })
  mustChangePassword: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;
}
