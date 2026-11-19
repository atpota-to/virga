// src/posting/lib/tags.js: the record's `tags` field, normalized from a comma
// list or an array, and its text form. Swift: VirgaPosting/Lib/Tags.swift.
//
// Inputs from src/posting/lib/tags.test.js and composeIntent.test.js, plus
// the 640-byte cap in ZWJ emoji, Greek final sigma and Turkish dotted I in
// the case-blind dedupe, hidden characters, full-width hashes and values of
// every JSON type.

import {
  formatTags,
  MAX_TAG_BYTES,
  MAX_TAG_GRAPHEMES,
  MAX_TAGS,
  normalizeTags,
} from '../../../src/posting/lib/tags.js';
import { each, value } from './_helpers.js';

export const sources = ['src/posting/lib/tags.js'];

const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';

const INPUTS = [
  ' one, #two ,##three,  , ＃four',
  ['#a', 'b', 3, null, ' c '],
  'Rust, rust, RUST, go',
  Array.from({ length: 12 }, (_, i) => `t${i}`).join(','),
  'a'.repeat(70),
  '\u{1F44D}\u{1F3FD}'.repeat(70),
  ['\u{1F469}\u200D\u{1F4BB}', 'می\u200Cخواهم'],
  family.repeat(70),
  family.repeat(64),
  'tag\u200B, tag',
  'tag\uFEFF, \u00A0tag\u00A0, t\u0000ag',
  '',
  null,
  'birds, night ,lamp',
  '#birds, ##night',
  'Birds, birds, BIRDS',
  Array.from({ length: 30 }, (_, i) => `t${i}`).join(','),
  'x'.repeat(200),
  'birds,,, ,night',
  'ΣΑΣ, σας, σασ',
  'İstanbul, i\u0307stanbul, istanbul',
  'Straße, STRASSE, strasse',
  'é, e\u0301',
  '#, ##, ＃＃, # #',
  '#tag#, #tag',
  'a,b,c,d,e,f,g,h,i,j',
  42,
  0,
  true,
  false,
  { a: 1 },
  [],
  ['', ' ', '#'],
  [['nested'], { x: 1 }, 'ok'],
  'trailing,',
  ',leading',
  '\u3000ideographic\u3000space\u3000, x',
  'e\u0301,é',
];

export default async function cases() {
  const out = [
    value('constants', { MAX_TAGS, MAX_TAG_GRAPHEMES, MAX_TAG_BYTES }),
  ];
  out.push(
    ...(await each(
      'normalizeTags',
      INPUTS.map((input) => ({ input })),
      ({ input }) => normalizeTags(input),
    )),
  );
  out.push(
    ...(await each(
      'formatTags',
      [
        ['a', 'b'],
        null,
        [],
        ['one'],
        ['a', null, 3, 'b'],
        'not an array',
        { a: 1 },
      ].map((tags) => ({ tags })),
      ({ tags }) => formatTags(tags),
    )),
  );
  return out;
}
