// What the posting overview shows, worked out from what its reads return:
// the posts going out next, the latest drafts, the latest posts and the
// timers still counting down. Pure, so the page only fetches and draws.

import { compactPostFromRecord } from '../../lib/analytics.js';
import { summarizeDraft } from '../drafts/drafts.js';
import { isLiveTimer } from '../timers/timerService.js';

const time = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? null : t;
};

/** "1 draft", "3 drafts", with the number in en-US form. */
export function countPhrase(n, one, many = `${one}s`) {
  const value = Number.isFinite(n) ? n : 0;
  return `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`;
}

/**
 * The scheduled rows that are still to go out, soonest first, at most
 * `limit` of them, plus the counts the overview's figures need:
 * `{ next, waiting, queued, atTime, failed }`. `waiting` counts what is
 * still to go out (pending or going out now); a failed row is counted on its
 * own, because it needs the writer's attention rather than patience.
 */
export function scheduledOverview(rows, { limit = 4 } = {}) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const waitingRows = list
    .filter((r) => r.status === 'pending' || r.status === 'publishing')
    .sort(
      (a, b) =>
        (time(a.scheduledFor) ?? Infinity) - (time(b.scheduledFor) ?? Infinity),
    );
  return {
    next: waitingRows.slice(0, Math.max(0, limit)),
    waiting: waitingRows.length,
    queued: waitingRows.filter((r) => r.queued).length,
    atTime: waitingRows.filter((r) => !r.queued).length,
    failed: list.filter((r) => r.status === 'failed').length,
  };
}

/** The first line of a scheduled row's first post, or what it carries. */
export function scheduledSnippet(row, max = 120) {
  const post = row?.payload?.posts?.[0] || null;
  const text = String(post?.record?.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const more = (row?.payload?.posts?.length || 0) > 1;
  if (!text) {
    const type = post?.embed?.type;
    const base =
      type === 'images'
        ? 'A post with images'
        : type === 'external'
          ? 'A link'
          : type === 'record' || type === 'recordWithMedia'
            ? 'A quote'
            : 'A post with no text';
    return more ? `${base} (thread)` : base;
  }
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

/**
 * Draft summaries for a list, the most recently changed first:
 * summarizeDraft's rows. `limit` cuts it (null for all).
 */
export function draftRows(drafts, { deviceId = null, limit = null } = {}) {
  const rows = (Array.isArray(drafts) ? drafts : [])
    .filter((d) => d?.id)
    .map((d) => summarizeDraft(d, { deviceId }));
  rows.sort(
    (a, b) => (time(b.updatedAt) ?? -Infinity) - (time(a.updatedAt) ?? -Infinity),
  );
  return limit == null ? rows : rows.slice(0, Math.max(0, limit));
}

/**
 * A post view from the author feed as an archive row (src/lib/analytics.js's
 * compact shape), counts included, so the overview and the Posted page can
 * list what the archive hasn't synced yet beside what it has. Null for
 * anything that isn't the account's own post.
 */
export function rowFromPostView(view, did) {
  const uri = view?.uri;
  if (typeof uri !== 'string' || !uri.startsWith(`at://${did}/app.bsky.feed.post/`)) return null;
  const row = compactPostFromRecord(uri, view.record || {});
  if (!row) return null;
  return {
    ...row,
    likes: view.likeCount || 0,
    reposts: view.repostCount || 0,
    replies: view.replyCount || 0,
    quotes: view.quoteCount || 0,
  };
}

/**
 * The archive's rows with the author feed's newer ones laid over them,
 * newest first. A post the feed has and the archive doesn't is marked
 * `fresh` (not synced yet); one both have keeps the archive's row but takes
 * the feed's counts, which are newer. `removed` URIs (deleted here since)
 * are left out.
 */
export function mergePostRows(archiveRows, feedRows, { removed = [] } = {}) {
  const gone = new Set(removed);
  const byUri = new Map();
  for (const row of archiveRows || []) {
    if (row?.uri && !gone.has(row.uri)) byUri.set(row.uri, row);
  }
  for (const row of feedRows || []) {
    if (!row?.uri || gone.has(row.uri)) continue;
    const held = byUri.get(row.uri);
    if (held) {
      byUri.set(row.uri, {
        ...held,
        likes: row.likes,
        reposts: row.reposts,
        replies: row.replies,
        quotes: row.quotes,
      });
    } else byUri.set(row.uri, { ...row, fresh: true });
  }
  return [...byUri.values()].sort(
    (a, b) => (time(b.at) ?? -Infinity) - (time(a.at) ?? -Infinity),
  );
}

/**
 * Timers still counting down: `{ live, nextCheck }`, `nextCheck` being the
 * soonest `checkAt` among them (ISO), or null.
 */
export function timersOverview(rows) {
  const live = (Array.isArray(rows) ? rows : []).filter(isLiveTimer);
  const next = live
    .map((r) => r.checkAt)
    .filter((t) => time(t) != null)
    .sort((a, b) => time(a) - time(b))[0];
  return { live: live.length, nextCheck: next || null };
}

/** "Today, 9:00 AM", "Tomorrow, 9:00 AM", "Fri, Nov 14, 9:00 AM". */
export function whenLabel(iso, now = new Date()) {
  const t = time(iso);
  if (t == null) return '';
  const d = new Date(t);
  const clock = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  if (days === 0) return `Today, ${clock}`;
  if (days === 1) return `Tomorrow, ${clock}`;
  if (days === -1) return `Yesterday, ${clock}`;
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString('en-US', opts)}, ${clock}`;
}
