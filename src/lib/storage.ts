import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSupabaseAdmin } from './supabase';
import { env } from '../config/env';
import { getR2, r2Bucket, r2Configured } from './r2';
import { AppError } from './errors';

export const BUCKETS = {
  productImages: 'product-images',
  stockFiles: 'stock-files',
  paymentProofs: 'payment-proofs',
  medicalRecords: 'medical-records',
  doctorSignatures: 'doctor-signatures',
  chatVoice: 'chat-voice',
} as const;
export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

const MB = 1024 * 1024;
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCUMENTS = [...IMAGES, 'application/pdf'];
export const AUDIO_TYPES = [
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/webm',
  'audio/ogg',
  'audio/3gpp',
];

export const BUCKET_SETTINGS: Record<
  BucketName,
  { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }
> = {
  [BUCKETS.productImages]: { public: true, fileSizeLimit: 5 * MB, allowedMimeTypes: IMAGES },
  [BUCKETS.stockFiles]: { public: false, fileSizeLimit: 10 * MB, allowedMimeTypes: DOCUMENTS },
  [BUCKETS.paymentProofs]: { public: false, fileSizeLimit: 10 * MB, allowedMimeTypes: DOCUMENTS },
  [BUCKETS.doctorSignatures]: { public: false, fileSizeLimit: 2 * MB, allowedMimeTypes: IMAGES },
  [BUCKETS.medicalRecords]: { public: false, fileSizeLimit: 10 * MB, allowedMimeTypes: DOCUMENTS },
  [BUCKETS.chatVoice]: { public: false, fileSizeLimit: 10 * MB, allowedMimeTypes: AUDIO_TYPES },
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

export const usesR2 = () => r2Configured();

export const r2Key = (bucket: BucketName, objectPath: string) => `${bucket}/${objectPath}`;

export async function putObject(bucket: BucketName, objectPath: string, buffer: Buffer, contentType: string) {
  if (usesR2()) {
    await getR2()
      .send(
        new PutObjectCommand({
          Bucket: r2Bucket(),
          Key: r2Key(bucket, objectPath),
          Body: buffer,
          ContentType: contentType,
        }),
      )
      .catch((err: unknown) => {
        throw AppError.badGateway(`File upload failed: ${(err as Error).message}`);
      });
    return;
  }
  const upload = () =>
    getSupabaseAdmin().storage.from(bucket).upload(objectPath, buffer, { contentType, upsert: false });
  let { error } = await upload();
  if (error && isMissingBucket(error.message)) {
    await createBucket(bucket);
    ({ error } = await upload());
  }
  if (error) throw AppError.badGateway(`File upload failed: ${error.message}`);
}

export async function uploadFile(input: UploadInput): Promise<{ bucket: BucketName; path: string }> {
  const objectPath = buildObjectPath(input.prefix, input.originalName);
  await putObject(input.bucket, objectPath, input.buffer, input.contentType);
  return { bucket: input.bucket, path: objectPath };
}

export async function createSignedUrl(bucket: BucketName, objectPath: string, expiresInSeconds = 300) {
  if (usesR2()) {
    const url = await getSignedUrl(
      getR2(),
      new GetObjectCommand({ Bucket: r2Bucket(), Key: r2Key(bucket, objectPath) }),
      { expiresIn: expiresInSeconds },
    ).catch(() => {
      throw AppError.badGateway('Could not create download link');
    });
    return { url, expiresIn: expiresInSeconds };
  }
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(objectPath, expiresInSeconds);
  if (error || !data) throw AppError.badGateway('Could not create download link');
  return { url: data.signedUrl, expiresIn: expiresInSeconds };
}

export async function downloadObject(
  bucket: BucketName,
  objectPath: string,
): Promise<{ body: Buffer; contentType: string }> {
  if (usesR2()) {
    try {
      const { Body, ContentType } = await getR2().send(
        new GetObjectCommand({ Bucket: r2Bucket(), Key: r2Key(bucket, objectPath) }),
      );
      if (!Body) throw new Error('empty');
      return {
        body: Buffer.from(await Body.transformToByteArray()),
        contentType: ContentType ?? 'application/octet-stream',
      };
    } catch {
      throw AppError.notFound('File');
    }
  }
  const { data, error } = await getSupabaseAdmin().storage.from(bucket).download(objectPath);
  if (error || !data) throw AppError.notFound('File');
  return {
    body: Buffer.from(await data.arrayBuffer()),
    contentType: data.type || 'application/octet-stream',
  };
}

export async function downloadFile(bucket: BucketName, objectPath: string): Promise<Buffer> {
  try {
    return (await downloadObject(bucket, objectPath)).body;
  } catch {
    throw AppError.badGateway('Could not open a saved file. Try again.');
  }
}

export async function removeFiles(bucket: BucketName, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  if (usesR2()) {
    for (let i = 0; i < paths.length; i += 1000) {
      const objects = paths.slice(i, i + 1000).map((p) => ({ Key: r2Key(bucket, p) }));
      const result = await getR2()
        .send(new DeleteObjectsCommand({ Bucket: r2Bucket(), Delete: { Objects: objects, Quiet: true } }))
        .catch((err: unknown) => {
          throw AppError.badGateway(`File delete failed: ${(err as Error).message}`);
        });
      if (result.Errors?.length)
        throw AppError.badGateway(`File delete failed: ${result.Errors[0]?.Message ?? ''}`);
    }
    return;
  }
  const { error } = await getSupabaseAdmin().storage.from(bucket).remove(paths);
  if (error) throw AppError.badGateway(`File delete failed: ${error.message}`);
}

export function publicUrl(bucket: BucketName, objectPath: string | null): string | null {
  if (!objectPath) return null;
  if (usesR2()) return `${env.PUBLIC_API_URL ?? ''}/api/v1/files/${bucket}/${objectPath}`;
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
