// How `new URL()` turns a host into ASCII (UTS #46 over Node's URL parser,
// Ada), character by character, for the Swift port's own WHATWG parser
// (VirgaPosting/Support/IDNA.swift over the table
// ios/scripts/generate-idna-table.mjs derives from Node).
//
// `host`: for a code point, the hostname of five hosts that expose its
// status and mapping (alone), its bidi class (between Latin letters, after
// two Hebrew ones, after one, after a Hebrew letter and an Arabic-Indic
// digit), as one string, `-` for a refused host. Every code point of the
// right-to-left blocks, and a sample of the rest.
//
// `bidiShapes`: Ada's bidi and joiner rules over every label of up to three
// characters drawn from each bidi class, a string of 1s and 0s per first
// character.

import { domainToASCII } from 'node:url';
import { each } from './_helpers.js';

export const sources = [
  'src/posting/lib/linkShortening.js',
  'src/posting/lib/inlineLinks.js',
];

const hostname = (s) => {
  try {
    return new URL(`https://${s}.com`).hostname;
  } catch {
    return '-';
  }
};
const forms = (c) => [
  c,
  `a${c}a`,
  `${c}\u05D0\u05D0`,
  `\u05D0${c}`,
  `\u05D0\u0661${c}`,
];

const POINTS = [];
const add = (from, to, step = 1) => {
  for (let cp = from; cp <= to; cp += step) POINTS.push(cp);
};
add(0x0590, 0x08ff);
add(0xfb1d, 0xfdff, 3);
add(0xfe70, 0xfeff, 2);
add(0x10800, 0x10fff, 13);
add(0x1e800, 0x1efff, 13);
add(0x80, 0x058f, 5);
add(0x0900, 0xd7ff, 131);
add(0xe000, 0xfb1c, 67);
add(0x10000, 0x107ff, 97);
add(0x11000, 0x1e7ff, 397);
add(0x1f000, 0x2ffff, 997);
add(0xe0000, 0xe01ef, 31);
for (const cp of [
  0x00df, 0x03c2, 0x1e9e, 0x200b, 0x200c, 0x200d, 0x2060, 0x3002, 0xfe0f,
  0xff0e, 0xff61, 0x1f44d, 0x1f600, 0x2f800, 0x2fa1d,
])
  POINTS.push(cp);

const CHARS = {
  L: 'a',
  Lm: '\u0915',
  R: '\u05D0',
  AL: '\u0627',
  AN: '\u0661',
  EN: '1',
  EN2: '\u06F1',
  ES: '-',
  ET: '$',
  CS: ',',
  ON: '!',
  ONe: '\u{1F44D}',
  NSM: '\u05B0',
  ZWNJ: '\u200C',
  ZWJ: '\u200D',
  V: '\u094D',
  D: '\u0628',
};
const KEYS = Object.keys(CHARS);

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'host',
      [...new Set(POINTS)].map((cp) => ({ cp })),
      ({ cp }) => forms(String.fromCodePoint(cp)).map(hostname).join(' '),
    )),
  );
  const chars = Object.values(CHARS);
  out.push(
    ...(await each(
      'bidiShapes',
      KEYS.map((key) => ({ $id: key, first: CHARS[key], chars })),
      ({ first }) => {
        let bits = '';
        for (const second of ['', ...chars])
          for (const third of ['', ...chars]) {
            if (!second && third) continue;
            bits += domainToASCII(first + second + third) ? '1' : '0';
          }
        return bits;
      },
    )),
  );
  return out;
}
