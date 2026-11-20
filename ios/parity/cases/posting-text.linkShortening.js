// src/posting/lib/linkShortening.js: links shortened for display as Bluesky
// writes them, the live count, and the splice that rewrites the text a link
// facet covers (and puts it back). Swift: VirgaPosting/Lib/LinkShortening.swift.
//
// Inputs from src/posting/lib/linkShortening.test.js and urlMatching.test.js,
// plus IDN hosts, ports, credentials, percent-encoding, the 15-character
// edge, malformed and overlapping facets, multibyte text around splices, a
// facet that cuts a character in half, and a leading BOM.

import {
  countPostGraphemes,
  expandLinkFacets,
  findShortenableLinks,
  shortenLinkFacets,
  shortenPostText,
  toShortUrl,
} from '../../../src/posting/lib/linkShortening.js';
import { each } from './_helpers.js';

export const sources = ['src/posting/lib/linkShortening.js'];

const encoder = new TextEncoder();
const LONG_URL =
  'https://example.org/profile/testing.dame.is/net.example.graph.wordlist/3mtw6wbql5z2p';

const rangeOf = (text, substring) => {
  const at = text.indexOf(substring);
  return {
    byteStart: encoder.encode(text.slice(0, at)).length,
    byteEnd: encoder.encode(text.slice(0, at + substring.length)).length,
  };
};
const linkFacet = (text, substring, uri = substring) => ({
  $type: 'app.bsky.richtext.facet',
  features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
  index: rangeOf(text, substring),
});
const mentionFacet = (text, substring) => ({
  $type: 'app.bsky.richtext.facet',
  features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:abc' }],
  index: rangeOf(text, substring),
});
const tagFacet = (text, substring, tag) => ({
  $type: 'app.bsky.richtext.facet',
  features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
  index: rangeOf(text, substring),
});

const URLS = [
  LONG_URL,
  'https://xn--a-.com/a/long/path/to/somewhere',
  'https://XN--XN--A-.example/x',
  'https://example.org/branding',
  'https://example.org/',
  'https://example.org',
  'https://example.com/a?ref=sample&utm=x',
  'https://example.com/#a-very-long-fragment',
  'example.org/profile/testing.dame.is/very/long/path',
  'at://did:plc:abc/app.bsky.feed.post/3mtw6wbql5z2p',
  '',
  'https://example.com/123456789012345',
  'https://example.com/1234567890123456',
  'https://example.com/12345678901234',
  'https://example.com:8080/a/b/c',
  'https://example.com:443/a',
  'https://user:pass@example.com/path/to/thing',
  'HTTPS://EXAMPLE.COM/PATH/TO/A/PLACE',
  'https://bücher.de/straße/und/mehr',
  'https://example.com/café/naïve/über',
  'https://example.com/a b c d e f g h',
  'https://example.com/?',
  'https://example.com/#',
  'https://example.com/?q=1#f',
  'http://example.com/x',
  'ftp://example.com/a/long/path/here',
  'mailto:someone@example.com',
  'https://[::1]:8080/path/to/the/thing',
  'https://192.168.0.1/long/path/somewhere',
  'https://en.wikipedia.org/wiki/Bee_(disambiguation)',
  'http:example.com/a/long/path/to/it',
  'not a url',
  'https://',
];

