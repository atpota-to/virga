/**
 * Per-account rate limiting for the AI endpoints (/api/ai/*).
 *
 * These endpoints spend real money on the deployment's AI_GATEWAY_API_KEY, so
 * on top of requiring a valid session they cap how many calls one account can
 * make. Two tiers:
 *
 *   1. Burst  — a per-minute counter held in a per-instance TtlCache. Cheap,
 *      zero-I/O, and stops a tight scripted loop immediately on a warm instance.
 *   2. Daily  — a per-DID per-day counter in Supabase (consume_ai_daily), so it
 *      holds across serverless instances and can't be reset by clearing
 *      browser state. This is the real cost ceiling.
 *
 * Both fail OPEN if their store is unavailable: authentication is the primary
 * control, and the counters are best-effort. Limits are generous for real use
 * and tunable via env (allowances.js), read on every call.
 */

import { TtlCache } from '../ttlCache.js';
import { getSupabaseClient } from '../supabase.js';
import { burstPerMin, dailyLimit } from './allowances.js';

const BURST_WINDOW_MS = 60 * 1000;

// windowStart is tracked explicitly; the TTL is only for memory hygiene.
const burstCache = new TtlCache({ ttlMs: 5 * BURST_WINDOW_MS, max: 20000 });

/** The current day in UTC, e.g. '2026-11-13'. */
export function dayKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Per-instance fixed-window burst check-and-consume. Never throws. */
function checkBurst(did, limit) {
  const now = Date.now();
  const entry = burstCache.get(did);
  if (!entry || now - entry.windowStart >= BURST_WINDOW_MS) {
    burstCache.set(did, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (entry.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(
        1,
        Math.ceil((BURST_WINDOW_MS - (now - entry.windowStart)) / 1000),
      ),
    };
  }
  entry.count += 1;
  burstCache.set(did, entry);
  return { allowed: true };
}

/**
 * Take one of today's slots in Supabase. The check and the increment are one
 * statement in the database, so concurrent requests can't pass the limit
 * between them. Fails open (allowed, untracked) when Supabase is unavailable
 * or errors. Never throws.
 */
async function checkAndConsumeDaily(did, limit, env) {
  const supabase = getSupabaseClient(env);
  if (!supabase || !did) return { allowed: true, tracked: false, limit };

  try {
    const { data, error } = await supabase.rpc('consume_ai_daily', {
      p_did: did,
      p_day: dayKey(),
      p_limit: limit,
    });
    if (error) {
      console.warn(
        `[ai-rate-limit] daily count failed: ${error.message || error.code || 'unknown error'}`,
      );
      return { allowed: true, tracked: false, limit };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== 'boolean') {
      console.warn('[ai-rate-limit] daily count gave no answer');
      return { allowed: true, tracked: false, limit };
    }
    return {
      allowed: row.allowed,
      tracked: true,
      limit,
      used: Number(row.used) || 0,
    };
  } catch (err) {
    console.warn(`[ai-rate-limit] daily count threw: ${err?.message || err}`);
    return { allowed: true, tracked: false, limit };
  }
}

/**
 * Enforce both tiers for an authenticated DID. Call this AFTER input validation
 * and BEFORE spending anything on the model, so malformed requests don't consume
 * budget and every call that reaches the gateway is counted.
 *
 * @param {string} did - the session-derived DID (never client-supplied)
 * @param {{ env?: object }} [opts]
 * @returns {Promise<{ allowed: boolean, status?: number, body?: object }>}
 *   When not allowed, `status`/`body` are ready to send as the HTTP response.
 */
export async function enforce(did, { env = process.env } = {}) {
  // Nothing to key a limit on. Every caller of the handlers has a DID; this
  // keeps a direct call from throwing.
  if (!did) return { allowed: true };

  const burst = checkBurst(did, burstPerMin(env));
  if (!burst.allowed) {
    return {
      allowed: false,
      status: 429,
      body: {
        error: 'rate_limited',
        scope: 'burst',
        retryAfterSec: burst.retryAfterSec,
      },
    };
  }

  const daily = await checkAndConsumeDaily(did, dailyLimit(env), env);
  if (!daily.allowed) {
    return {
      allowed: false,
      status: 429,
      body: { error: 'rate_limited', scope: 'daily', limit: daily.limit },
    };
  }

  return { allowed: true };
}

/** Tests only: forget every burst window. */
export function resetBurstForTests() {
  burstCache.clear();
}

export { burstCache as _burstCache };
