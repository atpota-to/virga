// What every report and every dashboard card draws: pure derivations over the
// archive for one period, computed once per (archive revision, period,
// options) and shared. A dashboard with a followers figure, a growth chart
// and a new-followers chart walks the follower list once, not three times.
//
// Each model takes `(archive, period, nowMs, options)`; `period` is one of
// ANALYTICS_PERIODS. All time starts at the oldest thing the model counts.

import {
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
  const key = [archive.did, archive.rev, archive.followRev || 0, archive.nowMs, name, period?.key, JSON.stringify(options || {})].join('|');
  if (cache.has(key)) return cache.get(key);
  const value = compute();
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return value;
}

/** The window's start, its length in days and the units it can be drawn in. */
function windowOf(period, nowMs, oldestMs, unitPick) {
  const t0 = period.days ? nowMs - period.days * DAY_MS : Number.isFinite(oldestMs) ? oldestMs : nowMs;
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
      top: topPosts(inWindow, { kind, t0, t1: nowMs, limit: 10 }),
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
  return cached(archive, 'people', period, { kind }, () => {
    const { posts, inbound, outbound, did } = archive;
    const windowFor = (events) => (period.days ? nowMs - period.days * DAY_MS : (oldestEventMs(events) ?? nowMs));
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

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
  return cached(archive, 'bestTime', period, { block }, () => {
    const cols = Math.ceil(24 / block);
    const t0 = period.days ? nowMs - period.days * DAY_MS : -Infinity;
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

/** "6–8 pm" for a column of `block` hours starting at `col * block`. */
export function hourRange(col, block = 2) {
  const from = col * block;
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
    out.push({ label: h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`, span: Math.min(every, cols - c) });
  }
  return out;
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
