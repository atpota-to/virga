// Writes ios/VirgaKit/Sources/VirgaCore/Support/JSCollationTable.swift:
// what Node's ICU (the collator `String.prototype.localeCompare` uses, CLDR
// root order, which every English locale shares) knows about every
// assigned code point, for VirgaCore's localeCompare port
// (Support/JSCollation.swift).
//
//   node ios/scripts/generate-collation-table.mjs [output.swift]
//
// Everything is read from Node's own collator, by comparing strings: which
// code points it ignores, which only carry an accent (a secondary weight),
// which equal a run of others (æ is a, a mark and e; ½ is 1⁄2), which
// sequences it weighs as one letter (contractions: й, ো, and the Thai and
// Lao vowels written before their consonant), the order of the rest at
// each of the three levels (base letter, accent, case), and the order of
// the ideographs it weighs implicitly (Han in radical-stroke order, then
// Tangut, Khitan and Nushu). The Swift side compares strings level by level
// over those weights after canonical decomposition, as the Unicode
// Collation Algorithm does. ios/parity/cases/core.collation.js then holds it
// to localeCompare.
//
// Run it again when Node's ICU moves to a newer CLDR or Unicode.

import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(here, '../VirgaKit/Sources/VirgaCore/Support/JSCollationTable.swift');

const full = new Intl.Collator(undefined, { sensitivity: 'variant' });
const base = new Intl.Collator(undefined, { sensitivity: 'base' });
const accent = new Intl.Collator(undefined, { sensitivity: 'accent' });

const PLANES = [
  [0x0000, 0x3ffff], // the BMP, and the supplementary planes in use
  [0xe0000, 0xe0fff], // tags and variation selectors
];
const isAssigned = (c) => !/\p{Cn}|\p{Cs}|\p{Co}/u.test(c);
/** Weighed by their place in ICU's own order of ideographs, not a table. */
const IMPLICIT =
  /\p{Unified_Ideograph}|(?=\p{Lo})(?:\p{Script=Tangut}|\p{Script=Khitan_Small_Script}|\p{Script=Nushu})/u;
const hex = (n) => n.toString(16).toUpperCase();
const cpOf = (c) => c.codePointAt(0);
const SEP = '\u0001'; // completely ignorable, and it blocks a contraction

