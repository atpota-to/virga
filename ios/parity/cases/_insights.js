// Helpers for the insights generators (ios/parity/cases/insights-*.js).
//
// The app's tables name lucide-react icons by component. A fixture can't
// hold a component, so each icon is recorded by its name: the component's
// displayName ("CalendarClock"; ImageIcon's is "Image"). The Swift tables
// carry the same names, and VirgaInsights' Icons.sfSymbol(lucide:) maps each
// to an SF Symbol.

/** An icon component's name, or the value itself when it isn't one. */
export function iconName(icon) {
  if (icon && typeof icon === 'object' && typeof icon.displayName === 'string')
    return icon.displayName;
  if (typeof icon === 'function' && typeof icon.displayName === 'string')
    return icon.displayName;
  return icon;
}

/** A copy of `value` with every `icon` member replaced by its name. */
export function withIconNames(value) {
  if (Array.isArray(value)) return value.map(withIconNames);
  if (value && typeof value === 'object' && !iconLike(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value))
      out[k] = k === 'icon' ? iconName(v) : withIconNames(v);
    return out;
  }
  return value;
}

function iconLike(value) {
  return typeof value.displayName === 'string' && '$$typeof' in value;
}

/**
 * A seeded pseudo-random number generator (mulberry32): the same seed gives
 * the same numbers on every run, so generated inputs keep fixtures stable.
 * Returns `{ next, int, pick, string }`: `next()` in [0, 1), `int(n)` in
 * [0, n), `pick(list)`, and `string(pool, max)`, a string of up to `max`
 * items of `pool` (each a whole code point or sequence, never half a
 * surrogate pair).
 */
export function seeded(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const pick = (list) => list[int(list.length)];
  const string = (pool, max) => {
    const length = int(max + 1);
    let out = '';
    for (let i = 0; i < length; i += 1) out += pick(pool);
    return out;
  };
  return { next, int, pick, string };
}

/**
 * Text that is hard to fold, lower-case, split into words and index by
 * UTF-16 unit: accents precomposed and combining, Greek with its final
 * sigma, Turkish dotted and dotless i, ß and ligatures, the Kelvin and
 * Ångström signs, Hangul syllables and jamo, CJK, Devanagari's spacing
 * marks, Cherokee, Georgian Mtavruli, Deseret and Osage (cased, outside
 * the BMP), digits of other scripts, Roman numerals, fullwidth letters,
 * emoji with skin tones and joiners, apostrophes, dashes and spaces.
 */
export const HARD_TEXT = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...'éÉèàÀçÇñÑüÜöÖåÅøØæÆœŒ',
  'é',
  'É',
  'ä',
  'ọ̃',
  '́',
  'ͅ',
  '⃝',
  ...'ΑΒΓΔΣσςΟΔΟΣάΆΐ',
  'ᾈ',
  'ǅ',
  'İ',
  'ı',
  'ß',
  'ẞ',
  'ﬁ',
  'ﬀ',
  '\u212A',
  '\u212B',
  '\u2126',
  '한',
  '국',
  '어',
  '\u1112',
  '\u1161',
  '\u11AB',
  '日',
  '本',
  'の',
  'レ',
  'ポ',
  'ー',
  'क',
  '\u093F',
  '\u0902',
  '\uAB70',
  '\u13A0',
  '\u1C90',
  '\u10D0',
  '\u{10400}',
  '\u{10428}',
  '\u{104B0}',
  '٣',
  '۴',
  '०',
  'Ⅻ',
  'ⅻ',
  '½',
  '²',
  'Ａ',
  'ｂ',
  '👍',
  '👍🏽',
  '👨‍👩‍👧',
  '🇳🇿',
  '’',
  '‘',
  "'",
  '-',
  '—',
  '_',
  '.',
  '/',
  ' ',
  '\u2009',
  ' ',
  '　',
  '\t',
  '‍',
  '﻿',
];
