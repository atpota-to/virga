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

/**
 * Letters the collator weighs as letters of their own though they take
 * apart canonically (contractions: й is the letter after і and ї, not и
 * with a breve; أ is not ا with a hamza; ো is one vowel sign, not two),
 * written whole and taken apart, with a shadda in between (canonical
 * order puts it before the hamza of ؤ); and compatibility forms, whose
 * case falls between a letter's small forms and its capitals (ﬁ after
 * fI, before Fi). Every pair within a group is compared.
 */
const OWN_LETTERS = [
  [
    'и',
    'й',
    'Й',
    '\u0438\u0306',
    '\u0418\u0306',
    'і',
    'І',
    'ї',
    'к',
    'мой',
    'моим',
    'Мой',
    'мои',
    'йод',
    'иод',
    'Йошкар',
    'Иван',
    'Київ',
    'Кий',
    'їжак',
    'іній',
    'Ӣ',
  ],
  [
    'ا',
    'أ',
    '\u0627\u0654',
    'إ',
    'آ',
    'ء',
    'ب',
    'و',
    'ؤ',
    '\u0648\u0654',
    'ؤّ',
    '\u0648\u0651\u0654',
    'وّ',
    'ي',
    'ئ',
    'أب',
    'اج',
    'أحمد',
    'احمد',
    'إسلام',
    'اسم',
    'مسؤول',
    'مسوق',
    'شيئ',
    'شيخ',
  ],
  [
    'কে',
    'কৈ',
    'কো',
    '\u0995\u09c7\u09be',
    'কৌ',
    'কেক',
    'கெ',
    'கே',
    'கை',
    'கொ',
    '\u0b95\u0bc6\u0bbe',
    'கோ',
    'கௌ',
    'கெட',
    'ဥ',
    'ဦ',
    '\u1025\u102e',
  ],
  [
    'fi',
    'fI',
    'Fi',
    'FI',
    'ﬁ',
    'ｆi',
    'ⓕi',
    'ff',
    'fF',
    'Ff',
    'FF',
    'ﬀ',
    'ffi',
    'ﬀi',
    'ﬀI',
    'ﬃ',
    'FFI',
    'ij',
    'Ij',
    'IJ',
    'ĳ',
    'Ĳ',
    'dž',
    'Dž',
    'DŽ',
    'ǆ',
    'ǅ',
    'Ǆ',
    'dz',
    'Dz',
    'DZ',
    'ǳ',
    'ǲ',
    'Ǳ',
    '½',
    '1⁄2',
    '¹⁄₂',
    'st',
    'ﬆ',
    'ﬅ',
  ],
];

/** Text of the scripts that have them, for seeded pairs. */
const OWN_LETTER_TEXT = [
  ...'абвгдеийклмнопрсуЙИІЇіїкм',
  ...'ابتجحدرسشعمنهويةىءآأإؤئ',
  'و' + 'ّ',
  'ّ',
  'ٔ',
  ...'কখগচেৈোৌািী',
  ...'கசடதெேைொோௌாி',
  ...'fiFIlLsStT',
  'ﬁ',
  'ﬀ',
  'ﬂ',
  'ﬃ',
  'ﬆ',
  'ĳ',
  'Ĳ',
  'ǆ',
  'ǅ',
  'Ǆ',
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
  for (const group of OWN_LETTERS)
    for (let i = 0; i < group.length; i += 1)
      for (let j = i + 1; j < group.length; j += 1)
        pairs.push({ a: group[i], b: group[j] });
  const own = seeded(20261122);
  for (let i = 0; i < 400; i += 1) {
    const a = own.string(OWN_LETTER_TEXT, 4);
    const b =
      own.next() < 0.5
        ? a.slice(0, -1) + own.pick(OWN_LETTER_TEXT)
        : own.string(OWN_LETTER_TEXT, 4);
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