// Every assigned code point that canonical decomposition leaves alone,
// plus the noncharacters ICU weighs (U+FFFE first of all, U+FFFF last).
const singles = [];
const implicitChars = [];
const decomposable = [];
for (const [from, to] of PLANES) {
  for (let cp = from; cp <= to; cp += 1) {
    const c = String.fromCodePoint(cp);
    if (cp !== 0xfffe && cp !== 0xffff && !isAssigned(c)) continue;
    if (IMPLICIT.test(c)) implicitChars.push(c);
    else if (c.normalize('NFD') !== c) decomposable.push(c);
    else singles.push(c);
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
const accentSet = new Set(accentOnly);

// Canonical decompositions the collator weighs as letters of their own
// (contractions): й is not и with a breve but the letter after і and ї, أ
// is not ا with a hamza, a two-part vowel sign (ো, ொ) is one vowel. Taking
// these apart would sort "мой" before "моим" and "أحمد" after "احمد". A
// decomposition is one when its parts weigh differently kept apart (by a
// completely ignorable code point, which a contraction can't reach
// across). They are weighed below like single code points, and
// JSCollation.swift puts their decompositions back together.
const contractions = new Map();
for (const c of decomposable) {
  const d = [...c.normalize('NFD')];
  if (full.compare(d.join(''), d.join(SEP)) !== 0) contractions.set(c, d);
}
weighed.push(...contractions.keys());
singles.push(...contractions.keys());
singles.sort((x, y) => cpOf(x) - cpOf(y));

// The vowels Thai, Lao, New Tai Lue and Tai Viet write before the
// consonant they follow in speech (Logical_Order_Exception): the collator
// weighs the pair as the consonant, then the vowel.
const swaps = new Map();
for (const x of singles) {
  if (!/\p{Logical_Order_Exception}/u.test(x)) continue;
  const ys = [];
  for (const y of singles) {
    if (full.compare(x + y, x + SEP + y) === 0) continue;
    if (full.compare(x + y, y + SEP + x) !== 0)
      throw new Error(`${hex(cpOf(x))} ${hex(cpOf(y))}: a contraction that isn't a swap`);
    ys.push(cpOf(y));
  }
  if (ys.length) swaps.set(cpOf(x), ys);
}

// Accent-only code points (combining marks, mostly): their order is the
// order of `a` followed by each. Ones the collator tells apart only by
// case share an accent and differ in case.
accentOnly.sort((x, y) => full.compare(`a${x}`, `a${y}`));
const accentWeight = new Map();
{
  let rank = 0;
  let t = 0;
  let prev = null;
  for (const c of accentOnly) {
    if (prev === null || accent.compare(`a${prev}`, `a${c}`) !== 0) {
      rank += 1;
      t = 0;
    } else if (full.compare(`a${prev}`, `a${c}`) !== 0) t += 1;
    accentWeight.set(c, { rank, t });
    prev = c;
  }
}
const markRanks = Math.max(0, ...[...accentWeight.values()].map((w) => w.rank));
const COMMON = 0x20;
const MARK_BASE = COMMON + 1;

// Code points that equal a run of others: their compatibility decomposition
// (½ is 1⁄2, ﬁ is fi), or two ASCII letters at the base level (æ, œ, ß).
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const expansions = new Map();
for (const c of weighed) {
  if (contractions.has(c)) continue;
  const k = c.normalize('NFKD');
  if (k !== c && [...k].length > 1) {
    if (base.compare(c, k) === 0) expansions.set(c, k);
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
        expansions.set(c, c === c.toLowerCase() ? x + y : (x + y).toUpperCase());
        break outer;
      }
    }
  }
}

// The ideographs in the collator's order: each is its own primary weight.
implicitChars.sort((x, y) => full.compare(x, y));
for (let i = 1; i < implicitChars.length; i += 1)
  if (base.compare(implicitChars[i - 1], implicitChars[i]) === 0)
    throw new Error(`ideographs ${hex(cpOf(implicitChars[i - 1]))} and ${hex(cpOf(implicitChars[i]))} tie`);
