// The monthly AI allowances: how many of each an account has used this UTC
// month, and counting one more. Best-effort by design: with Supabase
// unavailable nothing is enforced (`tracked: false`) and a failed count is
// logged and passed over. Signing in is the real gate; these bound the cost.

import { getSupabaseClient } from '../supabase.js';
import { allowanceFor, monthlyLimitFor } from './allowances.js';

/** The current month in UTC, e.g. '2026-11'. */
export function currentMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * How much of `allowance` the account has used this month.
 * @param {'adviser'|'style'|'altText'} allowance
 * @param {string} did
 * @param {{ env?: object, now?: Date }} [opts]
 * @returns {Promise<{ used: number, limit: number|null, tracked: boolean }>}
 *   `tracked` is false when the count couldn't be read (no enforcement possible).
 */
export async function getUsage(
  allowance,
  did,
  { env = process.env, now = new Date() } = {},
) {
  const { table, column } = allowanceFor(allowance);
  const limit = monthlyLimitFor(allowance, env);
  const supabase = getSupabaseClient(env);
  if (!supabase || !did) return { used: 0, limit, tracked: false };

  try {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .eq('did', did)
      .eq('month', currentMonthKey(now))
      .maybeSingle();
    if (error) {
      console.warn(
        `[ai-usage] ${allowance} read failed: ${error.message || error.code || 'unknown error'}`,
      );
      return { used: 0, limit, tracked: false };
    }
    return { used: Number(data?.[column]) || 0, limit, tracked: true };
  } catch (err) {
    console.warn(`[ai-usage] ${allowance} read threw: ${err?.message || err}`);
    return { used: 0, limit, tracked: false };
  }
}

/**
 * Count one more use of `allowance` this month. Never throws.
 * @param {'adviser'|'style'|'altText'} allowance
 * @param {string} did
 * @param {{ env?: object, now?: Date, usedBefore?: number }} [opts]
 *   `usedBefore` is the count read before the request, answered (plus one)
 *   when the write fails, so the client still sees a sensible number.
 * @returns {Promise<number>} the new count; 0 when Supabase isn't configured
 */
export async function incrementUsage(
  allowance,
  did,
  { env = process.env, now = new Date(), usedBefore } = {},
) {
  allowanceFor(allowance);
  const supabase = getSupabaseClient(env);
  if (!supabase || !did) return 0;
  const attempted = Number.isFinite(usedBefore) ? usedBefore + 1 : 0;

  try {
    const { data, error } = await supabase.rpc('bump_ai_usage', {
      p_allowance: allowance,
      p_did: did,
      p_month: currentMonthKey(now),
    });
    if (error) {
      console.warn(
        `[ai-usage] ${allowance} increment failed: ${error.message || error.code || 'unknown error'}`,
      );
      return attempted;
    }
    const count = Number(Array.isArray(data) ? data[0] : data);
    return Number.isFinite(count) && count > 0 ? count : attempted;
  } catch (err) {
    console.warn(
      `[ai-usage] ${allowance} increment threw: ${err?.message || err}`,
    );
    return attempted;
  }
}
