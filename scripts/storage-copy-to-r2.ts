import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { BUCKET_SETTINGS, putObject, r2Key, type BucketName } from '../src/lib/storage';
import { getR2, r2Bucket, r2Configured } from '../src/lib/r2';
import { getSupabaseAdmin } from '../src/lib/supabase';

const PAGE = 1000;
const PARALLEL = 6;

async function listAll(bucket: BucketName, prefix = ''): Promise<string[]> {
  const storage = getSupabaseAdmin().storage.from(bucket);
  const found: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage.list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    for (const item of data) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) found.push(full);
      else found.push(...(await listAll(bucket, full)));
    }
    if (data.length < PAGE) return found;
  }
}

async function existsInR2(bucket: BucketName, objectPath: string) {
  try {
    await getR2().send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: r2Key(bucket, objectPath) }));
    return true;
  } catch {
    return false;
  }
}

async function copyOne(bucket: BucketName, objectPath: string): Promise<'copied' | 'skipped'> {
  if (await existsInR2(bucket, objectPath)) return 'skipped';
  const { data, error } = await getSupabaseAdmin().storage.from(bucket).download(objectPath);
  if (error || !data) throw error ?? new Error('empty download');
  const buffer = Buffer.from(await data.arrayBuffer());
  await putObject(bucket, objectPath, buffer, data.type || 'application/octet-stream');
  return 'copied';
}

async function copyBucket(bucket: BucketName) {
  const paths = await listAll(bucket);
  const tally = { copied: 0, skipped: 0, failed: 0 };
  for (let i = 0; i < paths.length; i += PARALLEL) {
    const results = await Promise.allSettled(paths.slice(i, i + PARALLEL).map((p) => copyOne(bucket, p)));
    results.forEach((r, k) => {
      if (r.status === 'fulfilled') tally[r.value] += 1;
      else {
        tally.failed += 1;
        console.error(`  failed ${bucket}/${paths[i + k]}: ${String(r.reason)}`);
      }
    });
  }
  console.log(
    `${bucket}: ${paths.length} files, ${tally.copied} copied, ${tally.skipped} already there, ${tally.failed} failed`,
  );
  return tally.failed;
}

async function main() {
  if (!r2Configured())
    throw new Error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET first');
  const privateBuckets = (Object.keys(BUCKET_SETTINGS) as BucketName[]).filter(
    (b) => !BUCKET_SETTINGS[b].public,
  );
  let failed = 0;
  for (const bucket of privateBuckets) failed += await copyBucket(bucket);
  if (failed) process.exit(1);
}

main().catch((err: unknown) => {
  console.error('Copy to R2 failed:', err);
  process.exit(1);
});
