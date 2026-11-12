/**
 * What counts as a URL in post text. Shared by facet detection
 * (optimizedFacetDetection) and length counting (linkShortening), which must
 * agree or the composer's character count stops matching the written post.
 */

/**
 * A fresh URL matcher each call: the regex is `/g`, so a shared instance's
 * `lastIndex` would leak between callers. Matches protocol URLs and bare
 * domains; trailing punctuation and quotes are excluded.
 * @returns {RegExp}
 */
export function createUrlRegex() {
  return /https?:\/\/[^\s,;!…"\u201C\u201D]+?(?=[,;!…"\u201C\u201D\s]|$)|(?:www\.)?[a-zA-Z0-9]+(?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.(?:[a-zA-Z]{2,}|xn--[a-zA-Z0-9]+)(?:\/[^\s,;!…"\u201C\u201D]*)?(?:\?[^\s,;!…"\u201C\u201D]*)?(?:#[^\s,;!…"\u201C\u201D]*)?(?=[.,;!…"\u201C\u201D\s]|$)/gi;
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
