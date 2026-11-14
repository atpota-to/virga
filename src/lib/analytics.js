// Pure derivations for the dashboard: bucketing, growth series,
// period comparisons and the ranked lists. No fetch, no DOM, no state: this
// module turns the archives that analyticsSync.js gathers (posts, followers,
// inbound and outbound engagement events) into the numbers the dashboard draws.
//
// Everything is bucketed in LOCAL time: the owner reads their own dashboard
// in their own timezone, and a
// post made at 11pm should count toward that evening's bar, not the next day's
// because UTC rolled over.
//
// Vocabulary, used consistently across the sync, the store and the dashboard:
//
//   unit   'day' | 'week' | 'month'      — a bucket size. Weeks start Monday.
//   kind   'like' | 'repost' | 'reply' | 'quote' | 'mention'
//                                        — one engagement event type. Filters
//                                          use the same words; 'all' is the
//                                          absence of a filter, not a kind.
//   event  { uri, did, kind, at }        — one act of engagement, either
//                                          inbound (did = who did it) or
//                                          outbound (did = who it was aimed at).
//   post   the compact archive shape compactPostFromFeedItem produces.

import { activeLocale, weekdayOffset } from './locale.js';

const DAY_MS = 86_400_000;

/**
 * The shape of an archive post row. It went to 2 when rows began to keep the
 * whole text and what a post is made of (its length, tags, links, mentions,
 * media, alt text, languages and thread), which the Content report and the
 * archive search read. An archive whose `meta.posts.shape` is older is
 * brought up at its next sync from the repo's own post records, without
 * walking the author feed again (upgradePostRows below).
 */
export const POST_ROW_VERSION = 2;

/* ------------------------------------------------------------------ */
/* Periods and kinds                                                    */
/* ------------------------------------------------------------------ */

/**
 * The period presets, date-range-first as every dashboard filter row is.
 * `days: null` means "all time" — the caller derives t0 from its own oldest
 * data point, because "everything" starts wherever the data does.
 */
export const ANALYTICS_PERIODS = Object.freeze([
  Object.freeze({ key: '7d', days: 7, label: '7 days' }),
  Object.freeze({ key: '30d', days: 30, label: '30 days' }),
  Object.freeze({ key: '90d', days: 90, label: '90 days' }),
  Object.freeze({ key: '1y', days: 365, label: 'Year' }),
  Object.freeze({ key: 'all', days: null, label: 'All time' }),
]);

/**
 * The engagement-type filter for anything derived from POST COUNTS — a post
 * knows how many likes/reposts/replies/quotes it carries, and nothing else.
 */
export const ENGAGEMENT_KINDS = Object.freeze([
  Object.freeze({ key: 'all', label: 'All' }),
  Object.freeze({ key: 'like', label: 'Likes' }),
  Object.freeze({ key: 'repost', label: 'Reposts' }),
  Object.freeze({ key: 'reply', label: 'Replies' }),
  Object.freeze({ key: 'quote', label: 'Quotes' }),
]);

/**
 * The filter for EVENT lists (the People tab). Mentions exist only here:
 * a mention arrives as a notification event, but no post carries a
 * "mentionCount", so the post-count filter above cannot offer it.
 */
export const EVENT_KINDS = Object.freeze([
  ...ENGAGEMENT_KINDS,
  Object.freeze({ key: 'mention', label: 'Mentions' }),
]);

/** kind → the post-count field carrying it. */
const KIND_FIELD = { like: 'likes', repost: 'reposts', reply: 'replies', quote: 'quotes' };

/**
 * How much engagement a post carries, for one kind or for all four summed.
 * Unknown kinds count 0 rather than throwing — a stale filter value in a URL
 * must not take the dashboard down.
 */
export function engagementOf(post, kind = 'all') {
  if (!post) return 0;
  if (kind === 'all') {
    return (post.likes || 0) + (post.reposts || 0) + (post.replies || 0) + (post.quotes || 0);
  }
  const field = KIND_FIELD[kind];
  return field ? post[field] || 0 : 0;
}

