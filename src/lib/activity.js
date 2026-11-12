// When an account last did anything in public: the newest item in its author
// feed (a post, a reply or a repost), one item per account, from the public
// AppView. Follow cleanup uses it to find the accounts you follow that have
// gone quiet.
//
// One request per account, a few at a time, so a check over 800 follows is a
// minute or so of polite reading rather than a burst. An account the AppView
// can't find (deleted, deactivated, taken down) comes back `gone`, which is
// itself the strongest reason to tidy it away.

import { APPVIEW } from '../config.js';

const CONCURRENCY = 6;

/**
 * The time of a feed item: a repost is dated by when it was reposted, a post
 * by when it was written (falling back to when it was indexed).
 */
export function feedItemTime(item) {
  if (!item) return null;
  const at = item.reason?.indexedAt || item.post?.record?.createdAt || item.post?.indexedAt || null;
  const ms = Date.parse(at || '');
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function lastActive(did, signal) {
  const params = new URLSearchParams({ actor: did, limit: '1', filter: 'posts_with_replies' });
  const res = await fetch(`${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?${params}`, { signal });
  if (res.status === 400 || res.status === 404) {
    // The AppView says why: a missing, deactivated or taken-down actor is
    // gone; anything else (blocked us, a bad DID) is just unknown.
    const body = await res.json().catch(() => null);
    const gone = /not ?found|deactivated|suspended|takendown/i.test(`${body?.error || ''} ${body?.message || ''}`);
    return { did, lastActiveAt: null, gone };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return { did, lastActiveAt: feedItemTime(body?.feed?.[0]), gone: false };
}

/**
 * Read when each of `dids` was last active. Reports `{ done, total }` as it
 * goes. An account that fails to read is left out of the result rather than
 * recorded as quiet: a timeout says nothing about the account.
 *
 * @returns {Promise<Array<{did, lastActiveAt: string|null, gone: boolean}>>}
 */
export async function checkActivity(dids, { onProgress, signal } = {}) {
  const list = Array.from(new Set(dids || [])).filter(Boolean);
  const out = [];
  let next = 0;
  let done = 0;
  onProgress?.({ done: 0, total: list.length });
  async function worker() {
    while (next < list.length) {
      if (signal?.aborted) return;
      const did = list[next++];
      try {
        out.push(await lastActive(did, signal));
      } catch {
        // Left out: unknown, not quiet.
      }
      done += 1;
      onProgress?.({ done, total: list.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  return out;
}
