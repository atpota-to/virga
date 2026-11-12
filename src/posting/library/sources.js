// The reads behind the embed library's shelves, for the account the post is
// written as, and the lookups that turn a pasted link or a template's quote
// into something the composer can attach.
//
//   Your posts, Your replies   that account's archive (src/lib/analyticsStore.js,
//                              read only); the public author feed when the
//                              archive is empty
//   Saved                      Bluesky bookmarks, signed in
//   Links                      links in recent posts, public author feed
//   Feeds, Lists               public reads, plus the saved feeds in the
//                              account's preferences
//   Search                     Bluesky post search, signed in
//
// Whatever is picked is read again from the public AppView (getPosts and the
// feed and list reads) before it's attached, for its cid and the post as it
// now is: an archive row keeps only the start of the text and no cid. A post
// by someone else is checked for quoting turned off (its postgate) too.
//
// Public reads take `fetch` (the global one by default) and go to APPVIEW;
// signed-in reads take the account's agent and always ask Bluesky's AppView.

import { APPVIEW } from '../../config.js';
import { openAnalyticsStore } from '../../lib/analyticsStore.js';
import { parseRecordLink } from '../lib/postLink.js';
import { fetchLinkCard } from '../lib/linkCard.js';
import {
  isOwnThreadPost,
  isOwnThreadRow,
  itemFromArchiveRow,
  itemFromFeed,
  itemFromLink,
  itemFromList,
  itemFromPost,
  markQuotesOff,
} from './model.js';

const APPVIEW_SERVICE = ['bsky_appview', 'did:web:api.bsky.app'];

const POST_COLLECTION = 'app.bsky.feed.post';
const FEED_COLLECTION = 'app.bsky.feed.generator';
const LIST_COLLECTION = 'app.bsky.graph.list';
const RECORD_EMBED = 'app.bsky.embed.record';
const EXTERNAL_EMBED = 'app.bsky.embed.external';
const LINK_FEATURE = 'app.bsky.richtext.facet#link';
const POST_VIEW = 'app.bsky.feed.defs#postView';

/** getPosts takes at most this many URIs a call. */
export const GET_POSTS_MAX = 25;

const PAGE = {
  ownPosts: 50,
  links: 100,
  feeds: 50,
  lists: 50,
  bookmarks: 50,
  search: 25,
};
const LINKS_SCAN_LIMIT = 500;
const LINKS_WANTED = 50;
// A page of an author feed can hold none of one shelf's kind (fifty posts
// and not one reply), so the fallback reads on until it has this many, or
// has read this many pages.
const OWN_POSTS_WANTED = 10;
const OWN_POSTS_PAGES = 4;
const REQUEST_TIMEOUT_MS = 15_000;

const str = (v) => (typeof v === 'string' ? v : '');

function parseAtUri(uri) {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(str(uri));
  return m ? { did: m[1], collection: m[2], rkey: m[3] } : null;
}

const withCursor = (params, cursor) =>
  cursor ? { ...params, cursor } : params;

export function chunk(list, size = GET_POSTS_MAX) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function timeoutSignal(signal) {
  if (
    typeof AbortSignal === 'undefined' ||
    typeof AbortSignal.timeout !== 'function'
  )
    return signal;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!signal) return timeout;
  return typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, timeout])
    : signal;
}

/**
 * A public AppView read: `nsid` with `params` (arrays become repeated keys).
 * Resolves to the body; a failure throws with `status` and the AppView's
 * `error` name, so "gone" can be told from "couldn't read".
 */
export async function publicXrpc(
  nsid,
  params = {},
  { fetch: fetchImpl = globalThis.fetch, signal, appview = APPVIEW } = {},
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    for (const v of Array.isArray(value) ? value : [value])
      query.append(key, String(v));
  }
  const res = await fetchImpl(`${appview}/xrpc/${nsid}?${query}`, {
    signal: timeoutSignal(signal),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const error = new Error(body?.message || `HTTP ${res.status} from ${nsid}`);
    error.status = res.status;
    error.error = body?.error || null;
    throw error;
  }
  return res.json();
}

// A 400 or a not-found from the AppView means the record is gone; anything
// else (offline, a 5xx) says nothing about it.
function isGone(error) {
  if (!error) return false;
  if (error.status === 400 || error.status === 404) return true;
  if (error.error === 'NotFound' || error.code === 'NotFound') return true;
  return /not\s*found|could not (?:find|locate)/i.test(str(error.message));
}

