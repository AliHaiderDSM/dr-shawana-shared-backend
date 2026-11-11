import { type EntityManager } from 'typeorm';
import { AppDataSource } from '../../database/data-source';
import { AppError } from '../../lib/errors';
import { last9Of } from '../patients/phone';

export async function assertDoctorPhoneFree(
  phone: string | null | undefined,
  exceptStaffId?: string,
  manager: EntityManager = AppDataSource.manager,
) {
  const last9 = phone ? last9Of(phone) : null;
  if (!last9) return;
  const [taken] = (await manager.query(
    `SELECT trim(first_name || ' ' || last_name) AS name FROM staff_profiles
      WHERE deleted_at IS NULL AND role = 'doctor' AND ($2::uuid IS NULL OR id <> $2::uuid)
        AND RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 9) = $1
      LIMIT 1`,
    [last9, exceptStaffId ?? null],
  )) as { name: string }[];
  if (taken) {
    throw AppError.conflict(
      `This phone number is already used by ${taken.name}. Each doctor needs their own phone number, because doctors log in to the app with it.`,
    );
  }
}
