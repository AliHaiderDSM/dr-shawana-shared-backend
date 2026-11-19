import { AppDataSource } from '../../database/data-source';
import type { TreatmentPlanItem } from './treatment-plan.entity';

interface PlanRow {
  id: string;
  date: string;
  plan: string | null;
  items: TreatmentPlanItem[];
  doctor: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const treatmentPlansService = {
  async list(branchId: string, patientId: string) {
    const rows = (await AppDataSource.query(
      `SELECT t.id, t.date::text AS date, t.plan, t.items, d.display_name AS doctor,
              t.created_at AS "createdAt", t.updated_at AS "updatedAt"
         FROM treatment_plans t
         LEFT JOIN doctors d ON d.id = t.doctor_id
        WHERE t.branch_id = $1 AND t.patient_id = $2 AND t.deleted_at IS NULL
        ORDER BY t.date DESC, t.created_at DESC`,
      [branchId, patientId],
    )) as PlanRow[];
    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      plan: r.plan,
      doctor: r.doctor,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      medicines: r.items
        .filter((i) => i.kind === 'medicine')
        .map((i) => ({ name: i.name, dose: i.dose, groupName: i.groupName })),
      bloodWork: r.items
        .filter((i) => i.kind === 'blood_work')
        .map((i) => ({ name: i.name, groupName: i.groupName })),
    }));
  },
};
