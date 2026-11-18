import { S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';

let client: S3Client | undefined;
let testClient: S3Client | null | undefined;

export function r2Configured(): boolean {
  if (testClient !== undefined) return testClient !== null;
  if (env.NODE_ENV === 'test') return false;
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET);
}

export function getR2(): S3Client {
  if (testClient) return testClient;
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
      },
    });
  }
  return client;
}

export function r2Bucket(): string {
  return env.R2_BUCKET ?? 'test-bucket';
}

export function setR2ClientForTests(next?: S3Client | null): void {
  testClient = next;
}
