// src/posting/lib/inlineLinks.js: `[label](url)` in the composer, the label
// rule (a label naming another site is refused), collapsing, folding into
// detected facets, the count, and reopening a stored post. Swift:
// VirgaPosting/Lib/InlineLinks.swift.
//
// Inputs from src/posting/lib/inlineLinks.test.js (all of it), plus IDN and
// handle labels, nested brackets and parentheses, every way the syntax almost
// matches, and stored records with malformed facets. Detection runs as in
// posting-text.facets.js: each case at its own pinned instant, a table for
// the resolver.

import {
  applyInlineLinks,
  collapseInlineLinks,
  composerCountText,
  composerTextFromRecord,
  countComposerGraphemes,
  detectComposerFacets,
  findInlineLinks,
  isSingleAddress,
  labelMisleads,
  linkDestination,
} from '../../../src/posting/lib/inlineLinks.js';
import { detectAndCreateFacetsOptimized } from '../../../src/posting/lib/facets.js';
import { shortenLinkFacets } from '../../../src/posting/lib/linkShortening.js';
import { each } from './_helpers.js';
import { at as atTime, nextDay } from './posting-text.facets.js';

export const sources = ['src/posting/lib/inlineLinks.js'];

/** `fn` at a pinned instant a day after anything facets.js has cached. */
const at = (fn) => atTime(nextDay(), fn);

const encoder = new TextEncoder();
const facetOf = (text, substring, uri) => {
  const start = text.indexOf(substring);
  return {
    $type: 'app.bsky.richtext.facet',
    features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
    index: {
      byteStart: encoder.encode(text.slice(0, start)).length,
      byteEnd: encoder.encode(text.slice(0, start + substring.length)).length,
    },
  };
};

const DESTINATIONS = [
  'https://example.org/about',
  'http://example.com',
  'example.org/faq',
  'example.com:8080/x',
  '',
  'b',
  'notes.txt',
  'v1.2.3',
  '/relative',
  '//example.com',
  'mailto:a@b.com',
  'javascript:alert(1)',
  'at://did:plc:x/app.bsky.feed.post/1',
  'ftp://example.com',
  'https://localhost:3000',
  '192.168.0.1',
  'HTTPS://EXAMPLE.ORG/X',
  'bücher.de/x',
  'https://exa mple.com',
  'example.com:abc',
  'a:1',
  'localhost:8080',
  'https://example.com/a)b',
  'www.example.com',
  'https://[::1]/x',
  'https://1.2.3.4/x',
  'https://xn--abc.com',
  null,
];

const MISLEADS = [
  ['my essay', 'https://example.com/essay'],
  ['e.g. this', 'https://example.com'],
  ['example.org', 'https://example.org/about'],
  ['www.example.org', 'https://example.org'],
  ['https://example.org/faq', 'https://example.org/about'],
  ['Example.org, the site', 'https://example.org'],
  ['bsky.app', 'https://elsewhere.example'],
  ['https://bsky.app/profile/x', 'https://elsewhere.example'],
  ['bsky.app is great', 'https://elsewhere.example'],
  ['@dame.is', 'https://elsewhere.example'],
  ['example.com', 'https://blog.example.com'],
  ['read it on bsky.app', 'https://elsewhere.example'],
  ["bsky.app's feed", 'https://elsewhere.example'],
  ['(bsky.app)', 'https://elsewhere.example'],
  ['https://bsky.app...', 'https://elsewhere.example'],
  ['bsky.app or example.org', 'https://bsky.app'],
  ["bsky.app's own feed", 'https://bsky.app/profile/x'],
  ['bücher.de', 'https://xn--bcher-kva.de'],
  ['bücher.de', 'https://bucher.de'],
  ['BÜCHER.DE', 'https://bücher.de/x'],
  ['v1.2.3', 'https://example.com'],
  ['notes.txt', 'https://example.com'],
  ['"quoted.example"', 'https://quoted.example'],
  ['\u201Ccurly.example\u201D', 'https://other.example'],
  ['HTTPS://BSKY.APP', 'https://bsky.app'],
  ['https://bsky.app', 'not a url'],
  ['', 'https://example.com'],
  [null, 'https://example.com'],
  ['日本.jp', 'https://xn--wgv71a.jp'],
  ['ex-ample.co.uk', 'https://ex-ample.co.uk'],
  ['-bad-.com', 'https://elsewhere.example'],
  ['192.168.0.1', 'https://elsewhere.example'],
  // `/iu` matches by case folding: U+0345 (a combining mark) folds to the
  // letter ι, so it counts as a letter of a named domain, at either end or
  // inside; the long s folds to s, so it can spell the scheme.
  ['\u0345ab.com', 'https://x.com'],
  ['ab\u0345.com', 'https://x.com'],
  ['a\u0345b.com', 'https://x.com'],
  ['ab.co\u0345', 'https://x.com'],
  ['notes.txt\u0345', 'not a url'],
  ['httpſ://bsky.app', 'https://elsewhere.example'],
  ['\u212Aelvin.example', 'https://elsewhere.example'],
  ['\u0345', 'https://x.com'],
];

