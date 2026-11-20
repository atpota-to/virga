// src/posting/lib/facets.js: mentions, links and hashtags as the byte
// ranges a record carries, in the live preview (stand-in DIDs) and on submit
// (every mention resolved). Swift: VirgaPosting/Lib/Facets.swift.
//
// facets.js remembers what each submit learned in a module-level Map read
// with Date.now(). Every case here runs at its own instant a day after the
// last (Date.now is pinned to a clock that only moves forward, shared with
// posting-text.inlineLinks.js, which detects too), so nothing one case
// learned is fresh for the next, and the Swift test gives each case a new
// MentionValidationCache. Outputs hold no absolute time. The `scenario` cases walk the cache's five-minute TTL
// step by step. A resolver is a table, handle → DID (null for none,
// "$throw" for a failed lookup); its calls are recorded sorted, since
// distinct handles are resolved in parallel.
//
// Inputs from src/posting/lib/facets.test.js (all of it), inlineLinks and
// linkShortening tests, and more: every quote shape, record links of each
// kind, emails, look-alike domains, hashtags against links.

import {
  detectAndCreateFacetsOptimized,
  detectFacets,
} from '../../../src/posting/lib/facets.js';
import { DAY, each } from './_helpers.js';

export const sources = ['src/posting/lib/facets.js'];

// One clock for every generator that runs facets.js, so a later case is
// always more than a day after anything cached, whatever order they run in.
const CLOCK = Symbol.for('virga.parity.facetsClock');
export function nextDay() {
  globalThis[CLOCK] = (globalThis[CLOCK] ?? Date.UTC(2026, 0, 1)) + DAY;
  return globalThis[CLOCK];
}

export async function at(time, fn) {
  const real = Date.now;
  Date.now = () => time;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}

function resolverFrom(table, calls) {
  return async (handle) => {
    calls.push(handle);
    const answer = table?.[handle];
    if (answer === '$throw') throw new Error('offline');
    return answer ?? null;
  };
}

async function run({ text, mode, validated = [], invalidated = [], table }) {
  const calls = [];
  const result =
    mode === 'submit'
      ? await detectFacets(text, {
          resolveMention: resolverFrom(table, calls),
          validatedHandles: new Set(validated),
          invalidatedHandles: new Set(invalidated),
        })
      : await detectAndCreateFacetsOptimized(
          text,
          true,
          new Set(validated),
          new Set(invalidated),
        );
  return { result, calls: calls.sort() };
}

const g = (grapheme) => `${grapheme} #note @automeris.test https://example.com`;

