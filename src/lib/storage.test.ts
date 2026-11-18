import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type DeleteObjectsCommandInput,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import request from 'supertest';
import { installFakeSupabase } from '../../tests/helpers/supabase-fake';
import { createApp } from '../app';
import { setR2ClientForTests } from './r2';
import { BUCKETS, createSignedUrl, downloadFile, publicUrl, removeFiles, uploadFile } from './storage';

function fakeR2() {
  const objects = new Map<string, Buffer>();
  const types = new Map<string, string>();
  const client = new S3Client({
    region: 'auto',
    endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  jest.spyOn(client, 'send').mockImplementation(async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      const input = command.input as PutObjectCommandInput;
      objects.set(input.Key ?? '', input.Body as Buffer);
      types.set(input.Key ?? '', input.ContentType ?? '');
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const body = objects.get(command.input.Key ?? '');
      if (!body) throw new Error('NoSuchKey');
      return {
        Body: { transformToByteArray: async () => new Uint8Array(body) },
        ContentType: types.get(command.input.Key ?? ''),
      };
    }
    if (command instanceof DeleteObjectsCommand) {
      const input = command.input as DeleteObjectsCommandInput;
      for (const o of input.Delete?.Objects ?? []) objects.delete(o.Key ?? '');
      return {};
    }
    throw new Error('unexpected command');
  });
  return { client, objects };
}

describe('storage with Cloudflare R2', () => {
  afterEach(() => setR2ClientForTests(undefined));

  it('keeps every file in R2 under the bucket name and serves product images publicly', async () => {
    const supabase = installFakeSupabase();
    const r2 = fakeR2();
    setR2ClientForTests(r2.client);

    const proof = await uploadFile({
      bucket: BUCKETS.paymentProofs,
      prefix: 'branch/payment',
      originalName: 'slip.PNG',
      buffer: Buffer.from('proof'),
      contentType: 'image/png',
    });
    expect(proof.path).toMatch(/^branch\/payment\/[0-9a-f-]+\.png$/);
    expect(r2.objects.has(`payment-proofs/${proof.path}`)).toBe(true);
    expect(supabase.objects.size).toBe(0);

    const signed = await createSignedUrl(BUCKETS.paymentProofs, proof.path, 120);
    expect(signed.url).toContain(`/payment-proofs/${proof.path.split('/')[0]}`);
    expect(signed.url).toContain('X-Amz-Expires=120');
    expect((await downloadFile(BUCKETS.paymentProofs, proof.path)).toString()).toBe('proof');

    await removeFiles(BUCKETS.paymentProofs, [proof.path]);
    expect(r2.objects.size).toBe(0);
    await expect(downloadFile(BUCKETS.paymentProofs, proof.path)).rejects.toMatchObject({ status: 502 });

    const image = await uploadFile({
      bucket: BUCKETS.productImages,
      prefix: 'branch/product',
      originalName: 'item.jpg',
      buffer: Buffer.from('image'),
      contentType: 'image/jpeg',
    });
    expect(r2.objects.has(`product-images/${image.path}`)).toBe(true);
    expect(supabase.objects.size).toBe(0);
    const link = publicUrl(BUCKETS.productImages, image.path) ?? '';
    expect(link).toBe(`/api/v1/files/product-images/${image.path}`);
    const served = await request(createApp()).get(link);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(Buffer.from(served.body as Buffer).toString()).toBe('image');
    expect((await request(createApp()).get('/api/v1/files/product-images/branch/missing.jpg')).status).toBe(
      404,
    );
    expect((await request(createApp()).get('/api/v1/files/product-images/../secret')).status).toBe(404);
  });

  it('uses Supabase for every bucket when R2 is not configured', async () => {
    const supabase = installFakeSupabase();
    setR2ClientForTests(null);
    const record = await uploadFile({
      bucket: BUCKETS.medicalRecords,
      prefix: 'branch/record',
      originalName: 'report.pdf',
      buffer: Buffer.from('pdf'),
      contentType: 'application/pdf',
    });
    expect(supabase.objects.has(`medical-records/${record.path}`)).toBe(true);
  });
});
