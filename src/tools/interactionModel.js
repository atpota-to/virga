// What the Interaction lookup shows: everything the archive holds between the
// account and one other account, with the two directions kept apart.
//
//   'in'   them to you: the inbound store, which is the account's
//          notifications (likes, reposts, replies, quotes and mentions)
//   'out'  you to them: the outbound store (the likes and reposts in the
//          repo) and the replies and quotes in the post archive
//
// Pure functions of the archive, cached per sync like the report models.
// What the archive doesn't hold stays null instead of becoming a zero: a
// month before the notifications begin has no inbound count, a follow whose
// record key isn't a timestamp has no date, and the mentions you made have
// no count until the post rows keep who each post mentions.
//
// An event row may carry `subject`, the at:// URI of the post it was about
// (the post that was liked, the post that was replied to). The sync doesn't
// store one today, so everything that needs it (which of your posts someone
// engaged with, a link from a like to the post) reads it when it's there and
// reports that it isn't when it's not.

import { blockReach, bucketSeries, didFromAtUri, nextBucketMs, oldestEventMs } from '../lib/analytics.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { cached, relationSets } from '../reports/models.js';

/** Where the tool lives. The chosen account is `?who=<did>` on it. */
export const LOOKUP_PATH = '/tools/interaction-lookup';

/** Every kind of event, in the order the page lists them. */
export const LOOKUP_KINDS = Object.freeze(['like', 'repost', 'reply', 'quote', 'mention']);

/**
 * The kinds every archive can count from you to them. A mention joins them
 * only when the post rows keep who each post mentions (`mentions`, a list of
 * DIDs), which older rows don't; without it mentions are counted them to you
 * only, as in the People report.
 */
export const OUTBOUND_KINDS = Object.freeze(['like', 'repost', 'reply', 'quote']);

/** The ways one of your posts can be aimed at someone, and where the row says who. */
const POST_AIMS = [
  ['reply', (p, who) => p.replyTo === who],
  ['quote', (p, who) => p.quoteOf === who],
  ['mention', (p, who) => Array.isArray(p.mentions) && p.mentions.includes(who)],
];

/** Whether the post archive says who posts mention: true once any row does. */
export function keepsMentions(archive) {
  return cached(archive, 'keepsMentions', null, null, () => (archive.posts || []).some((p) => Array.isArray(p?.mentions)));
}

export const KIND_LABEL = Object.freeze({ like: 'Likes', repost: 'Reposts', reply: 'Replies', quote: 'Quotes', mention: 'Mentions' });

/** The direction filter. 'all' is the absence of a filter, as with kinds. */
export const DIRECTIONS = Object.freeze([
  Object.freeze({ key: 'all', label: 'Both ways' }),
  Object.freeze({ key: 'in', label: 'Them to you' }),
  Object.freeze({ key: 'out', label: 'You to them' }),
]);

const POST_COLLECTION = 'app.bsky.feed.post';

/* ------------------------------------------------------------------ */
/* Naming an account                                                    */
/* ------------------------------------------------------------------ */

// The two DID methods atproto accounts use.
const DID_RE = /^did:(plc|web):[A-Za-z0-9._:%-]+$/;
// A handle is a domain name: labels of letters, digits and hyphens, at least
// two of them, the last one starting with a letter.
const HANDLE_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isDid(text) {
  return DID_RE.test(String(text || ''));
}

