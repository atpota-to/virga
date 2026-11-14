// What PostPreview shows of a post, from whatever the caller has: a post view
// from the AppView (author, counts, a hydrated embed), the bare record from a
// repo, or only its URI.

import { bskyUrlFor, parseRecordUri } from '../lib/postLink.js';

const PREVIEW_CHARS = 280;

function plural(n, one, many) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** One line for an embed: "2 images", "A video", "Link: <title>", "Quotes a post". */
export function embedSummary(embed) {
  if (!embed || typeof embed !== 'object') return null;
  const type = String(embed.$type || '').replace(/#view$/, '');
  if (type === 'app.bsky.embed.images') {
    const n = (embed.images || []).length;
    return n ? plural(n, 'image', 'images') : null;
  }
  if (type === 'app.bsky.embed.video') return 'A video';
  if (type === 'app.bsky.embed.external') {
    const ext = embed.external || {};
    const title = ext.title || hostOf(ext.uri);
    return title ? `Link: ${title}` : 'A link';
  }
  if (type === 'app.bsky.embed.record') return quoteSummary(embed.record);
  if (type === 'app.bsky.embed.recordWithMedia') {
    return [embedSummary(embed.media), quoteSummary(embed.record?.record || embed.record)].filter(Boolean).join(' · ') || null;
  }
  return null;
}

function quoteSummary(record) {
  const uri = record?.uri;
  const kind = parseRecordUri(uri)?.kind;
  if (kind === 'feed') return 'Shares a feed';
  if (kind === 'list') return 'Shares a list';
  if (kind === 'starterpack') return 'Shares a starter pack';
  return uri ? 'Quotes a post' : null;
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * `{ uri, url, author, text, at, embed, counts, isReply }` for display.
 * `author` is null without a view; `counts` is null without one too, since
 * a bare record carries none. `compact` trims the text.
 */
export function postPreviewModel({ view = null, record = null, uri = null } = {}, { compact = false } = {}) {
  const rec = record || view?.record || null;
  const postUri = uri || view?.uri || null;
  const author = view?.author
    ? {
        did: view.author.did,
        handle: view.author.handle && view.author.handle !== 'handle.invalid' ? view.author.handle : null,
        displayName: view.author.displayName?.trim() || null,
        avatar: view.author.avatar || null,
      }
    : null;
  let text = typeof rec?.text === 'string' ? rec.text : '';
  const limit = compact ? 140 : PREVIEW_CHARS;
  if ([...text].length > limit) text = `${[...text].slice(0, limit - 1).join('').trimEnd()}…`;
  const counts = view
    ? {
        replies: view.replyCount || 0,
        reposts: view.repostCount || 0,
        likes: view.likeCount || 0,
        quotes: view.quoteCount || 0,
      }
    : null;
  return {
    uri: postUri,
    url: postUri ? bskyUrlFor(postUri, author?.handle) : null,
    author,
    text,
    at: rec?.createdAt || view?.indexedAt || null,
    embed: embedSummary(view?.embed) || embedSummary(rec?.embed),
    counts,
    isReply: Boolean(rec?.reply),
  };
}
