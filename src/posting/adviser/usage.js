// What this browser has seen of an account's free AI allowance this month.
//
// cocoon counts and enforces it (per account, per calendar month in UTC, and
// shared with Anisota). It answers each counted request with
// `usage: { used, limit }`, and a request over the allowance with
// `{ error: 'monthly_limit', limit }`. Accounts whose allowance is unlimited
// get no `usage` at all, so an answer without it clears what was kept: an
// account that was used up and then became unlimited (or had its count reset)
// is no longer "at the limit" here once one request has gone through.
//
// This copy is a hint, never a gate on its own: it lets the composer skip the
// automatic check once the month's reads are used up, and lets a page say how
// many are left. A request the writer asks for is always sent (cocoon refuses
// it before spending anything), so a stale hint costs one refused request.
//
// Stored at localStorage `virga:adviser-usage:<did>` as `{ month, used, limit }`
// for adviser reads, with the same shape under `altText` and `style` for the
// other two allowances.

export const ADVISER_USAGE_KEY_PREFIX = 'virga:adviser-usage:';

export const USAGE_FEATURES = Object.freeze(['adviser', 'altText', 'style']);

/**
 * What cocoon allows each free account a month. Shown only until cocoon has
 * said; its own `limit` replaces it.
 */
export const FREE_MONTHLY_LIMITS = Object.freeze({
  adviser: 30,
  altText: 15,
  style: 3,
});

export function adviserUsageKey(did) {
  return `${ADVISER_USAGE_KEY_PREFIX}${did}`;
}

function localStore() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The month cocoon counts in: `YYYY-MM`, UTC. */
export function currentMonthKey(now = new Date()) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** When the allowance starts again: the first of next month, 00:00 UTC. */
export function usageResetsAt(now = new Date()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

const count = (n) =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;

function readAll(did, store) {
  if (!did || !store) return {};
  try {
    const parsed = JSON.parse(store.getItem(adviserUsageKey(did)) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function entryOf(all, feature) {
  return feature === 'adviser'
    ? { month: all.month, used: all.used, limit: all.limit }
    : all[feature];
}

function checkFeature(feature) {
  if (!USAGE_FEATURES.includes(feature)) {
    throw new TypeError(`Not an AI allowance: ${feature}`);
  }
}

/**
 * This month's count for `feature`, or null when this browser hasn't seen
 * one (a new month, an unlimited account, nothing used yet).
 *
 * @returns {{ month: string, used: number, limit: number } | null}
 */
export function readAdviserUsage(
  did,
  { feature = 'adviser', now = new Date(), store = localStore() } = {},
) {
  checkFeature(feature);
  const entry = entryOf(readAll(did, store), feature);
  if (!entry || entry.month !== currentMonthKey(now)) return null;
  const used = count(entry.used);
  const limit = count(entry.limit);
  if (used === null || !limit) return null;
  return { month: entry.month, used, limit };
}

/**
 * Keep the count cocoon answered with (`{ used, limit }`). Ignores anything
 * else, so an answer without usage changes nothing.
 *
 * @returns {{ month: string, used: number, limit: number } | null} what is stored now
 */
export function recordAdviserUsage(
  did,
  usage,
  { feature = 'adviser', now = new Date(), store = localStore() } = {},
) {
  checkFeature(feature);
  const used = count(usage?.used);
  const limit = count(usage?.limit);
  if (!did || !store || used === null || !limit) return null;
  const entry = { month: currentMonthKey(now), used, limit };
  const all = readAll(did, store);
  const next =
    feature === 'adviser' ? { ...all, ...entry } : { ...all, [feature]: entry };
  try {
    store.setItem(adviserUsageKey(did), JSON.stringify(next));
  } catch {
    // Storage full or refused: the count is only a hint.
  }
  return entry;
}

/**
 * Forget `feature`'s count for the account: cocoon answered a request for it
 * without `usage`, which it does only for an unlimited allowance.
 */
export function clearAdviserUsage(
  did,
  { feature = 'adviser', store = localStore() } = {},
) {
  checkFeature(feature);
  if (!did || !store) return;
  const all = readAll(did, store);
  const next = { ...all };
  if (feature === 'adviser') {
    delete next.month;
    delete next.used;
    delete next.limit;
  } else {
    delete next[feature];
  }
  try {
    if (
      Object.keys(next).length === 0 &&
      typeof store.removeItem === 'function'
    )
      store.removeItem(adviserUsageKey(did));
    else store.setItem(adviserUsageKey(did), JSON.stringify(next));
  } catch {
    // Storage refused: the count is only a hint.
  }
}

/**
 * cocoon refused a request as over the month's allowance: remember it as
 * used up. `limit` is what it said, else the last one seen, else the free one.
 */
export function markAdviserLimitReached(
  did,
  limit,
  { feature = 'adviser', now = new Date(), store = localStore() } = {},
) {
  checkFeature(feature);
  const known =
    count(limit) ||
    readAdviserUsage(did, { feature, now, store })?.limit ||
    FREE_MONTHLY_LIMITS[feature];
  return recordAdviserUsage(
    did,
    { used: known, limit: known },
    { feature, now, store },
  );
}

/** Whether this month's allowance for `feature` is known to be used up. */
export function isAdviserAtLimit(did, options = {}) {
  const usage = readAdviserUsage(did, options);
  return !!usage && usage.used >= usage.limit;
}

/** How many are left this month, or null when unknown (or unlimited). */
export function adviserUsesLeft(did, options = {}) {
  const usage = readAdviserUsage(did, options);
  return usage ? Math.max(0, usage.limit - usage.used) : null;
}

const NOUNS = {
  adviser: ['check', 'checks'],
  altText: ['description', 'descriptions'],
  style: ['style reading', 'style readings'],
};

const RESET_FORMAT = { month: 'long', day: 'numeric', timeZone: 'UTC' };

/**
 * The allowance in a sentence, or '' when nothing is known:
 * "12 of 30 free checks left this month. Shared with Anisota." or
 * "No free checks left this month. They start again on December 1."
 */
export function adviserUsageLine(
  usage,
  { feature = 'adviser', now = new Date() } = {},
) {
  checkFeature(feature);
  if (!usage || !count(usage.limit) || count(usage.used) === null) return '';
  const [one, many] = NOUNS[feature];
  const left = Math.max(0, usage.limit - usage.used);
  if (left === 0) {
    const resets = usageResetsAt(now).toLocaleDateString('en-US', RESET_FORMAT);
    return `No free ${many} left this month. They start again on ${resets}.`;
  }
  return `${left} of ${usage.limit} free ${usage.limit === 1 ? one : many} left this month. Shared with Anisota.`;
}