function appviewAgent(agent) {
  if (!agent) throw new Error('Not signed in');
  return typeof agent.withProxy === 'function'
    ? agent.withProxy(...APPVIEW_SERVICE)
    : agent;
}

/* ---- posts ------------------------------------------------------------ */

/**
 * Post views for `uris`, read publicly in chunks of 25, in no particular
 * order. A chunk that couldn't be read is counted in `failed`, so a caller
 * can tell posts that are gone from posts that weren't read.
 * @returns {Promise<{ views: object[], failed: number, error: unknown }>}
 */
export async function getPosts(uris, { fetch, signal } = {}) {
  const unique = [
    ...new Set((uris || []).filter((u) => typeof u === 'string' && u)),
  ];
  let failed = 0;
  let error = null;
  const pages = await Promise.all(
    chunk(unique).map((part) =>
      publicXrpc(
        'app.bsky.feed.getPosts',
        { uris: part },
        { fetch, signal },
      ).then(
        (body) => body?.posts || [],
        (reason) => {
          failed += part.length;
          error = reason;
          return [];
        },
      ),
    ),
  );
  return { views: pages.flat(), failed, error };
}

/** Every post row in `did`'s archive, read only. Empty when there is none. */
export async function readArchivePosts(
  did,
  { openStore = openAnalyticsStore } = {},
) {
  if (!did) return [];
  try {
    const store = await openStore(did);
    const rows = await store.all('posts');
    return Array.isArray(rows)
      ? rows.filter((r) => r?.uri && r.uri.startsWith(`at://${did}/`))
      : [];
  } catch {
    return [];
  }
}

/**
 * One shelf of archive rows as items: Your posts (top-level posts and
 * continuations of your own threads) or, with `replies`, Your replies.
 * Searched (`query`, in the text the row keeps), sorted (`'date'` or
 * `'engagement'`) and cut to `limit`. Returns `{ items, total }`, `total`
 * being every row that matched.
 */
export function archiveShelf(
  rows,
  { did, replies = false, sort = 'date', query = '', limit = 50 } = {},
) {
  const needle = str(query).trim().toLowerCase();
  const time = (r) => {
    const t = Date.parse(r?.at || '');
    return Number.isNaN(t) ? -Infinity : t;
  };
  const score = (r) =>
    (r.likes || 0) + (r.reposts || 0) + (r.replies || 0) + (r.quotes || 0);
  const matched = (rows || []).filter(
    (r) =>
      r?.uri &&
      isOwnThreadRow(r, did) !== replies &&
      (!needle || str(r.text).toLowerCase().includes(needle)),
  );
  matched.sort((a, b) =>
    sort === 'engagement'
      ? score(b) - score(a) || time(b) - time(a)
      : time(b) - time(a),
  );
  const shelf = replies ? 'replies' : 'posts';
  return {
    items: matched
      .slice(0, Math.max(0, limit))
      .map((r) => itemFromArchiveRow(r, { shelf, selfDid: did })),
    total: matched.length,
  };
}

/**
 * The account's own posts from its public author feed, for when its archive
 * hasn't been built: top-level posts and own-thread continuations, or with
 * `replies` its replies into other threads. Reposts are left out. Reads on
 * until it has ten or has read four pages.
 * @returns {Promise<{ items: object[], cursor: string | null }>} post views
 */
export async function fetchOwnPosts(
  did,
  { cursor, replies = false, fetch, signal } = {},
) {
  const items = [];
  let next = cursor || null;
  let pages = 0;
  do {
    const body = await publicXrpc(
      'app.bsky.feed.getAuthorFeed',
      withCursor(
        { actor: did, limit: PAGE.ownPosts, filter: 'posts_with_replies' },
        next,
      ),
      { fetch, signal },
    );
    for (const entry of body?.feed || []) {
      const post = entry?.post;
      if (
        !post?.uri ||
        entry.reason ||
        (post.author?.did && post.author.did !== did)
      )
        continue;
      const own = isOwnThreadPost(post);
      if (replies ? !own : own) items.push(post);
    }
    // A cursor handed back unchanged would read the same page forever.
    next = body?.cursor && body.cursor !== next ? body.cursor : null;
    pages += 1;
  } while (next && items.length < OWN_POSTS_WANTED && pages < OWN_POSTS_PAGES);
  return { items, cursor: next };
}

