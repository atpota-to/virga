// Grapheme counting and truncation: what every length limit in a post is
// measured in. Swift: VirgaCore/Graphemes.swift.

import {
  countGraphemes,
  truncateGraphemes,
} from '../../../src/posting/lib/graphemes.js';
import { each } from './_helpers.js';

export const sources = ['src/posting/lib/graphemes.js'];

const TEXTS = [
  '',
  'hello',
  'héllo wörld',
  'é',
  '👍',
  '👍🏽',
  '👨‍👩‍👧‍👦',
  '🏳️‍🌈',
  '🇬🇧🇫🇷',
  'नमस्ते',
  '한국어',
  'a‍b',
  'tab\tand\nnewline',
  '𝔘𝔫𝔦𝔠𝔬𝔡𝔢',
  'mixed 👩🏾‍💻 text with café and 🇯🇵',
  'x'.repeat(301),
];

export default async function cases() {
  return [
    ...(await each(
      'countGraphemes',
      TEXTS.map((text) => ({ text })),
      ({ text }) => countGraphemes(text),
    )),
    ...(await each(
      'truncateGraphemes',
      TEXTS.flatMap((text) => [0, 1, 3, 300].map((max) => ({ text, max }))),
      ({ text, max }) => truncateGraphemes(text, max),
    )),
  ];
}
