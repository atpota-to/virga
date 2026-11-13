// How many timers an account holds, per kind, and the optional per-kind limits.
//
// Two kinds ("buckets"): a plain timer deletes after a lifespan; a conditional
// one reads counts before it acts, or does something other than delete. The
// client draws the same line (timerBucket in src/posting/timers/selfDestruct.js).
//
// Limits are flat and come from the environment: POST_TIMERS_LIMIT and
// CONDITIONAL_TIMERS_LIMIT, unset meaning unlimited. Separately from these, the
// arming RPC holds every account to TIMER_MAX_ACTIVE_PER_USER live timers.
//
// A scheduled or queued post carrying a timer holds its slot from the moment it
// is scheduled, so the publish worker arms it without asking again
// (armForPublishedSchedule does not come through here): a post never goes out
// with the timer it was promised quietly missing.

import { envInt } from '../env.js';
import { deps, normalizeConditions, normalizeEffects } from './selfDestruct.js';

const TIMERS = 'self_destruct_posts';
const SCHEDULED = 'scheduled_posts';
const LIVE = ['armed', 'checking'];
const WAITING = ['pending', 'publishing'];

/** The /api/limits/status feature behind each bucket, and the `feature` a refusal names. */
export const BUCKET_FEATURE = Object.freeze({ plain: 'postTimers', conditional: 'conditionalTimers' });
const BUCKET_LIMIT_ENV = Object.freeze({ plain: 'POST_TIMERS_LIMIT', conditional: 'CONDITIONAL_TIMERS_LIMIT' });

/** 'conditional' when the rule reads counts or does anything but delete; else 'plain'. */
export function timerBucket({ conditions, effects } = {}) {
  const hasClauses = normalizeConditions(conditions).clauses.length > 0;
  const onlyDeletes = normalizeEffects(effects).every((e) => e.action === 'delete');
  return hasClauses || !onlyDeletes ? 'conditional' : 'plain';
}

/** The limit on one bucket from the environment, or null for unlimited. */
export function timerLimitFor(bucket, env = process.env) {
  const name = BUCKET_LIMIT_ENV[bucket];
  return name ? envInt(env, name, null) : null;
}

/** Refused for want of a slot in one bucket. 409, naming the feature and its limit, as the client reads it. */
export class TimerLimitError extends Error {
  constructor(bucket, limit) {
    const kind = bucket === 'conditional' ? 'conditional timer' : 'plain timer';
    super(`this account can keep ${limit === 1 ? `one ${kind}` : `${limit} ${kind}s`} at a time, counting scheduled posts.`);
    this.name = 'TimerLimitError';
    this.code = 'QUOTA_EXCEEDED';
    this.feature = BUCKET_FEATURE[bucket];
    this.limit = limit;
    this.statusCode = 409;
  }
}

function emptyCounts() {
  return { plain: 0, conditional: 0 };
}

/**
 * Live timers per bucket, by the DID. Null when the read fails or there is no
 * database: an unknown count, never a zero.
 */
async function countLive(userDid, { exceptPostUri = null } = {}) {
  const supabase = deps.getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(TIMERS).select('post_uri, conditions, effects')
    .eq('user_did', userDid).in('status', LIVE);
  if (error) {
    console.warn('[timer-usage] could not count live timers:', error.message);
    return null;
  }
  const counts = emptyCounts();
  for (const row of data || []) {
    if (exceptPostUri && row.post_uri === exceptPostUri) continue;
    counts[timerBucket(row)] += 1;
  }
  return counts;
}

/**
 * Live timers (armed or checking) per feature, for /api/limits/status. The
 * scheduler adds the waiting scheduled posts that carry a timer; this counts
 * timers only. A count that can't be read is null, so a reader is never told
 * they're at 0 when nobody knows.
 *
 * @returns {Promise<{ postTimers: number|null, conditionalTimers: number|null }>}
 */
