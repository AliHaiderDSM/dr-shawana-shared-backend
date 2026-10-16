import { AppDataSource } from '../../database/data-source';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { discardUploads, uploadMany } from '../../lib/file-uploads';
import { BUCKETS, createSignedUrl, removeFiles } from '../../lib/storage';
import { auditService } from '../audit/audit.service';

export const RESOURCE_LABELS = {
  glpDietPlan: 'GLP diet plan',
  generalDietPlan: 'General diet plan',
  liverDetox: 'Liver detox',
  skinCareRoutine: 'Skin care routine',
  hairCareRoutine: 'Hair care routine',
} as const;

export type ResourceKey = keyof typeof RESOURCE_LABELS;
export const RESOURCE_KEYS = Object.keys(RESOURCE_LABELS) as ResourceKey[];

interface FileRow {
  id: string;
  key: ResourceKey;
  name: string;
  type: string;
  size: number;
  createdAt: Date;
}

const toFile = (f: FileRow) => ({
  id: f.id,
  name: f.name,
  type: f.type,
  size: f.size,
  createdAt: new Date(f.createdAt).toISOString(),
});

async function filesOf(keys: readonly ResourceKey[]) {
  if (keys.length === 0) return [] as FileRow[];
  return (await AppDataSource.query(
    `SELECT id, resource_key AS key, file_name AS name, content_type AS type, size_bytes AS size,
            created_at AS "createdAt"
       FROM educational_resource_files
      WHERE resource_key = ANY($1) AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [keys],
  )) as FileRow[];
}

async function recommendation(patientId: string) {
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
  const keys = RESOURCE_KEYS.filter((key) => row.data[key] === 'yes');
  return keys.length ? { date: row.date, doctor: row.doctor, keys } : null;
}

async function signedUrl(id: string, allowed?: readonly ResourceKey[]) {
  const [row] = (await AppDataSource.query(
    `SELECT file_path AS path, resource_key AS key FROM educational_resource_files
      WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )) as { path: string; key: ResourceKey }[];
  if (!row || (allowed && !allowed.includes(row.key))) throw AppError.notFound('File');
  return createSignedUrl(BUCKETS.educationalResources, row.path, 600);
}

export const educationalResourcesService = {
  async list() {
    const files = await filesOf(RESOURCE_KEYS);
    return RESOURCE_KEYS.map((key) => ({
      key,
      label: RESOURCE_LABELS[key],
      files: files.filter((f) => f.key === key).map(toFile),
    }));
  },

  async upload(actor: Actor, key: ResourceKey, files: Express.Multer.File[]) {
    if (files.length === 0) throw AppError.badRequest('Choose at least one file');
    const uploaded = await uploadMany(BUCKETS.educationalResources, key, files);
    try {
      for (const file of uploaded) {
        await AppDataSource.query(
          `INSERT INTO educational_resource_files (resource_key, file_path, file_name, content_type, size_bytes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [key, file.path, file.originalName, file.contentType, file.sizeBytes, actor.userId],
        );
      }
    } catch (err) {
      await discardUploads(uploaded);
      throw err;
    }
    await auditService.record({
      actor,
      branchId: null,
      action: 'upload',
      entity: 'educational_resource',
      entityId: key,
      after: { files: uploaded.map((f) => f.originalName) },
    });
    return (await this.list()).find((r) => r.key === key)!;
  },

  async remove(actor: Actor, id: string) {
    const [row] = (await AppDataSource.query(
      `UPDATE educational_resource_files SET deleted_at = now(), deleted_by = $2
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING file_path AS path, file_name AS name, resource_key AS key`,
      [id, actor.userId],
    )) as { path: string; name: string; key: ResourceKey }[];
    if (!row) throw AppError.notFound('File');
    await removeFiles(BUCKETS.educationalResources, [row.path]).catch(() => undefined);
    await auditService.record({
      actor,
      branchId: null,
      action: 'delete',
      entity: 'educational_resource',
      entityId: row.key,
      before: { file: row.name },
    });
  },

  fileUrl: (id: string) => signedUrl(id),

  async forPatient(patientId: string) {
    const found = await recommendation(patientId);
    if (!found) return null;
    const files = await filesOf(found.keys);
    return {
      date: found.date,
      doctor: found.doctor,
      items: found.keys.map((key) => ({
        key,
        label: RESOURCE_LABELS[key],
        files: files.filter((f) => f.key === key).map(toFile),
      })),
    };
  },

  async patientFileUrl(patientId: string, id: string) {
    const found = await recommendation(patientId);
    return signedUrl(id, found?.keys ?? []);
  },
};
