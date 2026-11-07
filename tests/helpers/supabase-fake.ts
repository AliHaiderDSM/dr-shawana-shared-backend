import { type SupabaseClient } from '@supabase/supabase-js';
import { setSupabaseClientsForTests } from '../../src/lib/supabase';

export class FakeSupabase {
  readonly objects = new Map<string, { contentType: string; size: number; body: Buffer }>();
  readonly missingBuckets = new Set<string>();
  readonly createdBuckets: { name: string; options: { public: boolean } }[] = [];

  private bucket(name: string) {
    const key = (path: string) => `${name}/${path}`;
    return {
      upload: async (path: string, body: Buffer, options: { contentType: string }) => {
        if (this.missingBuckets.has(name)) return { data: null, error: { message: 'Bucket not found' } };
        this.objects.set(key(path), { contentType: options.contentType, size: body.length, body });
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const object = this.objects.get(key(path));
        return object
          ? { data: new Blob([object.body], { type: object.contentType }), error: null }
          : { data: null, error: { message: 'Object not found' } };
      },
      remove: async (paths: string[]) => {
        for (const path of paths) this.objects.delete(key(path));
        return { data: [], error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/public/${key(path)}` } }),
      createSignedUrl: async (path: string, expiresIn: number) =>
        this.objects.has(key(path))
          ? { data: { signedUrl: `https://storage.test/signed/${key(path)}?ttl=${expiresIn}` }, error: null }
          : { data: null, error: { message: 'Object not found' } },
    };
  }

  readonly admin = {
    storage: {
      from: (name: string) => this.bucket(name),
      createBucket: async (name: string, options: { public: boolean }) => {
        this.missingBuckets.delete(name);
        this.createdBuckets.push({ name, options });
        return { data: { name }, error: null };
      },
    },
  };
}

export function installFakeSupabase(): FakeSupabase {
  const fake = new FakeSupabase();
  setSupabaseClientsForTests({
    admin: fake.admin as unknown as SupabaseClient,
  });
  return fake;
}
