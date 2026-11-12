// What a post made or deleted in Virga does to the archive before the next
// sync sees it: a made post appears with zero counts (the sync's refresh of
// recent posts fills them in), a deleted one leaves at once, so a chart never
// counts a post that's gone or misses one that was just made.

import { compactPostFromRecord } from '../lib/analytics.js';

const POST = 'app.bsky.feed.post';

/** Whether `uri` is a post in `did`'s own repo. */
export function isOwnPostUri(did, uri) {
  if (!did || typeof uri !== 'string') return false;
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  return Boolean(m && m[1] === did && m[2] === POST);
}

/**
 * The archive rows for posts `did` just made, from `[{ uri, cid, record }]`.
 * Anything that isn't the account's own post, or has no readable record, is
 * left out.
 */
export function postRowsFor(did, added) {
  const rows = [];
  for (const item of added || []) {
    if (!isOwnPostUri(did, item?.uri)) continue;
    const row = compactPostFromRecord(item.uri, item.record);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * `posts` with `rows` added (a row whose URI is already held replaces it in
 * place, keeping the counts the archive already has) and the `removed` URIs
 * gone. Returns the same array when nothing changed, so a caller can skip the
 * write.
 */
export function applyPostChanges(posts, { rows = [], removed = [] } = {}) {
  const list = Array.isArray(posts) ? posts : [];
  const gone = new Set(removed);
  const byUri = new Map(rows.map((r) => [r.uri, r]));
  let changed = false;
  const next = [];
  for (const post of list) {
    if (gone.has(post.uri)) {
      changed = true;
      continue;
    }
    const fresh = byUri.get(post.uri);
    if (fresh) {
      byUri.delete(post.uri);
      const merged = { ...fresh, likes: post.likes, reposts: post.reposts, replies: post.replies, quotes: post.quotes };
      if (!sameRow(merged, post)) changed = true;
      next.push(merged);
    } else {
      next.push(post);
    }
  }
  for (const row of byUri.values()) {
    if (gone.has(row.uri)) continue;
    next.push(row);
    changed = true;
  }
  return changed ? next : list;
}

function sameRow(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}