/** Bluesky bookmarks, signed in, as post views (blocked and deleted ones left out). */
export async function fetchBookmarks(
  agent,
  { cursor, limit = PAGE.bookmarks, signal } = {},
) {
  const res = await appviewAgent(agent).app.bsky.bookmark.getBookmarks(
    withCursor({ limit }, cursor),
    signal ? { signal } : undefined,
  );
  const items = (res?.data?.bookmarks || [])
    .map((b) => b?.item)
    .filter(
      (item) =>
        item?.uri &&
        (item.$type === POST_VIEW || (item.$type === undefined && item.record)),
    );
  return { items, cursor: res?.data?.cursor || null };
}

/**
 * Bluesky post search, signed in. With `mine`, only the account's own posts
 * (`from:` its handle, or `from:me` when the handle isn't known).
 */
export async function searchPosts(
  agent,
  query,
  { mine = false, handle, cursor, signal } = {},
) {
  const q = str(query).trim();
  const res = await appviewAgent(agent).app.bsky.feed.searchPosts(
    withCursor(
      { q: mine ? `from:${handle || 'me'} ${q}` : q, limit: PAGE.search },
      cursor,
    ),
    signal ? { signal } : undefined,
  );
  return { items: res?.data?.posts || [], cursor: res?.data?.cursor || null };
}

/* ---- links ------------------------------------------------------------ */

const MEDIA_EXTENSIONS = [
  '.gif',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.bmp',
  '.svg',
];
const MEDIA_HOSTS = [
  'media.tenor.com',
  'giphy.com',
  'media.giphy.com',
  'i.imgur.com',
  'media.imgur.com',
  'i.redd.it',
  'media.discordapp.net',
  'cdn.discordapp.com',
];

/** Whether a link is an image or a GIF rather than a page worth a card. */
export function isMediaUrl(url) {
  if (!url) return false;
  const lower = String(url).toLowerCase();
  let path = lower;
  let host = '';
  try {
    const u = new URL(lower);
    path = u.pathname;
    host = u.hostname;
  } catch {
    // Not a URL; judge the string as it is.
  }
  if (MEDIA_EXTENSIONS.some((ext) => path.endsWith(ext) || lower.endsWith(ext)))
    return true;
  return (
    !!host && MEDIA_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  );
}

// Links to posts and profiles belong to quoting, not to link cards.
const PROFILE_LINK = /\bbsky\.app\/profile/i;

/**
 * Links from the account's recent posts: link cards first-hand, and bare
 * links from facets. Scans at most 500 posts per call, stopping after the
 * page that brings the count to 50. Media links and post links are left out,
 * and so are reposts (someone else's link). A link already in `seen`, or
 * earlier in this call, is skipped, so pages dedupe against each other.
 *
 * @returns {Promise<{ items: object[], cursor: string | null }>} newest first;
 *   each `{ url, title, description, image, postUri, createdAt }`
 */
export async function fetchRecentLinks(
  did,
  { cursor, seen, fetch, signal } = {},
) {
  const known = new Set(seen || []);
  const found = [];
  let next = cursor || null;
  let scanned = 0;

  const add = (link) => {
    if (!link.url || known.has(link.url) || isMediaUrl(link.url)) return;
    known.add(link.url);
    found.push(link);
  };

  do {
    const body = await publicXrpc(
      'app.bsky.feed.getAuthorFeed',
      withCursor({ actor: did, limit: PAGE.links }, next),
      { fetch, signal },
    );
    const feed = body?.feed || [];
    for (const entry of feed) {
      const post = entry?.post;
      if (
        !post ||
        entry.reason ||
        (post.author?.did && post.author.did !== did)
      )
        continue;
      const createdAt = post.record?.createdAt || post.indexedAt || null;
      const embed = post.record?.embed;
      if (embed?.$type === EXTERNAL_EMBED && embed.external?.uri) {
        add({
          url: embed.external.uri,
          title: str(embed.external.title),
          description: str(embed.external.description),
          // The view's thumb is a URL; the record's is a blob.
          image:
            typeof post.embed?.external?.thumb === 'string'
              ? post.embed.external.thumb
              : null,
          postUri: post.uri,
          createdAt,
        });
      }
      for (const facet of post.record?.facets || []) {
        for (const feature of facet?.features || []) {
          if (
            feature?.$type !== LINK_FEATURE ||
            typeof feature.uri !== 'string'
          )
            continue;
          if (PROFILE_LINK.test(feature.uri)) continue;
          add({
            url: feature.uri,
            title: feature.uri,
            description: '',
            image: null,
            postUri: post.uri,
            createdAt,
          });
        }
      }
    }
    scanned += feed.length;
    next = body?.cursor || null;
    // An empty page with a cursor would otherwise loop; the cursor is kept for Load more.
    if (!feed.length) break;
  } while (next && scanned < LINKS_SCAN_LIMIT && found.length < LINKS_WANTED);

  const time = (l) => {
    const t = new Date(l.createdAt || '').getTime();
    return Number.isNaN(t) ? -Infinity : t;
  };
  found.sort((a, b) => time(b) - time(a));
  return { items: found, cursor: next };
}

