/**
 * Link shortening, as Bluesky does it. Before writing a post, Bluesky replaces
 * each link facet's covered *text* with a short form (scheme dropped, path
 * clipped) and leaves the facet's `uri` pointing at the full address, so a URL
 * costs far less than its length against the 300-grapheme cap. Counting and
 * writing must use the same rule: count what you'll write, write what you counted.
 *
 * Ported from bluesky-social/social-app: `toShortUrl` (src/lib/strings/url-helpers.ts)
 * and `shortenLinks` (src/lib/strings/rich-text-manip.ts), which its composer
 * uses for the count (`getShortenedLength`) and in `resolveRT` before writing.
 *
 * Only explicit-protocol URLs shorten: `new URL()` throws on a bare domain, so
 * Bluesky leaves it full length. Mirrored deliberately; counting a bare domain
 * as cheaper would let someone compose a post the PDS refuses.
 */

import { countGraphemes } from './graphemes.js';
import {
  findUrlsAndMentions,
  isValidDomain,
  isPrecededByQuote,
} from './urlMatching.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * A URL as it should read in post text: no scheme, and a path clipped to 13
 * characters plus an ellipsis once it runs past 15. Anything that isn't an
 * http(s) URL comes back untouched.
 * @param {string} url
 * @returns {string}
 */
export function toShortUrl(url) {
  try {
    const urlp = new URL(url);
    if (urlp.protocol !== 'http:' && urlp.protocol !== 'https:') {
      return url;
    }
    const path =
      (urlp.pathname === '/' ? '' : urlp.pathname) + urlp.search + urlp.hash;
    if (path.length > 15) {
      return urlp.host + path.slice(0, 13) + '...';
    }
    return urlp.host + path;
  } catch {
    // No scheme, or otherwise unparseable — not something we can shorten.
    return url;
  }
}

/**
 * Spans of `text` that will become link facets and get shorter, for the live
 * character count (the debounced facet detector would lag the keystrokes).
 *
 * Conservative on purpose: every span must be one the detector would also
 * facet, or the count could pass a post the PDS rejects. Erring the other way
 * only shows a number a few characters high.
 * @param {string} text
 * @returns {Array<{ charStart: number, charEnd: number, matchText: string }>}
 */
