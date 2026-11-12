// Compose-intent links: a public URL that opens the composer prefilled.
//
//     https://<virga>/intent/compose?text=hello&url=https://example.com&tags=a,b
//
// Mirrors Bluesky's intent links
// (https://docs.bsky.app/docs/advanced-guides/intent-links), so callers only
// swap the host; `url` and `tags` are additions. Other people's links depend on
// this surface, so keep the parameter set small and stable.
//
// An intent never posts. Every value comes from whoever wrote the link, so it
// only fills a draft the person must still send; all input is bounded and
// sanitized for the same reason.

import { sanitizeText } from './richText.js';
import { countGraphemes, truncateGraphemes } from './graphemes.js';
import { normalizeTags } from './tags.js';

/** The canonical path. */
export const INTENT_COMPOSE_PATH = '/intent/compose';

/** The post limit in graphemes; intent text is clamped so it arrives postable. */
export const MAX_POST_GRAPHEMES = 300;

/**
 * Recognized parameters; anything else is ignored. `title` is only a fallback
 * for `text`: an OS share sheet sends them separately, and a title-only share
 * should still prefill something.
 */
export const COMPOSE_INTENT_PARAMS = ['text', 'url', 'tags', 'title'];

const EMPTY_INTENT = Object.freeze({
  hasIntent: false,
  text: '',
  url: '',
  tags: Object.freeze([]),
  truncated: false,
});

/** URLSearchParams, a query string, a full URL or a plain object. */
function toSearchParams(source) {
  if (!source) return new URLSearchParams();
  if (source instanceof URLSearchParams) return source;
  if (typeof source === 'string') {
    const queryStart = source.indexOf('?');
    return new URLSearchParams(
      queryStart >= 0 ? source.slice(queryStart + 1) : source,
    );
  }
  if (typeof source === 'object') {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(source)) {
      if (value != null) params.append(key, String(value));
    }
    return params;
  }
  return new URLSearchParams();
}

/** Only http(s) URLs survive; anything else is dropped outright, not escaped. */
function normalizeUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

/**
 * Join `text` and `url` within the post limit. The prose gives way and the URL
 * stays whole, unless the URL alone can't fit.
 */
function joinWithinLimit(text, url) {
  if (!url || text.includes(url)) {
    const clamped = truncateGraphemes(text, MAX_POST_GRAPHEMES);
    return { body: clamped, truncated: clamped !== text };
  }
  if (!text) {
    const clamped = truncateGraphemes(url, MAX_POST_GRAPHEMES);
    return { body: clamped, truncated: clamped !== url };
  }

  const separator = '\n\n';
  const budget =
    MAX_POST_GRAPHEMES - countGraphemes(url) - countGraphemes(separator);
  if (budget <= 0) {
    return {
      body: truncateGraphemes(url, MAX_POST_GRAPHEMES),
      truncated: true,
    };
  }
  const trimmedText = truncateGraphemes(text, budget);
  return {
    body: `${trimmedText}${separator}${url}`,
    truncated: trimmedText !== text,
  };
}

/**
 * Read a compose intent.
 *
 * `text` is the post text to open with: the prose with the link joined below
 * it, within the post limit. `url` is the link on its own (for a link card),
 * `tags` the normalized tags (at most 8), and `truncated` says the limit forced
 * a cut. `hasIntent: false` when nothing usable was given.
 *
 * @param {URLSearchParams|string|Object|null} search
 * @returns {{ hasIntent: boolean, text: string, url: string, tags: string[], truncated: boolean }}
 */
export function parseComposeIntent(search) {
  const params = toSearchParams(search);
  if (!COMPOSE_INTENT_PARAMS.some((key) => params.has(key)))
    return EMPTY_INTENT;

  // `title` only when `text` is empty (a share with both usually repeats itself).
  const text = sanitizeText(
    params.get('text') || params.get('title') || '',
  ).trim();
  const url = normalizeUrl(params.get('url'));
  const tags = normalizeTags(params.get('tags'));
  const { body, truncated } = joinWithinLimit(text, url);

  if (!body && tags.length === 0) return EMPTY_INTENT;
  return { hasIntent: true, text: body, url, tags, truncated };
}

/**
 * The inverse of parseComposeIntent. Omits empty parameters and puts `text`
 * first (the Bluesky-compatible part).
 *
 * @param {{ text?: string, url?: string, tags?: string|string[] }} intent
 * @param {string} [origin] - defaults to the current origin in a browser
 * @returns {string}
 */
export function buildComposeIntentUrl(intent = {}, origin) {
  const base =
    origin ||
    (typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost');
  const target = new URL(INTENT_COMPOSE_PATH, base);
  const { text, url, tags } = intent;

  if (text) target.searchParams.set('text', text);
  if (url) target.searchParams.set('url', url);
  const tagList = Array.isArray(tags) ? tags.join(', ') : tags;
  if (tagList) target.searchParams.set('tags', tagList);

  return target.toString();
}
