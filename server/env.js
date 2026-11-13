// Environment readers for the server. Each takes `env` (process.env by
// default) and reads it when called, never at import: a function that read its
// settings at import would keep whatever a cold start saw, and tests set the
// environment after importing.

const POSITIVE_INT = /^\d+$/;

/** A positive integer from `env[name]`, or `fallback` for anything else (unset, 0, "12abc"). */
export function envInt(env = process.env, name, fallback) {
  const raw = String(env?.[name] ?? '').trim();
  if (!POSITIVE_INT.test(raw)) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/** A comma-separated list from `env[name]`, each entry trimmed, empties dropped. */
export function envList(env = process.env, name) {
  return String(env?.[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * True on the production deployment. VERCEL_ENV is set by Vercel itself, so a
 * forgotten NODE_ENV can't leave production looking like development; NODE_ENV
 * still counts for a production process run elsewhere.
 */
export function isProduction(env = process.env) {
  return env?.VERCEL_ENV === 'production' || env?.NODE_ENV === 'production';
}
