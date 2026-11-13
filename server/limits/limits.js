// The account limits Virga's server applies, all flat: there are no tiers.
//
// Two kinds of ceiling, both from env and read at call time:
//   - caps everyone has, as a guard against abuse: SCHEDULE_MAX_PENDING
//     scheduled posts waiting or publishing (50) and TIMER_MAX_ACTIVE_PER_USER
//     live timers (200);
//   - optional feature limits an operator may set lower: SCHEDULED_POSTS_LIMIT,
//     POST_TIMERS_LIMIT and CONDITIONAL_TIMERS_LIMIT. Unset means unlimited
//     under the caps.
// A refusal is 409 QUOTA_EXCEEDED with the `feature` and `limit` it hit, which
// the client turns into its own sentence.

import { envInt } from '../env.js';
import { getSupabaseClient } from '../supabase.js';
import {
  countTimerUsage,
  enforceTimerLimit,
  timerBucket,
} from '../timers/timerUsage.js';

export const LIMIT_FEATURES = Object.freeze([
  'scheduledPosts',
  'postTimers',
  'conditionalTimers',
]);

export const FEATURE_LIMIT_ENV = Object.freeze({
  scheduledPosts: 'SCHEDULED_POSTS_LIMIT',
  postTimers: 'POST_TIMERS_LIMIT',
  conditionalTimers: 'CONDITIONAL_TIMERS_LIMIT',
});

export const DEFAULT_MAX_PENDING = 50;
export const DEFAULT_MAX_LIVE_TIMERS = 200;

const SCHEDULED = 'scheduled_posts';
// Rows holding a scheduled slot: waiting, or being written right now.
const WAITING = ['pending', 'publishing'];

/** Scheduled posts an account may have pending or publishing at once. */
export function maxPending(env = process.env) {
  return envInt(env, 'SCHEDULE_MAX_PENDING', DEFAULT_MAX_PENDING);
}

/** Live timers an account may have at once (enforced where timers are armed). */
export function maxLiveTimers(env = process.env) {
  return envInt(env, 'TIMER_MAX_ACTIVE_PER_USER', DEFAULT_MAX_LIVE_TIMERS);
}

/** A feature's configured limit, or null when it has none. */
export function featureLimit(feature, env = process.env) {
  const name = FEATURE_LIMIT_ENV[feature];
  return name ? envInt(env, name, null) : null;
}

/** Every feature as the limits endpoint reports it. */
export function featureStatus(env = process.env) {
  const out = {};
  for (const key of LIMIT_FEATURES) {
    const limit = featureLimit(key, env);
    out[key] =
      limit == null
        ? { isUnlimited: true, limit: null }
        : { isUnlimited: false, limit };
  }
  return out;
}

/** The number of scheduled posts an account may hold: the cap, or a lower feature limit. */
export function scheduledPostsCeiling(env = process.env) {
  const cap = maxPending(env);
  const limit = featureLimit('scheduledPosts', env);
  return limit == null ? cap : Math.min(cap, limit);
}

/** A refusal for being at a limit. Never retried; the handlers answer it 409. */
export class QuotaExceededError extends Error {
  constructor(feature, limit, message) {
    super(message || quotaSentence(feature, limit));
    this.name = 'QuotaExceededError';
    this.code = 'QUOTA_EXCEEDED';
    this.nonRetryable = true;
    this.status = 409;
    this.feature = feature;
    this.limit = limit;
  }
}

function quotaSentence(feature, limit) {
  return feature === 'scheduledPosts'
    ? `you can have at most ${limit} scheduled posts`
    : `this account is at its limit of ${limit}`;
}

/** The 409 body for a QuotaExceededError (or anything carrying the same fields). */
export function quotaBody(err) {
  const body = { success: false, error: err.message, code: 'QUOTA_EXCEEDED' };
  if (err.feature) body.feature = err.feature;
  if (Number.isFinite(err.limit)) body.limit = err.limit;
  return body;
}

/** Scheduled posts pending or publishing, or null when that can't be read. */
export async function countScheduledActive(userDid) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { count, error } = await supabase
    .from(SCHEDULED)
    .select('id', { count: 'exact', head: true })
    .eq('user_did', userDid)
    .in('status', WAITING);
  if (error) {
    console.warn('[limits] could not count scheduled posts:', error.message);
    return null;
  }
  return count || 0;
}

/**
 * Timers waiting on a scheduled post, per bucket: they hold their slot from
 * the moment they're scheduled, so the publish worker arms them without
 * asking again. `exceptScheduledId` leaves out the row an edit is rewriting.
 * Null when the read fails.
 */
export async function countScheduledTimers(
  userDid,
  { exceptScheduledId = null } = {},
) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(SCHEDULED)
    .select('id, payload')
    .eq('user_did', userDid)
    .in('status', WAITING);
  if (error) {
    console.warn('[limits] could not count scheduled timers:', error.message);
    return null;
  }
  const counts = { plain: 0, conditional: 0 };
  for (const row of data || []) {
    if (exceptScheduledId && row.id === exceptScheduledId) continue;
    const spec = row.payload && row.payload.selfDestruct;
    if (!spec) continue;
    counts[timerBucket(spec)] += 1;
  }
  return counts;
}

/** Live timers per feature (TIMERS counts them), or null when they can't be counted. */
async function liveTimerUsage(userDid) {
  try {
    const usage = await countTimerUsage(userDid);
    if (!usage) return null;
    const ok = (n) => Number.isFinite(n);
    if (!ok(usage.postTimers) || !ok(usage.conditionalTimers)) return null;
    return usage;
  } catch (err) {
    console.warn('[limits] could not count live timers:', err?.message || err);
    return null;
  }
}

/**
 * What the account holds of each limited feature: scheduled posts pending or
 * publishing, and timers per kind, live ones plus those waiting on a
 * scheduled post. A count that can't be read is null, never 0.
 * @returns {Promise<{ scheduledPosts: number|null, postTimers: number|null, conditionalTimers: number|null }>}
 */
export async function featureUsage(userDid) {
  const [scheduledPosts, live, waiting] = await Promise.all([
    countScheduledActive(userDid),
    liveTimerUsage(userDid),
    countScheduledTimers(userDid),
  ]);
  const timers = live && waiting;
  return {
    scheduledPosts,
    postTimers: timers ? live.postTimers + waiting.plain : null,
    conditionalTimers: timers
      ? live.conditionalTimers + waiting.conditional
      : null,
  };
}

/**
 * Refuse a scheduled post's timer when its kind is at a configured feature
 * limit, counting live timers and the timers waiting on other scheduled
 * posts (`exceptScheduledId` is the row an edit rewrites). Unlimited, the
 * default, counts nothing. A count that can't be read lets the timer through
 * rather than refuse a writer over a blip; the cap on live timers still
 * applies when the worker arms it. Throws a QUOTA_EXCEEDED error naming the
 * feature and its limit.
 */
export async function enforceScheduledTimerLimit(
  { userDid, spec, exceptScheduledId = null },
  env = process.env,
) {
  if (!spec) return;
  await enforceTimerLimit(
    {
      userDid,
      conditions: spec.conditions,
      effects: spec.effects,
      exceptScheduledId,
    },
    env,
  );
}