export async function countTimerUsage(userDid) {
  const counts = await countLive(userDid);
  return {
    postTimers: counts ? counts.plain : null,
    conditionalTimers: counts ? counts.conditional : null,
  };
}

/**
 * Live timers and waiting scheduled timers per bucket, leaving out the post a
 * re-arm replaces and the scheduled row an edit rewrites. Null when either read
 * fails: the caller lets the timer through rather than refuse a writer over a
 * blip.
 */
export async function countTimersByBucket(userDid, { exceptPostUri = null, exceptScheduledId = null } = {}) {
  const supabase = deps.getSupabaseClient();
  if (!supabase) return null;
  const [live, waiting] = await Promise.all([
    countLive(userDid, { exceptPostUri }),
    supabase.from(SCHEDULED).select('id, payload').eq('user_did', userDid).in('status', WAITING),
  ]);
  if (!live) return null;
  if (waiting.error) {
    console.warn('[timer-usage] could not count scheduled timers:', waiting.error.message);
    return null;
  }
  const counts = { ...live };
  for (const row of waiting.data || []) {
    if (exceptScheduledId && row.id === exceptScheduledId) continue;
    const spec = row.payload && row.payload.selfDestruct;
    if (!spec) continue;
    counts[timerBucket(spec)] += 1;
  }
  return counts;
}

/**
 * Refuse a timer whose bucket has a limit and no free slot. Throws
 * TimerLimitError. Returns the verdict settleArmedTimer needs:
 * `{ bucket, limit }`, limit null when the bucket is unlimited (and then
 * nothing is counted at all).
 */
export async function enforceTimerLimit({ userDid, conditions, effects, exceptPostUri = null, exceptScheduledId = null }, env = process.env) {
  const bucket = timerBucket({ conditions, effects });
  const limit = timerLimitFor(bucket, env);
  if (limit === null) return { bucket, limit: null };
  const counts = await countTimersByBucket(userDid, { exceptPostUri, exceptScheduledId });
  if (counts && counts[bucket] >= limit) throw new TimerLimitError(bucket, limit);
  return { bucket, limit };
}

/**
 * After a limited bucket's timer is inserted, keep only as many as its slots
 * allow. Counting is two reads and a decision, not one locked statement, so two
 * timers armed at the same instant can both pass enforceTimerLimit. Live rows
 * in the bucket rank by (created_at, id) behind the waiting scheduled ones,
 * which already hold their slots; a new row ranked past the limit is called off
 * and the arm refused. Every racer ranks the same rows the same way, so exactly
 * the earliest keep their slots.
 */
export async function settleArmedTimer({ userDid, row, verdict }) {
  if (!verdict || verdict.limit == null || !row || !row.id) return;
  const supabase = deps.getSupabaseClient();
  if (!supabase) return;
  const [live, counts] = await Promise.all([
    supabase.from(TIMERS).select('id, created_at, conditions, effects')
      .eq('user_did', userDid).in('status', LIVE)
      .order('created_at', { ascending: true }).order('id', { ascending: true }),
    countTimersByBucket(userDid),
  ]);
  if (live.error || !counts) return;
  const liveInBucket = (live.data || []).filter((r) => timerBucket(r) === verdict.bucket);
  const waitingInBucket = counts[verdict.bucket] - liveInBucket.length;
  const keep = Math.max(0, verdict.limit - waitingInBucket);
  const rank = liveInBucket.findIndex((r) => r.id === row.id);
  if (rank === -1 || rank < keep) return;
  const { error } = await supabase.from(TIMERS).update({
    status: 'cancelled',
    resolution: 'not set: this account was already at its limit for this kind of timer',
    resolved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', row.id).eq('user_did', userDid).in('status', LIVE);
  if (error) {
    // The timer is still live. Refusing now would tell the writer there is no
    // timer on a post that will still be acted on, so it stands, one over.
    console.warn(`[timer-usage] could not call off over-limit timer ${row.id}: ${error.message}`);
    return;
  }
  throw new TimerLimitError(verdict.bucket, verdict.limit);
}
