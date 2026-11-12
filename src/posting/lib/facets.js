// Facet detection for post text: mentions, links and hashtags, as the byte
// ranges a record carries. Live (while typing) it skips the network and marks
// mentions with stand-in DIDs for highlighting; on submit every mention is
// resolved and an unresolvable one gets no facet.
//
// Inline links (`[label](url)`) are collapsed before this runs
// (inlineLinks.js), so this detector never sees the markdown.

import { createByteMap } from './richText.js';
import { detectPostLink } from './postLink.js';
import {
  createUrlRegex,
  isValidDomain,
  isPrecededByQuote,
} from './urlMatching.js';
import {
  findMentions,
  resolveMention as defaultResolveMention,
} from './mentions.js';
import { findHashtags } from './hashtags.js';

const MENTION = 'app.bsky.richtext.facet#mention';
const LINK = 'app.bsky.richtext.facet#link';
const TAG = 'app.bsky.richtext.facet#tag';

// What the last submit learned about each handle, so the live preview can
// highlight a handle it already knows resolves (or knows doesn't).
const validatedMentions = new Map(); // handle -> { did: string | null, timestamp }
const VALIDATION_CACHE_TTL = 5 * 60 * 1000;

const facet = (byteStart, byteEnd, feature) => ({
  $type: 'app.bsky.richtext.facet',
  features: [feature],
  index: { byteStart, byteEnd },
});

/**
 * Whether a match is the whole content of a quoted string (allowing a
 * domain/NSID-like continuation), in which case it gets no facet. Curly quotes
 * count as quotes too.
 */
