// src/posting/lib/mentions.js: where an @handle starts and ends, the
// typeahead's partial mention at every cursor position, completed mentions,
// handle syntax, the mention facet, and the resolver's cache and request
// sharing over a fake fetch. Swift: VirgaPosting/Lib/Mentions.swift.
//
// Inputs from src/posting/lib/mentions.test.js and facets.test.js ("where a
// handle ends"), with every cursor position of each typeahead text.

import {
  createMentionFacet,
  createMentionResolver,
  detectCompletedMentions,
  detectPartialMention,
  findMentions,
  isValidHandle,
} from '../../../src/posting/lib/mentions.js';
import { createByteMap } from '../../../src/posting/lib/richText.js';
import { each } from './_helpers.js';

export const sources = ['src/posting/lib/mentions.js'];

const longest = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;

const FIND = [
  'hi @dame.art\u{1F98B}',
  '\u{1F98B}@dame.art',
  'hi @dame.art\u2026',
  'hi @dame.art...',
  'thanks @dame.art.',
  'hi @dame.art, ok',
  'notes (@dame.art) ok',
  '\u65E5@dame.art\u672C',
  '\u201C@dame.art\u201D',
  "@dame.art's note",
  '@dame.art_x',
  'a@b.com',
  'mail note9@dame.art.',
  'me@localhost',
  'https://example.com/@dame.art/notes',
  '@ dame.art',
  '@',
  '@.',
  '@dame',
  '@dame.2art',
  '@-dame.art',
  '@\u{1F98B}',
  '@a.test,@b.test @@c.test',
  'hi @sphingicampa.test\u{1F469}\u200D\u{1F52C}',
  '@saturniid..test',
  '@saturniid.test- ok',
  'see @saturniid.2b',
  `@${longest}`,
  `@${longest}d`,
  `@${'a'.repeat(64)}.test`,
  '@Alice.Bsky.Social',
  'x@@y.test',
  '_@dame.art',
  '.@dame.art',
  '-@dame.art',
  '@dame.art@other.test',
  '@dame.art/@x.test',
  'e\u0301@dame.art',
  '\u00E9@dame.art',
  '',
  'no mentions here',
];

const PARTIAL = [
  'hi @da\u{1F98B} more',
  'hi @dame.art, ok',
  'hi @dame.',
  'hi @da\u{1F98B}x',
  'hi @dame.art\u2019s',
  'mail me@da',
  'see /@da',
  'mail @da',
  '\u65E5@da',
  'https://example.com/x @da',
  'www.example.com/@da',
  'example.com/path@da',
  'see http://x.y/z?q=@da',
  'a://b@c',
  '@',
  '@@a',
  '',
  'no at sign',
];

const COMPLETED = [
  ["hi @dame.art'", null],
  ["hi @dame.art's note", null],
  ['hi @dame.art\u2019', null],
  ['hi @dame.art\u2019s note', null],
  ['"hi @dame.art" ok', null],
  ['\u201Chi @dame.art\u201D ok', null],
  ['hi @dame.art', null],
  ['hi @dame.art ', null],
  ['hi @dame.art\u{1F98B} more', null],
  ['hi @dame.art\u65E5 more', null],
  ['hi @dame.art\u2026 more', null],
  ['hi @alice.bsky.', null],
  ['hi @dame.art. More', null],
  ['write to me@dame.art today', null],
  ['@a.test @b.test @c.test', null],
];

const HANDLES = [
  'dame.art',
  'a.b',
  'alice.bsky.social',
  'x-y.test',
  'note9.co',
  'ab.c2',
  `${'a'.repeat(63)}.test`,
  longest,
  'dame',
  'dame.',
  '.dame.art',
  'dame..art',
  '-dame.art',
  'dame-.art',
  'dame.art-',
  'dame.2art',
  'dame_x.art',
  'd\u00E9me.art',
  'dame.art\u{1F98B}',
  `${'a'.repeat(64)}.test`,
  `${longest}d`,
  '',
  null,
  42,
  'A.B',
  '1.a',
  'a.1a',
  'a.-',
  'xn--bcher-kva.de',
];

const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (body === undefined) throw new SyntaxError('Unexpected token');
    return body;
  },
});

/**
 * A resolver over a fake fetch, asked in steps: each step sets the clock
 * and asks for some handles at once. Records each step's answers and the
 * URLs fetched during it (sorted: concurrent asks can start in any order).
 */
async function resolverScenario({ options, table, steps }) {
  let clock = 0;
  const fetched = [];
  const fetch = async (url) => {
    fetched.push(url);
    const handle = new URL(url).searchParams.get('handle');
    const reply = table[handle];
    if (!reply || reply.throws) throw new TypeError('Failed to fetch');
    return answer(reply.status, reply.body);
  };
  const resolve = createMentionResolver({
    fetch,
    now: () => clock,
    ...options,
  });
  const out = [];
  for (const step of steps) {
    clock = step.at;
    const before = fetched.length;
    const results = await Promise.all(step.ask.map((h) => resolve(h)));
    out.push({ results, requests: fetched.slice(before).sort() });
  }
  return out;
}

