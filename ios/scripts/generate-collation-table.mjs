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

// Contractions that are no code point's canonical decomposition, found in
// the compatibility decompositions: l· (ŀ is l and an accent, not l and a
// middle dot), ํา (ำ), the Tibetan vowels ྲཱྀ and ླཱྀ. Each is weighed below
// like a code point of its own, under an id past U+10FFFF that
// JSCollation.swift gives the sequence.
const byDecomposition = new Map([...contractions].map(([c, d]) => [d.join(''), c]));
const synthetic = new Map();
/** The table's id for a code point or a contraction. */
const idOf = (c) => synthetic.get(c) ?? cpOf(c);
/**
 * Whether the collator weighs the code points `w` as one: kept apart
 * anywhere (by a completely ignorable code point), they weigh differently.
 */
const isUnit = (w) => {
  for (let k = 1; k < w.length; k += 1)
    if (full.compare(w.join(''), w.slice(0, k).join('') + SEP + w.slice(k).join('')) === 0) return false;
  return w.length > 1;
};
/**
 * `parts` (a decomposition) as the collator reads it: code points, and the
 * longest contraction at each place, as a canonical contraction's own code
 * point or a new contraction's sequence.
 */
function unitsOf(parts) {
  if (full.compare(parts.join(''), parts.join(SEP)) === 0) return parts;
  const units = [];
  for (let i = 0; i < parts.length; ) {
    let j = parts.length;
    while (j > i + 1 && !isUnit(parts.slice(i, j))) j -= 1;
    const unit = parts.slice(i, j).join('');
    if (j > i + 1 && !byDecomposition.has(unit) && !synthetic.has(unit)) {
      synthetic.set(unit, 0x110000 + synthetic.size);
      contractions.set(unit, parts.slice(i, j));
      weighed.push(unit);
      singles.push(unit);
    }
    units.push(byDecomposition.get(unit) ?? unit);
    i = j;
  }
  return units;
}

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

// Accent-only code points that are several accents (ﳳ is a damma and a
// shadda, its compatibility decomposition's marks): expansions, below.
const markExpansions = new Map();
for (let i = accentOnly.length - 1; i >= 0; i -= 1) {
  const c = accentOnly[i];
  const run = [...c.normalize('NFKD')].filter((x) => accentSet.has(x));
  if (run.length > 1 && accent.compare(`a${c}`, `a${run.join('')}`) === 0) {
    markExpansions.set(c, run);
    accentOnly.splice(i, 1);
  }
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
const marks = [...accentWeight.keys()].filter((m) => accentWeight.get(m).t === 0);
const COMMON = 0x20;
const MARK_BASE = COMMON + 1;

// Code points that equal a run of others: their compatibility decomposition
// (½ is 1⁄2, ﬁ is fi), or two ASCII letters at the base level (æ, œ, ß).
// A run is a list of units, each a code point or a contraction (below).
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const expansions = new Map();
for (const c of weighed) {
  if (contractions.has(c)) continue;
  const k = c.normalize('NFKD');
  if (k !== c && [...k].length > 1) {
    if (base.compare(c, k) !== 0) continue;
    const run = unitsOf([...k]);
    // A run that is one contraction (ŀ is the contraction l·) weighs as
    // one letter, like a code point of its own.
    if (run.length > 1) expansions.set(c, run);
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
        expansions.set(c, [...(c === c.toLowerCase() ? x + y : (x + y).toUpperCase())]);
        break outer;
      }
    }
  }
}

for (const [c, run] of markExpansions) expansions.set(c, unitsOf(run));

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
let groups = [];
for (const c of primaries) {
  const g = groups[groups.length - 1];
  if (g && base.compare(g.members[0], c) === 0) g.members.push(c);
  else groups.push({ members: [c] });
}