export function findShortenableLinks(text) {
  if (!text || !text.includes('://')) return [];

  // The same URL/mention split facet detection uses, and the same skips: a
  // link a mention or address overlaps gets no facet there, so no shortening.
  const { urls, mentions } = findUrlsAndMentions(text);
  const spans = [];

  for (const { charStart, charEnd, matchText } of urls) {
    // Bare domains keep their full text (see the module note).
    if (!/^https?:\/\//i.test(matchText)) continue;

    if (mentions.some(({ start, end }) => start < charEnd && charStart < end))
      continue;
    if (isPrecededByQuote(text, charStart)) continue;
    if (!isValidDomain(matchText)) continue;
    if (toShortUrl(matchText) === matchText) continue;

    spans.push({ charStart, charEnd, matchText });
  }

  return spans;
}

/**
 * `text` with its links shortened — what the character count should measure.
 * @param {string} text
 * @returns {string}
 */
export function shortenPostText(text) {
  const links = findShortenableLinks(text);
  if (links.length === 0) return text || '';

  let out = '';
  let cursor = 0;
  for (const link of links) {
    out += text.slice(cursor, link.charStart) + toShortUrl(link.matchText);
    cursor = link.charEnd;
  }
  return out + text.slice(cursor);
}

/**
 * Length of a post as the lexicon's 300-grapheme cap will see it: links
 * shortened, then counted in grapheme clusters rather than UTF-16 units, so a
 * flag or a ZWJ family costs the one character a reader sees.
 * @param {string} text
 * @returns {number}
 */
export function countPostGraphemes(text) {
  return countGraphemes(shortenPostText(text));
}

/** The `uri` a link facet points at, or null if it isn't a link facet. */
function linkUri(facet) {
  const link = facet?.features?.find(
    (f) => f?.$type === 'app.bsky.richtext.facet#link',
  );
  return link?.uri || null;
}

/**
 * Rewrites the text each facet covers and moves every facet's byte range to
 * match. `replacementFor(coveredText, facet)` returns new text, or null to
 * leave it. Missing, out-of-order or overlapping facets return the input
 * untouched: a wrong splice corrupts the post, a longer post is the better failure.
 * @param {string} text
 * @param {Array} facets - byte-indexed against `text`
 * @param {(coveredText: string, facet: object) => string | null} replacementFor
 * @returns {{ text: string, facets: Array }}
 */
export function respliceFacets(text, facets, replacementFor) {
  const safeFacets = Array.isArray(facets) ? facets : [];
  if (!text || safeFacets.length === 0) {
    return { text: text || '', facets: safeFacets };
  }

  const bytes = encoder.encode(text);
  const ordered = [...safeFacets].sort(
    (a, b) => (a?.index?.byteStart ?? 0) - (b?.index?.byteStart ?? 0),
  );

  // Bail on anything that would make the splice ambiguous.
  const replacements = [];
  let previousEnd = 0;
  for (const facet of ordered) {
    const byteStart = facet?.index?.byteStart;
    const byteEnd = facet?.index?.byteEnd;
    if (!Number.isInteger(byteStart) || !Number.isInteger(byteEnd)) {
      return { text, facets: safeFacets };
    }
    if (
      byteStart < previousEnd ||
      byteEnd < byteStart ||
      byteEnd > bytes.length
    ) {
      return { text, facets: safeFacets };
    }
    previousEnd = byteEnd;

    const covered = decoder.decode(bytes.subarray(byteStart, byteEnd));
    const replacement = replacementFor(covered, facet);
    if (replacement === null || replacement === covered) continue;

    replacements.push({
      byteStart,
      byteEnd,
      bytes: encoder.encode(replacement),
    });
  }

  if (replacements.length === 0) return { text, facets: safeFacets };

  const pieces = [];
  let cursor = 0;
  for (const replacement of replacements) {
    pieces.push(
      bytes.subarray(cursor, replacement.byteStart),
      replacement.bytes,
    );
    cursor = replacement.byteEnd;
  }
  pieces.push(bytes.subarray(cursor));

  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const spliced = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    spliced.set(piece, offset);
    offset += piece.length;
  }

  // Shift every facet by the replacements that finished before it. A replaced
  // facet keeps its new start and takes the replacement's length; facets never
  // overlap (checked above), so nothing else falls inside a replaced range.
  const shiftAt = (byteOffset) => {
    let delta = 0;
    for (const replacement of replacements) {
      if (byteOffset < replacement.byteEnd) break;
      delta +=
        replacement.bytes.length -
        (replacement.byteEnd - replacement.byteStart);
    }
    return delta;
  };

  const shiftedFacets = ordered.map((facet) => {
    const { byteStart, byteEnd } = facet.index;
    const replacement = replacements.find(
      (r) => r.byteStart === byteStart && r.byteEnd === byteEnd,
    );
    const newStart = byteStart + shiftAt(byteStart);
    return {
      ...facet,
      index: {
        byteStart: newStart,
        byteEnd: replacement
          ? newStart + replacement.bytes.length
          : byteEnd + shiftAt(byteEnd),
      },
    };
  });

  return { text: decoder.decode(spliced), facets: shiftedFacets };
}

/**
 * Record side: each link facet's text becomes its short form; facet `uri`s keep
 * the full address. Driven by the resolved facets, not re-detection, so what's
 * written can't disagree with what was faceted.
 * @param {string} text
 * @param {Array} facets - resolved facets, byte-indexed against `text`
 * @returns {{ text: string, facets: Array }}
 */
export function shortenLinkFacets(text, facets) {
  return respliceFacets(text, facets, (covered, facet) => {
    if (!linkUri(facet)) return null;
    return toShortUrl(covered);
  });
}

/**
 * The inverse, for reopening a stored record in the composer: restores each
 * link's full address, or the next save re-detects the truncated stub as the
 * link. Only expands a facet whose text is exactly toShortUrl(uri), so
 * hand-written link text is left alone.
 * @param {string} text
 * @param {Array} facets - the stored record's facets
 * @returns {{ text: string, facets: Array }}
 */
export function expandLinkFacets(text, facets) {
  return respliceFacets(text, facets, (covered, facet) => {
    const uri = linkUri(facet);
    if (!uri || uri === covered) return null;
    return toShortUrl(uri) === covered ? uri : null;
  });
}