/** The ideograph `c` weighs the same as at the base level, or null. */
function implicitBase(c) {
  let lo = 0;
  let hi = implicitChars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const order = base.compare(implicitChars[mid], c);
    if (order === 0) return implicitChars[mid];
    if (order < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? 'before' : lo === implicitChars.length ? 'after' : 'between';
}
// Past every ideograph come the code points ICU weighs by code point
// (unassigned and private use, the last of them U+10FFFD), then a few
// special ones (U+FFFD, U+FFFF).
const LAST_IMPLICIT = '\u{10FFFD}';

// The rest, in order at the base level: each group of base-equal code
// points is one primary weight, or an ideograph's.
const primaries = weighed.filter((c) => !expansions.has(c));
primaries.sort((x, y) => full.compare(x, y));
const groups = [];
for (const c of primaries) {
  const g = groups[groups.length - 1];
  if (g && base.compare(g.members[0], c) === 0) g.members.push(c);
  else groups.push({ members: [c] });
}
let explicitRanks = 0;
const post = [];
for (const g of groups) {
  const where = implicitBase(g.members[0]);
  if (where === 'before') g.p = ++explicitRanks;
  else if (where === 'after') {
    if (base.compare(g.members[0], LAST_IMPLICIT) <= 0)
      throw new Error(`${hex(cpOf(g.members[0]))} sorts among the code points weighed by code point`);
    post.push(g);
  } else if (where === 'between')
    throw new Error(`${hex(cpOf(g.members[0]))} sorts among the ideographs`);
  else {
    // A variant of an ideograph (a radical, a compatibility form).
    g.ideograph = where;
    g.members.unshift(where);
    g.members.sort((x, y) => full.compare(x, y));
    if (g.members[0] !== where) throw new Error(`${hex(cpOf(where))} isn't first among its variants`);
  }
}
const IMPLICIT_RANK = explicitRanks + 1;
const UNASSIGNED_RANK = explicitRanks + 2;
post.forEach((g, i) => {
  g.p = UNASSIGNED_RANK + 1 + i;
});

/** `{ p | ideograph, mark, t }` per code point: primary, secondary, tertiary. */
const weights = new Map();
const marks = [...accentWeight.keys()].filter((m) => accentWeight.get(m).t === 0);
let pseudoMarks = 0;
for (const g of groups) {
  // Within the group: accent-equal subgroups in order, each code point's
  // case rank within its subgroup.
  const subs = [];
  for (const c of g.members) {
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
      if (found) mark = MARK_BASE + accentWeight.get(found).rank;
      else {
        pseudo += 1;
        mark = -pseudo; // resolved once every group is counted
      }
    }
    // Code points the collator can't tell apart at all share a rank.
    let t = 0;
    sub.forEach((c, j) => {
      if (j > 0 && full.compare(sub[j - 1], c) !== 0) t += 1;
      weights.set(c, { p: g.p, ideograph: g.ideograph, mark, t });
    });
  });
  pseudoMarks = Math.max(pseudoMarks, pseudo);
}
const PSEUDO_BASE = MARK_BASE + markRanks + 1;
for (const w of weights.values()) if (w.mark !== null && w.mark < 0) w.mark = PSEUDO_BASE - 1 - w.mark;
const EXPANSION_ACCENT = PSEUDO_BASE + pseudoMarks + 1;

// The cases of each base letter and accent, for caseSlot.
const casesOf = new Map();
for (const [x, w] of weights) {
  const key = `${w.p}|${w.ideograph ?? ''}|${w.mark}`;
  if (!casesOf.has(key)) casesOf.set(key, new Map());
  const cases = casesOf.get(key);
  if (!cases.has(w.t)) cases.set(w.t, x);
}

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
  const cases = casesOf.get(`${own.p}|${own.ideograph ?? ''}|${own.mark}`);
  let slot = 0;
  for (const t of [...cases.keys()].sort((a, b) => a - b)) {
    const order = full.compare(cases.get(t) + rest.join(''), c);
    if (order === 0) return 2 * t + 1;
    if (order < 0) slot = 2 * (t + 1);
  }
  return slot;
}

// One entry per code point, in code point order.
const entries = [];
for (const c of singles) {
  const cp = cpOf(c);
  if (ignorable.has(c)) entries.push({ cp, kind: 'I' });
  else if (accentWeight.has(c)) {
    const { rank, t } = accentWeight.get(c);
    entries.push({ cp, kind: 'M', w: MARK_BASE + rank, t });
  } else if (expansions.has(c)) {
    // `!` when the run differs at the accent level too (æ from ae);
    // otherwise `@` and the case its first part weighs (caseSlot).
    const run = expansions.get(c);
    const accented = accent.compare(c, run) !== 0;
    const slot = accented ? null : caseSlot(c, run);
    entries.push({ cp, kind: 'E', run: [...run].map(cpOf), accented, slot });
  } else {
    const { p, ideograph, mark, t } = weights.get(c);
    entries.push({ cp, kind: 'W', p, ideograph: ideograph && cpOf(ideograph), mark, t });
  }
}

