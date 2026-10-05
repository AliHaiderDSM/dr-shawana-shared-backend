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

const MB = 1024 * 1024;
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCUMENTS = [...IMAGES, 'application/pdf'];

export const BUCKET_SETTINGS: Record<
  BucketName,
  { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }
> = {
  [BUCKETS.productImages]: { public: true, fileSizeLimit: 5 * MB, allowedMimeTypes: IMAGES },
  [BUCKETS.stockFiles]: { public: false, fileSizeLimit: 10 * MB, allowedMimeTypes: DOCUMENTS },
  [BUCKETS.paymentProofs]: { public: false, fileSizeLimit: 10 * MB, allowedMimeTypes: DOCUMENTS },
  [BUCKETS.doctorSignatures]: { public: false, fileSizeLimit: 2 * MB, allowedMimeTypes: IMAGES },
  [BUCKETS.medicalRecords]: { public: false, fileSizeLimit: 10 * MB, allowedMimeTypes: DOCUMENTS },
};

const isMissingBucket = (message: string) => /bucket not found/i.test(message);

async function createBucket(bucket: BucketName) {
  const { error } = await getSupabaseAdmin().storage.createBucket(bucket, BUCKET_SETTINGS[bucket]);
  if (error && !/already exists/i.test(error.message)) {
    throw AppError.badGateway(`Could not create storage bucket ${bucket}: ${error.message}`);
  }
}

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
  const upload = () =>
    getSupabaseAdmin()
      .storage.from(input.bucket)
      .upload(objectPath, input.buffer, { contentType: input.contentType, upsert: false });
  let { error } = await upload();
  if (error && isMissingBucket(error.message)) {
    await createBucket(input.bucket);
    ({ error } = await upload());
  }
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