const INLINE = [
  'read [my essay](https://example.com/essay) and [the faq](example.org/faq).',
  '[notes](https://en.wikipedia.org/wiki/Bee_(disambiguation)) here',
  '[a](b)',
  '[](https://example.com)',
  '[ ](https://example.com)',
  '[a] (https://example.com)',
  '[a](https://example.com',
  '[a\nb](https://example.com)',
  '[a](https://exa mple.com)',
  'arr[0](x)',
  '[[label](https://example.com)',
  '[bsky.app](https://elsewhere.example)',
  'a [b](https://b.com) c [dd](https://d.com) e',
  'see [bsky.app](https://elsewhere.example)',
  '[x](https://a.com)[y](https://b.com)',
  '[x](https://a.com/(b)(c))',
  '[x](https://a.com/((b)))tail',
  '[x](https://a.com/(b) more',
  '[x [y](https://a.com)',
  '[x]](https://a.com)',
  '[🦋 émoji](https://example.com/é)',
  '[label](mailto:a@b.com)',
  '[label](/relative)',
  '[\u0345ab.com](https://x.com) refused, as a domain that is not x.com',
  '[x.co\u0345m](https://x.com)',
  'no links here',
  '](',
  '[',
  '',
  null,
];

const COMPOSER = [
  { text: 'read [my essay](https://example.com/essay) tonight' },
  { text: '🦋 [ünïcödé](https://example.com) #notes' },
  {
    text: '@luna.test see [this](https://a.com/x) and https://b.com/y #tag',
    table: { 'luna.test': 'did:plc:luna' },
  },
  {
    text: 'see [example.org by @example.org #notes](https://example.org) now',
    table: { 'example.org': 'did:plc:example' },
  },
  { text: '[example.org](https://example.org/about) ', preview: true },
  {
    text: '[this post](https://bsky.app/profile/a.test/post/3abc) ',
    preview: true,
  },
  { text: '[bsky.app](https://elsewhere.example) ok' },
  {
    text: 'hello example.org and https://example.com/long/path/to/a/page #notes',
    preview: true,
  },
  {
    text: 'a [https://example.org/profile/x/y/z/w](https://example.org/profile/x/y/z/w) b [see https://example.com/long/path/here inside](https://example.com) c https://example.com/another/long/path d',
  },
  { text: '[bsky.app](https://elsewhere.example/a/long/path/here) ok' },
  {
    text: '🦋 [my essay](https://example.com/essay), [notes](https://en.wikipedia.org/wiki/Bee_(disambiguation)) and https://example.com/a/long/path/to/somewhere',
  },
  {
    text: '[@a.test](https://a.test) and @a.test',
    table: { 'a.test': 'did:plc:a' },
  },
  { text: '', preview: true },
  { text: null, preview: true },
];