/* ------------------------------------------------------------------ */
/* Buckets                                                              */
/* ------------------------------------------------------------------ */

/**
 * Start of the bucket containing `t`, in local time. Weeks start on the
 * reader's first day of the week (Monday unless Settings or their region
 * says otherwise; lib/locale.js). Returns a millisecond timestamp, NaN for
 * unparseable input.
 */
export function bucketStartMs(t, unit) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return NaN;
  if (unit === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  if (unit === 'week') {
    const first = d.getDate() - weekdayOffset(d.getDay());
    return new Date(d.getFullYear(), d.getMonth(), first).getTime();
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Start of the bucket after the one containing `t`. DST-safe: calendar math. */
export function nextBucketMs(t, unit) {
  const start = new Date(bucketStartMs(t, unit));
  if (unit === 'month') return new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime();
  const days = unit === 'week' ? 7 : 1;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + days).getTime();
}

/**
 * Dense series: one entry per bucket from t0 through t1 INCLUSIVE, zero-filled.
 * Density is not a nicety — a bar chart that simply skips empty buckets draws
 * a quiet week as if it never happened, and every trend read off it is wrong.
 *
 * `pickTime` maps an item to a millisecond timestamp (or anything Date can
 * parse); `pickValue` maps it to its contribution (default 1 = a count).
 * Items outside [t0, t1] and items with no readable time are dropped.
 *
 * Capped at 1000 buckets, keeping the NEWEST — the unit choices the dashboard
 * offers stay far under this, so the cap is a guard against a pathological
 * t0, not a limit anyone should meet.
 *
 * @returns {Array<{t:number, v:number}>} t = bucket start (local ms).
 */
export function bucketSeries(items, { unit = 'day', t0, t1, pickTime, pickValue } = {}) {
  const time = pickTime || ((i) => i?.at);
  const value = pickValue || (() => 1);
  const from = bucketStartMs(t0, unit);
  const to = bucketStartMs(t1, unit);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];

  const series = [];
  const index = new Map();
  for (let t = from, n = 0; t <= to && n < 1000; t = nextBucketMs(t, unit), n++) {
    index.set(t, series.length);
    series.push({ t, v: 0 });
  }

  for (const item of items || []) {
    const raw = time(item);
    const at = typeof raw === 'number' ? raw : Date.parse(raw);
    if (!Number.isFinite(at) || at < t0 || at > t1) continue;
    const slot = index.get(bucketStartMs(at, unit));
    if (slot == null) continue;
    const v = Number(value(item));
    if (Number.isFinite(v)) series[slot].v += v;
  }
  return series.slice(-1000);
}

/**
 * Running total over a dense series — the "cumulative" view of follower
 * growth. `baseline` is everything that happened before the series starts,
 * so a 30-day window climbs from the real count, not from zero.
 */
export function cumulativeSeries(series, baseline = 0) {
  let sum = baseline;
  return (series || []).map((p) => ({ t: p.t, v: (sum += p.v) }));
}

/**
 * Collapse direct block records and moderation-list subscriptions into current
 * blocking people. A person may appear once directly and once for every list
 * containing the owner; the reach total must still count that person once.
 *
 * The person's chart date is the earliest readable date of any current block
 * path. `source` records which path first reached them, allowing a stacked
 * cumulative chart whose two layers still add up to the unique reach.
 */
