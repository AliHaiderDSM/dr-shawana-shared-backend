import type { DataSource } from 'typeorm';

const EMPTY_ASSESSMENT =
  `jsonb_build_object('menopauseStage','[]'::jsonb,'menopauseType','[]'::jsonb,'diagnoses','[]'::jsonb,` +
  `'complaints','[]'::jsonb,'clinicalStatus','[]'::jsonb,'treatmentPlan','[]'::jsonb,'plan', a.remark)`;

const STEPS: { label: string; sql: string }[] = [
  {
    label: 'consultations for appointments with a remark',
    sql: `INSERT INTO consultations (branch_id, patient_id, doctor_id, appointment_id, status, created_at)
          SELECT a.branch_id, a.patient_id, a.doctor_id, a.id, 'completed', a.created_at
            FROM appointments a
           WHERE btrim(coalesce(a.remark, '')) <> '' AND a.deleted_at IS NULL
          ON CONFLICT (appointment_id) WHERE deleted_at IS NULL DO NOTHING`,
  },
  {
    label: 'fill empty clinical remarks from the appointment remark',
    sql: `UPDATE consultation_sections cs
             SET data = jsonb_set(cs.data, '{plan}', to_jsonb(a.remark)), updated_at = now()
            FROM consultations c
            JOIN appointments a ON a.id = c.appointment_id
           WHERE cs.consultation_id = c.id AND cs.section_key = 'clinical_assessment' AND cs.deleted_at IS NULL
             AND btrim(coalesce(a.remark, '')) <> '' AND btrim(coalesce(cs.data->>'plan', '')) = ''`,
  },
  {
    label: 'clinical remarks sections for consultations that lack one',
    sql: `INSERT INTO consultation_sections (branch_id, consultation_id, section_key, data)
          SELECT c.branch_id, c.id, 'clinical_assessment', ${EMPTY_ASSESSMENT}
            FROM consultations c
            JOIN appointments a ON a.id = c.appointment_id
           WHERE c.deleted_at IS NULL AND btrim(coalesce(a.remark, '')) <> ''
             AND NOT EXISTS (SELECT 1 FROM consultation_sections s
                              WHERE s.consultation_id = c.id AND s.section_key = 'clinical_assessment'
                                AND s.deleted_at IS NULL)`,
  },
];

class DryRunRollback extends Error {}

function affected(result: unknown): number {
  if (Array.isArray(result)) {
    if (Array.isArray(result[0])) return (result[0] as unknown[]).length;
    if (typeof result[1] === 'number') return result[1];
    return result.length;
  }
  return 0;
}

export async function fixClinicalRemarks(
  source: DataSource,
  options: { dryRun?: boolean; onProgress?: (message: string) => void } = {},
): Promise<Record<string, number>> {
  const report = options.onProgress ?? (() => {});
  const counts: Record<string, number> = {};
  try {
    await source.transaction(async (em) => {
      for (const step of STEPS) {
        const count = affected(await em.query(`${step.sql} RETURNING 1`));
        counts[step.label] = count;
        report(`${step.label}: ${count} rows`);
      }
      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return counts;
}
