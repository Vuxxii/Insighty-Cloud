import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cloud is OPTIONAL: with no env config the app runs exactly like the local-only
 * version (capture, retrieval, export — everything works, no account required).
 * Set these in `.env.local` (dev) or at build time:
 *   VITE_SUPABASE_URL=https://xxxx.supabase.co
 *   VITE_SUPABASE_ANON_KEY=eyJ...   (the PUBLIC anon key — safe to ship; RLS is the guard)
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

export function isCloudConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) throw new Error('Cloud is not configured (missing Supabase env).');
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        // Tokens persist so a reload keeps the session; the MASTER KEY does not —
        // it is re-derived from the password (or cached wrapped) at unlock.
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return client;
}
