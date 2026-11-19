// src/posting/lib/threadSplit.js: one over-long post cut into a thread, at
// the cheapest breaks, never inside a link, mention, address, hashtag,
// inline link or grapheme cluster, counted as the composer counts, with
// optional "2/5" counters; and the counters read, stripped and renumbered.
// Swift: VirgaPosting/Lib/ThreadSplit.swift.
//
// Inputs: every case of src/posting/lib/threadSplit.test.js, and its seeded
// random texts (the same generator, copied here) at both limits, with and
// without numbering, so the whole cost model is exercised, not only the
// examples.

import {
  joinThread,
  readCounter,
  renumberThread,
  splitIntoThread,
  stripCounter,
  threadNumbering,
  THREAD_NUMBERING,
} from '../../../src/posting/lib/threadSplit.js';
import { each, value } from './_helpers.js';

export const sources = ['src/posting/lib/threadSplit.js'];

// The test's seeded generator (mulberry32) and word lists.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAIN = [
  'the',
  'river',
  'ran',
  'high',
  'after',
  'a',
  'storm',
  'and',
  'herons',
  'came',
  'back',
  'to',
  'it',
  'café',
  'naïve',
  'Zoë',
  'über',
];
const SPECIAL = [
  'https://example.org/a/long/path/that/keeps/going?x=1&y=2',
  'https://en.wikipedia.org/wiki/Bee_(disambiguation)',
  'example.com',
  'bsky.app/profile/someone.example',
  '@alice.example.com',
  '@lab.example.org',
  'reader@example.org',
  '#weather',
  '#日本',
  '[a few words](https://example.org/somewhere/else)',
  '[one](example.org)',
  '👨\u200D👩\u200D👧\u200D👦',
  '🇯🇵',
  '"quoted"',
  '(aside)',
  'v1.2.3',
  '3/5',
  'これは文です。次の文です。',
  '"https://example.org/quoted/path/long/enough/to/shorten"',
  'x@https://a.example/long/path/here/and/more',
  'end.Next',
  'abc.de§§§',
];
const ENDS = ['.', '.', '.', '!', '?', '…', ','];
const GAPS = [' ', ' ', ' ', ' ', ' ', '\n', '\n\n', '  '];

function randomText(next, length, { run = 0 } = {}) {
  let out = '';
  while (out.length < length) {
    const special = next() < 0.12;
    const list = special ? SPECIAL : PLAIN;
    out += list[Math.floor(next() * list.length)];
    if (next() < 0.18) out += ENDS[Math.floor(next() * ENDS.length)];
    if (!run || next() < 0.9) out += GAPS[Math.floor(next() * GAPS.length)];
    if (run && next() < 0.01)
      out += `${'q'.repeat(run + Math.floor(next() * run))} `;
  }
  return out.trim();
}

const sentence =
  'The river ran high after the storm and the herons came back. ';
const filler = (n) => 'word '.repeat(n);
const family = '👨\u200D👩\u200D👧\u200D👦';
const flag = '🇯🇵';

