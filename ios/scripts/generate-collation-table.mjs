// Writes ios/VirgaKit/Sources/VirgaInsights/Support/JSCollationTable.swift:
// what Node's ICU (the collator `String.prototype.localeCompare` uses with
// no locale, CLDR root order) knows about each code point, for VirgaInsights'
// localeCompare port (JSCollation.swift).
//
//   node ios/scripts/generate-collation-table.mjs
//
// Everything is read from Node's own collator, by comparing strings: which
// code points it ignores, which only carry an accent (a secondary weight),
// which equal a run of others (æ is a, a mark and e; ½ is 1⁄2), and the
// order of the rest at each of the three levels (base letter, accent,
// case). The Swift side compares strings level by level over those weights
// after canonical decomposition, as the Unicode Collation Algorithm does.
// ios/parity/cases/insights.collation.js then holds it to localeCompare.
//
// Run it again when Node's ICU moves to a newer CLDR.

import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(
  here,
  '../VirgaKit/Sources/VirgaInsights/Support/JSCollationTable.swift',
);

const full = new Intl.Collator(undefined, { sensitivity: 'variant' });
const base = new Intl.Collator(undefined, { sensitivity: 'base' });
const accent = new Intl.Collator(undefined, { sensitivity: 'accent' });

/** The blocks the table covers; anything else is ordered by code point. */
export const RANGES = [
  [0x0000, 0x024f], // Latin, Latin-1, Latin Extended-A and -B
  [0x0250, 0x02ff], // IPA, spacing modifier letters
  [0x0300, 0x036f], // combining diacritical marks
  [0x0370, 0x03ff], // Greek
  [0x0400, 0x052f], // Cyrillic
  [0x0530, 0x058f], // Armenian
  [0x0590, 0x05ff], // Hebrew
  [0x0600, 0x06ff], // Arabic
  [0x0900, 0x0dff], // Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala
  [0x0e00, 0x0eff], // Thai, Lao
  [0x1000, 0x109f], // Myanmar
  [0x10a0, 0x10ff], // Georgian
  [0x1100, 0x11ff], // Hangul jamo
  [0x1200, 0x137f], // Ethiopic
  [0x13a0, 0x13ff], // Cherokee
  [0x1780, 0x17ff], // Khmer
  [0x1c90, 0x1cbf], // Georgian Mtavruli
  [0x1e00, 0x1eff], // Latin Extended Additional
  [0x1f00, 0x1fff], // Greek Extended
  [0x2000, 0x2bff], // punctuation, symbols, arrows, shapes, dingbats
  [0x3000, 0x30ff], // CJK punctuation, kana
  [0x3130, 0x318f], // Hangul compatibility jamo
  [0xab70, 0xabbf], // Cherokee small letters
  [0xfb00, 0xfb4f], // alphabetic presentation forms (ﬁ, ﬀ)
  [0xfe30, 0xfe4f], // CJK compatibility forms
  [0xff00, 0xffef], // fullwidth forms
  [0x10400, 0x1044f], // Deseret
  [0x104b0, 0x104ff], // Osage
  [0x1f000, 0x1faff], // emoji and other pictographs
];

const isAssigned = (c) => !/\p{Cn}|\p{Cs}|\p{Co}/u.test(c);

const singles = [];
for (const [from, to] of RANGES) {
  for (let cp = from; cp <= to; cp += 1) {
    const c = String.fromCodePoint(cp);
    // Canonical decompositions are taken apart before the table is read.
    if (!isAssigned(c) || c.normalize('NFD') !== c) continue;
    singles.push(c);
  }
}

const ignorable = new Set();
const accentOnly = [];
const weighed = [];
for (const c of singles) {
  if (full.compare(`a${c}b`, 'ab') === 0) ignorable.add(c);
  else if (base.compare(`a${c}`, 'a') === 0) accentOnly.push(c);
  else weighed.push(c);
}