export function blockReach(blocks) {
  const byDid = new Map();
  const directDids = new Set();
  const listDids = new Set();

  for (const block of blocks || []) {
    if (!block?.did) continue;
    const source = block.source === 'list' ? 'list' : 'direct';
    if (source === 'direct') directDids.add(block.did);
    else listDids.add(block.did);

    let person = byDid.get(block.did);
    if (!person) {
      person = { did: block.did, direct: false, list: false, candidates: [] };
      byDid.set(block.did, person);
    }
    person[source] = true;
    const atMs = Date.parse(block.blockedAt || '');
    if (Number.isFinite(atMs)) person.candidates.push({ atMs, source });
  }

  const people = Array.from(byDid.values()).map((person) => {
    person.candidates.sort((a, b) => a.atMs - b.atMs || (a.source === 'direct' ? -1 : 1));
    const first = person.candidates[0] || null;
    return {
      did: person.did,
      direct: person.direct,
      list: person.list,
      source: first?.source || (person.direct ? 'direct' : 'list'),
      blockedAt: first ? new Date(first.atMs).toISOString() : null,
    };
  });

  return {
    people,
    directCount: directDids.size,
    listCount: listDids.size,
    listOnlyCount: people.filter((person) => person.list && !person.direct).length,
    overlapCount: people.filter((person) => person.list && person.direct).length,
  };
}

/**
 * Centered moving average — the trend line over a bumpy bar series. The
 * window shrinks symmetrically at the edges rather than padding with zeros,
 * so the line begins and ends on real data instead of diving toward an
 * invented origin.
 */
export function movingAverage(series, window = 7) {
  const n = (series || []).length;
  if (n === 0) return [];
  const half = Math.floor(Math.max(1, window) / 2);
  return series.map((p, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += series[j].v;
    return { t: p.t, v: sum / (hi - lo + 1) };
  });
}

/**
 * This period against the one before it — the honest form of "comparisons of
 * periods": same length, immediately adjacent, summed with the same measure.
 *
 * `pct` is null when the previous period was zero: "+∞%" is not a number and
 * "+100%" would be a lie. The caller renders that case as "new".
 *
 * @returns {{current:number, previous:number, delta:number, pct:number|null}}
 */
export function comparePeriods(items, { days, now = Date.now(), pickTime, pickValue } = {}) {
  const time = pickTime || ((i) => i?.at);
  const value = pickValue || (() => 1);
  const span = (days || 0) * DAY_MS;
  let current = 0;
  let previous = 0;
  if (span > 0) {
    for (const item of items || []) {
      const raw = time(item);
      const at = typeof raw === 'number' ? raw : Date.parse(raw);
      if (!Number.isFinite(at) || at > now) continue;
      const v = Number(value(item));
      if (!Number.isFinite(v)) continue;
      if (at > now - span) current += v;
      else if (at > now - 2 * span) previous += v;
    }
  }
  const delta = current - previous;
  const pct = previous > 0 ? (delta / previous) * 100 : null;
  return { current, previous, delta, pct };
}

/* ------------------------------------------------------------------ */
/* Rates                                                                */
/* ------------------------------------------------------------------ */

/**
 * A post in the owner's own voice: top-level, or a reply to one of their own
 * posts (a thread). Replies to other people are left out of the engagement
 * rate — they are answers inside someone else's conversation, and earn on a
 * different scale entirely.
 */
export function isOwnVoicePost(post, ownerDid) {
  return Boolean(post) && (!post.replyTo || post.replyTo === ownerDid);
}

/**
 * Engagement per post, bucket by bucket: what the bucket's posts have earned
 * over how many posts there were. A bucket with no posts has no rate — `v` is
 * null there, never zero, because "nothing posted" and "posted to silence"
 * are different weeks.
 *
 * @returns {Array<{t:number, v:number|null, total:number, posts:number}>}
 */
export function rateSeries(posts, { unit = 'day', t0, t1, kind = 'all' } = {}) {
  const pickTime = (p) => (typeof p?.atMs === 'number' ? p.atMs : p?.at);
  const totals = bucketSeries(posts, { unit, t0, t1, pickTime, pickValue: (p) => engagementOf(p, kind) });
  const counts = bucketSeries(posts, { unit, t0, t1, pickTime });
  return totals.map((b, i) => {
    const n = counts[i]?.v || 0;
    return { t: b.t, v: n ? b.v / n : null, total: b.v, posts: n };
  });
}