const FIXED = [
  { text: 'short' },
  { text: '' },
  { text: null },
  { text: '  padded  ' },
  { text: 'a'.repeat(300) },
  { text: 'a'.repeat(301) },
  { text: 'short', options: { numbering: 'counter' } },
  { text: 'a'.repeat(298), options: { numbering: 'counter' } },
  {
    text: `https://example.org/${'a'.repeat(400)} ${'w '.repeat(100).trim()}`,
  },
  {
    text: `${'word '.repeat(50)}[the report](https://example.org/${'r'.repeat(300)})`,
  },
  { text: sentence.repeat(12).trim() },
  { text: sentence.repeat(9).trim() },
  { text: `${sentence.repeat(3).trim()}\n\n${sentence.repeat(4).trim()}` },
  { text: [1, 2, 3].map(() => sentence.repeat(3).trim()).join('\n\n') },
  { text: [1, 2, 3, 4].map(() => sentence.repeat(2).trim()).join('\n\n') },
  {
    text: Array.from(
      { length: 9 },
      (_, i) => `- item ${i + 1}: something to do. And why it matters`,
    ).join('\n'),
  },
  { text: `${'word '.repeat(90).trim()}.` },
  {
    text: Array(6)
      .fill(`Then ${'word '.repeat(30)}here.`)
      .join(' '),
  },
  { text: `Hi all. ${'word '.repeat(100).trim()}` },
  ...[
    'Meet Dr. Okafor at the lab tomorrow to go over all of it again please',
    'Written by J. Okafor at the lab tomorrow to go over all of it again',
    'Three things: 1. Okafor at the lab tomorrow to go over all of it now',
    'It works, e.g. at the lab tomorrow we go over all of it again and again',
    'It works, I.E. at the lab tomorrow we go over all of it again and again',
    'Ask St. Clair at the lab tomorrow to go over all of it again please now',
    'Ask ſt. Clair at the lab tomorrow to go over all of it again please now',
    'See \u201C(e.g. at the lab tomorrow we go over all of it again and again',
    'Read it. then at the lab tomorrow we go over all of it again and again',
    'Read it! Then at the lab tomorrow we go over all of it again and again',
    'Read it.) Then at the lab tomorrow we go over all of it again and again',
    'Read it.」Then at the lab tomorrow we go over all of it again and again',
  ].map((tail) => ({ text: `${'x'.repeat(250)} ${tail}` })),
  { text: 'z'.repeat(650) },
  { text: 'これは日本語の文章です。'.repeat(40) },
  { text: (family + flag + 'é').repeat(120), options: { limit: 100 } },
  { text: family.repeat(290) },
  ...[
    'https://example.org/a/long/path?with=a&query=string#and-a-fragment',
    'example.org/a/bare/domain/with/a/path',
    'https://en.wikipedia.org/wiki/Bee_(disambiguation)',
  ].flatMap((url) =>
    [50, 53, 55, 57, 60].map((n) => ({
      text: `${filler(n)}${url} ${filler(20)}`.trim(),
    })),
  ),
  ...['@alice.example.com', 'reader@example.org'].flatMap((mention) =>
    [54, 56, 58, 60].map((n) => ({
      text: `${filler(n)}${mention} ${filler(20)}`.trim(),
    })),
  ),
  ...[54, 57, 60].map((n) => ({
    text: `${filler(n)}#ThingsThatAreLongToSay ${filler(20)}`.trim(),
  })),
  ...[50, 54, 58, 60].map((n) => ({
    text: `${filler(n)}[a label of several words](https://example.org/a/b/c) ${filler(20)}`.trim(),
  })),
  {
    text: `${filler(56)}[bsky.app is here](https://elsewhere.example/x) ${filler(20)}`.trim(),
  },
  ...[
    'https://example.org/path/to/a/thing',
    '[ラベル](https://example.org/x)',
  ].map((mark) => ({ text: `${'あ'.repeat(280)}${mark}${'あ'.repeat(280)}` })),
  {
    text: `[a few words](https://example.org/somewhere/else)${'q'.repeat(400)}`,
  },
  { text: `${'あ'.repeat(299)}#日本${'い'.repeat(100)}` },
  { text: `${'あ'.repeat(299)}@alice.example.com${'い'.repeat(100)}` },
  { text: `${'あ'.repeat(289)}example.comあ${'い'.repeat(100)}` },
  {
    text: `${'あ'.repeat(299)}"https://example.org/a/path/long/enough/to/shorten"`,
  },
  {
    text: `Before it. [${'word '.repeat(70).trim()}](https://example.org/x) After it.`,
  },
  { text: sentence.repeat(14).trim(), options: { numbering: 'counter' } },
  { text: sentence.repeat(14).trim(), options: { numbering: 'off' } },
  {
    text: sentence.repeat(14).trim(),
    options: { numbering: 'counter', before: 2, after: 1 },
  },
  {
    text: `${sentence.repeat(14).trim()}\n\n11/14`,
    options: { numbering: 'counter' },
  },
  {
    text: `${'a'.repeat(294)} ${'a'.repeat(294)}`,
    options: { numbering: 'counter' },
  },
  { text: 'b'.repeat(293 * 9), options: { numbering: 'counter' } },
  { text: 'c'.repeat(293 * 101), options: { numbering: 'counter' } },
  { text: sentence.repeat(12).trim(), options: { maxPosts: 2 } },
  { text: sentence.repeat(12).trim(), options: { maxPosts: 1 } },
  { text: sentence.repeat(12).trim(), options: { maxPosts: 0 } },
  { text: sentence.repeat(12).trim(), options: { maxPosts: 2.7 } },
  { text: sentence.repeat(12).trim(), options: { maxPosts: 3 } },
  {
    text: sentence.repeat(12).trim(),
    options: { maxPosts: 2, numbering: 'counter' },
  },
  { text: sentence.repeat(5).trim(), options: { limit: 50 } },
  { text: sentence.repeat(5).trim(), options: { limit: 1 } },
  {
    text: sentence.repeat(5).trim(),
    options: { limit: 5, numbering: 'counter' },
  },
  { text: `${'é'.repeat(1600)}` },
  { text: `${'\u{1F98B}'.repeat(800)}` },
  { text: `line one\r\nline two\r\n\r\n${sentence.repeat(8)}` },
  { text: `${sentence.repeat(6)}\u00A0${sentence.repeat(6)}` },
  { text: `${'word\u3000'.repeat(80)}` },
  { text: `${'#tag '.repeat(70)}` },
  { text: `${'@a.test '.repeat(45)}` },
  { text: `${'https://e.co/x '.repeat(30)}` },
  { text: `${sentence.repeat(4)}\n\n\n\n${sentence.repeat(4)}` },
];

