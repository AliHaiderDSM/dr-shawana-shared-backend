import { logger } from './logger';
import { removeFiles, uploadFile, type BucketName } from './storage';

export interface UploadedFile {
  bucket: BucketName;
  path: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
}

export async function removeQuietly(bucket: BucketName, paths: string[]): Promise<void> {
  await removeFiles(bucket, paths).catch((err: unknown) =>
    logger.error({ err, bucket }, 'Failed to clean up uploaded files'),
  );
}

export async function discardUploads(uploaded: UploadedFile[]): Promise<void> {
  const byBucket = new Map<BucketName, string[]>();
  for (const file of uploaded) byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file.path]);
  for (const [bucket, paths] of byBucket) await removeQuietly(bucket, paths);
}

export async function uploadMany(
  bucket: BucketName,
  prefix: string,
  files: Express.Multer.File[],
): Promise<UploadedFile[]> {
  const uploaded: UploadedFile[] = [];
  try {
    for (const file of files) {
      const { path } = await uploadFile({
        bucket,
        prefix,
        originalName: file.originalname,
        buffer: file.buffer,
        contentType: file.mimetype,
      });
      uploaded.push({
        bucket,
        path,
        originalName: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
      });
    }
    return uploaded;
  } catch (err) {
    await discardUploads(uploaded);
    throw err;
  }
}

export async function withUploads<T>(uploaded: UploadedFile[], work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    await discardUploads(uploaded);
    throw err;
  }
}