// Code points that equal a run of others no decomposition gives (ײ is יי,
// ʩ is fŋ, the Malayalam chillus a consonant and a virama): a group that
// sorts before the last group of single weights followed by the heaviest
// (U+FFFF) starts with that weight and has more. The rest of the run is
// found one weight at a time, by bisecting the groups.
{
  const singleGroups = [];
  const found = [];
  for (const g of groups) {
    const last = singleGroups[singleGroups.length - 1];
    if (last && base.compare(g.members[0], last.members[0] + '\uFFFF') < 0) found.push({ g, first: last });
    else singleGroups.push(g);
  }
  const heads = singleGroups.map((g) => g.members[0]);
  for (const { g, first } of found) {
    const c = g.members[0];
    const run = [first.members[0]];
    for (;;) {
      const prefix = run.join('');
      let lo = 0;
      let hi = heads.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (base.compare(prefix + heads[mid], c) <= 0) lo = mid + 1;
        else hi = mid;
      }
      if (lo === 0) throw new Error(`${hex(cpOf(c))}: no run of weights makes it`);
      run.push(heads[lo - 1]);
      const order = base.compare(run.join(''), c);
      if (order === 0) break;
      if (base.compare(c, run.join('') + '\uFFFF') >= 0 || run.length > 8)
        throw new Error(`${hex(cpOf(c))}: no run of weights makes it`);
    }
    // An accent the weights don't show, from a mark (ༀ is ཨ, ོ and ཾ).
    if (accent.compare(c, run.join('')) !== 0) {
      search: for (let i = run.length; i > 0; i -= 1)
        for (const m of marks)
          if (accent.compare(c, [...run.slice(0, i), m, ...run.slice(i)].join('')) === 0) {
            run.splice(i, 0, m);
            break search;
          }
    }
    for (const m of g.members) expansions.set(m, run);
  }
  groups = singleGroups;
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

// Tertiary weights (case and form) sit TSCALE apart, a case rank r
// weighing TSCALE * r + HALF, so that what the collator puts between two
// cases of a letter (ﬁ between fI and Fi, ꙶ between ї and Ї) has room.
const TSCALE = 256;
const HALF = 128;
const tertiary = (rank) => TSCALE * rank + HALF;
const PLAIN = tertiary(0);
/** Added to the case of an expansion like æ's parts: heavier than every case. */
const EXPANSION_CASE = 1 << 20;

/** `{ p | ideograph, mark, t }` per code point: primary, secondary, tertiary. */
const weights = new Map();
const heaviestMark = marks.reduce((x, y) => (accentWeight.get(y).rank > accentWeight.get(x).rank ? y : x));
// The accents no mark makes (ſ is s and one, ð is d and one) are heavier
// than every mark, and only ever weighed against the other accents of the
// same base letter (no two strings can set them side by side otherwise):
// each base letter numbers its own, two apart from VARIANT_BASE, which
// leaves room for an expansion's accent between two of them (accentSlot).
const VARIANT_BASE = MARK_BASE + markRanks + 1;
const groupOf = new Map();
/**
 * What gets a case among a letter's cases rather than one of its own:
 * `{ c, cases, key, rest, done(place) }`, `c` weighing what the letter
 * does followed by `rest`, but for the case.
 */
const placed = [];
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
  g.variants = [];
  g.cases = new Map();
  subs.forEach((sub, si) => {
    // A subgroup past the first is its base letter with an accent: a real
    // mark when one makes it (ø is o and U+0338), or one heavier than
    // every mark.
    let mark = null;
    let markChar = null;
    if (si > 0) {
      markChar = marks.find((m) => accent.compare(head + m, sub[0]) === 0) ?? null;
      if (markChar) mark = MARK_BASE + accentWeight.get(markChar).rank;
      else {
        if (accent.compare(head + heaviestMark, sub[0]) >= 0)
          throw new Error(`${hex(cpOf(sub[0]))}: an accent lighter than a mark that no mark makes`);
        mark = VARIANT_BASE + 2 * (g.variants.length + 1);
        g.variants.push({ rep: sub[0], mark });
      }
    }
    for (const c of sub) groupOf.set(c, g);
    if (markChar) {
      // A letter and a real mark (ꙶ is і and a diaeresis) is weighed with
      // the letters canonical decomposition makes of the base letter and
      // that mark (ї, Ї): its case goes among theirs.
      for (const c of sub) {
        const w = { p: g.p, ideograph: g.ideograph, mark, t: null };
        weights.set(c, w);
        placed.push({ c, group: g, rest: markChar, done: ({ t }) => (w.t = t) });
      }
      return;
    }
    // Code points the collator can't tell apart at all share a rank.
    let t = 0;
    const cases = [];
    sub.forEach((c, j) => {
      if (j > 0 && full.compare(sub[j - 1], c) !== 0) t += 1;
      weights.set(c, { p: g.p, ideograph: g.ideograph, mark, t: tertiary(t) });
      if (!cases.length || cases[cases.length - 1].t !== tertiary(t)) cases.push({ t: tertiary(t), rep: c });
    });
    // The subgroup's cases, lightest first: `{ t, rep }`.
    g.cases.set(mark, cases);
  });
  pseudoMarks = Math.max(pseudoMarks, g.variants.length);
}