/* ---- feeds and lists -------------------------------------------------- */

/** Feeds the account made, from the public AppView. */
export async function fetchOwnFeeds(did, { cursor, fetch, signal } = {}) {
  const body = await publicXrpc(
    'app.bsky.feed.getActorFeeds',
    withCursor({ actor: did, limit: PAGE.feeds }, cursor),
    { fetch, signal },
  );
  return { items: body?.feeds || [], cursor: body?.cursor || null };
}

/** The feed URIs saved in an account's preferences, in saved order. */
export function savedFeedUris(preferences) {
  const out = [];
  for (const pref of Array.isArray(preferences) ? preferences : []) {
    if (pref?.$type === 'app.bsky.actor.defs#savedFeedsPrefV2') {
      for (const item of pref.items || [])
        if (item?.type === 'feed' && typeof item.value === 'string')
          out.push(item.value);
    } else if (pref?.$type === 'app.bsky.actor.defs#savedFeedsPref') {
      for (const uri of [...(pref.pinned || []), ...(pref.saved || [])]) {
        if (
          typeof uri === 'string' &&
          parseAtUri(uri)?.collection === FEED_COLLECTION
        )
          out.push(uri);
      }
    }
  }
  return [...new Set(out)];
}

/**
 * Feeds the account saved (lists left out), read from the public AppView;
 * one that can't be read is dropped. Throws when the preferences themselves
 * can't be read, so the shelf shows an error rather than "none".
 */
export async function fetchSavedFeeds(agent, { fetch, signal } = {}) {
  if (!agent) throw new Error('Not signed in');
  const res = await agent.app.bsky.actor.getPreferences(
    {},
    signal ? { signal } : undefined,
  );
  const uris = savedFeedUris(res?.data?.preferences);
  const pages = await Promise.all(
    chunk(uris).map((feeds) =>
      publicXrpc(
        'app.bsky.feed.getFeedGenerators',
        { feeds },
        { fetch, signal },
      ).then(
        (body) => body?.feeds || [],
        () => [],
      ),
    ),
  );
  const byUri = new Map(pages.flat().map((v) => [v.uri, v]));
  return uris.map((u) => byUri.get(u)).filter(Boolean);
}

/** Lists the account made, from the public AppView. */
export async function fetchOwnLists(did, { cursor, fetch, signal } = {}) {
  const body = await publicXrpc(
    'app.bsky.graph.getLists',
    withCursor({ actor: did, limit: PAGE.lists }, cursor),
    { fetch, signal },
  );
  return { items: body?.lists || [], cursor: body?.cursor || null };
}

/* ---- reading a pick again ---------------------------------------------- */

async function readRecord(kind, uri, { fetch, signal }) {
  if (kind === 'post') {
    const { views, failed, error } = await getPosts([uri], { fetch, signal });
    if (failed) throw error || new Error('Couldn’t read that post.');
    return views[0] || null;
  }
  try {
    if (kind === 'feed')
      return (
        (
          await publicXrpc(
            'app.bsky.feed.getFeedGenerator',
            { feed: uri },
            { fetch, signal },
          )
        )?.view || null
      );
    if (kind === 'list')
      return (
        (
          await publicXrpc(
            'app.bsky.graph.getList',
            { list: uri, limit: 1 },
            { fetch, signal },
          )
        )?.list || null
      );
  } catch (error) {
    if (isGone(error)) return null;
    throw error;
  }
  return null;
}

const POSTGATE_COLLECTION = 'app.bsky.feed.postgate';
const DISABLE_RULE = 'app.bsky.feed.postgate#disableRule';
const POST_AT = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/;

