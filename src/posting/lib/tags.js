// The post record's `tags` field: tags that travel with the post without
// appearing in its text. The lexicon allows 8, each at most 64 graphemes and
// 640 bytes; a record over either is refused by the PDS.

import { sanitizeText } from './richText.js';
import { truncateGraphemes } from './graphemes.js';

export const MAX_TAGS = 8;
export const MAX_TAG_GRAPHEMES = 64;
export const MAX_TAG_BYTES = 640;

const encoder = new TextEncoder();

function clampTag(tag) {
  let out = truncateGraphemes(tag, MAX_TAG_GRAPHEMES);
  // Graphemes made of many code points (ZWJ sequences) can still run past
  // the byte cap; give up whole graphemes until it fits.
  while (out && encoder.encode(out).length > MAX_TAG_BYTES) {
    const graphemes = [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
        out,
      ),
    ];
    out = graphemes
      .slice(0, -1)
      .map((g) => g.segment)
      .join('');
  }
  return out;
}

/**
 * Tags as the record should carry them: from a comma-separated string or an
 * array, each with hidden characters and leading `#`s removed and trimmed,
 * empty ones dropped, deduplicated without regard to case (the first spelling
 * wins), clamped to 64 graphemes, and at most 8.
 * @param {string | string[] | null | undefined} input
 * @returns {string[]}
 */
export function normalizeTags(input) {
  if (!input) return [];
  const pieces = Array.isArray(input) ? input : String(input).split(',');
  const seen = new Set();
  const tags = [];
  for (const piece of pieces) {
    if (typeof piece !== 'string') continue;
    const tag = clampTag(
      sanitizeText(piece)
        .trim()
        .replace(/^[#＃]+/, '')
        .trim(),
    );
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/** Tags as the comma-separated text a field shows. */
export function formatTags(tags) {
  return (Array.isArray(tags) ? tags : []).join(', ');
}
