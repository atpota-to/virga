// The one Supabase client the server uses: service role, so it bypasses RLS
// (every table denies everyone else). Callers ask for it per operation rather
// than holding it, so tests can swap it with setSupabaseClientForTests.

import { createClient } from '@supabase/supabase-js';

let cached = null; // { url, key, client }
let override; // undefined: no override; null: "unconfigured"; else the client to hand out
let warned = false;

function credentials(env) {
  return {
    url: env?.SUPABASE_URL || null,
    // The Supabase–Vercel integration writes SUPABASE_SERVICE_ROLE_KEY; the
    // shorter name is accepted for setups that copied an older env file.
    key: env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_KEY || null,
  };
}

/** True when the URL and the service-role key are both set (or a test client is installed). */
export function isSupabaseConfigured(env = process.env) {
  if (override !== undefined) return override !== null;
  const { url, key } = credentials(env);
  return Boolean(url && key);
}

/** The service-role client, or null when Supabase isn't configured. */
export function getSupabaseClient(env = process.env) {
  if (override !== undefined) return override;
  const { url, key } = credentials(env);
  if (!url || !key) {
    if (!warned) {
      warned = true;
      console.warn('[supabase] not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.');
    }
    return null;
  }
  if (cached && cached.url === url && cached.key === key) return cached.client;
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  cached = { url, key, client };
  return client;
}

/**
 * Tests only. A client (a fake, or the PGlite adapter) is handed to every
 * caller; null makes Supabase read as unconfigured; undefined removes the
 * override.
 */
export function setSupabaseClientForTests(client) {
  override = client;
}

/** Tests only: drop the override and the cached client. */
export function resetSupabaseClientForTests() {
  override = undefined;
  cached = null;
  warned = false;
}
