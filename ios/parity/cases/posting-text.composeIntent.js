// src/posting/lib/composeIntent.js: compose-intent links read into a draft
// (bounded and sanitized) and built back. Swift:
// VirgaPosting/Lib/ComposeIntent.swift.
//
// Inputs from src/posting/lib/composeIntent.test.js (all of it), plus
// repeated and empty parameters, `+` and malformed escapes, every non-http
// scheme, URLs that normalize, the post limit in emoji and around a link,
// and origins that aren't URLs. A URLSearchParams input is written as
// { $params: [[name, value], …] }.
//
// Node's URLSearchParams isn't the browser's on one input: a query whose
// value holds a valid escape (`%41`), a malformed one (`%zz`) and a
// non-ASCII character. Node then decodes with querystring.unescapeBuffer,
// which keeps only the low byte of each code unit ('١' becomes 'a'); browsers
// and the Swift port follow the URL Standard's parser and keep '١'. The web
// app runs in a browser, so no case here combines the three.

import {
  buildComposeIntentUrl,
  COMPOSE_INTENT_PARAMS,
  INTENT_COMPOSE_PATH,
  MAX_POST_GRAPHEMES,
  parseComposeIntent,
} from '../../../src/posting/lib/composeIntent.js';
import { each, value } from './_helpers.js';

export const sources = ['src/posting/lib/composeIntent.js'];

const SEARCHES = [
  '?text=hello',
  '?text=I%27m%20reading%20through%20the%20Bluesky%20API%20docs%21%20%F0%9F%A6%8B%0Ahttps%3A//docs.bsky.app',
  '',
  null,
  '?utm_source=newsletter&ref=x',
  '?text=&tags=',
  '?text=%20%20%20',
  { $params: [['text', 'hi']] },
  'text=hi',
  'https://virga.example/intent/compose?text=hi',
  { text: 'hi' },
  { title: 'A page worth reading' },
  { title: 'A page', text: 'A page, with my note' },
  { title: 'A page', url: 'https://example.com/a' },
  { text: 'A good read', url: 'https://example.com/a' },
  { url: 'https://example.com/a' },
  { text: 'see https://example.com/a for more', url: 'https://example.com/a' },
  { text: 'look', url: 'javascript:alert(1)' },
  { text: 'look', url: 'data:text/html,<script>alert(1)</script>' },
  { text: 'look', url: 'vbscript:msgbox(1)' },
  { text: 'look', url: 'file:///etc/passwd' },
  { text: 'look', url: 'not a url' },
  { text: 'short' },
  { text: 'a'.repeat(400) },
  { text: '👍🏽'.repeat(400) },
  { text: 'Shipping \u{1F469}\u200D\u{1F4BB} today, می\u200Cخواهم' },
  { text: 'see\u200Bexample.com' },
  {
    text: 'a'.repeat(400),
    url: 'https://example.com/an-article-worth-reading',
  },
  { text: 'context', url: `https://example.com/${'p'.repeat(320)}` },
  { text: 'context', url: `https://example.com/${'p'.repeat(275)}` },
  { text: 'context', url: `https://example.com/${'p'.repeat(278)}` },
  { tags: 'birds, night ,lamp' },
  { tags: '#birds, ##night' },
  { tags: 'Birds, birds, BIRDS' },
  { tags: Array.from({ length: 30 }, (_, i) => `t${i}`).join(',') },
  { tags: 'x'.repeat(200) },
  { tags: 'birds,,, ,night' },
  { text: 'https://exa\u200Bmple.com' },
  { text: 'a\u00A0b' },
  { text: 'look', url: 'https://example.com' },
  { text: 'look' },
  { text: 'look', url: '  HTTPS://EXAMPLE.COM/A B?c d#e  ' },
  { text: 'look', url: 'https://bücher.de/x' },
  { text: 'look', url: 'http:example.com' },
  '?text=a+b%2Bc&text=second',
  '?text=%zz%F0%9F',
  '?TEXT=upper',
  '??text=double',
  '#text=fragment',
  '?title=only+title&tags=a',
  '?url=https%3A%2F%2Fexample.com%2Fx&text=',
  '?tags=one&tags=two',
  { text: null, url: null, tags: null },
  { text: 42 },
  { text: ['a', 'b'] },
  { text: { nested: true } },
  { text: '\u0000\u0007 control \u001F' },
  { text: '   ', tags: 'x' },
  { text: 'x', url: 'https://example.com/x', tags: 'a' },
  42,
  true,
  ['text', 'array'],
];

const BUILDS = [
  { intent: { text: 'hi' }, origin: 'https://virga.example' },
  { intent: { tags: ['birds', 'night'] }, origin: 'https://virga.example' },
  { intent: { tags: 'birds, night' }, origin: 'https://virga.example' },
  {
    intent: {
      text: "I'm reading this 🦋",
      url: 'https://docs.bsky.app/',
      tags: 'birds, night',
    },
    origin: 'https://virga.example',
  },
  { intent: {}, origin: 'https://virga.example' },
  { intent: { text: '', url: '', tags: [] }, origin: 'https://virga.example' },
  { intent: { text: 'a b+c&d=e/f?g#h%' }, origin: 'https://virga.example' },
  { intent: { text: 'hi' }, origin: 'https://virga.example/some/page?x=1#y' },
  { intent: { text: 'hi' }, origin: 'http://localhost:5173' },
  { intent: { text: 'hi' } },
  { intent: { text: 'hi' }, origin: '' },
  { intent: { text: 'hi' }, origin: 'not a url' },
  { intent: { text: 'hi' }, origin: 'mailto:x' },
  { intent: { text: 'hi' }, origin: 'foo://host/p' },
  { intent: { tags: [] }, origin: 'https://v.example' },
  {
    intent: { url: 'https://example.com/?a=1&b=2' },
    origin: 'https://v.example',
  },
  { intent: { text: 'line\nbreak\ttab' }, origin: 'https://bücher.de' },
];

export default async function cases() {
  const out = [
    value('constants', {
      INTENT_COMPOSE_PATH,
      MAX_POST_GRAPHEMES,
      COMPOSE_INTENT_PARAMS,
    }),
  ];
  out.push(
    ...(await each(
      'parseComposeIntent',
      SEARCHES.map((search) => ({ search })),
      ({ search }) =>
        parseComposeIntent(
          search?.$params ? new URLSearchParams(search.$params) : search,
        ),
    )),
  );
  out.push(
    ...(await each('buildComposeIntentUrl', BUILDS, ({ intent, origin }) =>
      buildComposeIntentUrl(intent, origin),
    )),
  );
  out.push(
    ...(await each('roundTrip', BUILDS.slice(0, 7), ({ intent, origin }) =>
      parseComposeIntent(buildComposeIntentUrl(intent, origin)),
    )),
  );
  return out;
}