const text = (e) => {
  switch (e.kind) {
    case 'I':
      return 'I';
    case 'M':
      return `M${hex(e.w)}${e.t ? `.${hex(e.t)}` : ''}`;
    case 'E':
      return `=${e.run.map(hex).join(',')}${e.accented ? '!' : e.slot == null ? '' : `@${hex(e.slot)}`}`;
    default:
      return `${e.ideograph ? `~${hex(e.ideograph)}` : hex(e.p)}.${e.mark == null ? '' : hex(e.mark)}.${hex(e.t)}`;
  }
};
/** Whether `b` is `a`'s entry one code point on, as a run continues it. */
const continues = (a, b) => {
  if (b.cp !== a.cp + 1 || a.kind !== b.kind) return false;
  if (a.kind === 'I') return true;
  if (a.kind === 'M') return b.w === a.w + 1 && b.t === a.t;
  if (a.kind === 'W')
    return !a.ideograph && !b.ideograph && b.p === a.p + 1 && b.mark === a.mark && b.t === a.t;
  return false;
};
const lines = [];
for (let i = 0; i < entries.length; ) {
  let n = 1;
  while (i + n < entries.length && continues(entries[i + n - 1], entries[i + n])) n += 1;
  const e = entries[i];
  lines.push(`${hex(e.cp)}${e.kind === 'E' ? '' : ':'}${text(e)}${n > 1 ? `*${hex(n)}` : ''}`);
  i += n;
}

// The ideographs, in order, as runs of consecutive code points.
const implicitRuns = [];
for (let i = 0; i < implicitChars.length; ) {
  const start = cpOf(implicitChars[i]);
  let n = 1;
  while (i + n < implicitChars.length && cpOf(implicitChars[i + n]) === start + n) n += 1;
  implicitRuns.push(n > 1 ? `${hex(start)}+${hex(n)}` : hex(start));
  i += n;
}

const contractionLines = [...contractions].map(
  ([c, d]) => `${hex(cpOf(c))}=${d.map((x) => hex(cpOf(x))).join(',')}`,
);
const swapLines = [...swaps].map(([x, ys]) => {
  const ranges = [];
  for (let i = 0; i < ys.length; ) {
    let n = 1;
    while (i + n < ys.length && ys[i + n] === ys[i] + n) n += 1;
    ranges.push(n > 1 ? `${hex(ys[i])}-${hex(ys[i] + n - 1)}` : hex(ys[i]));
    i += n;
  }
  return `${hex(x)}>${ranges.join(',')}`;
});

// Canonical decomposition, so that JSCollation.swift takes text apart the
// same way on every platform (Foundation's and the standard library's
// Unicode tables differ between Apple's SDKs and Linux): each code point's
// full decomposition (Hangul syllables are taken apart by arithmetic), and
// the canonical combining class of every mark, as ranks in the classes'
// order, which is all canonical reordering needs. A mark has a class when
// it moves past U+0334 (class 1) or U+0345 (class 240, the highest).
const decompositionLines = [];
const marksWithClass = [];
for (let cp = 0; cp <= 0x10ffff; cp += 1) {
  if ((cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0xac00 && cp <= 0xd7a3)) continue;
  const c = String.fromCodePoint(cp);
  const d = c.normalize('NFD');
  if (d !== c) decompositionLines.push(`${hex(cp)}=${[...d].map((x) => hex(cpOf(x))).join(',')}`);
  else if (`${c}̴`.normalize('NFD') !== `${c}̴` || `ͅ${c}`.normalize('NFD') !== `ͅ${c}`)
    marksWithClass.push(c);
}
/** Negative when `x`'s class is lower than `y`'s (`y x` reorders to `x y`). */
const byClass = (x, y) => {
  if ((y + x).normalize('NFD') === x + y) return -1;
  if ((x + y).normalize('NFD') === y + x) return 1;
  return 0;
};
const classRank = new Map();
{
  const sorted = [...marksWithClass].sort(byClass);
  let rank = 0;
  sorted.forEach((c, i) => {
    if (i === 0 || byClass(sorted[i - 1], c) !== 0) rank += 1;
    classRank.set(cpOf(c), rank);
  });
}
const classLines = [];
{
  const cps = [...classRank.keys()].sort((a, b) => a - b);
  for (let i = 0; i < cps.length; ) {
    let n = 1;
    while (i + n < cps.length && cps[i + n] === cps[i] + n && classRank.get(cps[i + n]) === classRank.get(cps[i])) n += 1;
    classLines.push(`${hex(cps[i])}:${hex(classRank.get(cps[i]))}${n > 1 ? `*${hex(n)}` : ''}`);
    i += n;
  }
}