// Canonical decompositions the collator weighs as letters of their own
// (contractions): й is not и with a breve but the letter after і and ї, أ
// is not ا with a hamza, and a two-part vowel sign (ো, ொ) is one vowel.
// Taking these apart would sort "мой" before "моим" and "أحمد" after
// "احمد". A decomposition is an ordinary one when the collator weighs it as
// its first code point plus accents, or as that code point and then the
// weights of the rest (which a string of the first and the heaviest letter
// outweighs); anything else is a contraction, weighed below like a single
// code point, and JSCollation.swift puts its decomposition back together
// after taking text apart.
const heaviest = weighed.reduce((a, b) => (base.compare(a, b) >= 0 ? a : b));
const weightless = (c) => ignorable.has(c) || accentOnly.includes(c);
const contractions = new Set();
for (const [from, to] of RANGES) {
  for (let cp = from; cp <= to; cp += 1) {
    const c = String.fromCodePoint(cp);
    const d = c.normalize('NFD');
    if (!isAssigned(c) || d === c) continue;
    const [first, ...rest] = [...d];
    const order = base.compare(c, first);
    const ordinary =
      order === 0
        ? rest.every(weightless)
        : order > 0 && base.compare(c, first + heaviest) < 0;
    if (!ordinary) contractions.add(c);
  }
}
weighed.push(...contractions);
singles.push(...contractions);
singles.sort((x, y) => x.codePointAt(0) - y.codePointAt(0));

// Accent-only code points (combining marks, mostly): their order is the
// order of `a` followed by each.
accentOnly.sort((x, y) => full.compare(`a${x}`, `a${y}`));
const accentWeight = new Map();
{
  let rank = 0;
  let prev = null;
  for (const c of accentOnly) {
    if (prev === null || full.compare(`a${prev}`, `a${c}`) !== 0) rank += 1;
    accentWeight.set(c, rank);
    prev = c;
  }
}
const MARK_BASE = 0x21;
const PSEUDO_BASE = 0x100;

// Code points that equal a run of others: their compatibility decomposition
// (½ is 1⁄2, ﬁ is fi), or two ASCII letters at the base level (æ, œ, ß).
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const expansions = new Map();
for (const c of weighed) {
  if (contractions.has(c)) continue;
  const k = c.normalize('NFKD');
  if (k !== c && [...k].length > 1) {
    expansions.set(c, k);
    continue;
  }
  if (!/\p{L}/u.test(c)) continue;
  // Only letters past the alphabet are worth the 676 tries.
  if (base.compare(c, 'a') <= 0 || base.compare(c, 'zz') > 0) continue;
  if (LETTERS.includes(c.toLowerCase())) continue;
  outer: for (const x of LETTERS) {
    for (const y of LETTERS) {
      if (base.compare(c, x + y) === 0) {
        // A capital (Æ) is its capitals (AE).
        expansions.set(
          c,
          c === c.toLowerCase() ? x + y : (x + y).toUpperCase(),
        );
        break outer;
      }
    }
  }
}

// The rest, in order at the base level: each group of base-equal code
// points is one primary weight.
const primaries = weighed.filter((c) => !expansions.has(c));
primaries.sort((x, y) => full.compare(x, y));
const groups = [];
for (const c of primaries) {
  const g = groups[groups.length - 1];
  if (g && base.compare(g[0], c) === 0) g.push(c);
  else groups.push([c]);
}

/** `{ p, s, t }` per code point: primary rank, secondary, tertiary. */
const weights = new Map();
const marks = [...accentWeight.keys()];
groups.forEach((group, i) => {
  const p = i + 1;
  // Within the group: accent-equal subgroups in order, each code point's
  // case rank within its subgroup.
  const subs = [];
  for (const c of group) {
    const s = subs[subs.length - 1];
    if (s && accent.compare(s[0], c) === 0) s.push(c);
    else subs.push([c]);
  }
  const head = subs[0][0];
  let pseudo = 0;
  subs.forEach((sub, si) => {
    // A subgroup past the first is its base letter with an accent: a real
    // mark when one makes it (ø is o and U+0338), or one heavier than
    // every mark.
    let mark = null;
    if (si > 0) {
      const found = marks.find((m) => accent.compare(head + m, sub[0]) === 0);
      if (found) mark = accentWeight.get(found) + MARK_BASE;
      else {
        pseudo += 1;
        mark = PSEUDO_BASE + pseudo;
      }
    }
    // Code points the collator can't tell apart at all share a rank.
    let t = 0;
    sub.forEach((c, j) => {
      if (j > 0 && full.compare(sub[j - 1], c) !== 0) t += 1;
      weights.set(c, { p, mark, t });
    });
  });
});

