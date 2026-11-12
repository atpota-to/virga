/**
 * What counts as a URL in post text. Shared by facet detection (facets.js) and
 * length counting (linkShortening.js), which must agree or the composer's
 * character count stops matching the written post. Both read URLs through
 * findUrlsAndMentions, never the raw regex.
 */

import { findMentions } from './mentions.js';

/**
 * A fresh URL matcher each call: the regex is `/g`, so a shared instance's
 * `lastIndex` would leak between callers. Matches protocol URLs and bare
 * domains, stopping at whitespace, quotes and `,;!…`. A hit can still end in
 * sentence punctuation; trimUrlMatch takes that off.
 * @returns {RegExp}
 */
export function createUrlRegex() {
  return /https?:\/\/[^\s,;!…"\u201C\u201D]+?(?=[,;!…"\u201C\u201D\s]|$)|(?:www\.)?[a-zA-Z0-9]+(?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.(?:[a-zA-Z]{2,}|xn--[a-zA-Z0-9]+)(?:\/[^\s,;!…"\u201C\u201D]*)?(?:\?[^\s,;!…"\u201C\u201D]*)?(?:#[^\s,;!…"\u201C\u201D]*)?(?=[.,;!…"\u201C\u201D\s]|$)/gi;
}

const count = (text, ch) => text.split(ch).length - 1;

/**
 * A regex hit without the punctuation that ends the sentence around it, as
 * Bluesky's detector trims it: a run of `.,;:!?`, a `)` or `]` with no partner
 * inside the URL, and a closing `>` or markdown `*`. Left on, the character
 * becomes part of the facet's address, and shortening then rewrites it away
 * (`new URL()` drops an empty `?` query or `:` port), so it vanishes from the
 * post.
 * @param {string} matchText
 * @returns {string}
 */
export function trimUrlMatch(matchText) {
  let out = matchText;
  for (;;) {
    const last = out[out.length - 1];
    if (/[.,;:!?>*]/.test(last)) {
      out = out.slice(0, -1);
    } else if (last === ')' && count(out, ')') > count(out, '(')) {
      out = out.slice(0, -1);
    } else if (last === ']' && count(out, ']') > count(out, '[')) {
      out = out.slice(0, -1);
    } else {
      return out;
    }
  }
}

/**
 * The URLs in `text`, trimmed, and the mentions and email addresses that stand
 * apart from them. An `@` inside a URL that started before it
 * (`?email=reader@example.org`, `?u=@alice.example.com`) belongs to the URL,
 * as on Bluesky, where a mention only starts a word. An address's own domain
 * half (`reader@example.org`) is a URL hit that starts after the `@`, so the
 * address keeps it and it stays unlinked.
 *
 * @param {string} text
 * @returns {{
 *   urls: Array<{ charStart: number, charEnd: number, matchText: string, rawEnd: number }>,
 *   mentions: Array<{ start: number, end: number, handle: string, email: boolean }>,
 * }} `rawEnd` is where the untrimmed hit ended, for telling whether the URL is
 *   finished (followed by whitespace or the end of the text).
 */
export function findUrlsAndMentions(text) {
  const urls = [];
  const regex = createUrlRegex();
  let match;
  while ((match = regex.exec(text)) !== null) {
    const matchText = trimUrlMatch(match[0]);
    if (!matchText) continue;
    const charStart = match.index;
    urls.push({
      charStart,
      charEnd: charStart + matchText.length,
      matchText,
      rawEnd: charStart + match[0].length,
    });
  }
  const mentions = findMentions(text).filter(
    ({ start }) =>
      !urls.some((url) => url.charStart < start && start < url.charEnd),
  );
  return { urls, mentions };
}

/**
 * Whether a (deliberately loose) regex hit is a real domain, not a version
 * number, IP or filename like `v1.2.3` or `notes.txt`.
 * @param {string} domain - the matched text, with or without protocol
 * @returns {boolean}
 */
export function isValidDomain(domain) {
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');

  const domainOnly = cleanDomain.split('/')[0];

  const parts = domainOnly.split('.');

  if (parts.length < 2) return false;

  const nonDomainPatterns = [
    /^v?\d+\.\d+/, // Version numbers like v1.2.3, 1.0.0
    /^\d+\.\d+\.\d+\.\d+$/, // IP addresses
    /^[a-zA-Z0-9]+\.(txt|jpg|jpeg|png|gif|pdf|doc|docx|zip|rar|tar|gz|mp3|mp4|avi|mov|css|js|json|xml|html|htm)$/, // Common file extensions
  ];

  for (const pattern of nonDomainPatterns) {
    if (pattern.test(domainOnly)) return false;
  }

  const tld = parts[parts.length - 1];
  if (tld.length < 2 || /^\d+$/.test(tld)) return false;

  const domainName = parts[parts.length - 2];
  if (domainName.length < 1 || domainName.length > 63) return false;

  return true;
}

/**
 * Whether a match directly follows an opening double quote, straight or curly.
 * A quoted URL (`"example.com" is taken`) gets no facet, so it isn't shortened
 * either.
 * @param {string} text
 * @param {number} charStart - index the match begins at
 * @returns {boolean}
 */
export function isPrecededByQuote(text, charStart) {
  const charBefore = charStart > 0 ? text[charStart - 1] : '';
  return charBefore === '"' || charBefore === '\u201C';
}
