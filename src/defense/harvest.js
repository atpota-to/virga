// Everyone who touched a post, and how.
//
// Constellation is the source rather than the AppView's getLikes and
// getRepostedBy, because the AppView answers as a viewer: it leaves out the
// accounts behind blocks and mutes already in place, so using it to decide who
// to block hides the people already acted on and changes its answer as you
// work. Constellation indexes the firehose and answers the same for everyone.
//
// This runs in the reader's browser, so the public Constellation instance sees
// each reader's own requests rather than all of Virga's from one address.
//
// Sources are discovered, not declared. A counts call returns every
// (collection, path) pair pointing at the record, so a like is found the same
// way as engagement from a lexicon this code has never heard of.
//
// Nothing here judges anyone. It returns who did what; bands and the veto live
// in score.js and run over this output, so a harvest can be scored again later.
//
// Ported from bluesky-mod (src/lib/harvest.js).

import { backlinkRows, flattenSources, getBacklinkSources, getBacklinks } from '../lib/constellation.js';
import { mapLimit } from './limit.js';

/** Constellation pages at 100; anything larger is clamped. */
const PAGE = 100;

/**
 * Pages read from one source before stopping. The tail of a viral post's likes
 * is strangers who all score UNKNOWN; the cap is per source, so a post with 20k
 * likes still yields every reply and quote. `truncated` says when it applied.
 */
export const MAX_PAGES = 60;

/**
 * Sources outside Bluesky's own kinds one harvest reads. Anyone can add
 * sources to a post (one record holding its URI at a thousand paths is a
 * thousand sources), so the rest are read largest first up to this cap.
 */
const MAX_OTHER_SOURCES = 10;

/** Sources paged at once. Kept small: the public instance is shared. */
const SOURCE_CONCURRENCY = 3;

const DID_SYNTAX = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;

/** Whether a string is DID syntax (and nothing else). */
export const isDid = (value) => typeof value === 'string' && DID_SYNTAX.test(value);

/**
 * A Constellation source as an engagement kind. Bluesky's own verbs get names,
 * matched on exact paths. Anything else is `other`: its collection name is
 * chosen by whoever wrote the record, so it is never shown. `reply` is someone
 * answering the post itself; `threadReply` is anyone in the thread it starts.
 */
export function engagementKind({ collection, path }) {
  const p = path.startsWith('.') ? path.slice(1) : path;
  if (collection === 'app.bsky.feed.like' && p === 'subject.uri') return 'like';
  if (collection === 'app.bsky.feed.repost' && p === 'subject.uri') return 'repost';
  if (collection === 'app.bsky.feed.post') {
    if (p === 'reply.parent.uri') return 'reply';
    if (p === 'reply.root.uri') return 'threadReply';
    if (p === 'embed.record.uri' || p === 'embed.record.record.uri') return 'quote';
  }
  if (collection === 'app.bsky.feed.threadgate' && p === 'post') return 'gate';
  return 'other';
}

/**
 * Engagement kinds loudest first. A quote takes more deliberate effort than a
 * reply, a reply more than a repost, a repost more than a like. This says
 * nothing about how hostile any of them is.
 */
export const KIND_ORDER = ['quote', 'reply', 'threadReply', 'repost', 'like', 'gate'];

function primaryKind(engagements) {
  for (const kind of KIND_ORDER) if (engagements[kind]) return kind;
  const rest = Object.keys(engagements);
  return rest.length ? rest[0] : null;
}

/**
 * Page one source and hand back its rows. A source that fails outright comes
 * back empty and `failed`, so one dead lexicon doesn't cost the likes; one
 * that fails part way comes back `truncated`, never complete. A failed page is
 * asked for once more first.
 */