// A letter and a real mark: exactly a case of the base letter and the
// mark, or in the gap after one.
for (const item of placed) {
  const cases = item.group.cases.get(null);
  item.key = `${groups.indexOf(item.group)}|null|0|`;
  item.after = null;
  for (const { t, rep } of cases) {
    const order = full.compare(rep + item.rest, item.c);
    if (order === 0) {
      item.exact = t;
      break;
    }
    if (order > 0) break;
    item.after = t;
  }
}
for (let i = placed.length - 1; i >= 0; i -= 1)
  if (placed[i].exact !== undefined) {
    placed[i].done({ t: placed[i].exact });
    placed.splice(i, 1);
  }

/**
 * The accent an expansion like æ or ß weighs after its first part (the
 * collator's "æ is not ae"): heavier than every mark, and placed among the
 * other accents of its first part's base letter that no mark makes, by
 * comparing it with each of those followed by the rest of its run (ß
 * sorts before ſs).
 */
function accentSlot(c, run) {
  const [first, ...rest] = run;
  if (accent.compare(first + heaviestMark + rest.join(''), c) >= 0)
    throw new Error(`${hex(cpOf(c))}: an expansion's accent lighter than a mark`);
  const g = groupOf.get(first);
  let slot = VARIANT_BASE + 1;
  if (!g || weights.get(first).mark !== null) return slot;
  for (const { rep, mark } of g.variants) {
    const order = accent.compare(rep + rest.join(''), c);
    if (order === 0) return mark;
    if (order < 0) slot = mark + 1;
  }
  return slot;
}

/** The cases of each accent: `{ t, rep }`, lightest first. */
const markCases = new Map();
for (const [m, { rank, t }] of accentWeight) {
  if (!markCases.has(rank)) markCases.set(rank, []);
  const cases = markCases.get(rank);
  if (!cases.some((x) => x.t === tertiary(t))) cases.push({ t: tertiary(t), rep: m });
}
for (const cases of markCases.values()) cases.sort((x, y) => x.t - y.t);

/**
 * A part's cases, lightest first, and a key naming them, or null when it
 * has none (an ideograph).
 */
function casesOf(u) {
  if (accentWeight.has(u)) {
    const { rank } = accentWeight.get(u);
    return { key: `m${rank}`, cases: markCases.get(rank) };
  }
  const g = groupOf.get(u);
  const w = weights.get(u);
  if (!g || !w || !g.cases.has(w.mark)) return null;
  return { key: `${groups.indexOf(g)}|${w.mark}`, cases: g.cases.get(w.mark) };
}
const lightest = (u) => casesOf(u)?.cases[0].rep ?? u;
const heaviest = (u) => casesOf(u)?.cases.at(-1).rep ?? u;

/**
 * The case of each part of an expansion like ﬁ, ½ or ㉰, read one part at
 * a time: with the parts before it set, a part weighs one of its letter's
 * cases exactly when the expansion sorts between that case followed by
 * the lightest cases of the rest and that case followed by their heaviest
 * (㉰ is the circled ᄃ of ㉢ and an ᅡ heavier than the small one), or else
 * falls in the gap after one case (ﬁ's f, between ｆ and ⓕ). Returns
 * `{ run }`, the run as code points the collator weighs exactly, or
 * `{ k, after, fixed, at }`: the parts before k weigh as `fixed` does,
 * part k in the gap after the case `after` (null: before them all) of the
 * letter `at` (null: it has no cases), and the parts after it a step
 * heavier than their own.
 */