/**
 * Whether the post's author has turned quoting off: its postgate (at the
 * post's rkey) holds a disableRule. The public reads carry no viewer state,
 * so `viewer.embeddingDisabled` is never there to say; the record is public.
 * An author's own post can always be quoted by them. False when there's no
 * postgate, or it couldn't be read: that says nothing either way.
 */
export async function quotesTurnedOff(uri, { selfDid, fetch, signal } = {}) {
  const at = POST_AT.exec(str(uri));
  if (!at || (selfDid && at[1] === selfDid)) return false;
  try {
    const body = await publicXrpc(
      'com.atproto.repo.getRecord',
      { repo: at[1], collection: POSTGATE_COLLECTION, rkey: at[2] },
      { fetch, signal },
    );
    const rules = body?.value?.embeddingRules;
    return (
      Array.isArray(rules) && rules.some((rule) => rule?.$type === DISABLE_RULE)
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

function quotesOffError() {
  const error = new Error('That post’s author doesn’t allow quotes.');
  error.code = 'QUOTES_OFF';
  return error;
}

/** Whether the post at `view` (or `uri`) can't be quoted by `selfDid`. */
async function quotesOffFor(view, uri, { selfDid, fetch, signal }) {
  const mine = Boolean(selfDid) && view?.author?.did === selfDid;
  if (!mine && view?.viewer?.embeddingDisabled) return true;
  return quotesTurnedOff(uri, { selfDid, fetch, signal });
}

/** Throws QUOTES_OFF when the post at `view` (or `uri`) can't be quoted. */
async function checkQuotable(view, uri, opts) {
  if (await quotesOffFor(view, uri, opts)) throw quotesOffError();
}

function goneError(kind) {
  const noun = { post: 'post', feed: 'feed', list: 'list' }[kind] || 'record';
  const error = new Error(`That ${noun} is gone, so it can’t be attached.`);
  error.code = 'GONE';
  return error;
}

/**
 * A picked post, feed or list read again from the public AppView, as the
 * item it now is (its cid, its full text, its counts), keeping the shelf it
 * was picked from and its reason. A post whose author doesn't allow quotes
 * comes back marked `quotesOff`, to be shown but not attached. Templates and
 * links come back as they are. Throws `{ code: 'GONE' }` for one that no
 * longer exists; any other failure throws as it came.
 */
export async function hydratePick(item, { selfDid, fetch, signal } = {}) {
  const kind = item?.kind;
  if (!item?.uri || (kind !== 'post' && kind !== 'feed' && kind !== 'list'))
    return item;
  const view = await readRecord(kind, item.uri, { fetch, signal });
  if (!view) throw goneError(kind);
  const fresh =
    kind === 'post'
      ? itemFromPost(view, { shelf: item.shelf || 'posts', selfDid })
      : kind === 'feed'
        ? itemFromFeed(view, { group: item.group || 'yours' })
        : itemFromList(view);
  const out = {
    ...fresh,
    shelf: item.shelf || fresh.shelf,
    reason: item.reason || '',
  };
  // The public read has no viewer state, so what a signed-in shelf already
  // knew is kept, and the postgate is asked otherwise.
  if (
    kind === 'post' &&
    (item.quotesOff ||
      (await quotesOffFor(view, item.uri, { selfDid, fetch, signal })))
  )
    return markQuotesOff(out);
  return out;
}

/**
 * A plan's attachment with its cid and view filled in (a template's quote,
 * or a post picked from the archive). A link, or a record that already has
 * both, comes back as it is, once a post is known to be quotable. Throws
 * `{ code: 'GONE' }` and `{ code: 'QUOTES_OFF' }` as hydratePick does.
 */
export async function hydrateAttachment(
  attach,
  { selfDid, fetch, signal } = {},
) {
  if (!attach || attach.kind === 'link' || !attach.uri) return attach;
  let out = attach;
  if (!(attach.cid && attach.view)) {
    const view = await readRecord(attach.kind, attach.uri, { fetch, signal });
    if (!view) throw goneError(attach.kind);
    out = { ...attach, cid: view.cid || attach.cid || null, view };
  }
  if (out.kind === 'post')
    await checkQuotable(out.view, out.uri, { selfDid, fetch, signal });
  return out;
}

function embedUri(entry) {
  if (typeof entry === 'string') return entry;
  const embed = entry?.$type ? entry : entry?.embed;
  if (embed?.$type === RECORD_EMBED) return embed.record?.uri || null;
  return null;
}

/**
 * Views for what templates quote, batched: posts in getPosts chunks, feeds
 * through getFeedGenerator, lists through getList, all public. Entries may be
 * template embeds, templates, or at:// URIs; link cards need no view.
 *
 * A URI maps to its view, or to 'missing' when the AppView says it's gone. A
 * URI whose read failed for any other reason is absent, so a network blip
 * never reads as a deleted quote.
 *
 * @returns {Promise<Map<string, object | 'missing'>>}
 */
export async function hydrateEmbedViews(entries, { fetch, signal } = {}) {
  const out = new Map();
  const posts = [];
  const feeds = [];
  const lists = [];
  for (const entry of entries || []) {
    const uri = embedUri(entry);
    const parsed = parseAtUri(uri);
    if (
      !parsed ||
      posts.includes(uri) ||
      feeds.includes(uri) ||
      lists.includes(uri)
    )
      continue;
    if (parsed.collection === POST_COLLECTION) posts.push(uri);
    else if (parsed.collection === FEED_COLLECTION) feeds.push(uri);
    else if (parsed.collection === LIST_COLLECTION) lists.push(uri);
  }

  const postReads = chunk(posts).map(async (uris) => {
    try {
      const body = await publicXrpc(
        'app.bsky.feed.getPosts',
        { uris },
        { fetch, signal },
      );
      const found = new Map((body?.posts || []).map((p) => [p.uri, p]));
      for (const uri of uris) out.set(uri, found.get(uri) || 'missing');
    } catch {
      // Unknown, not gone: left out.
    }
  });
  const feedReads = feeds.map(async (feed) => {
    try {
      const body = await publicXrpc(
        'app.bsky.feed.getFeedGenerator',
        { feed },
        { fetch, signal },
      );
      out.set(feed, body?.view || 'missing');
    } catch (error) {
      if (isGone(error)) out.set(feed, 'missing');
    }
  });
  const listReads = lists.map(async (list) => {
    try {
      const body = await publicXrpc(
        'app.bsky.graph.getList',
        { list, limit: 1 },
        { fetch, signal },
      );
      out.set(list, body?.list || 'missing');
    } catch (error) {
      if (isGone(error)) out.set(list, 'missing');
    }
  });
  await Promise.all([...postReads, ...feedReads, ...listReads]);
  return out;
}

/* ---- pasted links ----------------------------------------------------- */

/** A handle's DID from the public AppView, or null. */
export async function resolveHandle(handle, { fetch, signal } = {}) {
  const clean = str(handle).replace(/^@/, '').trim().toLowerCase();
  if (!clean) return null;
  try {
    const body = await publicXrpc(
      'com.atproto.identity.resolveHandle',
      { handle: clean },
      { fetch, signal },
    );
    return typeof body?.did === 'string' ? body.did : null;
  } catch {
    return null;
  }
}

function firstLine(text) {
  return (
    str(text)
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) || ''
  );
}

async function recordFromLink(input, { fetch, signal }) {
  const link = parseRecordLink(str(input).trim());
  if (
    !link ||
    (link.kind !== 'post' && link.kind !== 'feed' && link.kind !== 'list')
  )
    return null;
  const did = link.did || (await resolveHandle(link.handle, { fetch, signal }));
  if (!did) return null;
  const uri = `at://${did}/${link.collection}/${link.rkey}`;
  try {
    const view = await readRecord(link.kind, uri, { fetch, signal });
    return view?.uri && view?.cid ? { kind: link.kind, view } : null;
  } catch {
    return null;
  }
}

/**
 * A pasted bsky.app (or aturi.to, or at://) link to a post, feed or list, as
 * a record embed for a template: `{ embed, title, by, view }`, or null when
 * the link isn't one or the record can't be read.
 */
export async function resolveRecordLink(url, { fetch, signal } = {}) {
  const found = await recordFromLink(url, { fetch, signal });
  if (!found) return null;
  const { kind, view } = found;
  let title;
  let by;
  if (kind === 'post') {
    title = firstLine(view.record?.text) || 'Post';
    by = view.author?.handle ? `Post by @${view.author.handle}` : 'Post';
  } else if (kind === 'feed') {
    title = str(view.displayName) || 'Feed';
    by = view.creator?.handle ? `Feed by @${view.creator.handle}` : 'Feed';
  } else {
    title = str(view.name) || 'List';
    by = view.creator?.handle ? `List by @${view.creator.handle}` : 'List';
  }
  return {
    embed: { $type: RECORD_EMBED, record: { uri: view.uri, cid: view.cid } },
    title,
    by,
    view,
  };
}

/**
 * Any other web link as a link-card embed for a template:
 * `{ embed, title, by }` with `by` the host, or null when it isn't a web
 * address or its card can't be read.
 */
export async function resolveExternalLink(url, { fetch, signal } = {}) {
  const trimmed = str(url).trim();
  let host = '';
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    host = u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  const card = await fetchLinkCard(trimmed, { fetch, signal });
  if (!card) return null;
  return {
    embed: {
      $type: EXTERNAL_EMBED,
      external: {
        uri: trimmed,
        title: str(card.title),
        description: str(card.description),
      },
    },
    title: str(card.title) || trimmed,
    by: host,
  };
}

/**
 * A link pasted into the library as an item to pick: a post, feed or list
 * when it's a link to one (read from the public AppView), otherwise a link
 * card (read from Bluesky's card service). Null when it's neither, or can't
 * be read.
 */
export async function resolvePastedLink(
  input,
  { selfDid, fetch, signal } = {},
) {
  const text = str(input).trim();
  if (!text) return null;
  const found = await recordFromLink(text, { fetch, signal });
  if (found) {
    if (found.kind === 'post') {
      const item = itemFromPost(found.view, { shelf: 'search', selfDid });
      return (await quotesOffFor(found.view, item.uri, {
        selfDid,
        fetch,
        signal,
      }))
        ? markQuotesOff(item)
        : item;
    }
    if (found.kind === 'feed')
      return itemFromFeed(found.view, { group: 'search' });
    return itemFromList(found.view);
  }
  if (parseRecordLink(text)) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  } catch {
    return null;
  }
  const card = await fetchLinkCard(text, { fetch, signal });
  if (!card) return null;
  return itemFromLink({
    url: text,
    title: card.title,
    description: card.description,
    image: card.thumb,
  });
}

/* ---- bound to one account --------------------------------------------- */

/**
 * The library's reads for one account (the one the post is written as):
 * `{ did, archive, posts, replies, saved, links, feeds, lists, savedFeeds,
 *    search, hydrate, hydrateAttachment, hydrateEmbeds, resolveLink }`.
 * `agent` may be the agent or a function resolving to it (the session's
 * agentFor); only Saved, saved feeds and Search sign in.
 */
export function librarySources({ did, agent, handle, fetch, openStore } = {}) {
  const signedIn = async () =>
    typeof agent === 'function' ? agent(did) : agent;
  return {
    did,
    archive: () => readArchivePosts(did, openStore ? { openStore } : {}),
    posts: ({ cursor, signal } = {}) =>
      fetchOwnPosts(did, { cursor, replies: false, fetch, signal }),
    replies: ({ cursor, signal } = {}) =>
      fetchOwnPosts(did, { cursor, replies: true, fetch, signal }),
    saved: async ({ cursor, signal } = {}) =>
      fetchBookmarks(await signedIn(), { cursor, signal }),
    links: ({ cursor, seen, signal } = {}) =>
      fetchRecentLinks(did, { cursor, seen, fetch, signal }),
    feeds: ({ cursor, signal } = {}) =>
      fetchOwnFeeds(did, { cursor, fetch, signal }),
    savedFeeds: async ({ signal } = {}) =>
      fetchSavedFeeds(await signedIn(), { fetch, signal }),
    lists: ({ cursor, signal } = {}) =>
      fetchOwnLists(did, { cursor, fetch, signal }),
    search: async (query, { mine, cursor, signal } = {}) =>
      searchPosts(await signedIn(), query, { mine, handle, cursor, signal }),
    hydrate: (item, { signal } = {}) =>
      hydratePick(item, { selfDid: did, fetch, signal }),
    hydrateAttachment: (attach, { signal } = {}) =>
      hydrateAttachment(attach, { selfDid: did, fetch, signal }),
    hydrateEmbeds: (entries, { signal } = {}) =>
      hydrateEmbedViews(entries, { fetch, signal }),
    resolveLink: (input, { signal } = {}) =>
      resolvePastedLink(input, { selfDid: did, fetch, signal }),
  };
}
