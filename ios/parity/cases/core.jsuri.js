// JavaScript's URI coding and Number(), which the Swift ports lean on
// (VirgaCore/Support/JSURI.swift, JSCoercion.swift and JSCompat.swift's
// Math.round): encodeURIComponent, encodeURI, decodeURIComponent and
// decodeURI with their failures, what Number() makes of a value, and
// Math.round where floor(x + 0.5) would be wrong.

import { each } from './_helpers.js';

export const sources = [
  'ios/VirgaKit/Sources/VirgaCore/Support/JSURI.swift',
  'ios/VirgaKit/Sources/VirgaCore/Support/JSCoercion.swift',
  'ios/VirgaKit/Sources/VirgaCore/Support/JSCompat.swift',
];

const PLAIN = [
  '',
  'hello world',
  'a+b=c&d',
  "-_.!~*'()",
  ';/?:@&=+$,#',
  'naïve café',
  '👍🏽 thumbs',
  '日本語',
  'at://did:plc:abc/app.bsky.feed.post/3k',
  '100%',
  'tab\tnew\nline',
  '[brackets]{braces}|pipe\\back^caret`tick"quote<>',
];

const ENCODED = [
  '',
  'hello%20world',
  'my%20board',
  'caf%C3%A9',
  'caf%c3%a9',
  '%F0%9F%91%8D',
  '%E6%97%A5%E6%9C%AC',
  '%2F%3F%23%26%3D%2B%24%2C%3B%3A%40',
  '%41%42%43',
  '%',
  '%2',
  '%zz',
  '100%',
  '%%41',
  '%C3',
  '%C3%',
  '%C3%2',
  '%C3%28',
  '%E6%97',
  '%80',
  '%BF',
  '%C0%80',
  '%C1%BF',
  '%E0%80%80',
  '%ED%A0%80',
  '%ED%9F%BF',
  '%EE%80%80',
  '%F0%80%80%80',
  '%F4%8F%BF%BF',
  '%F4%90%80%80',
  '%F8%80%80%80%80',
  '%FF',
  'plain text',
  'a%20b%2Fc',
];

const NUMBERS = [
  null,
  true,
  false,
  0,
  12.5,
  '',
  ' ',
  '12',
  ' 12 ',
  '\n12\t',
  ' 12﻿',
  '12px',
  '1e3',
  '1E-3',
  '1e',
  '.5',
  '5.',
  '.',
  '+5',
  '-5',
  '+-5',
  '0x1F',
  '0X1f',
  '-0x1F',
  '0x',
  '0xG',
  '0o17',
  '0b101',
  '0b102',
  '00012',
  '1_000',
  '1,000',
  'Infinity',
  '-Infinity',
  '+Infinity',
  'infinity',
  'NaN',
  '1e1000',
  '-1e1000',
  '١٢',
  'six',
  [],
  [5],
  ['7'],
  [1, 2],
  [null],
  [[3]],
  {},
  { a: 1 },
];

const ROUNDS = [
  0.5,
  1.5,
  2.5,
  -0.5,
  -1.5,
  -2.5,
  -0.4,
  -0.6,
  0.49999999999999994,
  -0.49999999999999994,
  4503599627370495.5,
  -4503599627370495.5,
  2 ** 53,
  1e21,
  -1e-300,
  0.1,
  123.456,
  -123.456,
];

const signed = (n) => (Object.is(n, -0) ? '-0' : n);

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'encodeURIComponent',
      PLAIN.map((s) => ({ s })),
      ({ s }) => encodeURIComponent(s),
    )),
  );
  out.push(
    ...(await each(
      'encodeURI',
      PLAIN.map((s) => ({ s })),
      ({ s }) => encodeURI(s),
    )),
  );
  out.push(
    ...(await each(
      'decodeURIComponent',
      ENCODED.map((s) => ({ s })),
      ({ s }) => decodeURIComponent(s),
    )),
  );
  out.push(
    ...(await each(
      'decodeURI',
      ENCODED.map((s) => ({ s })),
      ({ s }) => decodeURI(s),
    )),
  );
  out.push(
    ...(await each(
      'URLSearchParams.toString',
      [
        [['q', 'the heron']],
        [
          ['actor', 'did:plc:abc'],
          ['limit', '50'],
          ['cursor', '3k/x+y=z&w'],
        ],
        [
          ['text', "naïve 👍🏽 café ~*-._!'()"],
          ['url', 'https://ex.com/a?b=c#d'],
        ],
        [
          ['uris', 'at://a/b/c'],
          ['uris', 'at://d/e/f'],
        ],
        [
          ['', ''],
          ['empty', ''],
        ],
        [
          ['tab', '\t\n\r'],
          ['percent', '100%'],
        ],
      ].map((pairs) => ({ pairs })),
      ({ pairs }) => new URLSearchParams(pairs).toString(),
    )),
  );
  out.push(
    ...(await each(
      'URLSearchParams.parse',
      [
        '?text=hello+world&url=https%3A%2F%2Fex.com&tags=a,b',
        'text=caf%C3%A9%20%F0%9F%91%8D',
        '?a=1&a=2&b',
        '&&a=1&&',
        '?=x&y=',
        'bad=%zz%2&half=%C3&lone=%&x=%2',
        'eq=a=b=c',
        'plus=%2B+',
        '?',
        '',
        '??a=1',
        'emoji=👍&x=%E2%9C',
      ].map((query) => ({ query })),
      ({ query }) => [...new URLSearchParams(query)],
    )),
  );
  out.push(
    ...(await each(
      'Number',
      NUMBERS.map((value) => ({ value })),
      ({ value }) => {
        const n = Number(value);
        return Number.isNaN(n)
          ? 'NaN'
          : Number.isFinite(n)
            ? signed(n)
            : String(n);
      },
    )),
  );
  out.push(
    ...(await each(
      'round',
      ROUNDS.map((n) => ({ n })),
      ({ n }) => signed(Math.round(n)),
    )),
  );
  return out;
}
