// View counts: Bluesky's estimate of how often each of the account's own
// posts was seen, which its AppView hands only to the post's author, on a
// signed-in read (`viewCount` on app.bsky.feed.defs#postView, added to the
// lexicon on 2026-11-13 and shown in Bluesky's app as a beta from v1.138, on
// 2026-11-19).
//
// What the AppView does with it, as read from its source on 2026-11-20
// (bluesky-social/atproto, packages/bsky: hydration/hydrator.ts,
// hydration/feed.ts, views/index.ts, tests/views/post-view-counts.test.ts):
//
//   - The count is filled in only when the request is signed in as the
//     post's author. Anyone else, signed in or not, gets nothing.
//   - Counts under 100 are left out. No count is not zero views.
//   - Posts indexed or dated before the day Bluesky started counting
//     (BSKY_POST_VIEW_COUNTS_START_AT, a server setting that isn't published)
//     never get one, nor does a post imported later with an older date.
//   - The read has 100 ms and fails open: when it is slow, the posts come back
//     without counts. A count can go missing from one read and be back on the
//     next.
//   - The number it reads is a feature called `unique_views`; the lexicon
//     calls it "approximate", and Bluesky's app says it "estimates how often
//     your post was seen in Bluesky’s apps".
//
// So nothing here reads a missing count as a number. A row keeps the last
// count it saw, and a post that has never had one is "under 100, or not
// counted".
//
// Bluesky's app shows the count only to someone who has told Bluesky they are
// 18 or over (social-app, PostViewCount.tsx). Virga follows the same rule
// (ageGate, below), read from the `declaredAgePref` the account's PDS works
// out from the birthday it holds; an app never sees the birthday itself.
//
// Pure: no fetch, no IndexedDB, no React.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Bluesky leaves out any count below this. */
export const VIEWS_FLOOR = 100;

/** How many posts one sync asks about at most (getPosts takes 25 a call). */
export const VIEWS_PER_SYNC = 1500;

/** getPosts' cap on URIs per call. */
export const VIEWS_BATCH = 25;

/**
 * How many posts older than the oldest one with a count the first walk reads
 * before it stops going further back. Past that, Bluesky most likely wasn't
 * counting yet, and every older post would be a read for nothing.
 */
export const VIEWS_WALK_PAST_OLDEST = 300;

/** The most readings a post keeps; older ones are thinned to make room. */
export const VIEWS_MAX_POINTS = 48;

/** Posts younger than this are still collecting views, as they are engagement. */
export const VIEWS_SETTLE_MS = 2 * DAY_MS;