function isExactlyQuoted(text, matchStart, matchEnd, matchText, allowPrefix) {
  const charBefore = matchStart > 0 ? text[matchStart - 1] : '';
  if (charBefore !== '"' && charBefore !== '“') return false;

  const openQuotePos = matchStart - 1;
  const closeQuoteChar = text[openQuotePos] === '“' ? '”' : '"';

  let closeQuotePos = -1;
  for (let i = openQuotePos + 1; i < text.length; i++) {
    if (text[i] === closeQuoteChar || text[i] === '"') {
      closeQuotePos = i;
      break;
    }
  }
  if (closeQuotePos === -1) return false;

  const quotedContent = text.substring(openQuotePos + 1, closeQuotePos);
  const trimmedQuoted = quotedContent.trim();
  const trimmedMatch = matchText.trim();
  if (!allowPrefix) return trimmedQuoted === trimmedMatch;

  const matchStartInQuote = quotedContent.indexOf(trimmedMatch);
  const isAtStart =
    matchStartInQuote === 0 ||
    (matchStartInQuote > 0 &&
      quotedContent.substring(0, matchStartInQuote).trim() === '');
  const isExactMatch = trimmedQuoted === trimmedMatch;
  const isValidPrefix =
    isAtStart &&
    trimmedQuoted.startsWith(trimmedMatch) &&
    /^[a-zA-Z0-9./-]*$/.test(trimmedQuoted.substring(trimmedMatch.length));
  const matchEndsAtQuote =
    matchEnd >= closeQuotePos ||
    text.substring(matchEnd, closeQuotePos).trim() === '';

  return (isExactMatch || isValidPrefix) && matchEndsAtQuote;
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/**
 * Detect mentions, links and hashtags in `text`.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {(handle: string) => Promise<string|null>} [options.resolveMention]
 *   handle → DID, used on submit; defaults to the public AppView
 * @param {boolean} [options.skipMentionResolution] - true while typing: mentions
 *   get cached, `validated:` or `placeholder:` DIDs instead of a lookup
 * @param {Set<string>} [options.validatedHandles] - handles known to resolve
 * @param {Set<string>} [options.invalidatedHandles] - handles known not to (no facet)
 * @returns {Promise<{ facets: Array, postEmbeds: Array, externalLinks: Array, displayText: string, markdownLinks: [] }>}
 *   `postEmbeds` are record links (post, feed, list, starter pack);
 *   `externalLinks` are link-card candidates, offered only once the URL is
 *   complete (followed by whitespace or the end of the text)
 */
export async function detectFacets(text, options = {}) {
  const {
    resolveMention = defaultResolveMention,
    skipMentionResolution = false,
    validatedHandles = new Set(),
    invalidatedHandles = new Set(),
  } = options;
  const facets = [];
  const postEmbeds = [];
  const externalLinks = [];

  // Plain text exits early: a mention needs '@', a hashtag '#' or '＃', and a
  // link a protocol or a word.word domain ('[' is for inline links).
  if (!/[@#＃[]|https?:\/\//i.test(text) && !/\b\w+\.\w{2,}\b/.test(text)) {
    return {
      facets,
      postEmbeds,
      externalLinks,
      displayText: text,
      markdownLinks: [],
    };
  }

  const byteMap = createByteMap(text);

  const cachedDid = (handle) => {
    const cached = validatedMentions.get(handle);
    if (cached && Date.now() - cached.timestamp < VALIDATION_CACHE_TTL)
      return cached;
    return null;
  };

  // Ranges claimed by mentions (and email addresses), so URL detection
  // doesn't link a handle's or an address's domain half.
  const coveredRanges = [];
  const pendingMentions = [];

  for (const { start, end, handle, email } of findMentions(text)) {
    coveredRanges.push({ start, end });
    if (email) continue;
    if (isExactlyQuoted(text, start, end, text.substring(start, end), true))
      continue;

    const byteStart = byteMap[start];
    const byteEnd = byteMap[end];

    if (skipMentionResolution) {
      const cached = cachedDid(handle);
      if (
        cached
          ? cached.did !== null
          : validatedHandles.has(handle) && !invalidatedHandles.has(handle)
      ) {
        const did = cached ? cached.did : `validated:${handle}`;
        facets.push(facet(byteStart, byteEnd, { $type: MENTION, did }));
      } else if (!cached && !invalidatedHandles.has(handle)) {
        // A stand-in for the preview. A known-bad handle gets none, whether
        // the caller says so or the last submit found it doesn't resolve.
        facets.push(
          facet(byteStart, byteEnd, {
            $type: MENTION,
            did: `placeholder:${handle}`,
          }),
        );
      }
    } else {
      pendingMentions.push({ handle, byteStart, byteEnd });
    }
  }

  if (pendingMentions.length > 0) {
    // In parallel, one request per distinct handle; a failure drops that
    // mention's facet, never the post.
    const handles = [...new Set(pendingMentions.map((m) => m.handle))];
    const dids = new Map(
      await Promise.all(
        handles.map(async (handle) => {
          let did = null;
          try {
            did = (await resolveMention(handle)) || null;
          } catch {
            did = null;
          }
          validatedMentions.set(handle, { did, timestamp: Date.now() });
          return [handle, did];
        }),
      ),
    );
    for (const { handle, byteStart, byteEnd } of pendingMentions) {
      const did = dids.get(handle);
      if (did) facets.push(facet(byteStart, byteEnd, { $type: MENTION, did }));
    }
  }

  const isRangeCovered = (start, end) =>
    coveredRanges.some((range) => overlaps(start, end, range.start, range.end));

  // Shared with the character counter, which must shorten exactly the spans
  // that become link facets (urlMatching.js).
  const urlRegex = createUrlRegex();
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const matchText = match[0];
    const charStart = match.index;
    const charEnd = charStart + matchText.length;

    if (isRangeCovered(charStart, charEnd)) continue;
    if (isPrecededByQuote(text, charStart)) continue;
    if (isExactlyQuoted(text, charStart, charEnd, matchText, false)) continue;

    const fullUrl = /^https?:\/\//.test(matchText)
      ? matchText
      : `https://${matchText}`;

    // "Complete" = followed by whitespace or the end of the text, so cards
    // aren't fetched while the URL is still being typed.
    const charAfterUrl = text[charEnd];
    const isUrlComplete = !charAfterUrl || /\s/.test(charAfterUrl);
    const byteStart = byteMap[charStart];
    const byteEnd = byteMap[charEnd];

    const recordLink = detectPostLink(fullUrl);
    if (recordLink) {
      // A record link embeds at once, before a trailing space: it is
      // recognisable whole, unlike a page whose path may still be growing.
      postEmbeds.push({
        ...recordLink,
        charStart,
        charEnd,
        byteStart,
        byteEnd,
      });
      facets.push(facet(byteStart, byteEnd, { $type: LINK, uri: fullUrl }));
      continue;
    }

    if (!isValidDomain(matchText)) continue;

    facets.push(facet(byteStart, byteEnd, { $type: LINK, uri: fullUrl }));
    if (isUrlComplete) {
      externalLinks.push({
        url: fullUrl,
        charStart,
        charEnd,
        byteStart,
        byteEnd,
      });
    }
  }

  // Facets may not overlap, so a tag that runs into a link or a mention
  // (`#example.com`) is left to that facet.
  for (const { start, end, tag } of findHashtags(text)) {
    const byteStart = byteMap[start];
    const byteEnd = byteMap[end];
    const clash = facets.some((f) =>
      overlaps(byteStart, byteEnd, f.index.byteStart, f.index.byteEnd),
    );
    if (clash) continue;
    facets.push(facet(byteStart, byteEnd, { $type: TAG, tag }));
  }

  facets.sort((a, b) => a.index.byteStart - b.index.byteStart);

  return {
    facets,
    postEmbeds,
    externalLinks,
    displayText: text,
    markdownLinks: [],
  };
}

/**
 * `detectFacets` with positional arguments, the shape the composer's live
 * preview has always called.
 */
export function detectAndCreateFacetsOptimized(
  text,
  skipMentionResolution = false,
  validatedHandles = new Set(),
  invalidatedHandles = new Set(),
  { resolveMention } = {},
) {
  return detectFacets(text, {
    skipMentionResolution,
    validatedHandles,
    invalidatedHandles,
    ...(resolveMention ? { resolveMention } : {}),
  });
}