/**
 * The trend under a rate series: total engagement over total posts across a
 * centred window — a ratio of sums, never an average of averages, so a week
 * of one post weighs one post and a week of forty weighs forty. Null where the
 * window holds no posts at all.
 */
export function rollingRate(series, window = 7) {
  const n = (series || []).length;
  const half = Math.floor(Math.max(1, window) / 2);
  return (series || []).map((p, i) => {
    let total = 0;
    let posts = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      total += series[j].total || 0;
      posts += series[j].posts || 0;
    }
    return { t: p.t, v: posts ? total / posts : null };
  });
}

/**
 * This period's engagement rate against the previous one of the same length.
 * `pct` is null when the previous period had no posts to have a rate.
 *
 * @returns {{current:number|null, previous:number|null, pct:number|null}}
 */
export function compareRates(posts, { days, now = Date.now(), kind = 'all' } = {}) {
  const span = (days || 0) * DAY_MS;
  const sums = { cur: [0, 0], prev: [0, 0] };
  if (span > 0) {
    for (const p of posts || []) {
      const at = typeof p?.atMs === 'number' ? p.atMs : Date.parse(p?.at);
      if (!Number.isFinite(at) || at > now) continue;
      const slot = at > now - span ? sums.cur : at > now - 2 * span ? sums.prev : null;
      if (!slot) continue;
      slot[0] += engagementOf(p, kind);
      slot[1] += 1;
    }
  }
  const current = sums.cur[1] ? sums.cur[0] / sums.cur[1] : null;
  const previous = sums.prev[1] ? sums.prev[0] / sums.prev[1] : null;
  const pct = current != null && previous ? ((current - previous) / previous) * 100 : null;
  return { current, previous, pct };
}

/* ------------------------------------------------------------------ */
/* Engagement given                                                     */
/* ------------------------------------------------------------------ */

/**
 * Every act of engagement the owner has GIVEN: their likes and reposts (the
 * outbound archive) plus the replies and quotes already in the post archive.
 * Anything aimed at the owner's own posts is threading, not engagement, and
 * is left out — a long thread is not a hundred replies given.
 *
 * @returns {Array<{uri:string, did:string, kind:string, at:string}>}
 */
export function givenEvents(outbound, posts, ownerDid) {
  return [...(outbound || []), ...outboundFromPosts(posts)].filter((ev) => ev?.did && ev.did !== ownerDid);
}

/* ------------------------------------------------------------------ */
/* Ranked lists                                                         */
/* ------------------------------------------------------------------ */

/**
 * Rank posts within [t0, t1] by one engagement kind (or all four). Ties break
 * newest-first so the order is stable across renders.
 */
export function topPosts(posts, { kind = 'all', t0 = -Infinity, t1 = Infinity, limit = 10 } = {}) {
  return (posts || [])
    .filter((p) => {
      const at = Date.parse(p?.at);
      return Number.isFinite(at) && at >= t0 && at <= t1;
    })
    .sort((a, b) => engagementOf(b, kind) - engagementOf(a, kind) || Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.max(0, limit));
}

/**
 * Rank the accounts behind a pile of engagement events — who engages with the
 * owner (inbound events) or whom the owner engages with (outbound events),
 * the same shape either way.
 *
 * `kind` filters to one event type; `excludeDid` drops the owner's own DID,
 * because replying to yourself is threading, not engagement.
 *
 * @returns {Array<{did:string, total:number, byKind:Object<string,number>}>}
 */
export function topActors(events, { kind = 'all', t0 = -Infinity, t1 = Infinity, limit = 12, excludeDid = null } = {}) {
  const byDid = new Map();
  for (const ev of events || []) {
    if (!ev?.did || ev.did === excludeDid) continue;
    if (kind !== 'all' && ev.kind !== kind) continue;
    const at = typeof ev.at === 'number' ? ev.at : Date.parse(ev.at);
    if (!Number.isFinite(at) || at < t0 || at > t1) continue;
    let row = byDid.get(ev.did);
    if (!row) byDid.set(ev.did, (row = { did: ev.did, total: 0, byKind: {} }));
    row.total += 1;
    row.byKind[ev.kind] = (row.byKind[ev.kind] || 0) + 1;
  }
  return Array.from(byDid.values())
    .sort((a, b) => b.total - a.total || (a.did < b.did ? -1 : 1))
    .slice(0, Math.max(0, limit));
}