const TEXTS = [
  `Bluesky lets you create and share lists of accounts that can then be used to mute/unmute people more easily and at scale... what if you could do the same with muted words?\n\nIntroducing ~Muted Word Lists~\n\n${LONG_URL}`,
  `${'a'.repeat(228)}\n\n${LONG_URL}`,
  '🦋',
  '👨\u200D👩\u200D👧\u200D👦',
  'example.org/profile/testing.dame.is/net.example.graph.wordlist/3mtw6wbql5z2p',
  'the domain "https://example.org/profile/testing/and/more" is taken',
  'the domain \u201Chttps://example.org/profile/testing/and/more\u201D is taken',
  '"see https://example.com/another/quite/long/path"',
  '\u201Csee https://example.com/another/quite/long/path\u201D',
  'a note at a lamp on a porch at night',
  '',
  `see ${LONG_URL} and https://example.com/another/quite/long/path too`,
  'HTTPS://EXAMPLE.COM/A/LONG/PATH/HERE',
  'mail me@https://example.com/a/long/path/here',
  'x@https://a.example/long/path/here/and/more',
  'see https://v1.2.3/long/path/goes/here',
  'see https://notes.txt/long/path/goes/here',
  'https://example.com/short',
  '\u{1F98B} https://example.com/a/long/path/to/somewhere \u{1F98B}',
  'https://example.com/a/long/path/to/somewhere, https://example.com/b/long/path/to/elsewhere.',
  'https://bücher.de/straße/und/noch/viel/mehr',
  'no protocol://here',
];

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'toShortUrl',
      URLS.map((url) => ({ url })),
      ({ url }) => toShortUrl(url),
    )),
  );
  out.push(
    ...(await each(
      'findShortenableLinks',
      [...TEXTS.map((text) => ({ text })), { text: null }],
      ({ text }) => findShortenableLinks(text),
    )),
  );
  out.push(
    ...(await each(
      'shortenPostText',
      [...TEXTS.map((text) => ({ text })), { text: null }],
      ({ text }) => shortenPostText(text),
    )),
  );
  out.push(
    ...(await each(
      'countPostGraphemes',
      TEXTS.map((text) => ({ text })),
      ({ text }) => countPostGraphemes(text),
    )),
  );

  const other = 'https://example.com/another/quite/long/path';
  const t1 = `Introducing ~Muted Word Lists~\n\n${LONG_URL}`;
  const t2 = `🦋 hey @dame.is see ${LONG_URL} and ${other} #birding`;
  const t3 = `see ${LONG_URL}`;
  const t4 = 'go to example.org/profile/testing.dame.is/and/more';
  const t5 = '\uFEFFsee https://example.com/a/long/path/to/somewhere';
  const t6 = 'café https://example.com/a/long/path/to/somewhere';
  const range = rangeOf(t3, LONG_URL);
  const FACETED = [
    { $id: 'one link', text: t1, facets: [linkFacet(t1, LONG_URL)] },
    {
      $id: 'multibyte with mention, links and tag',
      text: t2,
      facets: [
        mentionFacet(t2, '@dame.is'),
        linkFacet(t2, LONG_URL),
        linkFacet(t2, other),
        tagFacet(t2, '#birding', 'birding'),
      ],
    },
    {
      $id: 'out of order',
      text: t2,
      facets: [
        tagFacet(t2, '#birding', 'birding'),
        linkFacet(t2, other),
        mentionFacet(t2, '@dame.is'),
        linkFacet(t2, LONG_URL),
      ],
    },
    { $id: 'empty', text: 'a note at a lamp', facets: [] },
    { $id: 'null facets', text: 'a note at a lamp', facets: null },
    { $id: 'empty text', text: '', facets: [] },
    { $id: 'null text', text: null, facets: [linkFacet(t3, LONG_URL)] },
    { $id: 'bare domain', text: t4, facets: [linkFacet(t4, t4.slice(6))] },
    {
      $id: 'overlapping',
      text: t3,
      facets: [
        linkFacet(t3, LONG_URL),
        {
          $type: 'app.bsky.richtext.facet',
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: LONG_URL }],
          index: { byteStart: range.byteStart + 4, byteEnd: range.byteEnd },
        },
      ],
    },
    {
      $id: 'past the end',
      text: t3,
      facets: [
        { ...linkFacet(t3, LONG_URL), index: { byteStart: 4, byteEnd: 9999 } },
      ],
    },
    {
      $id: 'missing end',
      text: t3,
      facets: [{ ...linkFacet(t3, LONG_URL), index: { byteStart: 4 } }],
    },
    {
      $id: 'fractional',
      text: t3,
      facets: [
        { ...linkFacet(t3, LONG_URL), index: { byteStart: 4.5, byteEnd: 20 } },
      ],
    },
    {
      $id: 'string offsets',
      text: t3,
      facets: [
        {
          ...linkFacet(t3, LONG_URL),
          index: { byteStart: '4', byteEnd: '88' },
        },
      ],
    },
    {
      $id: 'negative start',
      text: t3,
      facets: [
        { ...linkFacet(t3, LONG_URL), index: { byteStart: -1, byteEnd: 20 } },
      ],
    },
    {
      $id: 'end before start',
      text: t3,
      facets: [
        { ...linkFacet(t3, LONG_URL), index: { byteStart: 20, byteEnd: 10 } },
      ],
    },
    { $id: 'null facet', text: t3, facets: [null] },
    {
      $id: 'no features',
      text: t3,
      facets: [{ index: rangeOf(t3, LONG_URL) }],
    },
    {
      $id: 'empty uri',
      text: t3,
      facets: [linkFacet(t3, LONG_URL, '')],
    },
    {
      $id: 'extra keys survive, index keys do not',
      text: t3,
      facets: [
        {
          ...linkFacet(t3, LONG_URL),
          extra: { a: 1 },
          index: { ...rangeOf(t3, LONG_URL), $type: 'x' },
        },
      ],
    },
    {
      $id: 'cuts a character in half',
      text: t6,
      facets: [
        {
          $type: 'app.bsky.richtext.facet',
          features: [
            { $type: 'app.bsky.richtext.facet#link', uri: 'https://x.com' },
          ],
          index: { byteStart: 3, byteEnd: 4 },
        },
        linkFacet(t6, 'https://example.com/a/long/path/to/somewhere'),
      ],
    },
    {
      $id: 'leading BOM',
      text: t5,
      facets: [linkFacet(t5, 'https://example.com/a/long/path/to/somewhere')],
    },
    {
      $id: 'zero-length facets',
      text: t3,
      facets: [
        { ...linkFacet(t3, LONG_URL), index: { byteStart: 2, byteEnd: 2 } },
        { ...linkFacet(t3, LONG_URL), index: { byteStart: 2, byteEnd: 2 } },
        linkFacet(t3, LONG_URL),
      ],
    },
    {
      $id: 'link text a writer chose',
      text: 'read the field notes',
      facets: [
        linkFacet(
          'read the field notes',
          'field notes',
          'https://example.org/notes/very/long/path',
        ),
      ],
    },
  ];
  out.push(
    ...(await each('shortenLinkFacets', FACETED, ({ text, facets }) =>
      shortenLinkFacets(text, facets),
    )),
  );
  out.push(
    ...(await each('expandLinkFacets', FACETED, ({ text, facets }) =>
      expandLinkFacets(text, facets),
    )),
  );
  out.push(
    ...(await each('roundTrip', FACETED, ({ text, facets }) => {
      const stored = shortenLinkFacets(text, facets);
      return expandLinkFacets(stored.text, stored.facets);
    })),
  );
  return out;
}