/** A postView's count, or null when it carries none. */
export function viewCountOf(view) {
  const n = view?.viewCount;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Whether the account may see view counts, by Bluesky's own rule: 'adult'
 * when its preferences say it is 18 or over, 'minor' when they say it isn't,
 * and 'undeclared' when there is no `declaredAgePref` at all (no birthday
 * given, or a PDS that doesn't work one out). Only 'adult' reads them.
 *
 * `preferences` is getPreferences' list.
 */
export function ageGate(preferences) {
  const pref = (Array.isArray(preferences) ? preferences : []).find(
    (p) => p?.$type === 'app.bsky.actor.defs#declaredAgePref',
  );
  if (!pref) return 'undeclared';
  if (pref.isOverAge18 === true) return 'adult';
  if (pref.isOverAge18 === false) return 'minor';
  return 'undeclared';
}

/**
 * One read of one post, added to its row. `count` is the number the AppView
 * gave, or null when it gave none. A null never takes away a count the row
 * already has: it is either a post still under 100 or a read that failed
 * open, and the last count seen is truer than either guess.
 *
 * Readings are kept as `[ms, count]` points for the views-gained chart. A run
 * of equal readings keeps its first and last points only, so the chart knows
 * the count sat still between them rather than spreading the next rise over
 * the whole stretch.
 *
 * Row: { uri, at, count, countedAt, checkedAt, checks, points }
 */
export function applyReading(row, { uri, at = null, count = null, readAt }) {
  const prev = row || { uri, at, count: null, countedAt: null, checkedAt: null, checks: 0, points: [] };
  const next = {
    ...prev,
    uri: prev.uri || uri,
    at: at || prev.at || null,
    checkedAt: readAt,
    checks: (prev.checks || 0) + 1,
  };
  if (count == null) return next;
  // An estimate can dip a little between reads. The chart and the totals
  // hold the highest seen, so a dip never reads as views taken back.
  const held = prev.count == null ? count : Math.max(prev.count, count);
  next.count = held;
  next.countedAt = readAt;
  next.points = thinPoints(addPoint(prev.points || [], readAt, held), VIEWS_MAX_POINTS);
  return next;
}

function addPoint(points, t, v) {
  const n = points.length;
  const last = points[n - 1];
  if (last && t <= last[0]) return points;
  if (last && last[1] === v && n >= 2 && points[n - 2][1] === v) {
    // Still flat: move the run's end forward.
    return [...points.slice(0, -1), [t, v]];
  }
  return [...points, [t, v]];
}

/**
 * At most `max` points, the first and last always kept. While there are too
 * many, the inner point whose neighbours sit closest together goes: the
 * readings bunched in an afternoon thin before the ones a week apart.
 */
export function thinPoints(points, max = VIEWS_MAX_POINTS) {
  if (!Array.isArray(points) || points.length <= max || max < 2) return points;
  const out = points.slice();
  while (out.length > max) {
    let drop = 1;
    let span = Infinity;
    for (let i = 1; i < out.length - 1; i++) {
      const s = out[i + 1][0] - out[i - 1][0];
      if (s < span) {
        span = s;
        drop = i;
      }
    }
    out.splice(drop, 1);
  }
  return out;
}

/** How long a post of this age waits between reads. */
export function recheckAfter(ageMs) {
  if (ageMs < VIEWS_SETTLE_MS) return 0; // every sync
  if (ageMs < 7 * DAY_MS) return 6 * HOUR_MS;
  if (ageMs < 30 * DAY_MS) return DAY_MS;
  if (ageMs < 180 * DAY_MS) return 7 * DAY_MS;
  return 30 * DAY_MS;
}

/** The date of the oldest post that has ever had a count, in ms, or null. */
export function oldestCountedMs(rows) {
  let oldest = Infinity;
  for (const row of rowsOf(rows)) {
    if (row?.countedAt == null) continue;
    const at = Date.parse(row.at);
    if (Number.isFinite(at) && at < oldest) oldest = at;
  }
  return Number.isFinite(oldest) ? oldest : null;
}

function rowsOf(rows) {
  if (!rows) return [];
  return rows instanceof Map ? rows.values() : rows;
}

/**
 * Which posts this sync should ask about, most wanted first, at most `limit`:
 *
 *   1. posts under two days old, newest first: their counts move by the hour;
 *   2. posts never read, newest first, so a first walk covers the recent ones
 *      before it goes back;
 *   3. the rest whose wait (recheckAfter) is up, longest overdue first.
 *
 * Reads for nothing are kept down three ways. A walk back through posts over
 * 30 days old stops once it has read VIEWS_WALK_PAST_OLDEST of them older
 * than the oldest with a count (or, while none has one, that many in all)
 * and found nothing: Bluesky most likely wasn't counting yet, or the account's
 * posts don't reach 100. A post over 30 days old and older than the oldest
 * with a count isn't read again after a read without one. And a post over 30
 * days old read twice without a count isn't read again either: by then it
 * isn't going to reach 100.
 *
 * `posts` are archive rows ({ uri, at }); `rows` a Map of uri → view row.
 */
export function viewsDue(posts, rows, nowMs, { limit = VIEWS_PER_SYNC } = {}) {
  const map = rows instanceof Map ? rows : new Map((rows || []).map((r) => [r.uri, r]));
  const oldest = oldestCountedMs(map);
  let pastOldest = 0;
  for (const row of map.values()) {
    if (row?.checkedAt == null) continue;
    const at = Date.parse(row.at);
    if (oldest == null || (Number.isFinite(at) && at < oldest)) pastOldest += 1;
  }
  // How many more posts over 30 days old (past the oldest count, or in all
  // while there is none) the walk back may read.
  let walk = Math.max(0, VIEWS_WALK_PAST_OLDEST - pastOldest);

  const dated = [];
  for (const post of posts || []) {
    const atMs = Date.parse(post?.at);
    if (post?.uri && Number.isFinite(atMs)) dated.push({ uri: post.uri, atMs });
  }
  dated.sort((a, b) => b.atMs - a.atMs);

  const young = [];
  const unread = [];
  const stale = [];
  for (const { uri, atMs } of dated) {
    const age = nowMs - atMs;
    const row = map.get(uri);
    if (age < VIEWS_SETTLE_MS) {
      young.push({ uri });
      continue;
    }
    const recent = age < 30 * DAY_MS;
    if (!row || row.checkedAt == null) {
      if (recent || (oldest != null && atMs >= oldest)) unread.push({ uri });
      else if (walk > 0) {
        unread.push({ uri });
        walk -= 1;
      }
      continue;
    }
    if (row.countedAt == null && !recent && ((oldest != null && atMs < oldest) || (row.checks || 0) >= 2)) continue;
    const overdue = nowMs - row.checkedAt - recheckAfter(age);
    if (overdue >= 0) stale.push({ uri, overdue });
  }
  stale.sort((a, b) => b.overdue - a.overdue);
  return [...young, ...unread, ...stale].slice(0, Math.max(0, limit)).map((x) => x.uri);
}

/**
 * Views gained, bucket by bucket, worked out from the readings: the rise
 * between two readings is spread evenly over the time between them, so a
 * jump read after three days away lands across those three days, not on the
 * day the browser came back. That evenness is a simplification (a post is
 * seen most in its first hours), and the chart says so.
 *
 * Before its first reading, a post's views count only if the post was made
 * after Virga started reading counts (`sinceMs`): then the rise from zero, at
 * the moment it was posted, to that first reading is its own. An older post's
 * first reading is where it starts; what it gathered before isn't known by
 * day.
 *
 * `buckets` is a dense series ({ t }[], from bucketSeries) whose last bucket
 * ends at `t1`. Returns the same buckets with `v` the views gained in each.
 */
export function viewGains(rows, buckets, { t1, sinceMs = null } = {}) {
  const out = buckets.map((b) => ({ t: b.t, v: 0 }));
  if (!out.length) return out;
  const starts = out.map((b) => b.t);
  const ends = out.map((b, i) => (i + 1 < out.length ? out[i + 1].t : t1));
  for (const row of rowsOf(rows)) {
    const points = Array.isArray(row?.points) ? row.points : [];
    if (!points.length) continue;
    const seq = points;
    const postedMs = Date.parse(row.at);
    let prev = null;
    if (sinceMs != null && Number.isFinite(postedMs) && postedMs >= sinceMs && postedMs < seq[0][0]) {
      prev = [postedMs, 0];
    }
    for (const point of seq) {
      if (prev) spread(out, starts, ends, prev[0], point[0], point[1] - prev[1]);
      prev = point;
    }
  }
  return out;
}

function spread(out, starts, ends, from, to, gain) {
  if (!(gain > 0) || !(to > from)) return;
  const rate = gain / (to - from);
  // The first bucket that could overlap: the last start at or before `from`.
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= from) lo = mid;
    else hi = mid - 1;
  }
  for (let i = lo; i < out.length && starts[i] < to; i++) {
    const a = Math.max(from, starts[i]);
    const b = Math.min(to, ends[i]);
    if (b > a) out[i].v += rate * (b - a);
  }
}

