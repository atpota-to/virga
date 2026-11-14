// What every report and every dashboard card draws: pure derivations over the
// archive for one period, computed once per (archive revision, period,
// options) and shared. A dashboard with a followers figure, a growth chart
// and a new-followers chart walks the follower list once, not three times.
//
// Each model takes `(archive, period, nowMs, options)`; `period` is one of
// ANALYTICS_PERIODS. All time starts at the oldest thing the model counts.

import {
  POST_ROW_VERSION,
  ENGAGEMENT_KINDS,
  blockReach,
  bucketSeries,
  compareRates,
  comparePeriods,
  cumulativeSeries,
  defaultUnitFor,
  engagementOf,
  givenEvents,
  isOwnVoicePost,
  movingAverage,
  oldestEventMs,
  outboundFromPosts,
  rateSeries,
  rollingRate,
  topActors,
  topPosts,
  unitChoicesFor,
} from '../lib/analytics.js';
import { localeStamp, uses12Hour, weekOrder } from '../lib/locale.js';
import { periodEnd, periodStart } from '../lib/periods.js';

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* The cache                                                            */
/* ------------------------------------------------------------------ */

const CACHE_LIMIT = 80;
const cache = new Map();

/**
 * `compute()` once per archive revision, period and options; the same
 * object after that. The oldest entries go first past CACHE_LIMIT.
 */
export function cached(archive, name, period, options, compute) {
  // followRev moves when Follow or Unfollow changes the follows between syncs.
  // localeStamp moves with the locale and the first day of the week: a week
  // bucketed from Monday must not be served to someone who starts on Sunday.
  const key = [archive.did, archive.rev, archive.followRev || 0, archive.nowMs, localeStamp(), name, period?.key, JSON.stringify(options || {})].join('|');
  if (cache.has(key)) return cache.get(key);
  const value = compute();
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return value;
}

// Every model takes "now" and reads it as where its window ends: for a
// preset that is now, for a custom range the close of its last day, which is
// what the first line of each (`periodEnd`) swaps in.

/** The window's start, its length in days and the units it can be drawn in. */
function windowOf(period, nowMs, oldestMs, unitPick) {
  const t0 = periodStart(period, nowMs) ?? (Number.isFinite(oldestMs) ? oldestMs : nowMs);
  const spanDays = Math.max(1, Math.round((nowMs - t0) / DAY_MS));
  const units = unitChoicesFor(period.days ?? spanDays);
  const unit = unitPick && units.includes(unitPick) ? unitPick : defaultUnitFor(period.days ?? spanDays);
  return { t0, spanDays, units, unit };
}

function minOf(list, pick) {
  let min = Infinity;
  for (const item of list) {
    const v = pick(item);
    if (v < min) min = v;
  }
  return min;
}

/* ------------------------------------------------------------------ */
/* Followers                                                            */
/* ------------------------------------------------------------------ */

export function followersModel(archive, period, nowMs, { unit: unitPick = null } = {}) {
  nowMs = periodEnd(period, nowMs);
  return cached(archive, 'followers', period, { unitPick }, () => {
    const { followers, blocks } = archive;
    const dated = [];
    for (const f of followers) {
      const atMs = Date.parse(f.followedAt || '');
      if (Number.isFinite(atMs)) dated.push({ ...f, atMs });
    }
    const undated = followers.length - dated.length;
    const { t0, spanDays, units, unit } = windowOf(period, nowMs, minOf(dated, (f) => f.atMs), unitPick);
    const inWindow = dated.filter((f) => f.atMs >= t0 && f.atMs <= nowMs);
    const counts = bucketSeries(inWindow, { unit, t0, t1: nowMs, pickTime: (f) => f.atMs });
    const baseline = dated.filter((f) => f.atMs < t0).length;
    const datedBlocks = blocks.map((b) => ({ atMs: Date.parse(b.blockedAt || '') })).filter((b) => Number.isFinite(b.atMs));
    const blockCounts = bucketSeries(datedBlocks, { unit, t0, t1: nowMs, pickTime: (b) => b.atMs });
    const blockBaseline = datedBlocks.filter((b) => b.atMs < t0).length;
    const compare = comparePeriods(dated, { days: period.days || spanDays, now: nowMs, pickTime: (f) => f.atMs });
    const profileCount = archive.meta.followers?.profileCount ?? null;
    return {
      total: followers.length,
      undated,
      unit,
      units,
      counts,
      cumulative: cumulativeSeries(counts, baseline),
      blockCumulative: cumulativeSeries(blockCounts, blockBaseline),
      gained: inWindow.length,
      perDay: inWindow.length / spanDays,
      compare,
      spanDays,
      profileCount,
      counterGap: profileCount != null ? profileCount - followers.length : null,
      newest: [...inWindow].sort((a, b) => b.atMs - a.atMs).slice(0, 50),
      biggestDays: biggestDays(inWindow),
    };
  });
}