/**
 * Where the case of an expansion's parts falls among the cases of its first
 * letter (ﬁ among f, ｆ, ⓕ, F, …), on JSCollation.swift's scale: a case
 * rank t weighs 2t + 1 there, so a slot between ranks r - 1 and r is 2r.
 * The collator gives a compatibility form a case between the small letters
 * and the capitals (ﬁ sorts after fI and before Fi), which no rank of the
 * letter's own has. It is read by comparing the expansion with each case
 * of its first letter followed by the rest of its run: those strings
 * differ from it in case only, and first in the first part's. Null when
 * the first part has no rank.
 */
function caseSlot(c, run) {
  const [first, ...rest] = [...run];
  const own = weights.get(first);
  if (!own) return null;
  const cases = new Map();
  for (const [x, w] of weights)
    if (w.p === own.p && w.mark === own.mark && !cases.has(w.t))
      cases.set(w.t, x);
  let slot = 0;
  for (const t of [...cases.keys()].sort((a, b) => a - b)) {
    const order = full.compare(cases.get(t) + rest.join(''), c);
    if (order === 0) return 2 * t + 1;
    if (order < 0) slot = 2 * (t + 1);
  }
  return slot;
}

// The primary just before the digits: where symbols the table doesn't
// cover go, in code point order.
const digitPrimary = weights.get('0').p;

const lines = [];
const hex = (n) => n.toString(16).toUpperCase();
for (const c of singles) {
  const cp = hex(c.codePointAt(0));
  if (ignorable.has(c)) lines.push(`${cp}:I`);
  else if (accentWeight.has(c))
    lines.push(`${cp}:M${hex(accentWeight.get(c) + MARK_BASE)}`);
  else if (expansions.has(c)) {
    // `!` when the run differs at the accent level too (æ from ae);
    // otherwise `@` and the case its first part weighs (caseSlot).
    const run = expansions.get(c);
    const accented = accent.compare(c, run) !== 0;
    const slot = accented ? null : caseSlot(c, run);
    lines.push(
      `${cp}=${[...run].map((x) => hex(x.codePointAt(0))).join(',')}${accented ? '!' : slot == null ? '' : `@${hex(slot)}`}`,
    );
  } else {
    const { p, mark, t } = weights.get(c);
    lines.push(`${cp}:${hex(p)}.${mark == null ? '' : hex(mark)}.${hex(t)}`);
  }
}

const wrapped = [];
let line = '';
for (const entry of lines) {
  if (line.length + entry.length + 1 > 100) {
    wrapped.push(line);
    line = '';
  }
  line += (line ? ';' : '') + entry;
}
if (line) wrapped.push(line);

const swift = `// Generated by ios/scripts/generate-collation-table.mjs from Node ${process.version}'s
// ICU ${process.versions.icu} (Unicode ${process.versions.unicode}): don't edit by hand, run the script.
//
// What localeCompare's collator (CLDR root order) knows about each code
// point in the blocks the script covers, read from the collator itself.
// Each entry is \`code:I\` (ignored), \`code:Mw\` (an accent only, secondary
// weight w), \`code=a,b,…\` (that run of code points with another case: a
// compatibility form like ½ or ﬁ, \`@s\` the case its first part weighs, on
// the scale where a case rank t weighs 2t + 1; or a letter like æ, \`!\` when
// it differs in accent too, its parts heavier than every case), or
// \`code:p.m.t\` (primary rank p; m, when present, the accent that sets it
// apart from the first of its base letters; t its case rank among the
// code points with the same base and accent). A code point that decomposes
// canonically is listed only when the collator weighs it as a letter of its
// own (a contraction: й, أ, ো), and JSCollation.swift weighs its
// decomposition as that letter. Code points listed nowhere are ordered by
// code point (JSCollation.swift). ${lines.length} entries.

extension JSCollation {
  /// The primary rank of '0': symbols the table doesn't cover sort just before it.
  static let digitPrimary: UInt32 = ${digitPrimary}
  /// The highest primary rank in the table.
  static let topPrimary: UInt32 = ${groups.length}

  static let tableSource = """
${wrapped.join('\n')}
"""
}
`;

fs.writeFileSync(OUT, swift);
console.log(
  `${path.relative(process.cwd(), OUT)}: ${lines.length} entries, ${groups.length} primaries, ${expansions.size} expansions, ${swift.length} bytes`,
);