/* ------------------------------------------------------------------ */
/* Compact shapes — what the archives store                             */
/* ------------------------------------------------------------------ */

/** The DID a fully-formed at:// URI belongs to, or null. */
export function didFromAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/(did:[^/]+)/);
  return m ? m[1] : null;
}

/**
 * The facts a raw post RECORD carries, shared by both archive shapers: when
 * it was made, its words, what it is made of (length, tags, links, mentions,
 * media and its descriptions, languages, thread), and — for the outbound
 * People list — WHO a reply or quote was aimed at. A post can be both (a reply that quotes someone);
 * both targets are kept. Returns null when the record cannot be dated.
 */
function postFacts(record) {
  const at = record?.createdAt || null;
  if (!at || !Number.isFinite(Date.parse(at))) return null;

  // Quotes live in the embed, in one of two shapes: a bare record embed, or
  // record-with-media where the record is nested one level deeper.
  const embed = record.embed || {};
  const withMedia = embed.$type === 'app.bsky.embed.recordWithMedia';
  const quotedUri = embed.$type === 'app.bsky.embed.record' ? embed.record?.uri : withMedia ? embed.record?.record?.uri : null;
  const media = mediaFacts(withMedia ? embed.media : embed);
  const text = typeof record.text === 'string' ? record.text : '';
  const { tags, links, mentions } = facetFacts(record);
  if (media.host && !links.includes(media.host)) links.push(media.host);
  const root = atUriParts(record.reply?.root?.uri);

  return {
    at,
    text,
    len: graphemeCount(text),
    replyTo: didFromAtUri(record.reply?.parent?.uri),
    quoteOf: didFromAtUri(quotedUri),
    hasMedia: media.kind === 'image' || media.kind === 'video',
    media: media.kind,
    mediaCount: media.count,
    altCount: media.alt,
    tags,
    links,
    mentions,
    langs: Array.isArray(record.langs) ? record.langs.filter((l) => typeof l === 'string' && l).slice(0, 3) : [],
    // The thread a reply belongs to: who started it and the key of its first
    // post. Null on a post that isn't a reply (it may still START a thread;
    // the replies name it).
    threadOf: root?.did || null,
    threadKey: root?.rkey || null,
  };
}

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** A text's length as Bluesky counts it, in grapheme clusters. */
function graphemeCount(text) {
  if (!text) return 0;
  if (!segmenter) return [...text].length;
  let n = 0;
  // eslint-disable-next-line no-unused-vars
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

function atUriParts(uri) {
  const m = typeof uri === 'string' ? uri.match(/^at:\/\/([^/]+)\/[^/]+\/([^/?#]+)/) : null;
  return m ? { did: m[1], rkey: m[2] } : null;
}

/** "example.com" for a link, without the www; null for anything that isn't one. */
export function linkHost(uri) {
  try {
    const host = new URL(uri).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

// Bluesky's GIF picker posts a GIF as a link card to one of these hosts.
const GIF_HOST = /(^|\.)(tenor\.com|giphy\.com)$/;

/**
 * What a post carries besides its words: pictures, a video, a GIF or a link
 * card, how many, and how many of them are described.
 */
function mediaFacts(embed) {
  const none = { kind: null, count: 0, alt: 0, host: null };
  if (!embed || typeof embed !== 'object') return none;
  if (embed.$type === 'app.bsky.embed.images') {
    const images = Array.isArray(embed.images) ? embed.images : [];
    return { kind: 'image', count: images.length, alt: images.filter((i) => typeof i?.alt === 'string' && i.alt.trim()).length, host: null };
  }
  if (embed.$type === 'app.bsky.embed.video') {
    return { kind: 'video', count: 1, alt: typeof embed.alt === 'string' && embed.alt.trim() ? 1 : 0, host: null };
  }
  if (embed.$type === 'app.bsky.embed.external') {
    const host = linkHost(embed.external?.uri);
    if (host && GIF_HOST.test(host)) return { kind: 'gif', count: 1, alt: 0, host: null };
    return { kind: 'link', count: 1, alt: 0, host };
  }
  return none;
}

/** The tags, link hosts and mentioned accounts a post's facets (and its tag list) name. */
function facetFacts(record) {
  const tags = [];
  const links = [];
  const mentions = [];
  const add = (list, value) => {
    if (value && !list.includes(value)) list.push(value);
  };
  for (const facet of Array.isArray(record.facets) ? record.facets : []) {
    for (const feature of Array.isArray(facet?.features) ? facet.features : []) {
      if (feature?.$type === 'app.bsky.richtext.facet#tag') add(tags, cleanTag(feature.tag));
      else if (feature?.$type === 'app.bsky.richtext.facet#link') add(links, linkHost(feature.uri));
      else if (feature?.$type === 'app.bsky.richtext.facet#mention') add(mentions, typeof feature.did === 'string' ? feature.did : null);
    }
  }
  // Tags added beside the text rather than in it.
  for (const tag of Array.isArray(record.tags) ? record.tags : []) add(tags, cleanTag(tag));
  return { tags, links, mentions };
}

function cleanTag(tag) {
  return typeof tag === 'string' ? tag.trim().replace(/^#/, '') || null : null;
}

/**
 * Bring rows of an older shape up to the current one from the repo's own
 * post records (`uri → record`), keeping every count the archive holds.
 * Returns only the rows that changed, for one write. A row whose record is
 * not in the repo (deleted since) is left as it is.
 */
export function upgradePostRows(rows, recordsByUri) {
  const out = [];
  for (const row of rows || []) {
    const record = recordsByUri?.get(row?.uri);
    if (!record) continue;
    const facts = postFacts(record);
    if (!facts) continue;
    out.push({ ...row, ...facts });
  }
  return out;
}

/**
 * One getAuthorFeed item → one archive row, or null for the items that are
 * not the owner's own posts. A repost arrives as somebody else's post wearing
 * a `reason` — real activity, but its text, counts and author are not the
 * owner's, so it must never enter the post archive.
 */
export function compactPostFromFeedItem(item) {
  const post = item?.post;
  if (!post?.uri || item?.reason) return null;
  const facts = postFacts(post.record || {});
  if (!facts) return null;
  return {
    uri: post.uri,
    rkey: post.uri.split('/').pop(),
    ...facts,
    likes: post.likeCount || 0,
    reposts: post.repostCount || 0,
    replies: post.replyCount || 0,
    quotes: post.quoteCount || 0,
  };
}

/**
 * One raw post record (from the repo CAR) → the same archive row shape, with
 * every engagement count at ZERO — the repo does not know them; only the
 * AppView does. These rows exist to paint the posting history instantly on a
 * first build, and the getAuthorFeed hydration overwrites every one of them
 * with counted rows in the same sync. They must never overwrite a hydrated
 * row — the caller enforces that by seeding only URIs the archive lacks.
 */
export function compactPostFromRecord(uri, record) {
  if (!uri) return null;
  const facts = postFacts(record || {});
  if (!facts) return null;
  return {
    uri,
    rkey: uri.split('/').pop(),
    ...facts,
    likes: 0,
    reposts: 0,
    replies: 0,
    quotes: 0,
  };
}

/** The notification reasons that are engagement aimed at the owner. */
const INBOUND_REASONS = new Set(['like', 'repost', 'reply', 'quote', 'mention']);

/**
 * One listNotifications entry → one inbound event, or null for the reasons
 * that are not engagement (follows are the follower sweep's job; the rest —
 * verified, starterpack-joined, likes via repost — are noise here).
 *
 * `uri` is the record that CAUSED the notification (their like record, their
 * reply post…), which is unique per event and therefore the archive key.
 */
export function inboundFromNotification(n) {
  if (!n?.uri || !n?.author?.did || !INBOUND_REASONS.has(n.reason)) return null;
  const at = n.record?.createdAt || n.indexedAt || null;
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return { uri: n.uri, did: n.author.did, kind: n.reason, at };
}

/**
 * One of the owner's own like/repost records → one outbound event aimed at
 * the account whose post was liked/reposted. Null when the subject is
 * unreadable — an event with nobody on the other end ranks no one.
 */
export function outboundFromRecord(kind, record) {
  const targetUri = record?.value?.subject?.uri;
  const did = didFromAtUri(targetUri);
  if (!record?.uri || !did) return null;
  const at = record.value?.createdAt || null;
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return { uri: record.uri, kind, did, at };
}

/**
 * The outbound reply/quote events already sitting in the post archive. No
 * extra fetch: a reply knows whom it answered and a quote knows whom it
 * quoted, because compactPostFromFeedItem kept the target DIDs. A post that
 * is both emits both — they are two different acts toward possibly two
 * different people.
 */
export function outboundFromPosts(posts) {
  const events = [];
  for (const p of posts || []) {
    if (p?.replyTo) events.push({ uri: `${p.uri}#reply`, kind: 'reply', did: p.replyTo, at: p.at });
    if (p?.quoteOf) events.push({ uri: `${p.uri}#quote`, kind: 'quote', did: p.quoteOf, at: p.at });
  }
  return events;
}

/* ------------------------------------------------------------------ */
/* Small formatting / choice helpers                                    */
/* ------------------------------------------------------------------ */

/**
 * Which bucket sizes read well over a span, smallest first. A year of daily
 * bars is 365 four-pixel slivers, so 'day' is only offered while the bars
 * would still be bars.
 */
export function unitChoicesFor(spanDays) {
  if (spanDays == null || spanDays > 366) return ['week', 'month'];
  if (spanDays > 120) return ['week', 'month'];
  if (spanDays > 31) return ['day', 'week', 'month'];
  return ['day', 'week'];
}

/** The unit a span opens on: days for a month, weeks for a year, months beyond. */
export function defaultUnitFor(spanDays) {
  if (spanDays == null || spanDays > 366) return 'month';
  if (spanDays > 31) return 'week';
  return 'day';
}

/**
 * Tile-value formatting: exact and comma'd while short, compact (12.9K) once
 * the exact number stops being readable at a glance. One decimal, trimmed.
 */
export function fmtCompact(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  if (abs >= 10_000) return `${trimZero((n / 1000).toFixed(1))}K`;
  return Math.round(n).toLocaleString(activeLocale());
}

function trimZero(s) {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/**
 * A signed percent delta for a tile, or the two words that are truer than a
 * percentage: "new" when there was nothing before, "±0%" when nothing moved.
 */
export function fmtDelta(pct) {
  if (pct == null) return 'new';
  if (pct === 0) return '±0%';
  const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${pct > 0 ? '+' : '−'}${Math.abs(rounded)}%`;
}

/** Bucket label for an axis endpoint or tooltip: "Jun 3", "Jun 2025". */
export function bucketLabel(t, unit) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  if (unit === 'month') {
    return d.toLocaleDateString(activeLocale(), { month: 'short', year: 'numeric' });
  }
  const day = d.toLocaleDateString(activeLocale(), { month: 'short', day: 'numeric' });
  return unit === 'week' ? `wk of ${day}` : day;
}

/** The oldest event time in a pile, for honest "coverage since" captions. */
export function oldestEventMs(events) {
  let oldest = Infinity;
  for (const ev of events || []) {
    const at = typeof ev?.at === 'number' ? ev.at : Date.parse(ev?.at);
    if (Number.isFinite(at) && at < oldest) oldest = at;
  }
  return Number.isFinite(oldest) ? oldest : null;
}
