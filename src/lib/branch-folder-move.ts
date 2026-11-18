import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { DataSource } from 'typeorm';
import { getR2, r2Bucket, r2Configured } from './r2';
import { BUCKETS, r2Key, type BucketName } from './storage';

const UUID_FOLDER = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(.+)$/;

interface PathColumn {
  table: string;
  column: string;
  bucket: BucketName;
  kind?: string;
}

const PATH_COLUMNS: PathColumn[] = [
  { table: 'appointment_payments', column: 'proof_file_path', bucket: BUCKETS.paymentProofs },
  { table: 'sale_payment_proofs', column: 'file_path', bucket: BUCKETS.paymentProofs },
  { table: 'appointment_attachments', column: 'file_path', bucket: BUCKETS.medicalRecords },
  { table: 'medical_record_files', column: 'file_path', bucket: BUCKETS.medicalRecords },
  { table: 'stock_attachments', column: 'file_path', bucket: BUCKETS.stockFiles },
  { table: 'expenses', column: 'attachment_path', bucket: BUCKETS.stockFiles },
  { table: 'sale_replacement_files', column: 'file_path', bucket: BUCKETS.stockFiles },
  { table: 'doctors', column: 'signature_path', bucket: BUCKETS.doctorSignatures },
  { table: 'products', column: 'image_path', bucket: BUCKETS.productImages, kind: 'products' },
  { table: 'categories', column: 'image_path', bucket: BUCKETS.productImages },
  { table: 'bundles', column: 'image_path', bucket: BUCKETS.productImages },
];

export interface MoveTally {
  moved: number;
  missing: number;
}

export function branchCodePath(path: string, codes: Map<string, string>, kind?: string): string | null {
  const match = UUID_FOLDER.exec(path);
  const code = match ? codes.get(match[1] ?? '') : undefined;
  if (!match || !code) return null;
  return [code, kind, match[2]].filter(Boolean).join('/');
}

export function chatCodePath(path: string, code: string): { bucket: BucketName; path: string } | null {
  if (path.startsWith('voice/')) return { bucket: BUCKETS.chatVoice, path: `${code}/${path.slice(6)}` };
  if (path.startsWith('chat/')) return { bucket: BUCKETS.medicalRecords, path: `${code}/${path}` };
  return null;
}

async function exists(bucket: BucketName, path: string) {
  try {
    await getR2().send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: r2Key(bucket, path) }));
    return true;
  } catch {
    return false;
  }
}

async function moveObject(
  fromBucket: BucketName,
  from: string,
  toBucket: BucketName,
  to: string,
  deleteOld: boolean,
) {
  if (!(await exists(toBucket, to))) {
    if (!(await exists(fromBucket, from))) return false;
    await getR2().send(
      new CopyObjectCommand({
        Bucket: r2Bucket(),
        CopySource: `${r2Bucket()}/${r2Key(fromBucket, from)}`,
        Key: r2Key(toBucket, to),
      }),
    );
  }
  if (deleteOld) {
    await getR2().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: r2Key(fromBucket, from) }));
  }
  return true;
}

export async function moveToBranchFolders(
  db: DataSource,
  deleteOld: boolean,
): Promise<Record<string, MoveTally>> {
  if (!r2Configured()) throw new Error('Set the R2_* env vars first');
  const branches = (await db.query(`SELECT id, code FROM branches`)) as { id: string; code: string }[];
  const codes = new Map(branches.map((b) => [b.id, b.code]));
  const report: Record<string, MoveTally> = {};

  for (const { table, column, bucket, kind } of PATH_COLUMNS) {
    const tally: MoveTally = { moved: 0, missing: 0 };
    const rows = (await db.query(
      `SELECT id, ${column} AS path FROM ${table} WHERE ${column} ~ '^[0-9a-f-]{36}/'`,
    )) as { id: string; path: string }[];
    for (const row of rows) {
      const next = branchCodePath(row.path, codes, kind);
      if (!next) continue;
      if (!(await moveObject(bucket, row.path, bucket, next, deleteOld))) {
        tally.missing += 1;
        continue;
      }
      await db.query(`UPDATE ${table} SET ${column} = $1 WHERE id = $2`, [next, row.id]);
      tally.moved += 1;
    }
    report[`${table}.${column}`] = tally;
  }

  const summaries = { moved: 0, missing: 0 };
  const withFiles = (await db.query(
    `SELECT id, files FROM lab_report_summaries WHERE files::text ~ '"path": ?"[0-9a-f-]{36}/'`,
  )) as { id: string; files: { path: string | null }[] }[];
  for (const row of withFiles) {
    let changed = false;
    for (const file of row.files) {
      const next = file.path ? branchCodePath(file.path, codes) : null;
      if (!file.path || !next) continue;
      if (await moveObject(BUCKETS.medicalRecords, file.path, BUCKETS.medicalRecords, next, deleteOld)) {
        file.path = next;
        changed = true;
        summaries.moved += 1;
      } else summaries.missing += 1;
    }
    if (changed) {
      await db.query(`UPDATE lab_report_summaries SET files = $1::jsonb WHERE id = $2`, [
        JSON.stringify(row.files),
        row.id,
      ]);
    }
  }
  report['lab_report_summaries.files'] = summaries;

  const chat = { moved: 0, missing: 0 };
  const messages = (await db.query(
    `SELECT m.id, m.file_path AS path, m.file_type AS type, b.code
       FROM chat_messages m
       JOIN chat_conversations c ON c.id = m.conversation_id
       JOIN doctors d ON d.id = c.doctor_id
       JOIN branches b ON b.id = d.branch_id
      WHERE m.file_path LIKE 'voice/%' OR m.file_path LIKE 'chat/%'`,
  )) as { id: string; path: string; type: string | null; code: string }[];
  for (const row of messages) {
    const next = chatCodePath(row.path, row.code);
    if (!next) continue;
    const fromBucket = row.path.startsWith('voice/') ? BUCKETS.chatVoice : BUCKETS.medicalRecords;
    if (!(await moveObject(fromBucket, row.path, next.bucket, next.path, deleteOld))) {
      chat.missing += 1;
      continue;
    }
    await db.query(`UPDATE chat_messages SET file_path = $1 WHERE id = $2`, [next.path, row.id]);
    chat.moved += 1;
  }
  report['chat_messages.file_path'] = chat;
  return report;
}
