import type { DataSource } from 'typeorm';

const TREATING_BRANCH = `(SELECT patient_id, branch_id FROM (
  SELECT patient_id, branch_id,
         row_number() OVER (PARTITION BY patient_id ORDER BY count(*) DESC, branch_id) rn
    FROM appointments WHERE deleted_at IS NULL GROUP BY patient_id, branch_id) t
 WHERE rn = 1)`;

export const CLINICAL_BRANCH_FIXES: { label: string; sql: string }[] = [
  {
    label: 'appointments -> doctor branch',
    sql: `UPDATE appointments a SET branch_id = d.branch_id, updated_at = now()
            FROM doctors d WHERE d.id = a.doctor_id AND a.deleted_at IS NULL AND a.branch_id <> d.branch_id`,
  },
  {
    label: 'appointment payments -> appointment branch',
    sql: `UPDATE appointment_payments p SET branch_id = a.branch_id, updated_at = now()
            FROM appointments a WHERE a.id = p.appointment_id AND p.branch_id <> a.branch_id`,
  },
  {
    label: 'consultations -> appointment branch',
    sql: `UPDATE consultations c SET branch_id = a.branch_id, updated_at = now()
            FROM appointments a WHERE a.id = c.appointment_id AND c.branch_id <> a.branch_id`,
  },
  {
    label: 'consultation sections -> consultation branch',
    sql: `UPDATE consultation_sections s SET branch_id = c.branch_id, updated_at = now()
            FROM consultations c WHERE c.id = s.consultation_id AND s.branch_id <> c.branch_id`,
  },
  {
    label: 'prescriptions -> doctor branch',
    sql: `UPDATE prescriptions pr SET branch_id = d.branch_id, updated_at = now()
            FROM doctors d WHERE d.id = pr.doctor_id AND pr.branch_id <> d.branch_id`,
  },
  {
    label: 'prescription items -> prescription branch',
    sql: `UPDATE prescription_items i SET branch_id = pr.branch_id, updated_at = now()
            FROM prescriptions pr WHERE pr.id = i.prescription_id AND i.branch_id <> pr.branch_id`,
  },
  {
    label: 'medical records -> patient treating branch',
    sql: `UPDATE medical_records m SET branch_id = pb.branch_id, updated_at = now()
            FROM ${TREATING_BRANCH} pb WHERE pb.patient_id = m.patient_id AND m.branch_id <> pb.branch_id`,
  },
  {
    label: 'medical record files -> record branch',
    sql: `UPDATE medical_record_files f SET branch_id = m.branch_id, updated_at = now()
            FROM medical_records m WHERE m.id = f.medical_record_id AND f.branch_id <> m.branch_id`,
  },
  {
    label: 'blood work -> patient treating branch',
    sql: `UPDATE blood_work_results r SET branch_id = pb.branch_id, updated_at = now()
            FROM ${TREATING_BRANCH} pb WHERE pb.patient_id = r.patient_id AND r.branch_id <> pb.branch_id`,
  },
  {
    label: 'BHRT logs -> patient treating branch',
    sql: `UPDATE bhrt_status_log l SET branch_id = pb.branch_id, updated_at = now()
            FROM ${TREATING_BRANCH} pb WHERE pb.patient_id = l.patient_id AND l.branch_id <> pb.branch_id`,
  },
];

class DryRunRollback extends Error {}

function updatedCount(result: unknown): number {
  if (Array.isArray(result)) {
    if (Array.isArray(result[0])) return (result[0] as unknown[]).length;
    if (typeof result[1] === 'number') return result[1];
    return result.length;
  }
  return 0;
}

export async function fixClinicalBranches(
  source: DataSource,
  options: { dryRun?: boolean; onProgress?: (message: string) => void } = {},
): Promise<Record<string, number>> {
  const report = options.onProgress ?? (() => {});
  const counts: Record<string, number> = {};
  try {
    await source.transaction(async (em) => {
      for (const step of CLINICAL_BRANCH_FIXES) {
        const count = updatedCount(await em.query(`${step.sql} RETURNING 1`));
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
