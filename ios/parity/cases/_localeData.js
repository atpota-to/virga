// The locale data the Swift port formats with, read out of the JavaScript
// runtime's own Intl (ICU and CLDR), so the iOS app writes numbers, dates
// and times exactly as the web app does in every region, whatever ICU the
// device has.
//
// Virga's words are English, so its formats are English in the reader's
// region (src/lib/locale.js): every locale it formats in is `en-<region>`.
// For each region this reads the number symbols and grouping, the hour
// cycle, the first day of the week, the month and weekday names, and for
// each date-format option set the web app uses, the pattern Intl lays the
// fields out in (from formatToParts, checked by formatting it back).
//
// Used by cases/core.localeData.js (the fixture the Swift tests compare the
// table with) and ../locale-data.mjs (which writes the Swift table,
// VirgaCore/Locale/LocaleData+Table.swift).

/** The option sets the web app formats dates with (grep toLocale*String). */
export const DATE_OPTION_SETS = [
  { year: 'numeric', month: 'numeric', day: 'numeric' },
  {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  },
  { hour: 'numeric', minute: 'numeric', second: 'numeric' },
  { month: 'short', day: 'numeric', year: 'numeric' },
  { month: 'short', day: 'numeric' },
  { month: 'long', day: 'numeric' },
  { month: 'long', day: 'numeric', year: 'numeric' },
  { month: 'long', year: 'numeric' },
  { month: 'short', year: 'numeric' },
  { weekday: 'long' },
  { weekday: 'short' },
  { weekday: 'short', month: 'short', day: 'numeric' },
  { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' },
  { weekday: 'long', month: 'long', day: 'numeric' },
  { weekday: 'long', month: 'short', day: 'numeric' },
  {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
  {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
  {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
  { hour: 'numeric' },
  { hour: 'numeric', minute: '2-digit' },
  { hour: 'numeric', hour12: true },
  { hour: 'numeric', minute: '2-digit', hour12: true },
  { hour: '2-digit', minute: '2-digit', hour12: false },
  { dateStyle: 'medium', timeStyle: 'short' },
  { dateStyle: 'medium' },
  { dateStyle: 'long' },
  { timeStyle: 'short' },
];

/** The canonical key of an option set: its fields sorted, `k=v` joined by commas. */
export function optionKey(options) {
  return Object.keys(options)
    .filter((k) => k !== 'timeZone' && options[k] !== undefined)
    .sort()
    .map((k) => `${k}=${options[k]}`)
    .join(',');
}

/** Every region Intl can name, two letters, plus the three UN codes CLDR has English for. */
export function allRegions() {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const out = [];
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of A) {
    for (const b of A) {
      const code = a + b;
      try {
        const name = names.of(code);
        if (name && name !== code) out.push(code);
      } catch {
        // not a region
      }
    }
  }
  return [...out, '001', '150', '419'];
}

// Instants that tell the fields apart: single-digit day, month and hour in
// the morning; an afternoon in a two-digit month; half past midnight in
// September (the month CLDR abbreviates differently by region); and June
// and July, which en-AU abbreviates in a date ("17 June") but not alone
// ("Jun").
const SAMPLES = [
  Date.UTC(2026, 2, 5, 9, 5, 7),
  Date.UTC(2026, 10, 14, 14, 30, 45),
  Date.UTC(2026, 8, 1, 0, 30, 0),
  Date.UTC(2025, 0, 31, 12, 0, 9),
  Date.UTC(2027, 11, 25, 23, 59, 59),
  Date.UTC(2026, 5, 6, 6, 6, 6),
  Date.UTC(2026, 6, 20, 18, 45, 0),
];

/**
 * A region's month and weekday names, twice over: as a date writes them
 * (the month beside a day, the weekday beside a date), which the patterns'
 * M and E fields use, and stand-alone (the field by itself), which L and c
 * use. They differ in en-AU: "17 June" but "Jun" alone.
 */
function namesFor(tag) {
  const part = (options, ms, type) =>
    new Intl.DateTimeFormat(tag, { ...options, timeZone: 'UTC' })
      .formatToParts(new Date(ms))
      .find((p) => p.type === type).value;
  const month = (style, context) =>
    Array.from({ length: 12 }, (_, i) =>
      part({ month: style, ...context }, Date.UTC(2026, i, 15), 'month'),
    );
  // 2026-03-01 is a Sunday.
  const weekday = (style, context) =>
    Array.from({ length: 7 }, (_, i) =>
      part({ weekday: style, ...context }, Date.UTC(2026, 2, 1 + i), 'weekday'),
    );
  const inDate = { day: 'numeric', month: 'short' };
  const period = (ms) =>
    new Intl.DateTimeFormat(tag, {
      hour: 'numeric',
      hour12: true,
      timeZone: 'UTC',
    })
      .formatToParts(new Date(ms))
      .find((p) => p.type === 'dayPeriod')?.value ?? '';
  return {
    monthsShort: month('short', { day: 'numeric' }),
    monthsLong: month('long', { day: 'numeric' }),
    monthsNarrow: month('narrow', { day: 'numeric' }),
    weekdaysShort: weekday('short', inDate),
    weekdaysLong: weekday('long', inDate),
    weekdaysNarrow: weekday('narrow', inDate),
    standaloneMonthsShort: month('short'),
    standaloneMonthsLong: month('long'),
    standaloneMonthsNarrow: month('narrow'),
    standaloneWeekdaysShort: weekday('short'),
    standaloneWeekdaysLong: weekday('long'),
    standaloneWeekdaysNarrow: weekday('narrow'),
    am: period(Date.UTC(2026, 0, 1, 9)),
    pm: period(Date.UTC(2026, 0, 1, 15)),
  };
}

function utcFields(ms) {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** The ICU fields a part can be, given its value at an instant. */
function fieldTokens(part, f, names) {
  const v = part.value;
  if (part.type === 'literal') return null;
  if (part.type === 'dayPeriod') return ['a'];
  const h12 = f.hour % 12 === 0 ? 12 : f.hour % 12;
  const h11 = f.hour % 12;
  const h24 = f.hour === 0 ? 24 : f.hour;
  const candidates = {
    year: [
      ['y', String(f.year)],
      ['yy', pad2(f.year % 100)],
    ],
    month: [
      ['M', String(f.month + 1)],
      ['MM', pad2(f.month + 1)],
      ['MMM', names.monthsShort[f.month]],
      ['MMMM', names.monthsLong[f.month]],
      ['MMMMM', names.monthsNarrow[f.month]],
      ['LLL', names.standaloneMonthsShort[f.month]],
      ['LLLL', names.standaloneMonthsLong[f.month]],
      ['LLLLL', names.standaloneMonthsNarrow[f.month]],
    ],
    day: [
      ['d', String(f.day)],
      ['dd', pad2(f.day)],
    ],
    weekday: [
      ['EEE', names.weekdaysShort[f.weekday]],
      ['EEEE', names.weekdaysLong[f.weekday]],
      ['EEEEE', names.weekdaysNarrow[f.weekday]],
      ['ccc', names.standaloneWeekdaysShort[f.weekday]],
      ['cccc', names.standaloneWeekdaysLong[f.weekday]],
      ['ccccc', names.standaloneWeekdaysNarrow[f.weekday]],
    ],
    hour: [
      ['H', String(f.hour)],
      ['HH', pad2(f.hour)],
      ['h', String(h12)],
      ['hh', pad2(h12)],
      ['K', String(h11)],
      ['KK', pad2(h11)],
      ['k', String(h24)],
      ['kk', pad2(h24)],
    ],
    minute: [
      ['m', String(f.minute)],
      ['mm', pad2(f.minute)],
    ],
    second: [
      ['s', String(f.second)],
      ['ss', pad2(f.second)],
    ],
  }[part.type];
  if (!candidates) throw new Error(`can't read the ${part.type} part "${v}"`);
  const tokens = candidates.filter(([, s]) => s === v).map(([t]) => t);
  if (!tokens.length)
    throw new Error(`can't read the ${part.type} part "${v}"`);
  return tokens;
}

/** A literal in an ICU pattern: letters and apostrophes quoted. */
function quote(text) {
  let out = '';
  let run = '';
  for (const ch of text) {
    if (/[A-Za-z]/.test(ch)) run += ch;
    else {
      if (run) {
        out += `'${run}'`;
        run = '';
      }
      out += ch === "'" ? "''" : ch;
    }
  }
  if (run) out += `'${run}'`;
  return out;
}

/** Lays an ICU pattern out for UTC instant `ms`, as the Swift port does. */
export function renderPattern(pattern, ms, names) {
  const f = utcFields(ms);
  const h12 = f.hour % 12 === 0 ? 12 : f.hour % 12;
  const h11 = f.hour % 12;
  const h24 = f.hour === 0 ? 24 : f.hour;
  const values = {
    y: String(f.year),
    yy: pad2(f.year % 100),
    M: String(f.month + 1),
    MM: pad2(f.month + 1),
    MMM: names.monthsShort[f.month],
    MMMM: names.monthsLong[f.month],
    MMMMM: names.monthsNarrow[f.month],
    LLL: names.standaloneMonthsShort[f.month],
    LLLL: names.standaloneMonthsLong[f.month],
    LLLLL: names.standaloneMonthsNarrow[f.month],
    d: String(f.day),
    dd: pad2(f.day),
    EEE: names.weekdaysShort[f.weekday],
    EEEE: names.weekdaysLong[f.weekday],
    EEEEE: names.weekdaysNarrow[f.weekday],
    ccc: names.standaloneWeekdaysShort[f.weekday],
    cccc: names.standaloneWeekdaysLong[f.weekday],
    ccccc: names.standaloneWeekdaysNarrow[f.weekday],
    H: String(f.hour),
    HH: pad2(f.hour),
    h: String(h12),
    hh: pad2(h12),
    K: String(h11),
    KK: pad2(h11),
    k: String(h24),
    kk: pad2(h24),
    m: String(f.minute),
    mm: pad2(f.minute),
    s: String(f.second),
    ss: pad2(f.second),
    a: f.hour < 12 ? names.am : names.pm,
  };
  let out = '';
  for (let i = 0; i < pattern.length;) {
    const ch = pattern[i];
    if (ch === "'") {
      if (pattern[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      const end = pattern.indexOf("'", i + 1);
      out += pattern.slice(i + 1, end);
      i = end + 1;
    } else if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (pattern[j] === ch) j += 1;
      const token = pattern.slice(i, j);
      if (!(token in values)) throw new Error(`unknown field ${token}`);
      out += values[token];
      i = j;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** The pattern Intl uses for `options` in `tag`, checked against every sample. */
function patternFor(tag, options, names) {
  const dtf = new Intl.DateTimeFormat(tag, { ...options, timeZone: 'UTC' });
  // Each part's possible tokens, narrowed over the samples.
  let shape = null;
  for (const ms of SAMPLES) {
    const parts = dtf.formatToParts(new Date(ms));
    const f = utcFields(ms);
    // format() writes a plain space where ICU puts U+202F (before AM/PM),
    // and the web app formats with format(), so the pattern does too.
    const row = parts.map((p) =>
      p.type === 'literal'
        ? { literal: p.value.replaceAll('\u202f', ' ') }
        : { tokens: fieldTokens(p, f, names) },
    );
    if (!shape) shape = row;
    else {
      if (row.length !== shape.length)
        throw new Error(`${tag} ${optionKey(options)}: parts change shape`);
      shape = shape.map((cell, i) =>
        cell.literal !== undefined
          ? cell
          : { tokens: cell.tokens.filter((t) => row[i].tokens.includes(t)) },
      );
    }
  }
  const pattern = shape
    .map((cell) => {
      if (cell.literal !== undefined) return quote(cell.literal);
      if (cell.tokens.length === 0)
        throw new Error(`${tag} ${optionKey(options)}: no token fits`);
      return cell.tokens[0];
    })
    .join('');
  for (const ms of SAMPLES) {
    const expected = dtf.format(new Date(ms));
    const actual = renderPattern(pattern, ms, names);
    if (expected !== actual) {
      throw new Error(
        `${tag} ${optionKey(options)}: pattern ${pattern} gives "${actual}", Intl "${expected}"`,
      );
    }
  }
  return pattern;
}

function numberFor(tag) {
  const parts = new Intl.NumberFormat(tag).formatToParts(-1234567.5);
  const group = parts.find((p) => p.type === 'group')?.value ?? '';
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  const minus = parts.find((p) => p.type === 'minusSign')?.value ?? '-';
  const integers = parts
    .filter((p) => p.type === 'integer')
    .map((p) => p.value);
  // [1, 234, 567] or [12, 34, 567]: the second group from the right.
  const secondaryGrouping =
    integers.length > 2 ? integers[integers.length - 2].length : 3;
  const minimumGroupingDigits = (1234).toLocaleString(tag).includes(group)
    ? 1
    : 2;
  return { decimal, group, minus, secondaryGrouping, minimumGroupingDigits };
}

/** Everything the Swift port knows about `en-<region>`. */
export function regionRecord(region) {
  const tag = `en-${region}`;
  const names = namesFor(tag);
  const patterns = {};
  for (const options of DATE_OPTION_SETS) {
    patterns[optionKey(options)] = patternFor(tag, options, names);
  }
  const locale = new Intl.Locale(tag);
  const info =
    typeof locale.getWeekInfo === 'function'
      ? locale.getWeekInfo()
      : locale.weekInfo;
  return {
    region,
    number: numberFor(tag),
    hourCycle: new Intl.DateTimeFormat(tag, {
      hour: 'numeric',
    }).resolvedOptions().hourCycle,
    firstDay: info.firstDay % 7,
    names,
    patterns,
  };
}

/**
 * What the Swift port needs to read a language tag the way Intl.Locale
 * does: the languages Intl formats at all (supportedLocalesOf, which takes
 * deprecated codes too); for every language code Intl.Locale reads, its
 * canonical form where it differs (iw → he, eng → en, tw → ak) and its
 * likeliest region (maximize(): de → DE, dv → MV), whether or not Intl can
 * format in it, since systemLocale and regionWeekStart maximize any
 * language; for the formatted ones, the likeliest region in a script where
 * that differs (zh-Hant → TW); and the canonical form of deprecated region
 * codes (UK → GB, 826 → GB).
 */
export function languageRecord() {
  const A = 'abcdefghijklmnopqrstuvwxyz';
  const codes = [];
  for (const a of A) for (const b of A) codes.push(a + b);
  for (const a of A)
    for (const b of A) for (const c of A) codes.push(a + b + c);
  const supported = codes.filter((code) => {
    try {
      return Intl.NumberFormat.supportedLocalesOf([code]).length > 0;
    } catch {
      return false;
    }
  });
  const aliases = {};
  const likelyRegions = {};
  const scripts = new Set();
  for (const code of codes) {
    let locale;
    try {
      locale = new Intl.Locale(code);
    } catch {
      continue;
    }
    if (locale.toString() !== code) aliases[code] = locale.toString();
    const max = locale.maximize();
    if (max.region) likelyRegions[code] = max.region;
    if (max.script && supported.includes(code)) scripts.add(max.script);
  }
  // `und` (no language) maximizes too: to the world's likeliest, en-Latn-US.
  likelyRegions.und = new Intl.Locale('und').maximize().region;
  for (const extra of [
    'Hant',
    'Hans',
    'Latn',
    'Cyrl',
    'Arab',
    'Deva',
    'Bopo',
    'Mong',
    'Adlm',
    'Nkoo',
    'Olck',
    'Vaii',
    'Tfng',
    'Rohg',
    'Mymr',
    'Sinh',
    'Thai',
  ])
    scripts.add(extra);
  const scriptRegions = {};
  for (const code of supported) {
    for (const script of [...scripts].sort()) {
      const max = new Intl.Locale(`${code}-${script}`).maximize();
      if (max.region && max.region !== likelyRegions[code]) {
        scriptRegions[`${code}-${script}`] = max.region;
      }
    }
  }
  const regionAliases = {};
  const R = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const regionCodes = [];
  for (const a of R) for (const b of R) regionCodes.push(a + b);
  for (let n = 0; n < 1000; n++) regionCodes.push(String(n).padStart(3, '0'));
  for (const code of regionCodes) {
    const region = new Intl.Locale(`und-${code}`).region;
    if (region && region !== code) regionAliases[code] = region;
  }
  return { supported, aliases, likelyRegions, scriptRegions, regionAliases };
}

/**
 * The whole table, deduplicated: the distinct formats and name sets, each
 * region's indexes into them with its first day and hour cycle, and the
 * language data. In region order, so the output is stable.
 */
export function localeTable() {
  const formats = [];
  const formatIndex = new Map();
  const names = [];
  const namesIndex = new Map();
  const regions = {};
  const indexOf = (list, index, value) => {
    const key = JSON.stringify(value);
    if (!index.has(key)) {
      index.set(key, list.length);
      list.push(value);
    }
    return index.get(key);
  };
  for (const region of allRegions()) {
    const record = regionRecord(region);
    regions[region] = {
      format: indexOf(formats, formatIndex, {
        number: record.number,
        patterns: record.patterns,
      }),
      names: indexOf(names, namesIndex, record.names),
      firstDay: record.firstDay,
      hourCycle: record.hourCycle,
    };
  }
  return {
    runtime: runtimeRecord(),
    formats,
    names,
    regions,
    languages: languageRecord(),
  };
}

/** The runtime the data was read from. */
export function runtimeRecord() {
  return {
    icu: process.versions.icu,
    cldr: process.versions.cldr,
    unicode: process.versions.unicode,
  };
}
