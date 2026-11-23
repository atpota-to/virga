// JavaScript's own string and number behaviour, which the Swift ports lean
// on (VirgaCore/Support/JSCompat.swift): UTF-16 indexing, slice, substring,
// indexOf, trim, toFixed, Math.round and String(number).

import { each } from './_helpers.js';

export const sources = [
  'ios/VirgaKit/Sources/VirgaCore/Support/JSCompat.swift',
];

const STRINGS = [
  '',
  'hello world',
  'naïve café',
  '👍🏽 thumbs',
  'a👨‍👩‍👧b',
  '🇬🇧 flag',
  '﻿ bom\u0085 ',
  '   spaced\t\n',
  'x',
];

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'length',
      STRINGS.map((s) => ({ s })),
      ({ s }) => s.length,
    )),
  );
  out.push(
    ...(await each(
      'slice',
      STRINGS.flatMap((s) =>
        [
          [0, undefined],
          [1, 4],
          [-3, undefined],
          [2, -1],
          [5, 2],
          [0, 100],
        ].map(([start, end]) => ({ s, start, end: end ?? null })),
      ),
      ({ s, start, end }) => s.slice(start, end ?? undefined),
    )),
  );
  out.push(
    ...(await each(
      'substring',
      STRINGS.flatMap((s) =>
        [
          [0, null],
          [4, 1],
          [-2, 3],
          [2, 100],
        ].map(([start, end]) => ({ s, start, end })),
      ),
      ({ s, start, end }) => s.substring(start, end ?? undefined),
    )),
  );
  out.push(
    ...(await each(
      'indexOf',
      [
        { s: 'hello world', search: 'o', from: 0 },
        { s: 'hello world', search: 'o', from: 5 },
        { s: 'hello world', search: 'z', from: 0 },
        { s: '👍🏽 thumbs', search: 'th', from: 0 },
        { s: 'a👨‍👩‍👧b', search: 'b', from: 0 },
        { s: 'abc', search: '', from: 2 },
        { s: 'abc', search: '', from: 9 },
      ],
      ({ s, search, from }) => s.indexOf(search, from),
    )),
  );
  out.push(
    ...(await each(
      'lastIndexOf',
      [
        { s: 'a.b.c', search: '.' },
        { s: 'abc', search: 'z' },
        { s: 'abc', search: '' },
      ],
      ({ s, search }) => s.lastIndexOf(search),
    )),
  );
  out.push(
    ...(await each(
      'trim',
      STRINGS.map((s) => ({ s })),
      ({ s }) => s.trim(),
    )),
  );
  out.push(
    ...(await each(
      'trimStart',
      STRINGS.map((s) => ({ s })),
      ({ s }) => s.trimStart(),
    )),
  );
  out.push(
    ...(await each(
      'trimEnd',
      STRINGS.map((s) => ({ s })),
      ({ s }) => s.trimEnd(),
    )),
  );
  out.push(
    ...(await each(
      'utf8Offset',
      STRINGS.flatMap((s) =>
        [0, 1, 3, s.length].map((index) => ({ s, index })),
      ),
      ({ s, index }) => new TextEncoder().encode(s.slice(0, index)).length,
    )),
  );
  out.push(
    ...(await each(
      'toFixed',
      [
        0,
        -0,
        1.005,
        2.5,
        -2.5,
        0.125,
        1234.5678,
        0.1 + 0.2,
        -0.0001,
        99.995,
        1e-7,
        9.995,
        0.045,
        1.45,
        999.9999,
        123456789.987,
      ].flatMap((n) => [0, 1, 2].map((digits) => ({ n, digits }))),
      ({ n, digits }) => n.toFixed(digits),
    )),
  );
  out.push(
    ...(await each(
      'round',
      [0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 2.4999, -2.5001, 7].map((n) => ({ n })),
      ({ n }) => Math.round(n) + 0,
    )),
  );
  out.push(
    ...(await each(
      'numberString',
      [
        0,
        -0,
        1,
        -3,
        1.5,
        0.1 + 0.2,
        1e21,
        1.5e22,
        123456789,
        1 / 3,
        2.5e-7,
        1e-7,
        1.234e-6,
        0.000001,
        100,
        1e20,
        123.456,
        -0.5,
        5e-324,
        1.7976931348623157e308,
      ].map((n) => ({ n })),
      ({ n }) => String(n),
    )),
  );
  return out;
}
