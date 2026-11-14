// A per-instance fixed-window rate limiter for bursts (creates per minute and
// the like).
//
// Per-instance is an honest first line on serverless, not a global guarantee:
// each warm instance keeps its own window. Quotas that must hold across
// instances live in Postgres instead. The window comes from the injected clock,
// never from the store's own TTL, so a Map and a TtlCache both work as a store.

import { TtlCache } from './ttlCache.js';

const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_LIMIT = 10;

/**
 * @param {object} [opts]
 * @param {{ get: Function, set: Function }} [opts.store]  key → { windowStart, count }
 * @param {() => number} [opts.now]  clock in ms
 * @param {number} [opts.limit]  requests allowed per window
 * @param {number} [opts.windowMs]  window length in ms
 * @returns {{ check: (key: string) => { allowed: boolean, retryAfterSec: number, count?: number, limit?: number, degraded?: boolean } }}
 */
export function createRateLimiter({
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
  now = () => Date.now(),
  store = new TtlCache({ ttlMs: windowMs * 2, max: 20000 }),
} = {}) {
  function check(key) {
    try {
      const t = now();
      const k = `rl:${key}`;
      let entry = store.get(k);
      if (!entry || t - entry.windowStart >= windowMs) {
        entry = { windowStart: t, count: 0 };
      }
      entry.count += 1;
      store.set(k, entry);

      const allowed = entry.count <= limit;
      const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((entry.windowStart + windowMs - t) / 1000));
      return { allowed, retryAfterSec, count: entry.count, limit };
    } catch (err) {
      // Fail open: a limiter fault must never refuse a legitimate request.
      console.warn('[rate-limit] check failed (allowing):', err?.message);
      return { allowed: true, retryAfterSec: 0, count: 0, limit, degraded: true };
    }
  }
  return { check };
}