/**
 * The typical (median) views of a set of posts that Bluesky counts, where a
 * post without a count is somewhere under 100. When the middle falls among
 * those, the typical post is "under 100" (`under: true`, `value: null`),
 * which is truer than a median of only the posts that cleared the floor.
 *
 * `values` holds a count, or null for a post without one.
 */
export function typicalViews(values) {
  const list = (values || []).map((v) => (v == null ? -1 : v)).sort((a, b) => a - b);
  if (!list.length) return { value: null, under: false, posts: 0 };
  const mid = list.length >> 1;
  const pair = list.length % 2 ? [list[mid]] : [list[mid - 1], list[mid]];
  if (pair.some((v) => v < 0)) return { value: null, under: true, posts: list.length };
  return { value: pair.reduce((a, b) => a + b, 0) / pair.length, under: false, posts: list.length };
}

/**
 * Where an account stands with view counts, for the screens that show them:
 *
 *   'off'         turned off in Settings on this browser
 *   'minor'       Bluesky has the account down as under 18
 *   'undeclared'  no age given to Bluesky, so Bluesky's app doesn't show them
 *   'scope'       the sign-in doesn't hold the permission, and nothing is kept
 *   'unread'      not read yet (the next sync reads them)
 *   'none'        read, and no post has a count: all under 100, or too old
 *   'ready'       counts to show
 *
 * A sign-in that lost the permission (or a read that failed) after counts
 * were kept is still 'ready': what's kept is shown, and the page says why it
 * isn't fresh.
 */
export function viewsStatus(meta, rows, { enabled = true } = {}) {
  if (!enabled) return 'off';
  const status = meta?.status || null;
  if (status === 'minor' || status === 'undeclared') return status;
  const any = Array.isArray(rows) ? rows.some((r) => r?.countedAt != null) : false;
  if (any) return 'ready';
  if (status === 'scope') return 'scope';
  if (!meta?.since) return 'unread';
  return 'none';
}
