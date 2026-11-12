// Links to records that a post can embed: posts, feeds, lists and starter
// packs, written as bsky.app links, aturi.to links or at:// URIs. Pure: an
// actor that is a handle comes back as a handle, and the caller resolves it.

export const RECORD_COLLECTIONS = Object.freeze({
  post: 'app.bsky.feed.post',
  feed: 'app.bsky.feed.generator',
  list: 'app.bsky.graph.list',
  starterpack: 'app.bsky.graph.starterpack',
});

const KIND_BY_COLLECTION = Object.fromEntries(
  Object.entries(RECORD_COLLECTIONS).map(([kind, nsid]) => [nsid, kind]),
);

/** The embeddable kind a collection holds, or null. */
export function kindForCollection(collection) {
  return KIND_BY_COLLECTION[collection] || null;
}

// The bsky.app path segment each kind lives under.
const BSKY_SEGMENT = { post: 'post', feed: 'feed', list: 'lists' };

// Only the bare host and www.: a subdomain (staging., a look-alike) is not
// bsky.app, and the record must be the path's own, not one smuggled into a
// query or a later path.
const BSKY_PROFILE_RECORD =
  /^https?:\/\/(?:www\.)?bsky\.app\/profile\/([^/?#]+)\/(post|feed|lists)\/([^/?#]+)/i;
const BSKY_STARTER_PACK =
  /^https?:\/\/(?:www\.)?bsky\.app\/(?:starter-pack|start)\/([^/?#]+)\/([^/?#]+)/i;
const WAYPOINT =
  /^https?:\/\/(?:www\.)?aturi\.to\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)/i;
const AT_URI = /^at:\/\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)\/?$/;

const SEGMENT_KIND = { post: 'post', feed: 'feed', lists: 'list' };

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function result(kind, actor, rkey, url) {
  const cleanActor = decodeSegment(actor);
  const out = {
    kind,
    collection: RECORD_COLLECTIONS[kind],
    actor: cleanActor,
    rkey: decodeSegment(rkey),
    url,
  };
  if (cleanActor.startsWith('did:')) {
    out.did = cleanActor;
    out.uri = `at://${cleanActor}/${out.collection}/${out.rkey}`;
  } else {
    out.handle = cleanActor.replace(/^@/, '').toLowerCase();
  }
  return out;
}

/**
 * A link to an embeddable record, read into its parts:
 * `{ kind, collection, actor, did?, handle?, rkey, url, uri? }`. `uri` is set
 * only when the actor is a DID (a handle has to be resolved first). Null for
 * anything else, non-strings included.
 * @param {unknown} input
 */
export function parseRecordLink(input) {
  if (typeof input !== 'string') return null;
  const url = input.trim();
  if (!url) return null;

  let m = url.match(AT_URI);
  if (m) {
    const kind = kindForCollection(m[2]);
    return kind ? result(kind, m[1], m[3], url) : null;
  }

  m = url.match(BSKY_PROFILE_RECORD);
  if (m) return result(SEGMENT_KIND[m[2].toLowerCase()], m[1], m[3], url);

  m = url.match(BSKY_STARTER_PACK);
  if (m) return result('starterpack', m[1], m[2], url);

  m = url.match(WAYPOINT);
  if (m) {
    const kind = kindForCollection(m[2]);
    return kind ? result(kind, m[1], m[3], url) : null;
  }

  return null;
}

/**
 * A link to a post: `{ did, rkey }` or `{ handle, rkey }` (with `actor`, the
 * segment as written), or null when the input isn't a post link.
 * @param {unknown} url
 */
export function parsePostLink(url) {
  const parsed = parseRecordLink(url);
  if (!parsed || parsed.kind !== 'post') return null;
  const out = { actor: parsed.actor, rkey: parsed.rkey };
  if (parsed.did) out.did = parsed.did;
  else out.handle = parsed.handle;
  return out;
}

/** `at://<did>/<collection>/<rkey>` for a kind. */
export function recordUri(did, kind, rkey) {
  const collection = RECORD_COLLECTIONS[kind];
  if (!collection) throw new Error(`Not an embeddable kind: ${kind}`);
  return `at://${did}/${collection}/${rkey}`;
}

/**
 * The record a `uri` names, if it is an embeddable kind:
 * `{ kind, did, collection, rkey }` or null.
 */
export function parseRecordUri(uri) {
  const m = typeof uri === 'string' ? uri.match(AT_URI) : null;
  if (!m) return null;
  const kind = kindForCollection(m[2]);
  if (!kind) return null;
  return { kind, did: m[1], collection: m[2], rkey: m[3] };
}

/**
 * The bsky.app page for a record URI, or null for a kind bsky.app has no page
 * for. `actor` (a handle) reads better than the DID when it is known.
 */
export function bskyUrlFor(uri, actor) {
  const parsed = parseRecordUri(uri);
  if (!parsed) return null;
  const who = encodeURIComponent(actor || parsed.did);
  if (parsed.kind === 'starterpack') {
    return `https://bsky.app/starter-pack/${who}/${parsed.rkey}`;
  }
  return `https://bsky.app/profile/${who}/${BSKY_SEGMENT[parsed.kind]}/${parsed.rkey}`;
}

/**
 * The facet detector's view of a link: what kind of record it embeds, in the
 * shape the composer's link handling reads (`linkType` plus `postId`,
 * `feedId`, `listId` or `packId`). Null for anything that isn't a record link.
 * @param {unknown} url
 */
export function detectPostLink(url) {
  const parsed = parseRecordLink(url);
  if (!parsed || parsed.url.startsWith('at://')) return null;
  const idKey = {
    post: 'postId',
    feed: 'feedId',
    list: 'listId',
    starterpack: 'packId',
  }[parsed.kind];
  return {
    type: 'bluesky',
    linkType: parsed.kind,
    handle: parsed.actor,
    [idKey]: parsed.rkey,
    url: parsed.url,
  };
}
