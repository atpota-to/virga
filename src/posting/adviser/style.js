// Learning the writer's style for the adviser's proofread: their recent posts
// (replies included) are read from the public AppView and sent to the server,
// which answers with a short description of their deliberate habits
// (all-lowercase, "gonna", no full stops) so the proofread leaves them alone.
// The description is kept in the account's adviser setup
// (`writingChecks.styleProfile`) and sent with every proofread; the posts
// themselves aren't kept.

import { publicXrpc } from '../library/sources.js';
import { synthesizeStyle } from './aiService.js';
import { ADVISER_TEXT_LIMITS, normalizeStyleSampleSize } from './setup.js';

/** The server won't read a style from fewer posts than this. */
export const MIN_STYLE_POSTS = 5;

/** Nor from more than this. */
export const MAX_STYLE_POSTS = 500;

const PAGE_SIZE = 100;

// Pages are 100 items and reposts are dropped, so two extra pages still
// reach the target for someone who reposts a lot.
const pageBudgetFor = (target) => Math.ceil(target / PAGE_SIZE) + 2;

function styleError(code, message, extra = {}) {
  return Object.assign(new Error(message), {
    status: 0,
    code,
    detail: null,
    payload: null,
    ...extra,
  });
}

/**
 * The author's own post texts from a getAuthorFeed page: reposts and other
 * people's posts skipped, feed order (newest first).
 *
 * @param {Array} feed - getAuthorFeed items
 * @param {string} did - the author being learned from
 * @returns {string[]}
 */
export function extractStyleTexts(feed, did) {
  if (!Array.isArray(feed)) return [];
  return feed
    .filter((entry) => {
      if (entry?.reason?.$type === 'app.bsky.feed.defs#reasonRepost')
        return false;
      const text = entry?.post?.record?.text;
      return (
        entry?.post?.author?.did === did &&
        typeof text === 'string' &&
        !!text.trim()
      );
    })
    .map((entry) => entry.post.record.text.trim());
}

/**
 * Up to `sampleSize` of the account's recent post texts, newest first.
 * `onPage({ posts })` hears the running total after each page. Rejects with
 * `code: 'STYLE_FETCH_FAILED'` when the AppView can't be read, and
 * `code: 'not_enough_posts'` (the server's own) when there are fewer than
 * MIN_STYLE_POSTS, before anything is sent to the server.
 *
 * @param {string} did
 * @param {{ sampleSize?: number, onPage?: Function, fetch?: typeof fetch, signal?: AbortSignal }} [options]
 * @returns {Promise<string[]>}
 */
export async function fetchStylePostTexts(
  did,
  { sampleSize, onPage, fetch, signal } = {},
) {
  if (!did) throw styleError('NO_ACCOUNT', 'Choose an account to learn from.');
  const target = Math.min(
    normalizeStyleSampleSize(sampleSize),
    MAX_STYLE_POSTS,
  );
  const texts = [];
  let cursor;
  try {
    for (
      let page = 0;
      page < pageBudgetFor(target) && texts.length < target;
      page++
    ) {
      const body = await publicXrpc(
        'app.bsky.feed.getAuthorFeed',
        {
          actor: did,
          filter: 'posts_with_replies',
          limit: PAGE_SIZE,
          cursor,
        },
        { ...(fetch ? { fetch } : {}), signal },
      );
      texts.push(...extractStyleTexts(body?.feed, did));
      onPage?.({ posts: Math.min(texts.length, target) });
      cursor = body?.cursor;
      if (!cursor) break;
    }
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') throw err;
    throw styleError(
      'STYLE_FETCH_FAILED',
      'Couldn’t load your recent posts to learn from. Try again.',
      { cause: err },
    );
  }
  if (texts.length < MIN_STYLE_POSTS) {
    throw styleError(
      'not_enough_posts',
      `There aren’t enough posts to learn from yet. It needs at least ${MIN_STYLE_POSTS}.`,
      { found: texts.length, minimum: MIN_STYLE_POSTS },
    );
  }
  return texts.slice(0, target);
}

/**
 * A style reading from posts already gathered, so a dialog can gather once
 * and refine as often as the writer likes.
 *
 * @param {object} req - the posting account's Requester
 * @param {{ texts: string[], guidance?: string, previousSummary?: string, now?: Date, signal?: AbortSignal, store?: Storage }} options
 * @returns {Promise<{ summary: string, analyzedCount: number, updatedAt: string, usage? }>}
 */
export async function synthesizeStyleFromTexts(
  req,
  { texts, guidance, previousSummary, now = new Date(), signal, store } = {},
) {
  if (!Array.isArray(texts) || texts.length < MIN_STYLE_POSTS) {
    throw styleError(
      'not_enough_posts',
      `There aren’t enough posts to learn from yet. It needs at least ${MIN_STYLE_POSTS}.`,
      { found: texts?.length || 0, minimum: MIN_STYLE_POSTS },
    );
  }
  const result = await synthesizeStyle(
    req,
    {
      posts: texts.slice(0, MAX_STYLE_POSTS),
      guidance: (guidance || '')
        .trim()
        .slice(0, ADVISER_TEXT_LIMITS.styleGuidance),
      previousSummary: (previousSummary || '')
        .trim()
        .slice(0, ADVISER_TEXT_LIMITS.styleSummary),
    },
    { signal, store },
  );
  if (!result.summary) {
    throw styleError(
      'EMPTY_STYLE',
      'No style came back from that reading. Try again.',
    );
  }
  return {
    summary: result.summary.slice(0, ADVISER_TEXT_LIMITS.styleSummary),
    analyzedCount: result.analyzedCount,
    updatedAt: new Date(now).toISOString(),
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

/** fetchStylePostTexts then synthesizeStyleFromTexts, as the posting account. */
export async function learnWritingStyle(req, options = {}) {
  const { sampleSize, onPage, fetch, signal, ...rest } = options;
  const texts = await fetchStylePostTexts(req?.did, {
    sampleSize,
    onPage,
    fetch,
    signal,
  });
  return synthesizeStyleFromTexts(req, { ...rest, texts, signal });
}

/**
 * The `styleProfile` to keep from a reading and the writer's note on it
 * (kept so the next reading starts from it).
 */
export function styleProfileFrom(result, guidance = '') {
  return {
    summary: String(result?.summary || '').slice(
      0,
      ADVISER_TEXT_LIMITS.styleSummary,
    ),
    analyzedCount: Number.isFinite(result?.analyzedCount)
      ? Math.max(0, Math.floor(result.analyzedCount))
      : 0,
    updatedAt: typeof result?.updatedAt === 'string' ? result.updatedAt : '',
    guidance: String(guidance || '').slice(
      0,
      ADVISER_TEXT_LIMITS.styleGuidance,
    ),
  };
}

/** "Forget my style": the reading goes, the writer's own note stays. */
export function forgetStyleProfile(profile) {
  return {
    summary: '',
    analyzedCount: 0,
    updatedAt: '',
    guidance: String(profile?.guidance || '').slice(
      0,
      ADVISER_TEXT_LIMITS.styleGuidance,
    ),
  };
}