const PREVIEW = [
  '#owl',
  '#owls',
  'wow #cool',
  '#cool and #cats',
  'a.co #owl',
  '@zizyphia.test',
  'this path is just thoughts',
  'a calm walk',
  '',
  '   ',
  'no news',
  'hi @zenaida.test ok',
  '@automeris.bsky.social hi',
  "@hemileuca.test's note",
  '@paratrea.test\u2019s note',
  'see "@darapsa.test" ok',
  'see "@amphion.test hi" ok',
  'see "@amphion.test.extra" ok',
  'see " @amphion.test" ok',
  'see "@amphion.test/x" ok',
  'see "@amphion.test" and "@b.test"',
  'hi @sphingicampa.test\u{1F98B}',
  'hi @sphingicampa.test\u{1F469}\u200D\u{1F52C}',
  'hi @sphingicampa.test…',
  'hi @sphingicampa.test...',
  'thanks @sphingicampa.test.',
  'hi @sphingicampa.test, ok',
  'notes (@sphingicampa.test) ok',
  'hi @sphingicampa.test日本',
  '\u201Chi @sphingicampa.test\u201D',
  '\u{1F98B}@sphingicampa.test\u{1F98B}',
  '日@sphingicampa.test本',
  'a@b.com',
  'write to note9@citioica.test today',
  'see https://example.com/@eupackardia.test/repo now',
  '@saturniid hi',
  'see @saturniid.2b',
  '@saturniid..test',
  '@saturniid.test- ok',
  'see https://example.com/a ok',
  'see https://example.com/a',
  'see https://example.com/a\nok',
  'see https://example.com/a, ok',
  'go example.com now',
  'Did you see https://example.com/page? Read https://example.com/b.',
  'See (https://example.com/page) or <https://example.com/x>',
  'join https://example.com/subscribe?email=reader@example.org&ref=@actiasluna.test now',
  'x https://bsky.app/profile/a.test/post/3k,y',
  'x https://bsky.app/profile/a.test/feed/whats-hot',
  'x https://bsky.app/profile/a.test',
  'x https://bsky.app/profile/a.test/lists/xyz',
  'x https://bsky.app/starter-pack/a.test/3p,y',
  'x https://aturi.to/did:plc:abc/app.bsky.feed.post/3x ',
  'x at://did:plc:abc/app.bsky.feed.post/3x ',
  'x bsky.app/profile/a.test/post/3k now',
  'v1.2.3 released',
  'open notes.txt now',
  'ping 192.168.0.1 twice',
  'go "example.com" now',
  `go ${'a'.repeat(63)}.com now`,
  `go ${'a'.repeat(64)}.com now`,
  'go sub.example.co.uk now',
  '"@agapema.test"',
  'go "example.com" now',
  'go "https://example.com/x" now',
  '"hi @agapema.test see https://example.com/x"',
  '\u201C@syssphinx.test\u201D',
  'go \u201Cexample.com\u201D now',
  'go \u201Chttps://example.com/x\u201D now',
  '\u201Chi @syssphinx.test see https://example.com/x\u201D',
  '#one @two.test https://three.com',
  'café #note',
  'café @quill.test',
  '\u{1F98B} #note',
  '\u{1F98B} @pyxi.test',
  g('\u{1F98B}'),
  g('\u{1F469}\u200D\u{1F52C}'),
  g('\u{1F44D}\u{1F3FD}'),
  g('\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'),
  'read https://example.com/page#section now',
  'a#tag',
  'post\n#owls',
  '#café #123 #1st',
  '#example.com',
  '#tag.com and #@x.test',
  'HTTPS://EXAMPLE.COM/PATH and http://example.org',
  'Example.COM and WWW.EXAMPLE.ORG',
  'https://bücher.de/x and bücher.de',
  '[label](https://example.com)',
  'mail me@x.com or @y.test or z@',
  '"https://example.com/x" and https://example.com/y',
  'x "example.com/path" y',
  'trailing https://example.com/path)',
  'see https://example.com/x.\nnext',
  '\u{1F98B}'.repeat(3) + ' https://e.co/' + 'é'.repeat(5),
  // The early exit's \b\w+\.\w{2,}\b is ASCII: these have no word.word.
  '日本.com',
  'é.co',
  'go to a.b now',
  'x.y1',
  'snake_case.py2',
  'naïve.fr',
  'Ⅻ.com',
  'ab.c\u0301d',
  null,
];

const VALIDATED = [
  { text: 'hi @dryocampa.test ok', validated: ['dryocampa.test'] },
  { text: '@citheronia.test', invalidated: ['citheronia.test'] },
  {
    text: '@eacles.test',
    validated: ['eacles.test'],
    invalidated: ['eacles.test'],
  },
  {
    text: '@a.test @b.test @c.test',
    validated: ['a.test', 'c.test'],
    invalidated: ['b.test'],
  },
  { text: '@A.Test', validated: ['a.test'] },
  // A Set compares code units: the Kelvin sign is not the K in the text.
  { text: '@Kate.test', validated: ['\u212Aate.test'] },
  {
    text: '@Kate.test',
    validated: ['Kate.test'],
    invalidated: ['\u212Aate.test'],
  },
  { text: '@Kate.test @kate.test', validated: ['kate.test'] },
];