/** What someone typed, without the wrapping a paste brings: a profile link, `at://`, an `@`. */
function bareActor(text) {
  let s = String(text || '').trim();
  const link = s.match(/^https?:\/\/[^/]+\/profile\/([^/?#]+)/i);
  if (link) {
    try {
      s = decodeURIComponent(link[1]);
    } catch {
      s = link[1];
    }
  }
  return s.replace(/^at:\/\//i, '').replace(/^@/, '');
}

/**
 * A handle or a DID typed (or pasted) in full, as `{ kind: 'did' | 'handle',
 * value }`, or null for anything else: half a name is a search, not an
 * account to look up.
 */
export function parseActorInput(text) {
  const s = bareActor(text);
  if (!s) return null;
  if (DID_RE.test(s)) return { kind: 'did', value: s };
  const handle = s.toLowerCase();
  if (handle.length <= 253 && HANDLE_RE.test(handle)) return { kind: 'handle', value: handle };
  return null;
}

/**
 * The address of one account's history (or of the tool with nobody chosen,
 * for `null`), keeping whatever else the query string holds. The DID's
 * colons are left as they are: they're allowed in a query, and the address
 * is one people read and paste.
 */
export function lookupHref(who, search = '') {
  const params = new URLSearchParams(search);
  params.delete('who');
  const rest = params.toString();
  const mine = who ? `who=${encodeURIComponent(who).replace(/%3A/gi, ':')}` : '';
  const query = [rest, mine].filter(Boolean).join('&');
  return `${LOOKUP_PATH}${query ? `?${query}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Everyone the archive knows                                           */
/* ------------------------------------------------------------------ */

function dated(ev) {
  const atMs = typeof ev?.at === 'number' ? ev.at : Date.parse(ev?.at);
  return Number.isFinite(atMs) ? atMs : null;
}

/**
 * How many events the archive holds with each account, each way:
 * `byDid` (did → `{ did, in, out, total }`) and `ranked`, the same rows with
 * the most events first. The account's own DID is left out: replying to
 * yourself is threading.
 */
export function interactionIndex(archive) {
  return cached(archive, 'interactionIndex', null, null, () => {
    const byDid = new Map();
    const count = (did, side) => {
      if (!did || did === archive.did) return;
      let row = byDid.get(did);
      if (!row) byDid.set(did, (row = { did, in: 0, out: 0, total: 0 }));
      row[side] += 1;
      row.total += 1;
    };
    for (const ev of archive.inbound || []) if (dated(ev) != null) count(ev.did, 'in');
    for (const ev of archive.outbound || []) if (dated(ev) != null) count(ev.did, 'out');
    for (const p of archive.posts || []) {
      if (dated(p) == null) continue;
      if (p.replyTo) count(p.replyTo, 'out');
      if (p.quoteOf) count(p.quoteOf, 'out');
      if (Array.isArray(p.mentions)) for (const did of new Set(p.mentions)) count(did, 'out');
    }
    const ranked = [...byDid.values()].sort((a, b) => b.total - a.total || (a.did < b.did ? -1 : 1));
    return { byDid, ranked };
  });
}

/**
 * Everyone the search can suggest: the accounts behind the archive's events,
 * its followers and its follows, each with the name the archive has for them
 * (`cardOf(did)` returns a profile card or null) and how much there is
 * between you. Not cached here: cards arrive between syncs, so the caller
 * keeps it for as long as its own cards stand.
 */
export function peopleDirectory(archive, cardOf = () => null) {
  const { byDid } = interactionIndex(archive);
  const sets = relationSets(archive);
  const dids = new Set([...byDid.keys(), ...sets.followers, ...sets.following]);
  dids.delete(archive.did);
  const people = [];
  for (const did of dids) {
    const card = cardOf(did);
    const counts = byDid.get(did);
    people.push({
      did,
      handle: card?.handle || '',
      displayName: card?.displayName || '',
      avatar: card?.avatar || '',
      in: counts?.in || 0,
      out: counts?.out || 0,
      total: counts?.total || 0,
      followsYou: sets.followers.has(did),
      youFollow: sets.following.has(did),
    });
  }
  return people;
}

/** How well `person` answers the query `q` (lower is better), or null. */
function matchScore(person, q) {
  if (q.startsWith('did:')) return person.did === q ? 0 : person.did.startsWith(q) ? 1 : null;
  const handle = person.handle.toLowerCase();
  const name = person.displayName.toLowerCase();
  if (handle === q || name === q) return 0;
  if (handle.startsWith(q) || name.startsWith(q)) return 1;
  if (name.split(/\s+/).some((word) => word.startsWith(q)) || handle.split('.').some((label) => label.startsWith(q))) return 2;
  if (handle.includes(q) || name.includes(q)) return 3;
  return null;
}

/**
 * The people in `directory` whose handle, name or DID matches what was
 * typed: the closest match first, then whoever there is most history with.
 * Someone the archive knows only by DID can be found only by DID.
 */
export function matchPeople(directory, query, { limit = 8 } = {}) {
  const typed = bareActor(query);
  const q = typed.startsWith('did:') ? typed : typed.toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const person of directory || []) {
    const score = matchScore(person, q);
    if (score != null) hits.push({ person, score });
  }
  const label = (p) => p.handle || p.did;
  hits.sort((a, b) => a.score - b.score || b.person.total - a.person.total || (label(a.person) < label(b.person) ? -1 : 1));
  return hits.slice(0, Math.max(0, limit)).map((h) => h.person);
}

/* ------------------------------------------------------------------ */
/* One account                                                          */
/* ------------------------------------------------------------------ */

function postsByUri(archive) {
  return cached(archive, 'postsByUri', null, null, () => new Map((archive.posts || []).map((p) => [p.uri, p])));
}

/** The bsky.app address of a post, from the DID that wrote it and its record key. */
function postUrl(did, rkey) {
  return did && rkey ? `https://bsky.app/profile/${did}/post/${encodeURIComponent(rkey)}` : null;
}

/** The same, from an at:// URI, or null when the URI doesn't name a post. */
function postUrlOf(uri) {
  const m = String(uri || '').match(/^at:\/\/(did:[^/]+)\/([^/]+)\/([^/?#]+)/);
  return m && m[2] === POST_COLLECTION ? postUrl(m[1], m[3]) : null;
}

/**
 * Every event between the account and `who`, newest first. Each is
 *
 *   { key, dir, kind, at, atMs, uri, subject, url, urlOwner, text }
 *
 * `uri` is the record behind the event (their like, their reply; your like,
 * your post). `url` is the post it can open on Bluesky, and `urlOwner` whose
 * post that is ('them' or 'you'); both are null when the archive doesn't
 * know the post, which is every like and repost without a `subject`. `text`
 * is your own words, when the post is yours and in the archive: the archive
 * never holds theirs.
 */
function eventsWith(archive, who) {
  const mine = archive.did;
  const posts = postsByUri(archive);
  const events = [];

  for (const ev of archive.inbound || []) {
    if (ev?.did !== who || !ev.uri) continue;
    const atMs = dated(ev);
    if (atMs == null) continue;
    const subject = ev.subject || null;
    // A reply, a quote and a mention are posts of theirs, by what a
    // notification of that kind is. A like or a repost is a record of its
    // own; the post is the one it points at.
    const theirPost = ev.kind === 'reply' || ev.kind === 'quote' || ev.kind === 'mention';
    const yourPost = !theirPost && didFromAtUri(subject) === mine ? subject : null;
    const url = theirPost ? postUrl(who, rkeyFromAtUri(ev.uri)) : postUrlOf(yourPost);
    events.push({
      key: `in|${ev.uri}`,
      dir: 'in',
      kind: ev.kind,
      at: new Date(atMs).toISOString(),
      atMs,
      uri: ev.uri,
      subject,
      url,
      urlOwner: url ? (theirPost ? 'them' : 'you') : null,
      text: url && yourPost ? posts.get(yourPost)?.text || '' : '',
    });
  }

  for (const ev of archive.outbound || []) {
    if (ev?.did !== who || !ev.uri) continue;
    const atMs = dated(ev);
    if (atMs == null) continue;
    const subject = ev.subject || null;
    const url = postUrlOf(subject);
    events.push({
      key: `out|${ev.uri}`,
      dir: 'out',
      kind: ev.kind,
      at: new Date(atMs).toISOString(),
      atMs,
      uri: ev.uri,
      subject,
      url,
      urlOwner: url ? 'them' : null,
      text: '',
    });
  }

  // Replies, quotes and mentions are already in the post archive: a reply
  // knows who it answered, a quote who it quoted, and a row that keeps its
  // mentions who it named. A post that does more than one of these to the
  // same person is that many events, as a reply that quotes is in the
  // People report.
  for (const p of archive.posts || []) {
    if (!p?.uri) continue;
    const kinds = POST_AIMS.filter(([, aimedAt]) => aimedAt(p, who)).map(([kind]) => kind);
    if (!kinds.length) continue;
    const atMs = dated(p);
    if (atMs == null) continue;
    for (const kind of kinds) {
      events.push({
        key: `out|${p.uri}#${kind}`,
        dir: 'out',
        kind,
        at: new Date(atMs).toISOString(),
        atMs,
        uri: p.uri,
        subject: null,
        url: postUrl(mine, p.rkey || rkeyFromAtUri(p.uri)),
        urlOwner: 'you',
        text: p.text || '',
      });
    }
  }

  return events.sort((a, b) => b.atMs - a.atMs || (a.key < b.key ? -1 : 1));
}

/** A count for each of `kinds` and their total; every other kind is null: not counted, which is not none. */
function totalsOf(events, kinds) {
  const totals = Object.fromEntries(LOOKUP_KINDS.map((k) => [k, kinds.includes(k) ? 0 : null]));
  let total = 0;
  for (const ev of events) {
    if (totals[ev.kind] == null) continue;
    totals[ev.kind] += 1;
    total += 1;
  }
  return { ...totals, total };
}

function validDate(value) {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * Who follows whom, from the follower and follow stores, as of the last
 * sync. `known` is whether that store has been read at all: before it has,
 * "not following" would be a guess. `since` is null when the follow is there
 * but can't be dated.
 */
function relationshipOf(archive, who) {
  const follower = relationSets(archive).followerCards.get(who) || null;
  // A repo can hold two follow records for one account; the older one is
  // when the following began.
  const followedAt = (archive.following || [])
    .filter((f) => f.did === who)
    .map((f) => validDate(f.followedAt))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const youFollow = relationSets(archive).following.has(who);

  // The unfollow log is the only record of someone who used to follow: its
  // newest entry for them says which way they last went.
  const last = (archive.meta?.followerLog?.entries || []).find((e) => e.did === who) || null;
  const left =
    !follower && last?.kind === 'lost' ? { noticedAt: last.at || null, since: last.since || null, followedAt: validDate(last.followedAt) } : null;

  const paths = (archive.blocks || []).filter((b) => b.did === who);
  const block = paths.length ? blockReach(paths).people[0] : null;

  return {
    theyFollow: {
      known: Boolean(archive.meta?.followers),
      is: Boolean(follower),
      since: validDate(follower?.followedAt),
      left,
    },
    youFollow: {
      known: Boolean(archive.meta?.following),
      is: youFollow,
      since: followedAt[0] || null,
    },
    theyBlock: block ? { since: block.blockedAt, direct: block.direct, list: block.list } : null,
  };
}

/**
 * Both directions by month, from the first event either way to now, every
 * month in between present. A month that ended before the notifications
 * begin has no inbound value (null), because nothing can be said about it.
 */
function timelineOf(events, nowMs, inboundSinceMs) {
  if (!events.length) return null;
  let t0 = Infinity;
  let t1 = nowMs;
  for (const ev of events) {
    if (ev.atMs < t0) t0 = ev.atMs;
    if (ev.atMs > t1) t1 = ev.atMs;
  }
  const series = (dir) => bucketSeries(events.filter((ev) => ev.dir === dir), { unit: 'month', t0, t1, pickTime: (ev) => ev.atMs });
  const covered = (t) => inboundSinceMs != null && nextBucketMs(t, 'month') > inboundSinceMs;
  const inbound = series('in').map((p) => (covered(p.t) ? p : { t: p.t, v: null }));
  const firstCovered = inbound.find((p) => p.v != null);
  return {
    unit: 'month',
    inbound,
    outbound: series('out'),
    // The first month with an inbound value, when it isn't the first month
    // drawn: where the chart's "them to you" line begins to mean something.
    inboundFromMs: firstCovered && firstCovered.t > inbound[0].t ? firstCovered.t : null,
    inboundCovered: Boolean(firstCovered),
  };
}

/**
 * Which of your posts they engaged with, most first. Only an event with a
 * `subject` can say; `known` is whether any of theirs does, and `counted` of
 * `of` how many do (a mention has no post of yours to point at, so it isn't
 * in `of`).
 */
function engagedPostsOf(archive, incoming) {
  const posts = postsByUri(archive);
  const byUri = new Map();
  let counted = 0;
  let of = 0;
  for (const ev of incoming) {
    if (ev.kind === 'mention') continue;
    of += 1;
    if (!ev.subject) continue;
    counted += 1;
    if (didFromAtUri(ev.subject) !== archive.did || !postUrlOf(ev.subject)) continue;
    let row = byUri.get(ev.subject);
    if (!row) {
      row = { uri: ev.subject, url: postUrlOf(ev.subject), post: posts.get(ev.subject) || null, total: 0, byKind: {}, latestMs: 0 };
      byUri.set(ev.subject, row);
    }
    row.total += 1;
    row.byKind[ev.kind] = (row.byKind[ev.kind] || 0) + 1;
    if (ev.atMs > row.latestMs) row.latestMs = ev.atMs;
  }
  const rows = [...byUri.values()].sort((a, b) => b.total - a.total || b.latestMs - a.latestMs || (a.uri < b.uri ? -1 : 1));
  return { known: counted > 0, counted, of, rows };
}

/**
 * How far back each side of the archive can speak.
 *
 *   inboundSinceMs   the oldest notification event held, from anyone: where
 *                    "them to you" begins. null: no notifications on record.
 *   outboundSinceMs  how far back the likes and reposts reach when the repo
 *                    couldn't be downloaded; null means all of them.
 *   postsComplete    whether the post archive (your replies and quotes) has
 *                    been read to the end.
 */
function coverageOf(archive) {
  const outMs = archive.meta?.outbound?.coverageMs;
  return {
    inboundSinceMs: oldestEventMs(archive.inbound),
    inboundTruncated: Boolean(archive.meta?.inbound?.truncated),
    outboundSinceMs: outMs > 0 ? outMs : null,
    postsComplete: Boolean(archive.meta?.posts?.complete),
  };
}

/**
 * Everything between the account and `who` (a DID). An account the archive
 * has never met comes back the same shape, empty. Looking yourself up is
 * `self`: your replies to yourself are threads, not a history with someone.
 */
export function interactionModel(archive, who) {
  return cached(archive, 'interaction', null, { who }, () => {
    const self = who === archive.did;
    const events = self ? [] : eventsWith(archive, who);
    const incoming = events.filter((ev) => ev.dir === 'in');
    const outgoing = events.filter((ev) => ev.dir === 'out');
    const coverage = coverageOf(archive);
    const yourPosts = self ? [] : (archive.posts || []).filter((p) => p.replyTo === who || p.quoteOf === who);
    yourPosts.sort((a, b) => (dated(b) ?? 0) - (dated(a) ?? 0));
    return {
      did: who,
      self,
      relationship: relationshipOf(archive, who),
      totals: { in: totalsOf(incoming, LOOKUP_KINDS), out: totalsOf(outgoing, keepsMentions(archive) ? LOOKUP_KINDS : OUTBOUND_KINDS) },
      // Newest first, so the first of each is at the end.
      first: { in: incoming[incoming.length - 1] || null, out: outgoing[outgoing.length - 1] || null },
      latest: { in: incoming[0] || null, out: outgoing[0] || null },
      timeline: timelineOf(events, archive.nowMs ?? Date.now(), coverage.inboundSinceMs),
      coverage,
      engagedPosts: engagedPostsOf(archive, incoming),
      yourPosts,
      events,
    };
  });
}

/** The events one direction and one kind leave: 'all' is no filter. */
export function filterEvents(events, { direction = 'all', kind = 'all' } = {}) {
  return (events || []).filter((ev) => (direction === 'all' || ev.dir === direction) && (kind === 'all' || ev.kind === kind));
}

const PHRASES = {
  in: {
    like: 'They liked one of your posts',
    repost: 'They reposted one of your posts',
    reply: 'They replied to you',
    quote: 'They quoted you',
    mention: 'They mentioned you',
  },
  out: {
    like: 'You liked one of their posts',
    repost: 'You reposted one of their posts',
    reply: 'You replied to them',
    quote: 'You quoted them',
    mention: 'You mentioned them',
  },
};

/** What an event was, in a sentence that says who did it. */
export function eventPhrase(ev) {
  return PHRASES[ev?.dir]?.[ev?.kind] || '';
}

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

/**
 * The events as rows for a CSV, the header first. `post_url` is the post an
 * event can open, `post_by` whose it is, and `text` your own words where the
 * post is yours. The account is named by its DID and handle only: a display
 * name is free text from someone else, which a spreadsheet may take for a
 * formula.
 */
export function eventsCsvRows(events, { did, handle = '' } = {}) {
  return [
    ['at', 'direction', 'kind', 'their_did', 'their_handle', 'post_url', 'post_by', 'text', 'record_uri'],
    ...(events || []).map((ev) => [
      ev.at,
      ev.dir === 'in' ? 'them to you' : 'you to them',
      ev.kind,
      did || '',
      handle || '',
      ev.url || '',
      ev.urlOwner || '',
      String(ev.text || '').replace(/\r\n?/g, '\n'),
      ev.uri,
    ]),
  ];
}
