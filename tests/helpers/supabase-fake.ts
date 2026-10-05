import { randomUUID } from 'node:crypto';
import { type SupabaseClient } from '@supabase/supabase-js';
import { setSupabaseClientsForTests } from '../../src/lib/supabase';

interface FakeUser {
  id: string;
  email: string;
  password: string;
  banned: boolean;
}

const failure = (message: string, status = 400) => ({
  data: { user: null, session: null },
  error: { message, status },
});

export class FakeSupabase {
  readonly users = new Map<string, FakeUser>();
  private readonly refreshTokens = new Map<string, string>();
  failNextCreate = false;
  readonly objects = new Map<string, { contentType: string; size: number }>();
  readonly missingBuckets = new Set<string>();
  readonly createdBuckets: { name: string; options: { public: boolean } }[] = [];

  private bucket(name: string) {
    const key = (path: string) => `${name}/${path}`;
    return {
      upload: async (path: string, body: Buffer, options: { contentType: string }) => {
        if (this.missingBuckets.has(name)) return { data: null, error: { message: 'Bucket not found' } };
        this.objects.set(key(path), { contentType: options.contentType, size: body.length });
        return { data: { path }, error: null };
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

  addUser(email: string, password: string, id: string = randomUUID()): string {
    this.users.set(id, { id, email: email.toLowerCase(), password, banned: false });
    return id;
  }

  private findByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email.toLowerCase());
  }

  private session(user: FakeUser) {
    const refreshToken = `refresh-${randomUUID()}`;
    this.refreshTokens.set(refreshToken, user.id);
    return {
      access_token: user.id,
      refresh_token: refreshToken,
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: { id: user.id, email: user.email },
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
    auth: {
      getUser: async (token: string) => {
        const user = this.users.get(token);
        return user && !user.banned
          ? { data: { user: { id: user.id, email: user.email } }, error: null }
          : failure('invalid token', 401);
      },
      admin: {
        createUser: async (attrs: { email: string; password: string }) => {
          if (this.failNextCreate) {
            this.failNextCreate = false;
            return failure('boom', 500);
          }
          if (this.findByEmail(attrs.email)) return failure('User already registered', 422);
          const id = this.addUser(attrs.email, attrs.password);
          return { data: { user: { id, email: attrs.email } }, error: null };
        },
        deleteUser: async (id: string) => {
          this.users.delete(id);
          return { data: {}, error: null };
        },
        updateUserById: async (
          id: string,
          attrs: { password?: string; email?: string; ban_duration?: string },
        ) => {
          const user = this.users.get(id);
          if (!user) return failure('User not found', 404);
          if (attrs.password) user.password = attrs.password;
          if (attrs.email) user.email = attrs.email.toLowerCase();
          if (attrs.ban_duration) user.banned = attrs.ban_duration !== 'none';
          return { data: { user: { id } }, error: null };
        },
      },
    },
  };

  readonly authClient = {
    auth: {
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        const user = this.findByEmail(email);
        if (!user || user.password !== password || user.banned) return failure('Invalid login credentials');
        const session = this.session(user);
        return { data: { user: session.user, session }, error: null };
      },
      refreshSession: async ({ refresh_token }: { refresh_token: string }) => {
        const user = this.users.get(this.refreshTokens.get(refresh_token) ?? '');
        if (!user || user.banned) return failure('Invalid refresh token', 401);
        this.refreshTokens.delete(refresh_token);
        const session = this.session(user);
        return { data: { user: session.user, session }, error: null };
      },
    },
  };
}

export function installFakeSupabase(): FakeSupabase {
  const fake = new FakeSupabase();
  setSupabaseClientsForTests({
    admin: fake.admin as unknown as SupabaseClient,
    authFactory: () => fake.authClient as unknown as SupabaseClient,
  });
  return fake;
}