const SUBMIT = [
  {
    text: '@hyalophora.test and @callosamia.test',
    table: {
      'hyalophora.test': 'did:plc:hyalophora',
      'callosamia.test': 'did:plc:hyalophora',
    },
  },
  {
    text: '@paonias.test and @paonias.test again',
    table: { 'paonias.test': 'did:plc:paonias' },
  },
  {
    text: '@arctiaone.test @arctiatwo.test',
    table: {
      'arctiaone.test': 'did:plc:arctiaone',
      'arctiatwo.test': 'did:plc:arctiatwo',
    },
  },
  { text: 'hi @antheraea.test', table: { 'antheraea.test': null } },
  { text: 'hi @actias.test and #luna', table: { 'actias.test': '$throw' } },
  {
    text: '\u{1F98B}@adelocephala.test\u{1F98B}',
    table: { 'adelocephala.test': 'did:plc:adelocephala' },
  },
  { text: 'a@b.com', table: { 'b.com': 'did:plc:x' } },
  {
    text: 'write to note9@citioica.test today',
    table: { 'citioica.test': 'did:plc:citioica' },
  },
  {
    text: 'see https://example.com/@eupackardia.test/repo now',
    table: { 'eupackardia.test': 'did:plc:x' },
  },
  {
    text: 'join https://example.com/subscribe?email=reader@example.org&ref=@actiasluna.test now',
    table: { 'actiasluna.test': 'did:plc:actiasluna' },
  },
  {
    text: '@optionsone.test #x',
    table: { 'optionsone.test': 'did:plc:opts' },
  },
  { text: 'hi @optionstwo.test', table: { 'optionstwo.test': '$throw' } },
  {
    text: '@a.test @b.test @a.test @c.test',
    table: { 'a.test': 'did:plc:a', 'b.test': '', 'c.test': '$throw' },
  },
  {
    text: 'see "@quoted.test" and @plain.test',
    table: { 'quoted.test': 'did:plc:q', 'plain.test': 'did:plc:p' },
  },
  { text: '@saturniid hi @x.test', table: { 'x.test': 'did:plc:x' } },
  {
    text: '@x.test',
    validated: ['x.test'],
    invalidated: ['x.test'],
    table: { 'x.test': 'did:plc:x' },
  },
  {
    text: '#one @two.test https://three.com',
    table: { 'two.test': 'did:plc:two' },
  },
  { text: 'no facets here at all', table: {} },
];

const SCENARIOS = [
  {
    $id: 'a submit caches the DID for five minutes, and not one millisecond longer',
    steps: [
      {
        at: 0,
        mode: 'submit',
        text: '@smerinthus.test',
        table: { 'smerinthus.test': 'did:plc:smerinthus' },
      },
      { at: 1, mode: 'preview', text: '@smerinthus.test' },
      { at: 299999, mode: 'preview', text: '@smerinthus.test' },
      { at: 300000, mode: 'preview', text: '@smerinthus.test' },
    ],
  },
  {
    $id: "a cached failure outranks the caller's validated set until the TTL lapses",
    steps: [
      {
        at: 0,
        mode: 'submit',
        text: '@sphinx.test',
        table: { 'sphinx.test': null },
      },
      {
        at: 10,
        mode: 'preview',
        text: '@sphinx.test',
        validated: ['sphinx.test'],
      },
      { at: 10, mode: 'preview', text: '@sphinx.test' },
      {
        at: 300000,
        mode: 'preview',
        text: '@sphinx.test',
        validated: ['sphinx.test'],
      },
      {
        at: 300000,
        mode: 'preview',
        text: '@sphinx.test',
        validated: ['sphinx.test'],
        invalidated: ['sphinx.test'],
      },
    ],
  },
  {
    $id: 'a resolution is reused in preview, ahead of validated',
    steps: [
      {
        at: 0,
        mode: 'submit',
        text: '@samia.test',
        table: { 'samia.test': 'did:plc:samia' },
      },
      {
        at: 5,
        mode: 'preview',
        text: '@samia.test',
        validated: ['samia.test'],
      },
      {
        at: 5,
        mode: 'preview',
        text: '@samia.test',
        invalidated: ['samia.test'],
      },
      {
        at: 6,
        mode: 'submit',
        text: '@samia.test @other.test',
        table: { 'samia.test': null, 'other.test': '$throw' },
      },
      { at: 7, mode: 'preview', text: '@samia.test @other.test' },
    ],
  },
];

export default async function cases() {
  const out = [];
  const timed = (input) => at(nextDay(), () => run(input));
  out.push(
    ...(await each(
      'preview',
      [...PREVIEW.map((text) => ({ text })), ...VALIDATED],
      (input) => timed({ ...input, mode: 'preview' }),
    )),
  );
  out.push(
    ...(await each('submit', SUBMIT, (input) =>
      timed({ ...input, mode: 'submit' }),
    )),
  );
  out.push(
    ...(await each('scenario', SCENARIOS, async ({ steps }) => {
      const base = nextDay();
      const results = [];
      for (const step of steps)
        results.push(await at(base + step.at, () => run(step)));
      return results;
    })),
  );
  return out;
}
