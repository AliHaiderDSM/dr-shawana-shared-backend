import { AppDataSource } from '../../database/data-source';

export const RESOURCES = {
  glpDietPlan: { label: 'GLP diet plan', file: 'glp-diet-plan.pdf', type: 'application/pdf' },
  generalDietPlan: { label: 'General diet plan', file: 'general-diet-plan.pdf', type: 'application/pdf' },
  liverDetox: { label: 'Liver detox', file: 'liver-detox.jpeg', type: 'image/jpeg' },
  skinCareRoutine: { label: 'Skin care routine', file: 'skin-care-routine.jpeg', type: 'image/jpeg' },
  hairCareRoutine: { label: 'Hair care routine', file: 'hair-care-routine.jpeg', type: 'image/jpeg' },
} as const;

export type ResourceKey = keyof typeof RESOURCES;
export const RESOURCE_KEYS = Object.keys(RESOURCES) as ResourceKey[];
export const RESOURCES_PATH = '/resources';

export const educationalResourcesService = {
  async forPatient(patientId: string) {
    const [row] = (await AppDataSource.query(
      `SELECT cs.data, to_char(a.date, 'YYYY-MM-DD') AS date, d.display_name AS doctor
         FROM consultation_sections cs
         JOIN consultations c ON c.id = cs.consultation_id AND c.deleted_at IS NULL
         JOIN appointments a ON a.id = c.appointment_id AND a.deleted_at IS NULL
         LEFT JOIN doctors d ON d.id = c.doctor_id
        WHERE c.patient_id = $1 AND cs.section_key = 'plans' AND cs.deleted_at IS NULL
        ORDER BY a.date DESC, a.time_from DESC, cs.updated_at DESC
        LIMIT 1`,
      [patientId],
    )) as { data: Record<string, unknown>; date: string; doctor: string | null }[];
    if (!row) return null;
    const items = RESOURCE_KEYS.filter((key) => row.data[key] === 'yes').map((key) => ({
      key,
      label: RESOURCES[key].label,
      file: {
        name: RESOURCES[key].file,
        type: RESOURCES[key].type,
        path: `${RESOURCES_PATH}/${RESOURCES[key].file}`,
      },
    }));
    return items.length ? { date: row.date, doctor: row.doctor, items } : null;
  },
};