function placeRun(c, run) {
  const fixed = [];
  for (let k = 0; k < run.length; k += 1) {
    const at = casesOf(run[k]);
    if (!at) return { k, after: null, fixed, at: null };
    const rest = run.slice(k + 1);
    const lo = rest.map(lightest);
    const hi = rest.map(heaviest);
    const prefix = fixed.join('');
    let after = null;
    let exact = null;
    for (const { t, rep } of at.cases) {
      const low = full.compare(prefix + rep + lo.join(''), c);
      if (low === 0) return { run: [...fixed, rep, ...lo] };
      const high = full.compare(prefix + rep + hi.join(''), c);
      if (high === 0) return { run: [...fixed, rep, ...hi] };
      if (low < 0 && high > 0) {
        exact = rep;
        break;
      }
      if (high > 0) break;
      after = t;
    }
    if (exact === null) return { k, after, fixed, at };
    fixed.push(exact);
  }
  throw new Error(`${hex(cpOf(c))}: no case of its parts`);
}

// Expansions: an accent after the first part (æ), or the cases of the
// parts (placeRun).
const expansionEntry = new Map();
const families = [];
for (const [c, run] of expansions) {
  if (accent.compare(c, run.join('')) !== 0) {
    families.push({ c, run, accent: accentSlot(c, run) });
    continue;
  }
  const place = placeRun(c, run);
  if (place.run) {
    expansionEntry.set(c, { run: place.run, accent: null, slot: null, at: null });
    continue;
  }
  const e = { run: [...place.fixed, ...run.slice(place.k)], accent: null, slot: null, at: place.k };
  expansionEntry.set(c, e);
  if (place.at)
    placed.push({
      c,
      key: `${place.at.key}|${place.k}|${place.fixed.join('')}`,
      after: place.after,
      expansion: e,
      done: ({ t }) => (e.slot = t),
    });
}

/**
 * Sets what falls in the same gap among a letter's cases (`placed`) and
 * ties up to the case (the same base letters and accents: ﮤ and ﮥ, ㎩ and
 * 🆌) in the collator's order there; what can't tie is never weighed
 * against it. Expansions that tie completely take the same run (🆏 is 🅏).
 */
{
  const gaps = new Map();
  for (const item of placed) {
    const key = `${item.key}|${item.after}`;
    if (!gaps.has(key)) gaps.set(key, { after: item.after, items: [] });
    gaps.get(key).items.push(item);
  }
  for (const { after, items } of gaps.values()) {
    const classes = [];
    for (const item of items) {
      const cls = classes.find((k) => accent.compare(k[0].c, item.c) === 0);
      if (cls) cls.push(item);
      else classes.push([item]);
    }
    for (const cls of classes) {
      cls.sort((x, y) => full.compare(x.c, y.c));
      let k = 0;
      cls.forEach((item, i) => {
        if (i > 0 && full.compare(cls[i - 1].c, item.c) !== 0) k += 1;
        const t = (after ?? 0) + 1 + k;
        if (t >= (after ?? 0) + TSCALE - HALF) throw new Error(`${hex(cpOf(item.c))}: no room among the cases`);
        item.done({ t });
        const same = cls.slice(0, i).find((x) => x.expansion && full.compare(x.c, item.c) === 0);
        if (same && item.expansion) item.expansion.run = same.expansion.run;
      });
    }
  }
}

// Accented expansions that tie up to the case (œ, Œ, ꟹ) are set in the
// collator's order, each case heavier than every case of a letter.
{
  const classes = [];
  for (const f of families) {
    const cls = classes.find((k) => k[0].accent === f.accent && accent.compare(k[0].c, f.c) === 0);
    if (cls) cls.push(f);
    else classes.push([f]);
  }
  for (const cls of classes) {
    cls.sort((x, y) => full.compare(x.c, y.c));
    let k = 0;
    cls.forEach((f, i) => {
      if (i > 0 && full.compare(cls[i - 1].c, f.c) !== 0) k += 1;
      expansionEntry.set(f.c, { run: f.run, accent: f.accent, slot: EXPANSION_CASE + tertiary(k), at: 0 });
    });
  }
}

