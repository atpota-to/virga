// `localeCompare` with no locale, which the reports break their ties with
// (tags, linked sites and languages in the Content report, list names in
// Lists you're on): pairs and whole lists of words, accents, cases,
// ligatures, digits, punctuation, other scripts and emoji, compared by
// Node's own collator. Swift: VirgaInsights/Support/JSCollation.swift, over
// the table ios/scripts/generate-collation-table.mjs reads from that
// collator.

import { each } from './_helpers.js';
import { HARD_TEXT, seeded } from './_insights.js';

export const sources = ['src/reports/models.js'];

/** What the reports sort by name: tags, sites, language tags, list names. */
const WORDS = [
  '',
  ' ',
  'a',
  'A',
  'b',
  'B',
  'z',
  'Z',
  'ab',
  'Ab',
  'aB',
  'AB',
  'abc',
  'abd',
  'gardens',
  'Gardens',
  'GARDENS',
  'garden',
  'bees',
  'Bees',
  'zine',
  'cafe',
  'café',
  'Café',
  'café',
  'cafés',
  'cafes',
  'naive',
  'naïve',
  'résumé',
  'resume',
  'Résumé',
  'ae',
  'Ae',
  'æ',
  'Æ',
  'af',
  'aé',
  'oe',
  'œ',
  'ss',
  'ß',
  'st',
  'straße',
  'strasse',
  'Strasse',
  'ø',
  'o',
  'ö',
  'p',
  'ł',
  'l',
  'm',
  'đ',
  'ð',
  'd',
  'e',
  'þ',
  'ŋ',
  'ə',
  'ı',
  'i',
  'İ',
  'ﬁ',
  'fi',
  'Fi',
  'ﬀ',
  'Ａ',
  'ａ',
  '½',
  '1/2',
  '1',
  '10',
  '2',
  '2024',
  '2026',
  'a1',
  'a10',
  'a2',
  '٣',
  '३',
  '3',
  '³',
  '-',
  '_',
  '.',
  '#',
  '@',
  '$',
  '€',
  '£',
  '©',
  '~',
  'a-b',
  'a_b',
  'a b',
  'ab-',
  'a.b',
  'example.com',
  'example.org',
  'www.example.com',
  'xn--bcher-kva.example',
  'bsky.app',
  'github.com',
  'en',
  'en-US',
  'en-GB',
  'fr',
  'pt-BR',
  'zh-Hant',
  'ja',
  'de',
  'Moderation list',
  'moderation list',
  'Muted accounts',
  'Art people',
  'art people',
  'Ärzte',
  'Arzte',
  'Zürich',
  'Zurich',
  'Ελληνικά',
  'ελληνικά',
  'αβγ',
  'Αβγ',
  'ς',
  'σ',
  'Русский',
  'русский',
  'ёж',
  'еж',
  'עברית',
  'العربية',
  'हिन्दी',
  '한국어',
  '日本語',
  '中文',
  'ひらがな',
  'カタカナ',
  '😀',
  '😁',
  '👍',
  '👍🏽',
  '❤',
  '🇳🇿',
  'ok👍',
  'ok',
  ' ',
  'a b',
  'a\tb',
  'a​b',
  'a­b',
];

export default async function cases() {
  const out = [];
  const pairs = [];
  for (let i = 0; i < WORDS.length; i += 1) {
    for (let j = i + 1; j < WORDS.length; j += 6) {
      pairs.push({ a: WORDS[i], b: WORDS[j] });
    }
  }
  // Seeded text from the pool of hard text, short enough to tie often.
  const rand = seeded(20261121);
  for (let i = 0; i < 1000; i += 1) {
    const a = rand.string(HARD_TEXT, 3);
    const b =
      rand.next() < 0.3
        ? a + rand.string(HARD_TEXT, 1)
        : rand.string(HARD_TEXT, 3);
    pairs.push({ a, b });
  }
  out.push(
    ...(await each('localeCompare', pairs, ({ a, b }) =>
      Math.sign(a.localeCompare(b)),
    )),
  );

  // Whole lists, sorted as the reports sort them by name.
  const lists = [];
  for (let i = 0; i < 30; i += 1) {
    const list = [];
    for (let k = 0; k < 20; k += 1)
      list.push(
        rand.next() < 0.5 ? rand.pick(WORDS) : rand.string(HARD_TEXT, 4),
      );
    lists.push({ list });
  }
  out.push(
    ...(await each('sort', lists, ({ list }) =>
      [...list].sort((x, y) => x.localeCompare(y)),
    )),
  );
  return out;
}
