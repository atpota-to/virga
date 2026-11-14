/**
 * Inline links: `[label](url)` in the composer becomes `label` in the post,
 * with a link facet over it pointing at `url`. A link facet's text and its
 * `uri` are independent in the record, so this is ordinary rich text to every
 * reader; the markdown exists only in the composer.
 *
 * The textarea keeps the markdown while you write, because its overlay has to
 * match it character for character or the caret drifts. It collapses when the
 * post is written (`detectComposerFacets`), and a stored post reopened for
 * editing gets its markdown back (`composerTextFromRecord`).
 *
 * Two rules hold everywhere:
 * - Any word in a label that reads as a web address must name the site the
 *   link goes to. `[bsky.app](https://elsewhere.example)` is refused: it stays
 *   as typed, so it posts literally and the real address shows. (Bluesky's
 *   app asks readers to confirm any external link whose label isn't the
 *   destination's own address, `linkRequiresWarning` in social-app's
 *   url-helpers.ts; this refuses only labels that name another site.)
 * - An inline link never becomes a link card or a quote embed; the writer
 *   chose words over a preview.
 */

import { createByteMap } from './richText.js';
import { detectFacets } from './facets.js';
import { countGraphemes } from './graphemes.js';
import { isValidDomain } from './urlMatching.js';
import {
  expandLinkFacets,
  findShortenableLinks,
  respliceFacets,
  toShortUrl,
} from './linkShortening.js';

const LINK = 'app.bsky.richtext.facet#link';

/**
 * The address an inline link's `(…)` part points at, with `https://` added to
 * a bare domain, or null when it isn't an http(s) address on a real domain
 * (so `[a](b)` in ordinary prose stays prose).
 * @param {string} destination
 * @returns {string | null}
 */
export function linkDestination(destination) {
  if (!destination || destination.startsWith('/')) return null;
  let uri;
  if (/^https?:\/\//i.test(destination)) {
    uri = destination;
  } else if (
    /^[a-z][a-z0-9+.-]*:/i.test(destination) &&
    !/^[^:]+:\d/.test(destination)
  ) {
    return null; // another scheme (mailto:, at:, javascript:); a port after a bare host is fine
  } else {
    uri = `https://${destination}`;
  }
  let url;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!isValidDomain(url.hostname)) return null;
  return uri;
}

const bareHost = (host) => host.toLowerCase().replace(/^www\./, '');

