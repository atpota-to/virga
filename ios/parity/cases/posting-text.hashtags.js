// src/posting/lib/hashtags.js: hashtags by Bluesky's rule. Swift:
// VirgaPosting/Lib/Hashtags.swift.
//
// Inputs from src/posting/lib/hashtags.test.js, plus every zero-width
// character that ends a tag, keycaps, the 64-grapheme edge in emoji, full-width
// and Unicode punctuation at the end, digits from other scripts.

import {
  findHashtags,
  isValidHashtag,
  MAX_HASHTAG_GRAPHEMES,
} from '../../../src/posting/lib/hashtags.js';
import { each, value } from './_helpers.js';

export const sources = ['src/posting/lib/hashtags.js'];

const TEXTS = [
  '#owl and #cats',
  'line\n#one\t#two',
  '#café time',
  '#日本 #Ünïcödé',
  'hi #café',
  '#123 #1st #2024',
  'so #good!',
  '#one, #two. #three?!',
  '#a.b #x-y #under_score',
  'C#sharp https://example.com/#anchor a#b',
  '＃tag',
  '#\uFE0F\u20E3 # alone',
  `#${'a'.repeat(64)}`,
  `#${'a'.repeat(65)}`,
  `#${'\u{1F44D}\u{1F3FD}'.repeat(64)}`,
  `#${'\u{1F44D}\u{1F3FD}'.repeat(65)}`,
  '#one\u200Btwo',
  '#one\u200Ctwo #a\u200Db #x\u2060y #s\u00ADt #h\u200Aj #k\u20E2l',
  '#\u{1F98B}',
  '#\u{1F98B}\u{1F98B} #\u{1F469}\u200D\u{1F52C}',
  '##double',
  '#a#b#c',
  '#tag、next',
  '#tag」',
  '#١٢٣',
  '#１２',
  '#!!!',
  '#a!!!b!!!',
  '#"quoted"',
  '#(paren)',
  '#\u0301mark',
  '\u3000#ideographic',
  '\u00A0#nbsp',
  '\u2028#ls',
  '\uFEFF#bom',
  '\u0085#nel',
  '#tag\u0085after',
  '#e\u0301te',
  '#😀😀😀!',
  '#$money',
  '#+plus',
  '#',
  '#  ',
  '',
  'no tags',
  '\t#tab',
];

export default async function cases() {
  const out = [value('MAX_HASHTAG_GRAPHEMES', MAX_HASHTAG_GRAPHEMES)];
  out.push(
    ...(await each(
      'findHashtags',
      [...TEXTS.map((text) => ({ text })), { text: null }],
      ({ text }) => findHashtags(text),
    )),
  );
  out.push(
    ...(await each(
      'isValidHashtag',
      [
        'café',
        '123',
        '',
        'two words',
        7,
        null,
        'a'.repeat(64),
        'a'.repeat(65),
        '\u{1F44D}\u{1F3FD}'.repeat(64),
        'tab\there',
        'nbsp\u00A0here',
        '１',
        '1st',
        '.',
      ].map((tag) => ({ tag })),
      ({ tag }) => isValidHashtag(tag),
    )),
  );
  return out;
}
