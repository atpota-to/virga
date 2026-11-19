// src/posting/lib/urlMatching.js: what counts as a URL in post text, the
// trim of the sentence punctuation around it, the URL/mention split, the
// domain check and the quote check. Swift: VirgaPosting/Lib/UrlMatching.swift.
//
// Inputs from src/posting/lib/urlMatching.test.js and facets.test.js
// ("links", "straight and curly quotes"), plus case, IDN, xn--, ports,
// brackets, every stop character and the long-run guard.

import {
  createUrlRegex,
  findUrlsAndMentions,
  isPrecededByQuote,
  isValidDomain,
  trimUrlMatch,
} from '../../../src/posting/lib/urlMatching.js';
import { each } from './_helpers.js';

export const sources = ['src/posting/lib/urlMatching.js'];

const TEXTS = [
  '"see https://example.com/x" ok',
  '\u201Csee https://example.com/x\u201D ok',
  '"visit example.com/path"',
  '\u201Cvisit example.com/path\u201D',
  '"example.com"',
  '\u201Cexample.com\u201D',
  'see https://example.com/x, then example.org.',
  'https://example.com/subscribe?email=reader@example.org&u=@someone.example.com',
  'sign up https://example.com/subscribe?email=reader@example.org&u=@someone.example.com today',
  'hi @someone.example.com, mail reader@example.org',
  'Did you see https://example.com/page?',
  'see a-b.example.co.uk/path?x=1#top now',
  'www.example.com and sub.domain.example.org.',
  'xn--bcher-kva.example and a--b.example',
  'no-dot-here and trailing-.com',
  `${'z'.repeat(6000)} and then example.com`,
  'HTTPS://EXAMPLE.COM/PATH and HtTp://x.org',
  'WWW.EXAMPLE.COM',
  'example.COM example.c example.co example.123 example.xn--p1ai example.XN--P1AI',
  'https://bücher.de/x and bücher.de',
  'https://example.com:8080/x',
  'example.com:8080/x',
  'https://en.wikipedia.org/wiki/Moth_(insect)).',
  '(https://example.com/page) or <https://example.com/x>',
  '[link](https://example.com/a)',
  'https://example.com/a!b;c,d…e"f\u201Cg\u201Dh',
  'example.com!x example.com;x example.com,x example.com…x',
  'example.com/a?b#c.d',
  'example.com/#frag?q',
  'v1.2.3 released and notes.txt and 192.168.0.1',
  'https://',
  'https://.',
  'https://a',
  'http://x',
  'a.co #owl',
  'go example.com now',
  'go "example.com" now',
  'https://example.com/a*b**',
  'https://example.com/:',
  'see https://example.com/page...',
  'mail me@example.com or @alice.test',
  'https://example.com/@eupackardia.test/repo',
  'x https://bsky.app/profile/a.test/post/3k,y',
  'end.Next and abc.de§§§',
  'a.b.c.d.e.f.g.h.i.j.k',
  'a\u00A0example.com\u2028b.org\u3000c.net\uFEFFd.io',
  'tab\texample.com\nnext.org\r',
  '',
];

const TRIMS = [
  'https://example.com/page?',
  'https://example.com:',
  'https://example.com/page.',
  'https://example.com/page...',
  'https://example.com/x>',
  'https://example.com/x**',
  'example.com/page).',
  'https://en.wikipedia.org/wiki/Moth_(insect)',
  'https://en.wikipedia.org/wiki/Moth_(insect))',
  'https://example.com/a]',
  'https://example.com/a[b]]',
  'https://example.com/?q=a.b&c=d',
  '.,;:!?>*',
  ')',
  '(()))',
  '',
  'a)!).',
];

const DOMAINS = [
  'example.com',
  'https://example.com/x',
  'http://www.example.com',
  'HTTPS://example.com',
  'www.example',
  'v1.2.3',
  '1.0.0',
  '192.168.0.1',
  'notes.txt',
  'NOTES.TXT',
  'photo.JPG',
  'a.b.txt',
  'example.c',
  'example.12',
  `${'a'.repeat(63)}.com`,
  `${'a'.repeat(64)}.com`,
  '.com',
  'a..com',
  'example',
  'example.com/path.txt',
  'bücher.de',
  'xn--bcher-kva.de',
  '',
  'https://',
  'https:///x.com',
  'a.b',
];

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'urlRegex',
      TEXTS.map((text) => ({ text })),
      ({ text }) => [...text.matchAll(createUrlRegex())].map((m) => m[0]),
    )),
  );
  out.push(
    ...(await each(
      'trimUrlMatch',
      TRIMS.map((matchText) => ({ matchText })),
      ({ matchText }) => trimUrlMatch(matchText),
    )),
  );
  out.push(
    ...(await each(
      'findUrlsAndMentions',
      TEXTS.map((text) => ({ text })),
      ({ text }) => findUrlsAndMentions(text),
    )),
  );
  out.push(
    ...(await each(
      'isValidDomain',
      DOMAINS.map((domain) => ({ domain })),
      ({ domain }) => isValidDomain(domain),
    )),
  );
  out.push(
    ...(await each(
      'isPrecededByQuote',
      [
        ['"example.com"', 1],
        ['\u201Cexample.com\u201D', 1],
        ['example.com', 0],
        ['see example.com', 4],
        ['\u201Dexample.com', 1],
        ["'example.com", 1],
        ['"x', 0],
        ['', 0],
      ].map(([text, charStart]) => ({ text, charStart })),
      ({ text, charStart }) => isPrecededByQuote(text, charStart),
    )),
  );
  return out;
}
