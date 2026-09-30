import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getSupabaseAdmin } from './supabase';
import { AppError } from './errors';

export const BUCKETS = {
  productImages: 'product-images',
  stockFiles: 'stock-files',
  paymentProofs: 'payment-proofs',
  medicalRecords: 'medical-records',
  doctorSignatures: 'doctor-signatures',
} as const;
export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

export interface UploadInput {
  bucket: BucketName;
  prefix: string;
  originalName: string;
  buffer: Buffer;
  contentType: string;
}

export function buildObjectPath(prefix: string, originalName: string): string {
  const ext = path
    .extname(originalName)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');
  const cleanPrefix = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  return `${cleanPrefix}/${randomUUID()}${ext}`;
}

export async function uploadFile(input: UploadInput): Promise<{ bucket: BucketName; path: string }> {
  const objectPath = buildObjectPath(input.prefix, input.originalName);
  const { error } = await getSupabaseAdmin()
    .storage.from(input.bucket)
    .upload(objectPath, input.buffer, { contentType: input.contentType, upsert: false });
  if (error) throw AppError.badGateway(`File upload failed: ${error.message}`);
  return { bucket: input.bucket, path: objectPath };
}

export async function createSignedUrl(bucket: BucketName, objectPath: string, expiresInSeconds = 300) {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(objectPath, expiresInSeconds);
  if (error || !data) throw AppError.badGateway('Could not create download link');
  return { url: data.signedUrl, expiresIn: expiresInSeconds };
}

export async function removeFiles(bucket: BucketName, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await getSupabaseAdmin().storage.from(bucket).remove(paths);
  if (error) throw AppError.badGateway(`File delete failed: ${error.message}`);
}

export function publicUrl(bucket: BucketName, objectPath: string | null): string | null {
  if (!objectPath) return null;
  return getSupabaseAdmin().storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
}

export async function replaceFile(
  input: UploadInput,
  previousPath: string | null,
): Promise<{ bucket: BucketName; path: string }> {
  const uploaded = await uploadFile(input);
  if (previousPath) await removeFiles(input.bucket, [previousPath]).catch(() => undefined);
  return uploaded;
}