// One entry per code point, in code point order (the contractions last).
singles.sort((x, y) => idOf(x) - idOf(y));
const entries = [];
for (const c of singles) {
  const cp = idOf(c);
  if (ignorable.has(c)) entries.push({ cp, kind: 'I' });
  else if (accentWeight.has(c)) {
    const { rank, t } = accentWeight.get(c);
    entries.push({ cp, kind: 'M', w: MARK_BASE + rank, t: tertiary(t) });
  } else if (expansionEntry.has(c)) {
    const e = expansionEntry.get(c);
    entries.push({ cp, kind: 'E', ...e, run: e.run.map(idOf) });
  } else {
    const { p, ideograph, mark, t } = weights.get(c);
    if (t === null) throw new Error(`${hex(cp)}: no case`);
    entries.push({ cp, kind: 'W', p, ideograph: ideograph && cpOf(ideograph), mark, t });
  }
}

const text = (e) => {
  switch (e.kind) {
    case 'I':
      return 'I';
    case 'M':
      return `M${hex(e.w)}${e.t === PLAIN ? '' : `.${hex(e.t)}`}`;
    case 'E':
      return `=${e.run.map(hex).join(',')}${e.accent ? `!${hex(e.accent)}` : ''}${e.at === null ? '' : `@${hex(e.at)}:${e.slot === null ? '' : hex(e.slot)}`}`;
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
  ([c, d]) => `${hex(idOf(c))}=${d.map((x) => hex(cpOf(x))).join(',')}`,
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
// only: secondary weight w, tertiary t when not the first case's),
// \`code=a,b,…\` (that run of code points or contractions, each part as it
// weighs, and \`@k:s\` when part k weighs the tertiary s instead, the parts
// after it a step heavier than their own, as in a compatibility form like
// ½ or ㉰; \`@k:\` with no s, part k on a step too; \`!w@0:s\` a letter like
// æ, which differs in accent too: w the accent after its first part, s its
// first part's tertiary, and the rest of its parts heavier than every
// case), or \`code:p.m.t\` (primary rank p, or \`~i\` the
// primary of the ideograph i; m, when present, the accent that sets it
// apart from the first of its base letters; t its tertiary weight). Case
// and form weigh 256 apart, 128 the first (\`plainTertiary\`), and what
// the collator puts between two of a letter's cases weighs between. \`*n\`
// repeats an entry for n code points, the rank or
// weight one higher each time. A code point that decomposes canonically is
// listed only when the collator weighs it as a letter of its own (a
// contraction: й, أ, ো), and \`contractionSource\` has the code points the
// collator weighs as one (\`code=a,b,…\`): those decompositions, and a few
// sequences no code point decomposes to (l·, ํา), listed under codes past
// U+10FFFF. JSCollation.swift weighs each such sequence as its code.
// \`implicitSource\` lists the ideographs in the collator's order (runs of
// \`start+count\`); \`swapSource\` the vowels written before a consonant that
// the collator weighs after it, with those consonants. Code points listed
// nowhere (unassigned, private use) sort after the ideographs in code
// point order. \`decompositionSource\` holds every canonical decomposition
// but Hangul's (\`code=a,b,…\`, in full), and \`combiningClassSource\` the
// canonical combining class of every mark that has one, as its rank among
// the classes (\`code:r\`, \`*n\` for n code points of that class).
// ${entries.length} code points and contractions in ${lines.length} entries; ${implicitChars.length} ideographs; ${decompositionLines.length} decompositions; ${classRank.size} marks in ${new Set(classRank.values()).size} classes.

extension JSCollation {
  /// The primary rank of the ideographs (each its place in their order after it).
  static let implicitRank: UInt32 = ${IMPLICIT_RANK}
  /// The primary rank of code points the table doesn't list (by code point after it).
  static let unassignedRank: UInt32 = ${UNASSIGNED_RANK}
  /// The secondary weight of a base letter with no accent.
  static let common: UInt32 = 0x${hex(COMMON)}
  /// The tertiary weight of a small letter, or of a mark: the first case.
  static let plainTertiary: UInt32 = 0x${hex(PLAIN)}
  /// Added to the case of an expansion's parts that is heavier than every case.
  static let expansionCase: UInt32 = 0x${hex(EXPANSION_CASE)}

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
