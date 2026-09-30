import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { AppError } from './errors';

const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};

const notConfigured = (key: string) =>
  new AppError(503, 'SERVICE_UNAVAILABLE', `Supabase is not configured: set SUPABASE_URL and ${key}`);

let adminClient: SupabaseClient | undefined;
let authClientFactory: (() => SupabaseClient) | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw notConfigured('SUPABASE_SERVICE_ROLE_KEY');
    }
    adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, clientOptions);
  }
  return adminClient;
}

export function createSupabaseAuthClient(): SupabaseClient {
  if (authClientFactory) return authClientFactory();
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw notConfigured('SUPABASE_ANON_KEY');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, clientOptions);
}

export function setSupabaseClientsForTests(clients?: {
  admin: SupabaseClient;
  authFactory: () => SupabaseClient;
}): void {
  adminClient = clients?.admin;
  authClientFactory = clients?.authFactory;
}
