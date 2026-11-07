import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { AppError } from './errors';

const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};

let adminClient: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new AppError(
        503,
        'SERVICE_UNAVAILABLE',
        'Supabase Storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      );
    }
    adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, clientOptions);
  }
  return adminClient;
}

export function setSupabaseClientsForTests(clients?: { admin: SupabaseClient }): void {
  adminClient = clients?.admin;
}