/** The days in a window with the most new followers, largest first. */
function biggestDays(dated, limit = 5) {
  const byDay = new Map();
  for (const f of dated) {
    const d = new Date(f.atMs);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  return [...byDay.entries()]
    .map(([t, n]) => ({ t, n }))
    .sort((a, b) => b.n - a.n || b.t - a.t)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Blocks                                                               */
/* ------------------------------------------------------------------ */

export function blocksModel(archive, period, nowMs, { unit: unitPick = null } = {}) {
  nowMs = periodEnd(period, nowMs);
  return cached(archive, 'blocks', period, { unitPick }, () => {
    const { blocks, followers } = archive;
    const reach = blockReach(blocks);
    const dated = reach.people
      .map((person) => ({ ...person, atMs: Date.parse(person.blockedAt || '') }))
      .filter((person) => Number.isFinite(person.atMs));
    const undated = reach.people.length - dated.length;
    const { t0, spanDays, units, unit } = windowOf(period, nowMs, minOf(dated, (b) => b.atMs), unitPick);
    const inWindow = dated.filter((b) => b.atMs >= t0 && b.atMs <= nowMs);
    const counts = bucketSeries(inWindow, { unit, t0, t1: nowMs, pickTime: (b) => b.atMs });
    const baseline = dated.filter((b) => b.atMs < t0).length;
    const direct = dated.filter((p) => p.source === 'direct');
    const viaLists = dated.filter((p) => p.source === 'list');
    const directCounts = bucketSeries(direct, { unit, t0, t1: nowMs, pickTime: (p) => p.atMs });
    const listCounts = bucketSeries(viaLists, { unit, t0, t1: nowMs, pickTime: (p) => p.atMs });
    const datedFollowers = followers.map((f) => ({ atMs: Date.parse(f.followedAt || '') })).filter((f) => Number.isFinite(f.atMs));
    const followerCounts = bucketSeries(datedFollowers, { unit, t0, t1: nowMs, pickTime: (f) => f.atMs });
    return {
      total: reach.people.length,
      directTotal: reach.directCount,
      listTotal: reach.listCount,
      overlap: reach.overlapCount,
      undated,
      unit,
      units,
      counts,
      trend: movingAverage(counts, 7),
      cumulative: cumulativeSeries(counts, baseline),
      directCumulative: cumulativeSeries(directCounts, direct.filter((p) => p.atMs < t0).length),
      listCumulative: cumulativeSeries(listCounts, viaLists.filter((p) => p.atMs < t0).length),
      followerCumulative: cumulativeSeries(followerCounts, datedFollowers.filter((f) => f.atMs < t0).length),
      received: inWindow.length,
      perDay: inWindow.length / spanDays,
      compare: comparePeriods(dated, { days: period.days || spanDays, now: nowMs, pickTime: (b) => b.atMs }),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Posts                                                                */
/* ------------------------------------------------------------------ */

function datedPosts(archive) {
  return cached(archive, 'datedPosts', null, null, () =>
    archive.posts.map((p) => ({ ...p, atMs: Date.parse(p.at) })).filter((p) => Number.isFinite(p.atMs)),
  );
}

export function postsModel(archive, period, nowMs, { unit: unitPick = null } = {}) {
  nowMs = periodEnd(period, nowMs);
  return cached(archive, 'posts', period, { unitPick }, () => {
    const dated = datedPosts(archive);
    const { t0, spanDays, units, unit } = windowOf(period, nowMs, minOf(dated, (p) => p.atMs), unitPick);
    const inWindow = dated.filter((p) => p.atMs >= t0 && p.atMs <= nowMs);
    const counts = bucketSeries(inWindow, { unit, t0, t1: nowMs, pickTime: (p) => p.atMs });
    const replies = inWindow.filter((p) => p.replyTo).length;
    const quotes = inWindow.filter((p) => p.quoteOf).length;
    const withMedia = inWindow.filter((p) => p.hasMedia).length;
    return {
      unit,
      units,
      counts,
      trend: movingAverage(counts, 7),
      count: inWindow.length,
      perDay: inWindow.length / spanDays,
      replies,
      quotes,
      originals: inWindow.length - replies,
      withMedia,
      compare: comparePeriods(dated, { days: period.days || spanDays, now: nowMs, pickTime: (p) => p.atMs }),
      spanDays,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Engagement received                                                  */
/* ------------------------------------------------------------------ */

export function engagementModel(archive, period, nowMs, { kind = 'all', unit: unitPick = null, rateUnit: ratePick = null } = {}) {
  nowMs = periodEnd(period, nowMs);
  return cached(archive, 'engagement', period, { kind, unitPick, ratePick }, () => {
    const did = archive.did;
    const dated = datedPosts(archive);
    const { t0, spanDays, units, unit } = windowOf(period, nowMs, minOf(dated, (p) => p.atMs), unitPick);
    const inWindow = dated.filter((p) => p.atMs >= t0 && p.atMs <= nowMs);
    const value = (p) => engagementOf(p, kind);
    const total = inWindow.reduce((sum, p) => sum + value(p), 0);
    const series = bucketSeries(inWindow, { unit, t0, t1: nowMs, pickTime: (p) => p.atMs, pickValue: value });
    // The rate: engagement per post, over the owner's own voice only: top-
    // level posts and threads, never replies to other people.
    const own = dated.filter((p) => isOwnVoicePost(p, did));
    const ownInWindow = own.filter((p) => p.atMs >= t0 && p.atMs <= nowMs);
    const ownTotal = ownInWindow.reduce((sum, p) => sum + value(p), 0);
    const rateUnit = ratePick && units.includes(ratePick) ? ratePick : units.includes('week') ? 'week' : unit;
    const rate = rateSeries(ownInWindow, { unit: rateUnit, t0, t1: nowMs, kind });
    const byKind = ENGAGEMENT_KINDS.filter((k) => k.key !== 'all').map((k) => ({
      kind: k.key,
      label: k.label,
      value: inWindow.reduce((sum, p) => sum + engagementOf(p, k.key), 0),
    }));
    return {
      unit,
      units,
      series,
      trend: movingAverage(series, 7),
      total,
      byKind,
      posts: inWindow.length,
      // Twenty, for a dashboard card set to show that many; the report shows ten.
      top: topPosts(inWindow, { kind, t0, t1: nowMs, limit: 20 }),
      compare: comparePeriods(dated, { days: period.days || spanDays, now: nowMs, pickTime: (p) => p.atMs, pickValue: value }),
      rateUnit,
      rate,
      rateTrend: rollingRate(rate, 5),
      ownPosts: ownInWindow.length,
      ownRate: ownInWindow.length ? ownTotal / ownInWindow.length : null,
      rateCompare: period.days ? compareRates(own, { days: period.days, now: nowMs, kind }) : null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Engagement given                                                     */
/* ------------------------------------------------------------------ */

export const GIVEN_NOUN = { like: 'likes', repost: 'reposts', reply: 'replies', quote: 'quotes' };

export function givenModel(archive, period, nowMs, { kind = 'all', unit: unitPick = null } = {}) {
  nowMs = periodEnd(period, nowMs);
  return cached(archive, 'given', period, { kind, unitPick }, () => {
    const all = [];
    for (const ev of givenEvents(archive.outbound, archive.posts, archive.did)) {
      const atMs = Date.parse(ev.at);
      if (Number.isFinite(atMs)) all.push({ ...ev, atMs });
    }
    const { t0, spanDays, units, unit } = windowOf(period, nowMs, minOf(all, (e) => e.atMs), unitPick);
    const inWindowAll = all.filter((e) => e.atMs >= t0 && e.atMs <= nowMs);
    const byKind = Object.keys(GIVEN_NOUN)
      .map((k) => ({ kind: k, count: inWindowAll.filter((e) => e.kind === k).length }))
      .sort((a, b) => b.count - a.count);
    const events = kind === 'all' ? all : all.filter((e) => e.kind === kind);
    const inWindow = kind === 'all' ? inWindowAll : inWindowAll.filter((e) => e.kind === kind);
    const series = bucketSeries(inWindow, { unit, t0, t1: nowMs, pickTime: (e) => e.atMs });
    return {
      unit,
      units,
      series,
      trend: movingAverage(series, 7),
      total: inWindow.length,
      perDay: inWindow.length / spanDays,
      accounts: new Set(inWindow.map((e) => e.did)).size,
      byKind,
      compare: comparePeriods(events, { days: period.days || spanDays, now: nowMs, pickTime: (e) => e.atMs }),
    };
  });
}

/* ------------------------------------------------------------------ */
/* People                                                               */
/* ------------------------------------------------------------------ */

/**
 * Everyone who engaged with the account in the window (`inbound`), and
 * everyone it engaged with (`outbound`), ranked, unfiltered. The People
 * report filters these by relationship; the cards take the top few.
 */
export function peopleModel(archive, period, nowMs, { kind = 'all' } = {}) {
  nowMs = periodEnd(period, nowMs);
  return cached(archive, 'people', period, { kind }, () => {
    const { posts, inbound, outbound, did } = archive;
    const windowFor = (events) => periodStart(period, nowMs) ?? oldestEventMs(events) ?? nowMs;
    const outboundAll = [...outbound, ...outboundFromPosts(posts)];
    const inT0 = windowFor(inbound);
    const outT0 = windowFor(outboundAll);
    return {
      inbound: topActors(inbound, { kind, t0: inT0, t1: nowMs, limit: Infinity, excludeDid: did }),
      outbound: kind === 'mention' ? [] : topActors(outboundAll, { kind, t0: outT0, t1: nowMs, limit: Infinity, excludeDid: did }),
      inOldest: oldestEventMs(inbound),
      inT0,
    };
  });
}

/** Sets of who follows the account and whom it follows, by DID. */
export function relationSets(archive) {
  return cached(archive, 'relations', null, null, () => ({
    followers: new Set(archive.followers.map((f) => f.did)),
    following: new Set(archive.following.map((f) => f.did)),
    followerCards: new Map(archive.followers.map((f) => [f.did, f])),
  }));
}

/**
 * Followers who engage with the account and whom it doesn't follow back,
 * most engaged first: the Follow-back queue.
 */
export function followBackModel(archive, period, nowMs) {
  nowMs = periodEnd(period, nowMs);
  return cached(archive, 'followBack', period, null, () => {
    const { followers, following } = relationSets(archive);
    const people = peopleModel(archive, period, nowMs);
    return people.inbound.filter((r) => followers.has(r.did) && !following.has(r.did));
  });
}

/* ------------------------------------------------------------------ */
/* Atmosphere                                                           */
/* ------------------------------------------------------------------ */

export function atmosphereModel(archive, period, nowMs, { unit: unitPick = null } = {}) {
  nowMs = periodEnd(period, nowMs);
  return cached(archive, 'atmosphere', period, { unitPick }, () => {
    const { atmosphere } = archive;
    if (!atmosphere.length) return null;
    const { t0, spanDays, units, unit } = windowOf(period, nowMs, minOf(atmosphere, (r) => r.at), unitPick);
    const inWindow = atmosphere.filter((r) => r.at >= t0 && r.at <= nowMs);
    const byCollection = new Map();
    for (const r of inWindow) byCollection.set(r.collection, (byCollection.get(r.collection) || 0) + 1);
    const ranked = [...byCollection.entries()]
      .map(([collection, count]) => ({ collection, count }))
      .sort((a, b) => b.count - a.count || (a.collection < b.collection ? -1 : 1));
    const series = bucketSeries(inWindow, { unit, t0, t1: nowMs, pickTime: (r) => r.at });
    return {
      unit,
      units,
      series,
      trend: movingAverage(series, 7),
      total: inWindow.length,
      collections: ranked.length,
      ranked,
      spanDays,
      allTime: atmosphere.length,
    };
  });
}

/* ------------------------------------------------------------------ */
/* When posts land                                                      */
/* ------------------------------------------------------------------ */

// Indexed from Monday everywhere in the model (`day` 0 is Monday), whatever
// day the reader's week starts on; weekdayOrder() below is the order to draw
// them in.
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * The model's weekday indexes in the order the reader's week runs:
 * [0..6] for a Monday start, [6, 0, 1, 2, 3, 4, 5] for a Sunday one.
 */
export function weekdayOrder() {
  return weekOrder().map((day) => (day + 6) % 7);
}

/** The fewest posts a slot needs before its average is shown at all. */
export const BEST_TIME_MIN_POSTS = 3;

/** The middle value of a list of numbers (the mean of the middle two). */
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Engagement per post by the weekday and hour each post was made, in this
 * browser's time zone, over the owner's own voice (top-level posts and
 * threads; replies to other people earn differently and would drown it).
 * `block` is the hours per column (2 gives a 7×12 grid).
 *
 * Each slot reads its typical post, the median, not the mean: one post that
 * went round would otherwise make its hour look like the best time forever.
 * A slot with fewer than BEST_TIME_MIN_POSTS posts has no value: too few to
 * say anything.
 *
 * Counts are as of the last sync, so the newest posts are still collecting;
 * posts younger than two days are left out for that reason.
 */
export function bestTimeModel(archive, period, nowMs, { block = 2 } = {}) {
  nowMs = periodEnd(period, nowMs);
  return cached(archive, 'bestTime', period, { block }, () => {
    const cols = Math.ceil(24 / block);
    const t0 = periodStart(period, nowMs) ?? -Infinity;
    const settled = nowMs - 2 * DAY_MS;
    const grid = WEEKDAYS.map(() => Array.from({ length: cols }, () => []));
    const all = [];
    for (const p of datedPosts(archive)) {
      if (p.atMs < t0 || p.atMs > settled || !isOwnVoicePost(p, archive.did)) continue;
      const d = new Date(p.atMs);
      const e = engagementOf(p, 'all');
      grid[(d.getDay() + 6) % 7][Math.floor(d.getHours() / block)].push(e);
      all.push(e);
    }
    const slots = [];
    const rows = grid.map((cells, day) => ({
      label: WEEKDAYS[day],
      cells: cells.map((list, col) => {
        const avg = list.length >= BEST_TIME_MIN_POSTS ? median(list) : null;
        if (avg != null) slots.push({ day, col, avg, posts: list.length });
        return { posts: list.length, avg };
      }),
    }));
    slots.sort((a, b) => b.avg - a.avg || b.posts - a.posts);
    const byDay = grid.map((cells, day) => {
      const list = cells.flat();
      return { day, posts: list.length, avg: list.length >= BEST_TIME_MIN_POSTS ? median(list) : null };
    });
    const byHour = Array.from({ length: cols }, (_, col) => {
      const list = grid.flatMap((cells) => cells[col]);
      return { col, posts: list.length, avg: list.length >= BEST_TIME_MIN_POSTS ? median(list) : null };
    });
    return { block, cols, rows, best: slots.slice(0, 3), byDay, byHour, posts: all.length, overall: median(all) };
  });
}

/**
 * "6–8 pm" for a column of `block` hours starting at `col * block`, or
 * "18–20" where the reader's clock runs to 24.
 */
export function hourRange(col, block = 2) {
  const from = col * block;
  if (!uses12Hour()) {
    const two = (x) => String(x % 24).padStart(2, '0');
    return `${two(from)}–${two(from + block)}`;
  }
  const h = (x) => {
    const v = x % 24;
    return { n: v % 12 === 0 ? 12 : v % 12, ap: v < 12 ? 'am' : 'pm' };
  };
  const a = h(from);
  const b = h(from + block);
  return a.ap === b.ap ? `${a.n}–${b.n} ${b.ap}` : `${a.n} ${a.ap}–${b.n} ${b.ap}`;
}

/** Hour-of-day labels for a heatmap's columns: every third column labelled. */
export function hourColumns(block = 2) {
  const cols = Math.ceil(24 / block);
  const every = Math.max(1, Math.round(6 / block));
  const out = [];
  for (let c = 0; c < cols; c += every) {
    const h = c * block;
    const label = !uses12Hour() ? String(h).padStart(2, '0') : h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
    out.push({ label, span: Math.min(every, cols - c) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* What posts are made of                                               */
/* ------------------------------------------------------------------ */

/** What a post is, by what it carries. A quote that also has pictures is its pictures. */
export const CONTENT_FORMATS = Object.freeze([
  { key: 'text', label: 'Text only' },
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Video' },
  { key: 'link', label: 'Link card' },
  { key: 'gif', label: 'GIF' },
  { key: 'quote', label: 'Quote post' },
]);

/** Length bands, in the characters Bluesky counts (a post holds 300). */
export const LENGTH_BANDS = Object.freeze([
  { key: 'short', label: 'Up to 80', max: 80 },
  { key: 'medium', label: '81 to 160', max: 160 },
  { key: 'long', label: '161 to 240', max: 240 },
  { key: 'full', label: '241 to 300', max: Infinity },
]);

export const THREAD_PLACES = Object.freeze([
  { key: 'single', label: 'On its own' },
  { key: 'opener', label: 'Starts a thread' },
  { key: 'later', label: 'Later in a thread' },
]);

/** The fewest posts a group needs before its typical post is shown. */
export const CONTENT_MIN_POSTS = BEST_TIME_MIN_POSTS;

export function formatOf(post) {
  return post.media || (post.quoteOf ? 'quote' : 'text');
}

/** Whether the archive's post rows hold what the Content report reads. */
export function contentReady(archive) {
  return archive?.meta?.posts?.shape === POST_ROW_VERSION;
}

function tally() {
  return { posts: 0, total: 0, settled: [] };
}

function addTo(group, post, settled) {
  const e = engagementOf(post, 'all');
  group.posts += 1;
  group.total += e;
  if (settled) group.settled.push(e);
}

function closed(group, all) {
  return {
    posts: group.posts,
    total: group.total,
    share: all ? group.posts / all : 0,
    // The typical post, as Best time to post reads it: the median, and only
    // once there are enough posts for a middle to mean something.
    typical: group.settled.length >= CONTENT_MIN_POSTS ? median(group.settled) : null,
  };
}

/**
 * What the account's posts are made of, and what each kind typically earns:
 * by format, by length, by tag, by linked site, by place in a thread, plus
 * how much of its media is described. Over the owner's own voice (top-level
 * posts and their own threads), like the engagement rate: a reply inside
 * someone else's conversation earns on a different scale.
 *
 * Counts are every post in the window. What a group "typically earns" is the
 * median over its posts older than two days, since the newest are still
 * collecting, and is null for a group with fewer than CONTENT_MIN_POSTS.
 */
export function contentModel(archive, period, nowMs) {
  nowMs = periodEnd(period, nowMs);
  return cached(archive, 'content', period, null, () => {
    const t0 = periodStart(period, nowMs) ?? -Infinity;
    const settledBefore = nowMs - 2 * DAY_MS;
    const own = datedPosts(archive).filter((p) => p.atMs >= t0 && p.atMs <= nowMs && isOwnVoicePost(p, archive.did));
    // The first post of a thread carries no reply; the posts after it name it.
    const openers = new Set();
    for (const p of datedPosts(archive)) {
      if (p.threadOf === archive.did && p.replyTo === archive.did && p.threadKey) openers.add(p.threadKey);
    }

    const all = tally();
    const formats = new Map(CONTENT_FORMATS.map((f) => [f.key, tally()]));
    const lengths = new Map(LENGTH_BANDS.map((b) => [b.key, tally()]));
    const places = new Map(THREAD_PLACES.map((t) => [t.key, tally()]));
    const tags = new Map();
    const links = new Map();
    const langs = new Map();
    const alt = { posts: 0, described: 0, items: 0, itemsDescribed: 0 };
    let withTags = 0;
    let withLinks = 0;

    for (const p of own) {
      const settled = p.atMs <= settledBefore;
      addTo(all, p, settled);
      addTo(formats.get(formatOf(p)) || formats.get('text'), p, settled);
      const len = p.len ?? 0;
      addTo(lengths.get(LENGTH_BANDS.find((b) => len <= b.max).key), p, settled);
      const place = p.replyTo ? 'later' : openers.has(p.rkey) ? 'opener' : 'single';
      addTo(places.get(place), p, settled);

      if (p.tags?.length) withTags += 1;
      for (const tag of p.tags || []) {
        const key = tag.toLowerCase();
        if (!tags.has(key)) tags.set(key, { tag, ...tally() });
        addTo(tags.get(key), p, settled);
      }
      if (p.links?.length) withLinks += 1;
      for (const host of p.links || []) {
        if (!links.has(host)) links.set(host, { host, ...tally() });
        addTo(links.get(host), p, settled);
      }
      for (const lang of p.langs || []) langs.set(lang, (langs.get(lang) || 0) + 1);
      if (p.media === 'image' || p.media === 'video') {
        alt.posts += 1;
        alt.items += p.mediaCount || 0;
        alt.itemsDescribed += p.altCount || 0;
        if (p.mediaCount && p.altCount >= p.mediaCount) alt.described += 1;
      }
    }

    const ranked = (map, name) =>
      [...map.values()]
        .map((g) => ({ [name]: g[name], ...closed(g, all.posts) }))
        .sort((a, b) => b.posts - a.posts || (b.typical ?? -1) - (a.typical ?? -1) || String(a[name]).localeCompare(String(b[name])));
    const grouped = (defs, map) => defs.map((d) => ({ key: d.key, label: d.label, ...closed(map.get(d.key), all.posts) }));

    return {
      ready: contentReady(archive),
      posts: all.posts,
      typical: all.settled.length ? median(all.settled) : null,
      formats: grouped(CONTENT_FORMATS, formats),
      lengths: grouped(LENGTH_BANDS, lengths),
      places: grouped(THREAD_PLACES, places),
      tags: ranked(tags, 'tag'),
      links: ranked(links, 'host'),
      langs: [...langs.entries()].map(([lang, posts]) => ({ lang, posts })).sort((a, b) => b.posts - a.posts || a.lang.localeCompare(b.lang)),
      withTags,
      withLinks,
      alt: { ...alt, pct: alt.items ? (alt.itemsDescribed / alt.items) * 100 : null },
    };
  });
}

/**
 * The group that typically earns the most among those with a typical value,
 * and the one to hold it against (`against`, by key; the overall typical
 * post when that group has none). Null when there is nothing to compare.
 */
export function contentStandout(groups, overall, against = null) {
  const known = groups.filter((g) => g.typical != null);
  if (known.length < 2) return null;
  const best = known.reduce((a, b) => (b.typical > a.typical ? b : a));
  const base = known.find((g) => g.key === against && g.key !== best.key) || null;
  const baseline = base ? base.typical : overall;
  if (baseline == null || best.typical <= baseline) return null;
  return { best, base, baseline };
}

/* ------------------------------------------------------------------ */
/* Lists and the follower log                                           */
/* ------------------------------------------------------------------ */

/** The lists the account is on, moderation lists first, then by size. */
export function listsModel(archive) {
  return cached(archive, 'lists', null, null, () => {
    const lists = archive.meta.lists?.lists || [];
    const order = { moderation: 0, curation: 1, reference: 2 };
    return [...lists].sort(
      (a, b) => (order[a.purpose] ?? 3) - (order[b.purpose] ?? 3) || (b.subscribers || 0) - (a.subscribers || 0) || String(a.name).localeCompare(String(b.name)),
    );
  });
}

/** The unfollow tracker's view of the follower log. */
export function followerLogModel(archive) {
  return cached(archive, 'followerLog', null, null, () => {
    const log = archive.meta.followerLog || null;
    const entries = log?.entries || [];
    const lastAt = log?.lastSyncAt || null;
    const latest = entries.filter((e) => e.at === lastAt);
    return {
      tracking: Boolean(log),
      since: log?.firstSyncAt || null,
      lastSyncAt: lastAt,
      lost: entries.filter((e) => e.kind === 'lost'),
      gained: entries.filter((e) => e.kind === 'gained'),
      latestLost: latest.filter((e) => e.kind === 'lost'),
      latestGained: latest.filter((e) => e.kind === 'gained'),
    };
  });
}
