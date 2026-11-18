import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type DeleteObjectsCommandInput,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { installFakeSupabase } from '../../tests/helpers/supabase-fake';
import { setR2ClientForTests } from './r2';
import { BUCKETS, createSignedUrl, downloadFile, publicUrl, removeFiles, uploadFile } from './storage';

function fakeR2() {
  const objects = new Map<string, Buffer>();
  const client = new S3Client({
    region: 'auto',
    endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  jest.spyOn(client, 'send').mockImplementation(async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      const input = command.input as PutObjectCommandInput;
      objects.set(input.Key ?? '', input.Body as Buffer);
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const body = objects.get(command.input.Key ?? '');
      if (!body) throw new Error('NoSuchKey');
      return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
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

  it('keeps private files in R2 under the bucket name and product images in Supabase', async () => {
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
    expect(supabase.objects.has(`product-images/${image.path}`)).toBe(true);
    expect(publicUrl(BUCKETS.productImages, image.path)).toContain('storage.test/public');
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
