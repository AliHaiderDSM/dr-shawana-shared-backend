import { BUCKETS } from '../src/lib/storage';
import { getSupabaseAdmin } from '../src/lib/supabase';

const MB = 1024 * 1024;
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];

const bucketConfig = [
  { name: BUCKETS.productImages, public: true, fileSizeLimit: 5 * MB, allowedMimeTypes: IMAGES },
  {
    name: BUCKETS.stockFiles,
    public: false,
    fileSizeLimit: 10 * MB,
    allowedMimeTypes: [...IMAGES, 'application/pdf'],
  },
  {
    name: BUCKETS.paymentProofs,
    public: false,
    fileSizeLimit: 10 * MB,
    allowedMimeTypes: [...IMAGES, 'application/pdf'],
  },
  {
    name: BUCKETS.doctorSignatures,
    public: false,
    fileSizeLimit: 2 * MB,
    allowedMimeTypes: IMAGES,
  },
  {
    name: BUCKETS.medicalRecords,
    public: false,
    fileSizeLimit: 10 * MB,
    allowedMimeTypes: [...IMAGES, 'application/pdf'],
  },
];

async function main() {
  const storage = getSupabaseAdmin().storage;
  const { data: existing, error } = await storage.listBuckets();
  if (error) throw error;
  const names = new Set(existing.map((b) => b.name));

  for (const { name, ...options } of bucketConfig) {
    const result = names.has(name)
      ? await storage.updateBucket(name, options)
      : await storage.createBucket(name, options);
    if (result.error) throw result.error;
    console.log(
      `${names.has(name) ? 'Updated' : 'Created'} bucket ${name} (${options.public ? 'public' : 'private'})`,
    );
  }
}

main().catch((err: unknown) => {
  console.error('Storage setup failed:', err);
  process.exit(1);
});
