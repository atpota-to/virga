// Hashtags in post text, by Bluesky's rule (the `TAG_REGEX` in @atproto/api's
// rich-text detection): a # or ＃ at the start or after whitespace, then any
// run of letters, marks, symbols and digits that isn't all digits, with
// trailing punctuation dropped, at most 64 graphemes. So `#café` and `#日本`
// are tags, `#123` and `#` are not.

import { countGraphemes } from './graphemes.js';

export const MAX_HASHTAG_GRAPHEMES = 64;

// U+FE0F is the emoji presentation selector, so a keycap emoji (# U+FE0F
// U+20E3) isn't a tag; the rest are zero-width characters that end a tag.
const TAG_REGEX =
  // eslint-disable-next-line no-misleading-character-class
  /(^|\s)[#＃]((?!\uFE0F)[^\s\u00AD\u2060\u200A\u200B\u200C\u200D\u20E2]*[^\d\s\p{P}\u00AD\u2060\u200A\u200B\u200C\u200D\u20E2]+[^\s\u00AD\u2060\u200A\u200B\u200C\u200D\u20E2]*)?/gu;
const TRAILING_PUNCTUATION = /\p{P}+$/u;

/**
 * Every hashtag in `text`, as `{ start, end, tag }`: `start` is the `#`,
 * `end` is just past the tag (UTF-16 indices), `tag` is without the `#`.
 * @param {string} text
 * @returns {Array<{ start: number, end: number, tag: string }>}
 */
export function findHashtags(text) {
  const found = [];
  if (!text) return found;
  // matchAll works on a copy of the regex, so its lastIndex never leaks.
  for (const match of text.matchAll(TAG_REGEX)) {
    const [, leading, raw] = match;
    if (!raw) continue;
    const tag = raw.trim().replace(TRAILING_PUNCTUATION, '');
    if (!isValidHashtag(tag)) continue;
    const start = match.index + leading.length;
    found.push({ start, end: start + 1 + tag.length, tag });
  }
  return found;
}

/**
 * Whether `tag` (without its `#`) is one Bluesky would facet: non-empty, not
 * all digits, no whitespace, at most 64 graphemes.
 * @param {string} tag
 */
export function isValidHashtag(tag) {
  if (typeof tag !== 'string' || !tag || /\s/.test(tag)) return false;
  if (/^\d+$/.test(tag)) return false;
  return countGraphemes(tag) <= MAX_HASHTAG_GRAPHEMES;
}
