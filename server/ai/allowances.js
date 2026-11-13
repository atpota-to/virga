// How much AI help an account gets: three monthly allowances, a daily ceiling
// across all of them and a per-minute burst limit, each from the environment
// and read when called. Every account gets the same; there are no tiers.

import { envInt } from '../env.js';

/**
 * The monthly allowances. The ids match the client's (USAGE_FEATURES in
 * src/posting/adviser/usage.js). `table` / `column` are where usage.js reads
 * the month's count; the writes go through reserve_ai_usage and
 * release_ai_usage, keyed by the id.
 */
export const ALLOWANCES = Object.freeze({
  adviser: {
    env: 'AI_ADVISER_MONTHLY_LIMIT',
    fallback: 30,
    table: 'posting_adviser_usage',
    column: 'count',
  },
  style: {
    env: 'AI_STYLE_MONTHLY_LIMIT',
    fallback: 3,
    table: 'posting_adviser_usage',
    column: 'style_count',
  },
  altText: {
    env: 'AI_ALT_TEXT_MONTHLY_LIMIT',
    fallback: 15,
    table: 'alt_text_usage',
    column: 'count',
  },
});

export const DEFAULT_DAILY_LIMIT = 200;
export const DEFAULT_BURST_PER_MIN = 40;

/** The allowance's definition; throws on an unknown id (a coding mistake, not a request). */
export function allowanceFor(allowance) {
  const entry = Object.prototype.hasOwnProperty.call(ALLOWANCES, allowance)
    ? ALLOWANCES[allowance]
    : undefined;
  if (!entry) throw new Error(`Unknown AI allowance "${allowance}"`);
  return entry;
}

/**
 * This month's limit for `allowance`, or null for unlimited ('unlimited' or
 * 'none'): nothing is read or counted then, and the answer carries no `usage`.
 * 0 refuses every request with monthly_limit. Anything unparseable reads as
 * the default rather than as unlimited, so a typo can't open the gate.
 */
export function monthlyLimitFor(allowance, env = process.env) {
  const entry = allowanceFor(allowance);
  const raw = String(env?.[entry.env] ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'unlimited' || raw === 'none') return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isSafeInteger(n)) return n;
  }
  return entry.fallback;
}

/** AI requests one account may make in a UTC day, across all three endpoints. */
export function dailyLimit(env = process.env) {
  return envInt(env, 'AI_DAILY_LIMIT', DEFAULT_DAILY_LIMIT);
}

/** AI requests one account may make in a minute on one instance. */
export function burstPerMin(env = process.env) {
  return envInt(env, 'AI_BURST_PER_MIN', DEFAULT_BURST_PER_MIN);
}