const wrap = (items) => {
  const out = [];
  let line = '';
  for (const item of items) {
    if (line && line.length + item.length + 1 > 100) {
      out.push(line);
      line = '';
    }
    line += (line ? ';' : '') + item;
  }
  if (line) out.push(line);
  return out.join('\n');
};

const swift = `// Generated by ios/scripts/generate-collation-table.mjs from Node ${process.version}'s
// ICU ${process.versions.icu} (Unicode ${process.versions.unicode}): don't edit by hand, run the script.
//
// What localeCompare's collator (CLDR root order) knows about every
// assigned code point, read from the collator itself. In \`tableSource\`,
// each entry is \`code:I\` (ignored), \`code:Mw\` or \`code:Mw.t\` (an accent
// only: secondary weight w, case rank t), \`code=a,b,…\` (that run of code
// points with another case: a compatibility form like ½ or ﬁ, \`@s\` the case
// its first part weighs, on the scale where a case rank t weighs 2t + 1; or
// a letter like æ, \`!\` when it differs in accent too, its parts heavier
// than every case), or \`code:p.m.t\` (primary rank p, or \`~i\` the primary of
// the ideograph i; m, when present, the accent that sets it apart from the
// first of its base letters; t its case rank among the code points with
// the same base and accent). \`*n\` repeats an entry for n code points, the
// rank or weight one higher each time. A code point that decomposes
// canonically is listed only when the collator weighs it as a letter of its
// own (a contraction: й, أ, ো; \`contractionSource\` has its decomposition),
// and JSCollation.swift weighs its decomposition as that letter.
// \`implicitSource\` lists the ideographs in the collator's order (runs of
// \`start+count\`); \`swapSource\` the vowels written before a consonant that
// the collator weighs after it, with those consonants. Code points listed
// nowhere (unassigned, private use) sort after the ideographs in code
// point order. \`decompositionSource\` holds every canonical decomposition
// but Hangul's (\`code=a,b,…\`, in full), and \`combiningClassSource\` the
// canonical combining class of every mark that has one, as its rank among
// the classes (\`code:r\`, \`*n\` for n code points of that class).
// ${entries.length} code points in ${lines.length} entries; ${implicitChars.length} ideographs; ${decompositionLines.length} decompositions; ${classRank.size} marks in ${new Set(classRank.values()).size} classes.

extension JSCollation {
  /// The primary rank of the ideographs (each its place in their order after it).
  static let implicitRank: UInt32 = ${IMPLICIT_RANK}
  /// The primary rank of code points the table doesn't list (by code point after it).
  static let unassignedRank: UInt32 = ${UNASSIGNED_RANK}
  /// The secondary weight of a base letter with no accent.
  static let common: UInt32 = 0x${hex(COMMON)}
  /// The accent between an expansion's first two parts (æ is not ae), heavier than every other.
  static let expansionAccent: UInt32 = 0x${hex(EXPANSION_ACCENT)}

  static let tableSource = """
${wrap(lines)}
"""

  static let contractionSource = """
${wrap(contractionLines)}
"""

  static let swapSource = """
${wrap(swapLines)}
"""

  static let implicitSource = """
${wrap(implicitRuns)}
"""

  static let decompositionSource = """
${wrap(decompositionLines)}
"""

  static let combiningClassSource = """
${wrap(classLines)}
"""
}
`;

fs.writeFileSync(OUT, swift);
console.log(
  `${path.relative(process.cwd(), OUT)}: ${entries.length} code points in ${lines.length} entries, ${explicitRanks} primaries (+${post.length} after the ideographs), ${expansions.size} expansions, ${contractions.size} contractions, ${swaps.size} prevowels, ${markRanks} accents (+${pseudoMarks} pseudo), ${implicitChars.length} ideographs in ${implicitRuns.length} runs, ${swift.length} bytes`,
);