async function drainSource(uri, source, { signal, maxPages }) {
  const rows = [];
  let cursor;
  let pages = 0;
  const read = () => getBacklinks(uri, source, { limit: PAGE, cursor, signal });
  while (pages < maxPages) {
    const page = (await read()) ?? (signal?.aborted ? null : await read());
    if (!page) return { rows, truncated: pages > 0, failed: pages === 0 };
    rows.push(...backlinkRows(page));
    pages += 1;
    cursor = page.cursor;
    if (!cursor) return { rows, truncated: false, failed: false };
  }
  return { rows, truncated: true, failed: false };
}

/**
 * Harvest every account that interacted with `uri`.
 *
 * @param {string} uri at:// URI of the post
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.maxPages] per-source page cap
 * @param {string[]} [opts.only] engagement kinds to read; the rest are skipped
 * @param {(s: {done: number, total: number}) => void} [opts.onProgress]
 *
 * `truncated` is true when anything was left out: a source cut at the page
 * cap, a source that never answered, or a source past the cap on others.
 * `unread` names the kinds of the sources that never answered, with
 * Constellation's count of their records.
 */
export async function harvestPost(uri, { signal, maxPages = MAX_PAGES, onProgress, only = null } = {}) {
  const flat = flattenSources(await getBacklinkSources(uri, { signal }));
  if (!flat) {
    signal?.throwIfAborted();
    throw new Error(
      "Constellation didn't answer. It's the only complete record of who engaged with a post, so there's nothing to scan without it. Try again in a minute.",
    );
  }

  const wanted = flat.filter((s) => s.count > 0 && (!only || only.includes(engagementKind(s))));
  const known = wanted.filter((s) => engagementKind(s) !== 'other');
  const others = wanted.filter((s) => engagementKind(s) === 'other');
  const live = [...known, ...others.slice(0, MAX_OTHER_SOURCES)];
  const unreadByKind = new Map();
  const sources = [];
  const byDid = new Map();
  let records = 0;

  let done = 0;
  onProgress?.({ done, total: live.length });
  const drained = await mapLimit(live, SOURCE_CONCURRENCY, async (src) => {
    const out = await drainSource(uri, src.source, { signal, maxPages });
    done += 1;
    onProgress?.({ done, total: live.length });
    return out;
  });

  // Folded in the order the sources were listed, so participants come out the
  // same however the reads finished.
  live.forEach((src, i) => {
    const kind = engagementKind(src);
    const { rows, truncated, failed } = drained[i];
    for (const row of rows) {
      // A DID comes from whoever wrote the backlinked record. One that isn't
      // DID syntax is nobody to block, and kept, it would reach the page as
      // text someone chose.
      if (!isDid(row?.did)) continue;
      records += 1;
      let entry = byDid.get(row.did);
      if (!entry) {
        entry = { did: row.did, engagements: {}, records: [], total: 0 };
        byDid.set(row.did, entry);
      }
      entry.engagements[kind] = (entry.engagements[kind] || 0) + 1;
      entry.total += 1;
      entry.records.push({ kind, rkey: row.rkey, collection: row.collection ?? src.collection });
    }
    sources.push({ ...src, kind, truncated, failed });
    if (failed) unreadByKind.set(kind, (unreadByKind.get(kind) || 0) + src.count);
  });

  const participants = [...byDid.values()].map((p) => ({ ...p, primary: primaryKind(p.engagements) }));
  // Loudest engagement first, then most engagements.
  const rank = (k) => {
    const i = KIND_ORDER.indexOf(k);
    return i === -1 ? KIND_ORDER.length : i;
  };
  participants.sort((a, b) => rank(a.primary) - rank(b.primary) || b.total - a.total);

  const engagements = {};
  for (const p of participants) {
    for (const [kind, n] of Object.entries(p.engagements)) engagements[kind] = (engagements[kind] || 0) + n;
  }

  return {
    uri,
    harvestedAt: new Date().toISOString(),
    sources,
    participants,
    totals: { participants: participants.length, engagements, records },
    truncated: sources.some((s) => s.truncated) || unreadByKind.size > 0 || others.length > MAX_OTHER_SOURCES,
    unread: [...unreadByKind].map(([kind, count]) => ({ kind, count })),
  };
}
