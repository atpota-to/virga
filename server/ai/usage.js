// The monthly AI allowances: how many of each an account has used this UTC
// month, taking one before the model is called and giving it back when the
// request ends without a usable answer. Best-effort by design: with Supabase
// unavailable nothing is enforced (`tracked: false`) and a failed write is
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
 * Take one use of `allowance` for this month before the model is called, if
 * any is left. The check and the increment are one statement in the database
 * (reserve_ai_usage), so requests arriving together can't all pass at the
 * last use. A limit of 0 refuses before anything is read, so switching a
 * feature off holds even while the store is down. Never throws.
 *
 * @param {'adviser'|'style'|'altText'} allowance
 * @param {string} did
 * @param {{ env?: object, now?: Date }} [opts]
 * @returns {Promise<{ allowed: boolean, used: number, limit: number|null,
 *   held: boolean, month: string }>} `used` is the count after the use (or as
 *   it stands, when refused). `held` says a use was written, to give back with
 *   releaseUsage if the request fails; it is false for unlimited, a refusal,
 *   or Supabase unavailable (which lets the request through, used 0).
 */
export async function reserveUsage(
  allowance,
  did,
  { env = process.env, now = new Date() } = {},
) {
  allowanceFor(allowance);
  const limit = monthlyLimitFor(allowance, env);
  const month = currentMonthKey(now);
  const open = { allowed: true, used: 0, limit, held: false, month };
  if (limit === null) return open;
  if (limit < 1) return { ...open, allowed: false };
  const supabase = getSupabaseClient(env);
  if (!supabase || !did) return open;

  try {
    const { data, error } = await supabase.rpc('reserve_ai_usage', {
      p_allowance: allowance,
      p_did: did,
      p_month: month,
      p_limit: limit,
    });
    if (error) {
      console.warn(
        `[ai-usage] ${allowance} reserve failed: ${error.message || error.code || 'unknown error'}`,
      );
      return open;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== 'boolean') {
      console.warn(`[ai-usage] ${allowance} reserve gave no answer`);
      return open;
    }
    return {
      allowed: row.allowed,
      used: Number(row.used) || 0,
      limit,
      held: row.allowed,
      month,
    };
  } catch (err) {
    console.warn(
      `[ai-usage] ${allowance} reserve threw: ${err?.message || err}`,
    );
    return open;
  }
}

/**
 * Give back a use reserveUsage took, for a request that ended without a usable
 * answer. `month` is the reservation's, so a request that crosses midnight at
 * the month's end gives back the use it took. Never throws: a use that can't
 * be given back stays counted, which errs toward the limit.
 *
 * @param {'adviser'|'style'|'altText'} allowance
 * @param {string} did
 * @param {{ env?: object, month: string }} opts
 */
export async function releaseUsage(
  allowance,
  did,
  { env = process.env, month } = {},
) {
  allowanceFor(allowance);
  const supabase = getSupabaseClient(env);
  if (!supabase || !did || !month) return;

  try {
    const { error } = await supabase.rpc('release_ai_usage', {
      p_allowance: allowance,
      p_did: did,
      p_month: month,
    });
    if (error) {
      console.warn(
        `[ai-usage] ${allowance} release failed: ${error.message || error.code || 'unknown error'}`,
      );
    }
  } catch (err) {
    console.warn(
      `[ai-usage] ${allowance} release threw: ${err?.message || err}`,
    );
  }
}