const RANDOM = [];
for (let seed = 1; seed <= 50; seed++) {
  const next = rng(seed);
  const limit = seed % 2 ? 300 : 120;
  RANDOM.push({
    $id: `random seed ${seed}`,
    text: randomText(next, 200 + Math.floor(next() * 3000), {
      run: limit === 120 ? 130 : 0,
    }),
    options: { limit },
  });
}
for (let seed = 500; seed <= 520; seed++) {
  const next = rng(seed);
  RANDOM.push({
    $id: `random numbered seed ${seed}`,
    text: randomText(next, 400 + Math.floor(next() * 3000)),
    options: { numbering: 'counter' },
  });
}
for (let seed = 900; seed <= 910; seed++) {
  const next = rng(seed);
  RANDOM.push({
    $id: `random 200 seed ${seed}`,
    text: randomText(next, 2000),
    options: { limit: 200 },
  });
}

const COUNTERS = [
  'Words.\n\n2/5',
  'Words.\n2/5  ',
  '12/25',
  'I\u2019d give it 4/5',
  '2/5\n\nWords.',
  'Words.\n\n2 of 5',
  '',
  null,
  'Words.\n \t2/5',
  'Words.\n\u00A02/5',
  'Words.\n\n12345/5',
  'Words.\n\n1/2/3',
  'Words.\r\n2/5',
  'Words.\n\n٢/٥',
  'Words. \n\n 0/0 ',
  'Scores so far:\n3/5',
  '\n\n1/2',
  'a\n\nb\n\n3/4',
];

export default async function cases() {
  const out = [value('THREAD_NUMBERING', THREAD_NUMBERING)];
  out.push(
    ...(await each(
      'splitIntoThread',
      [...FIXED, ...RANDOM],
      ({ text, options }) => splitIntoThread(text, options),
    )),
  );
  out.push(
    ...(await each(
      'readCounter',
      COUNTERS.map((text) => ({ text })),
      ({ text }) => readCounter(text),
    )),
  );
  out.push(
    ...(await each(
      'stripCounter',
      [...COUNTERS, 'Words, rated 4/5'].map((text) => ({ text })),
      ({ text }) => stripCounter(text),
    )),
  );
  out.push(
    ...(await each(
      'joinThread',
      [
        {
          posts: ['One.\n\n1/2', 'Two.\n\n2/2'],
          options: { numbering: 'counter' },
        },
        { posts: ['One.\n\n1/2', 'Two.'] },
        { posts: ['One.', '', 'Two.'] },
        { posts: null },
        { posts: ['  a  ', '\n\nb\n', '   '] },
        {
          posts: ['a\n\n1/3', 'b\n\n9/9', 'c'],
          options: { numbering: 'counter' },
        },
      ],
      ({ posts, options }) => joinThread(posts, options),
    )),
  );
  out.push(
    ...(await each(
      'threadNumbering',
      [
        ['One.', 'Two.'],
        ['One.\n\n1/2', 'Two.\n\n2/2'],
        ['One.\n\n1/3', 'Three.\n\n3/3'],
        ['One.\n\n1/2', 'Two.\n\n2/2', 'New.'],
        ['Two.\n\n2/2', 'One.\n\n1/2'],
        ['Scores so far:\n3/5', 'More.'],
        ['Only.\n\n1/3'],
        null,
        [],
        ['a\n\n1/3', 'b\n\n2/3', 'c\n\n3/3'],
        ['a\n\n1/3', 'b', 'c\n\n3/3'],
      ].map((texts) => ({ texts })),
      ({ texts }) => threadNumbering(texts),
    )),
  );
  out.push(
    ...(await each(
      'renumberThread',
      [
        ['One.\n\n1/3', 'New, by hand.', 'Three.\n\n3/3'],
        ['B.\n\n2/2', 'A.\n\n1/2'],
        ['One.\n\n1/2', ''],
        ['Only.\n\n1/3'],
        ['a\n\n4/9', 'b', 'c\n\n1/9'],
        null,
        [],
        ['  spaced  \n\n', 'x'],
      ].map((texts) => ({ texts })),
      ({ texts }) => renumberThread(texts),
    )),
  );
  return out;
}