// The domain a word starts with, past an opening bracket or quote, a scheme or
// an @: `bsky.app's` names bsky.app, `(https://bsky.app/x)` too.
const NAMED_DOMAIN =
  /^[(["'\u201C\u2018]*(?:https?:\/\/)?@?((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}\p{N}-]{2,})/iu;

/**
 * The hosts a label names: every word that reads as a web address or a handle
 * (a handle names the domain it is). Empty for a label that is just words.
 * @param {string} label
 * @returns {string[]}
 */
function namedHosts(label) {
  const hosts = [];
  for (const word of (label || '').split(/\s+/)) {
    const domain = word.match(NAMED_DOMAIN)?.[1];
    if (!domain || !isValidDomain(domain)) continue;
    try {
      hosts.push(new URL(`https://${domain}`).hostname);
    } catch {
      // Can't be normalized, so it can't be shown to match: compared as written.
      hosts.push(domain);
    }
  }
  return hosts;
}

/**
 * Whether text is a single web address (or handle), the selection a pasted
 * address should replace rather than link.
 * @param {string} text
 * @returns {boolean}
 */
export function isSingleAddress(text) {
  const words = (text || '').trim().split(/\s+/);
  return words.length === 1 && namedHosts(words[0]).length === 1;
}

/**
 * Whether a label names a different site than the link goes to: any word in
 * it that reads as a web address must name the link's own host. Hosts are
 * compared exactly apart from a leading `www.`; a subdomain is a different
 * host, because on shared suffixes (github.io and the like) it is a different
 * owner.
 * @param {string} label
 * @param {string} uri
 * @returns {boolean}
 */
export function labelMisleads(label, uri) {
  const named = namedHosts(label);
  if (named.length === 0) return false;
  let host;
  try {
    host = bareHost(new URL(uri).hostname);
  } catch {
    return true;
  }
  return named.some((name) => bareHost(name) !== host);
}

/** The inline link whose `[` is at `open`, or null. */
function parseAt(text, open) {
  let close = -1;
  for (let k = open + 1; k < text.length; k++) {
    const ch = text[k];
    if (ch === ']') {
      close = k;
      break;
    }
    if (ch === '[' || ch === '\n') return null;
  }
  if (close === -1 || text[close + 1] !== '(') return null;
  const label = text.slice(open + 1, close);
  if (!label.trim()) return null;

  // Balanced parentheses, so `en.wikipedia.org/wiki/Bee_(disambiguation)` works.
  let depth = 1;
  let end = -1;
  for (let k = close + 2; k < text.length; k++) {
    const ch = text[k];
    if (/\s/.test(ch)) return null;
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) {
      end = k + 1;
      break;
    }
  }
  if (end === -1) return null;

  const uri = linkDestination(text.slice(close + 2, end - 1));
  if (!uri) return null;
  return {
    start: open,
    end,
    labelStart: open + 1,
    labelEnd: close,
    label,
    uri,
    misleading: labelMisleads(label, uri),
  };
}

/**
 * Every `[label](url)` in `text`, in order and never overlapping. Character
 * offsets are into `text`. Misleading ones are included with `misleading:
 * true` so the composer can say why they won't become links.
 * @param {string} text
 * @returns {Array<{ start: number, end: number, labelStart: number, labelEnd: number, label: string, uri: string, misleading: boolean }>}
 */
export function findInlineLinks(text) {
  const links = [];
  if (!text || !text.includes('](')) return links;
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('[', i);
    if (open === -1) break;
    const link = parseAt(text, open);
    if (link) {
      links.push(link);
      i = link.end;
    } else {
      i = open + 1;
    }
  }
  return links;
}

/**
 * `text` with each inline link replaced by its label. `links` gives each
 * label's character range in the returned text. Misleading links stay as typed.
 * @param {string} text
 * @returns {{ text: string, links: Array<{ charStart: number, charEnd: number, label: string, uri: string }> }}
 */
export function collapseInlineLinks(text) {
  const found = findInlineLinks(text).filter((link) => !link.misleading);
  if (found.length === 0) return { text: text || '', links: [] };

  let out = '';
  let cursor = 0;
  const links = [];
  for (const link of found) {
    out += text.slice(cursor, link.start);
    const charStart = out.length;
    out += link.label;
    links.push({
      charStart,
      charEnd: out.length,
      label: link.label,
      uri: link.uri,
    });
    cursor = link.end;
  }
  return { text: out + text.slice(cursor), links };
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

function linkFacet(byteStart, byteEnd, uri) {
  return {
    $type: 'app.bsky.richtext.facet',
    features: [{ $type: LINK, uri }],
    index: { byteStart, byteEnd },
  };
}

/**
 * Folds inline links into a facet-detection result for the same `text`.
 * Anything detected inside a link's range is dropped (facets may not overlap,
 * and a URL there must not become a card or a quote), and each link gets a
 * facet over its label.
 *
 * @param {string} text - the text `result` was detected on
 * @param {Array<{ start: number, end: number, labelStart: number, labelEnd: number, uri: string }>} ranges
 *   character ranges in `text`: `start`/`end` is what to clear, the label is what to link
 * @param {{ facets?: Array, postEmbeds?: Array, externalLinks?: Array }} result
 * @returns {{ facets: Array, postEmbeds: Array, externalLinks: Array }}
 */
export function applyInlineLinks(text, ranges, result) {
  const facets = result?.facets || [];
  const postEmbeds = result?.postEmbeds || [];
  const externalLinks = result?.externalLinks || [];
  if (ranges.length === 0) return { facets, postEmbeds, externalLinks };

  const byteMap = createByteMap(text);
  const byteRanges = ranges.map((r) => ({
    start: byteMap[r.start],
    end: byteMap[r.end],
  }));
  const clearOf = (start, end) =>
    !byteRanges.some((r) => overlaps(start, end, r.start, r.end));
  const charClearOf = (start, end) =>
    !ranges.some((r) => overlaps(start, end, r.start, r.end));

  const kept = facets.filter((f) =>
    clearOf(f.index.byteStart, f.index.byteEnd),
  );
  const added = ranges.map((r) =>
    linkFacet(byteMap[r.labelStart], byteMap[r.labelEnd], r.uri),
  );

  return {
    facets: [...kept, ...added].sort(
      (a, b) => a.index.byteStart - b.index.byteStart,
    ),
    postEmbeds: postEmbeds.filter((e) => charClearOf(e.charStart, e.charEnd)),
    externalLinks: externalLinks.filter((l) =>
      charClearOf(l.charStart, l.charEnd),
    ),
  };
}

/**
 * Facet detection for the composer's text, inline links included: the text is
 * collapsed first and everything is detected on what will be written.
 *
 * @param {string} text - the composer's text, markdown and all
 * @param {object} [options] - as `detectFacets`: `resolveMention`,
 *   `skipMentionResolution`, `validatedHandles`, `invalidatedHandles`
 * @returns {Promise<{ text: string, facets: Array, postEmbeds: Array, externalLinks: Array }>}
 *   `text` is what the record carries before link shortening; `facets` index into it
 */
export async function detectComposerFacets(text, options = {}) {
  const collapsed = collapseInlineLinks(text);
  const result = await detectFacets(collapsed.text, options);
  const ranges = collapsed.links.map((l) => ({
    start: l.charStart,
    end: l.charEnd,
    labelStart: l.charStart,
    labelEnd: l.charEnd,
    uri: l.uri,
  }));
  return {
    ...result,
    text: collapsed.text,
    ...applyInlineLinks(collapsed.text, ranges, result),
  };
}

/**
 * The text the 300-grapheme cap will measure: inline links collapsed to their
 * labels, then shortened exactly as `shortenLinkFacets` will write it. A label
 * that is itself an address shortens like any link; an address that merely
 * sits inside a label is left whole, as the writer leaves it.
 * @param {string} text - the composer's text
 * @returns {string}
 */
export function composerCountText(text) {
  const { text: collapsed, links } = collapseInlineLinks(text);
  const spans = [
    ...findShortenableLinks(collapsed)
      .filter(
        (s) =>
          !links.some((l) =>
            overlaps(s.charStart, s.charEnd, l.charStart, l.charEnd),
          ),
      )
      .map((s) => ({
        charStart: s.charStart,
        charEnd: s.charEnd,
        replacement: toShortUrl(s.matchText),
      })),
    ...links.map((l) => ({
      charStart: l.charStart,
      charEnd: l.charEnd,
      replacement: toShortUrl(l.label),
    })),
  ].sort((a, b) => a.charStart - b.charStart);

  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += collapsed.slice(cursor, span.charStart) + span.replacement;
    cursor = span.charEnd;
  }
  return out + collapsed.slice(cursor);
}

/**
 * The composer's length against the 300-grapheme cap, inline links included.
 * @param {string} text
 * @returns {number}
 */
export function countComposerGraphemes(text) {
  return countGraphemes(composerCountText(text || ''));
}

/** A destination written so the parser reads it back whole. */
function markdownDestination(uri) {
  let depth = 0;
  for (const ch of uri) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) break;
  }
  return depth === 0 ? uri : uri.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * A stored post's text as the composer should hold it: shortened links
 * expanded (`expandLinkFacets`), and every link whose text isn't its own
 * address turned back into `[label](uri)`. Without this, reopening a post
 * would keep the label and silently lose the link.
 *
 * A link that couldn't be read back (a label with brackets or a line break,
 * an address that isn't http(s)) is left as plain text.
 * @param {string} text - the record's text
 * @param {Array} facets - the record's facets
 * @returns {string}
 */
export function composerTextFromRecord(text, facets) {
  const expanded = expandLinkFacets(text || '', facets);
  return respliceFacets(expanded.text, expanded.facets, (covered, facet) => {
    const uri = facet?.features?.find((f) => f?.$type === LINK)?.uri;
    if (!uri) return null;
    // How facet detection writes a link it found in the text.
    if (uri === covered || uri === `https://${covered}`) return null;
    if (!covered.trim() || /[[\]\n]/.test(covered)) return null;
    const destination = markdownDestination(uri);
    const markdown = `[${covered}](${destination})`;
    const reread = findInlineLinks(markdown)[0];
    return reread && reread.start === 0 && reread.end === markdown.length
      ? markdown
      : null;
  }).text;
}