const SCENARIOS = [
  {
    $id: 'lowercased bare handle, custom appview',
    options: { appview: 'https://appview.test' },
    table: { 'alice.test': { status: 200, body: { did: 'did:plc:abc' } } },
    steps: [{ at: 0, ask: ['@Alice.Test'] }],
  },
  {
    $id: 'ttl and shared request',
    options: { ttlMs: 1000 },
    table: { 'a.test': { status: 200, body: { did: 'did:plc:abc' } } },
    steps: [
      { at: 0, ask: ['a.test', 'a.test'] },
      { at: 999, ask: ['a.test'] },
      { at: 1000, ask: ['a.test'] },
      { at: 1500, ask: ['A.TEST', '@a.test'] },
    ],
  },
  {
    $id: 'a definite no is remembered, a failure is not',
    options: {},
    table: {
      'gone.test': { status: 400, body: { error: 'InvalidRequest' } },
      'flaky.test': { throws: true },
      'down.test': { status: 502, body: { error: 'BadGateway' } },
    },
    steps: [
      { at: 0, ask: ['gone.test', 'flaky.test', 'down.test'] },
      { at: 10, ask: ['gone.test', 'flaky.test', 'down.test'] },
      { at: 300000, ask: ['gone.test'] },
    ],
  },
  {
    $id: 'not handles are refused without asking',
    options: {},
    table: {},
    steps: [
      { at: 0, ask: ['nodot', '', '@', 'dame..art', 'd\u00E9me.art', null] },
    ],
  },
  {
    $id: 'bodies without a DID',
    options: {},
    table: {
      'nope.test': { status: 200, body: { did: 'nope' } },
      'num.test': { status: 200, body: { did: 42 } },
      'empty.test': { status: 200, body: {} },
      'text.test': { status: 200 },
      'ok.test': { status: 200, body: { did: 'did:web:ok.test', handle: 'x' } },
      // startsWith('did:') by code unit: the accent is after the colon.
      'mark.test': { status: 200, body: { did: 'did:\u0301web:mark.test' } },
      'upper.test': { status: 200, body: { did: 'DID:plc:upper' } },
    },
    steps: [
      {
        at: 0,
        ask: [
          'nope.test',
          'num.test',
          'empty.test',
          'text.test',
          'ok.test',
          'mark.test',
          'upper.test',
        ],
      },
      { at: 5, ask: ['nope.test', 'text.test'] },
    ],
  },
  {
    $id: 'encodes the handle into the URL',
    options: { appview: 'https://a.example/base' },
    table: { 'x-y.test': { status: 200, body: { did: 'did:plc:xy' } } },
    steps: [{ at: 0, ask: ['X-Y.test'] }],
  },
];

// A timeout AbortSignal.timeout refuses (written as text: JSON has no
// Infinity or NaN). Browsers and Node agree these throw; they differ on a
// fraction and on 2^32 to 2^53, which are left out. Past 2^32 Node writes
// the number with underscores, after every third character from the end,
// exponent and all.
const TIMEOUTS = [
  'Infinity',
  '-Infinity',
  'NaN',
  '-1',
  '-1.5',
  '-5000000000',
  '-4294967297',
  '9007199254740992',
  '1e300',
  '-1e21',
  '-1e-7',
];

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'findMentions',
      FIND.map((text) => ({ text })),
      ({ text }) => findMentions(text),
    )),
  );
  const partial = [];
  for (const text of PARTIAL)
    for (let cursor = -1; cursor <= text.length + 1; cursor++)
      partial.push({ text, cursor });
  out.push(
    ...(await each('detectPartialMention', partial, ({ text, cursor }) =>
      detectPartialMention(text, cursor),
    )),
  );
  const completed = [];
  for (const [text] of COMPLETED)
    for (const cursor of new Set([0, 3, 5, 12, 13, 14, text.length]))
      completed.push({ text, cursor });
  out.push(
    ...(await each('detectCompletedMentions', completed, ({ text, cursor }) =>
      detectCompletedMentions(text, cursor),
    )),
  );
  out.push(
    ...(await each(
      'isValidHandle',
      HANDLES.map((handle) => ({ handle })),
      ({ handle }) => isValidHandle(handle),
    )),
  );
  out.push(
    ...(await each(
      'createMentionFacet',
      [
        { text: 'hi @dame.art', did: 'did:plc:x', start: 3, end: 12 },
        { text: '\u{1F98B}@dame.art', did: 'did:plc:y', start: 2, end: 11 },
        { text: 'café @a.test', did: 'did:web:a.test', start: 5, end: 12 },
      ],
      ({ text, did, start, end }) =>
        createMentionFacet({ did }, start, end, createByteMap(text)),
    )),
  );
  out.push(
    ...(await each('createMentionResolver', SCENARIOS, (scenario) =>
      resolverScenario(scenario),
    )),
  );
  out.push(
    ...(await each(
      'resolverTimeout',
      TIMEOUTS.flatMap((timeoutMs) =>
        ['a.test', 'not a handle'].map((handle) => ({ timeoutMs, handle })),
      ),
      async ({ timeoutMs, handle }) => {
        const requests = [];
        const resolve = createMentionResolver({
          timeoutMs: Number(timeoutMs),
          fetch: async (url) => {
            requests.push(url);
            return answer(200, { did: 'did:plc:a' });
          },
        });
        const outcomes = [];
        for (let i = 0; i < 2; i++) {
          try {
            outcomes.push(await resolve(handle));
          } catch (error) {
            outcomes.push({ $throws: error.message });
          }
        }
        return { outcomes, requests };
      },
    )),
  );
  return out;
}
