import { Check, Column, Entity, Generated, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { type Decimal } from 'decimal.js';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn } from '../../database/transformers';
import { Doctor } from '../doctors/doctor.entity';
import { Patient } from '../patients/patient.entity';
import { AppointmentPayment } from './appointment-payment.entity';

export const APPOINTMENT_STATUSES = ['booked', 'completed', 'cancelled'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_MODES = ['online', 'physical'] as const;
export type AppointmentMode = (typeof APPOINTMENT_MODES)[number];

export const VISIT_TYPES = ['new', 'followup'] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export const APPOINTMENT_SOURCES = ['dashboard', 'app'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

@Entity('appointments')
@Index(['branchId', 'doctorId', 'date'])
@Index('UQ_appointments_number', ['appointmentNo'], { unique: true })
@Check('CHK_appointments_time_range', `"time_to" > "time_from"`)
export class Appointment extends BranchScopedEntity {
  @Column({ name: 'appointment_no', type: 'integer' })
  @Generated('increment')
  appointmentNo: number;

  @Index()
  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'patient_id' })
  patient?: Patient;

  @Column({ name: 'patient_city', type: 'varchar', length: 100, nullable: true })
  patientCity: string | null;

  @Index()
  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'time_from', type: 'time' })
  timeFrom: string;

  @Column({ name: 'time_to', type: 'time' })
  timeTo: string;

  @Index()
  @Column({ type: 'enum', enum: APPOINTMENT_MODES, enumName: 'appointment_mode' })
  mode: AppointmentMode;

  @Column({ name: 'visit_type', type: 'enum', enum: VISIT_TYPES, enumName: 'visit_type' })
  visitType: VisitType;

  @Column({ type: 'text', nullable: true })
  issues: string | null;

  @Column({ ...moneyColumn({ default: '0' }), name: 'fee' })
  fee: Decimal;

  @Column({ type: 'text', nullable: true })
  remark: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: APPOINTMENT_STATUSES,
    enumName: 'appointment_status',
    default: 'booked',
  })
  status: AppointmentStatus;

  @Column({
    type: 'enum',
    enum: APPOINTMENT_SOURCES,
    enumName: 'appointment_source',
    default: 'dashboard',
  })
  source: AppointmentSource;

  @OneToMany(() => AppointmentPayment, (payment) => payment.appointment)
  payments?: AppointmentPayment[];
}
