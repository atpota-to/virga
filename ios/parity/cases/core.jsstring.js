// JavaScript's toLowerCase and toUpperCase, which the Swift ports case-fold
// with (VirgaCore/Support/JSCase.swift): Unicode's full mappings, the
// special cases (İ, ß, ligatures, title-case letters), and Greek capital
// sigma, which lowers to final ς at the end of a word and σ elsewhere.

import { each } from './_helpers.js';

export const sources = ['ios/VirgaKit/Sources/VirgaCore/Support/JSCase.swift'];

const TEXTS = [
  '',
  'Alice.Bsky.Social',
  'ABC xyz 123 _-.',
  // Final sigma, in every context the rule has.
  'ΟΔΟΣ',
  'ΟΔΟΣ ΚΑΙ ΔΡΟΜΟΣ',
  'ΣΑΣ',
  'Σ',
  'ΑΣ',
  'ΣΑ',
  ' Σ ',
  'ΑΣ.',
  'ΑΣ.Β',
  'ΟΔΟΣ.test',
  'ΑΣ1',
  'ΑΣΑ',
  "ΑΣ'",
  "Α'Σ",
  "Α'Σ'Α",
  'ΆΣ',
  'ΑΣ́',
  'ΑΣ́Α',
  'aΣ',
  'aΣb',
  'ΑΣ👍',
  '#ΚΑΛΗΜΕΡΑΣ',
  'σς',
  // Full and special mappings.
  'İstanbul',
  'İ',
  'ß straße',
  'ǅǄǆ',
  'ﬀ ﬁ ﬂ ﬃ',
  'ΐ ΰ',
  'ŉ',
  'ǰ',
  'ﬓ',
  'Ⅻ ⅻ',
  'ＡＢＣ ａｂｃ',
  '𐐀𐐨',
  'Ꭰꭰ',
  'ᾈ ᾳ ῼ',
  'ı',
  'K Å Ω',
  'µ',
  'ÿ Ÿ',
  'Ꞵꞵ',
  // Untouched.
  '👍🏽 日本語 ١٢٣',
  '́',
];

export default async function cases() {
  return [
    ...(await each(
      'toLowerCase',
      TEXTS.map((text) => ({ text })),
      ({ text }) => text.toLowerCase(),
    )),
    ...(await each(
      'toUpperCase',
      TEXTS.map((text) => ({ text })),
      ({ text }) => text.toUpperCase(),
    )),
  ];
}