const COUNTS = [
  'read [my essay](https://example.com/a/very/long/path/that/costs/nothing/now)',
  'a [https://example.org/profile/x/y/z/w](https://example.org/profile/x/y/z/w) b [see https://example.com/long/path/here inside](https://example.com) c https://example.com/another/long/path d',
  '[bsky.app](https://elsewhere.example/a/long/path/here) ok',
  '[https://bücher.de/straße/und/mehr](https://bücher.de/straße/und/mehr)',
  'plain text only',
  '[\u0345ab.com](https://x.com/a/long/path/that/shortens) and [ok](https://x.com/a/long/path/that/shortens)',
  '👨\u200D👩\u200D👧\u200D👦 [🇯🇵](https://example.jp) é',
  '',
  null,
];

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'linkDestination',
      DESTINATIONS.map((destination) => ({ destination })),
      ({ destination }) => linkDestination(destination),
    )),
  );
  out.push(
    ...(await each(
      'labelMisleads',
      MISLEADS.map(([label, uri]) => ({ label, uri })),
      ({ label, uri }) => labelMisleads(label, uri),
    )),
  );
  out.push(
    ...(await each(
      'isSingleAddress',
      [
        'https://old.example/x',
        ' example.org ',
        'my essay',
        'on example.org',
        '@dame.is',
        'bsky.app.',
        '',
        null,
        'v1.2.3',
        'example.org example.com',
        '\u0345ab.com',
        'ſt.\u0345ab12',
        ' \u0345ab.app\u0345 ',
      ].map((text) => ({ text })),
      ({ text }) => isSingleAddress(text),
    )),
  );
  out.push(
    ...(await each(
      'findInlineLinks',
      INLINE.map((text) => ({ text })),
      ({ text }) => findInlineLinks(text),
    )),
  );
  out.push(
    ...(await each(
      'collapseInlineLinks',
      INLINE.map((text) => ({ text })),
      ({ text }) => collapseInlineLinks(text),
    )),
  );
  out.push(
    ...(await each(
      'applyInlineLinks',
      [
        'go [here](https://bsky.app/profile/a.test/post/3abc) ',
        'see [example.org](https://example.org) and https://other.example/x ',
        '[a](https://a.com) @x.test #tag [b](https://b.com)',
        'no links',
      ].map((text) => ({ text })),
      ({ text }) =>
        at(async () =>
          applyInlineLinks(
            text,
            findInlineLinks(text),
            await detectAndCreateFacetsOptimized(text, true),
          ),
        ),
    )),
  );
  const resolverFrom = (table) => async (handle) => {
    const answer = table?.[handle];
    if (answer === '$throw') throw new Error('offline');
    return answer ?? null;
  };
  out.push(
    ...(await each(
      'detectComposerFacets',
      COMPOSER,
      ({ text, table, preview }) =>
        at(() =>
          detectComposerFacets(
            text,
            preview
              ? { skipMentionResolution: true }
              : { resolveMention: resolverFrom(table) },
          ),
        ),
    )),
  );
  out.push(
    ...(await each(
      'composerCountText',
      [...COUNTS, ...INLINE].map((text) => ({ text })),
      ({ text }) => composerCountText(text),
    )),
  );
  out.push(
    ...(await each(
      'countComposerGraphemes',
      [...COUNTS, ...INLINE].map((text) => ({ text })),
      ({ text }) => countComposerGraphemes(text),
    )),
  );
  out.push(
    ...(await each(
      'writtenEqualsCounted',
      COMPOSER.filter((c) => c.text).map(({ text, table }) => ({
        text,
        table,
      })),
      ({ text, table }) =>
        at(async () => {
          const result = await detectComposerFacets(text, {
            resolveMention: resolverFrom(table),
          });
          return {
            counted: composerCountText(text),
            written: shortenLinkFacets(result.text, result.facets),
          };
        }),
    )),
  );
  const r1 = 'read my essay tonight';
  const r2 = 'see example.org and example.com/long/path/he...';
  const r3 = 'odd link';
  const r4 = 'a [b] c';
  const RECORDS = [
    {
      text: r1,
      facets: [facetOf(r1, 'my essay', 'https://example.com/essay')],
    },
    {
      text: r2,
      facets: [
        facetOf(r2, 'example.org', 'https://example.org'),
        facetOf(
          r2,
          'example.com/long/path/he...',
          'https://example.com/long/path/here/and/more',
        ),
      ],
    },
    { text: r3, facets: [facetOf(r3, 'odd', 'https://example.com/a)b')] },
    { text: r3, facets: [facetOf(r3, 'odd', 'https://example.com/(a')] },
    { text: r3, facets: [facetOf(r3, 'odd', 'https://example.com/(a)')] },
    { text: r4, facets: [facetOf(r4, '[b]', 'https://example.com')] },
    {
      text: '@luna.test #notes',
      facets: [
        {
          features: [
            { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:luna' },
          ],
          index: { byteStart: 0, byteEnd: 10 },
        },
        {
          features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'notes' }],
          index: { byteStart: 11, byteEnd: 17 },
        },
      ],
    },
    { text: r1, facets: [facetOf(r1, 'my essay', 'mailto:a@b.com')] },
    { text: r1, facets: [facetOf(r1, 'my essay', 'at://did:plc:x/a/b')] },
    { text: r1, facets: [facetOf(r1, 'my', 'https://bsky.app')] },
    { text: r1, facets: [facetOf(r1, ' ', 'https://example.com')] },
    {
      text: 'line\nbreak',
      facets: [facetOf('line\nbreak', 'line\nbreak', 'https://x.com')],
    },
    { text: '', facets: [] },
    { text: null, facets: null },
    { text: r1, facets: [{ index: { byteStart: 0, byteEnd: 4 } }] },
    {
      text: '🦋 my essay',
      facets: [facetOf('🦋 my essay', 'my essay', 'https://example.com/essay')],
    },
  ];
  out.push(
    ...(await each('composerTextFromRecord', RECORDS, ({ text, facets }) =>
      composerTextFromRecord(text, facets),
    )),
  );
  out.push(
    ...(await each(
      'reopenRoundTrip',
      COMPOSER.filter((c) => c.text && !c.preview).map(({ text, table }) => ({
        text,
        table,
      })),
      ({ text, table }) =>
        at(async () => {
          const result = await detectComposerFacets(text, {
            resolveMention: resolverFrom(table),
          });
          const written = shortenLinkFacets(result.text, result.facets);
          return composerTextFromRecord(written.text, written.facets);
        }),
    )),
  );
  return out;
}
