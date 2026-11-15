// How numbers, dates and times are written, and which day a week starts on.
//
// Virga's words are English, so the formats are English too, but in the
// reader's own region: someone in Berlin reads "14 Nov 2026", "1.234,5" and
// "14:30", someone in Chicago "Nov 14, 2026", "1,234.5" and "2:30 PM". A
// German browser therefore resolves to en-DE, not de-DE, which would put
// "14. Nov." into the middle of an English sentence.
//
// The values live at module level, not in React state, because the code that
// formats is mostly plain functions (the report models, the chart helpers,
// the posting models) with no component to hand them a context. The
// preferences provider sets them before anything renders and remounts the
// app when they change (src/lib/preferences.jsx), so nothing keeps a string
// formatted the old way. Under test nothing sets them, and they stay at
// en-US and Monday, which is what every expected string in the tests assumes.

export const DEFAULT_LOCALE = 'en-US';

/** 0 is Sunday, as `Date.prototype.getDay()` counts. */
export const DEFAULT_WEEK_START = 1;

/** The formats Settings offers by name, besides following the browser. */
export const LOCALE_CHOICES = Object.freeze(['en-US', 'en-GB', 'en-DE', 'en-FR', 'en-CH', 'en-IN']);

/** The week starts Settings offers, besides following the region. */
export const WEEK_START_CHOICES = Object.freeze({ monday: 1, sunday: 0, saturday: 6 });

let locale = DEFAULT_LOCALE;
let weekStart = DEFAULT_WEEK_START;
let twelveHour = true;

/** The locale to hand to `toLocaleString` and `Intl`: `n.toLocaleString(activeLocale())`. */
export function activeLocale() {
  return locale;
}

/** The first day of the week, as a `getDay()` index: 0 Sunday, 1 Monday, 6 Saturday. */
export function activeWeekStart() {
  return weekStart;
}

/** Whether times read "2:30 PM" (true) or "14:30" (false) in the active locale. */
export function uses12Hour() {
  return twelveHour;
}

/**
 * Something that changes whenever the formats do, for a cache key: a number
 * formatted for one locale must not be served to the next.
 */
export function localeStamp() {
  return `${locale}/${weekStart}`;
}

function supported(tag) {
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length > 0;
  } catch {
    return false;
  }
}

function hourCycleOf(tag) {
  try {
    const cycle = new Intl.DateTimeFormat(tag, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h11' || cycle === 'h12';
  } catch {
    return true;
  }
}

/** Set the locale. Anything `Intl` doesn't know falls back to the default. */
export function setActiveLocale(tag) {
  locale = typeof tag === 'string' && supported(tag) ? tag : DEFAULT_LOCALE;
  twelveHour = hourCycleOf(locale);
  return locale;
}

/** Set the first day of the week (0 to 6). Anything else falls back to Monday. */
export function setActiveWeekStart(day) {
  weekStart = Number.isInteger(day) && day >= 0 && day <= 6 ? day : DEFAULT_WEEK_START;
  return weekStart;
}

function browserLanguages() {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

/**
 * The browser's first language as an English locale in its region: 'de-DE'
 * and 'de' both give 'en-DE', 'en-AU' stays 'en-AU', and no readable language
 * at all gives the default.
 */
export function systemLocale(languages = browserLanguages()) {
  for (const tag of languages || []) {
    try {
      const parsed = new Intl.Locale(tag);
      if (parsed.language === 'en' && parsed.region) return `en-${parsed.region}`;
      // A bare 'de' has no region; maximize() adds the likeliest one (DE).
      const region = parsed.region || parsed.maximize().region;
      if (region && /^[A-Z]{2}$/.test(region) && supported(`en-${region}`)) return `en-${region}`;
    } catch {
      // Not a language tag; try the next.
    }
  }
  return DEFAULT_LOCALE;
}

/** The locale a stored preference means: 'system', or one of LOCALE_CHOICES. */
export function resolveLocale(pref, languages = browserLanguages()) {
  if (LOCALE_CHOICES.includes(pref)) return pref;
  return systemLocale(languages);
}

// Where the week starts on Sunday or Saturday, for engines without
// Intl.Locale's week info. Everywhere else it's Monday. From CLDR's
// supplemental week data (read 2026-11-14); a region missing here only costs
// someone a trip to Settings.
const SUNDAY_REGIONS = new Set(
  'AG AS AU BD BR BS BT BW BZ CA CN CO DM DO ET GT GU HK HN ID IL IN JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW'.split(' '),
);
const SATURDAY_REGIONS = new Set('AE AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY'.split(' '));

/** The day a week starts on where `tag` is from, as a `getDay()` index. */
export function regionWeekStart(tag) {
  try {
    const parsed = new Intl.Locale(tag);
    const info = typeof parsed.getWeekInfo === 'function' ? parsed.getWeekInfo() : parsed.weekInfo;
    // Intl counts Monday as 1 through Sunday as 7.
    if (info && Number.isInteger(info.firstDay)) return info.firstDay % 7;
    const region = parsed.region || parsed.maximize().region;
    if (SUNDAY_REGIONS.has(region)) return 0;
    if (SATURDAY_REGIONS.has(region)) return 6;
  } catch {
    // Fall through to Monday.
  }
  return DEFAULT_WEEK_START;
}

/** The day a stored preference means: 'system' (the locale's own), or a named day. */
export function resolveWeekStart(pref, tag = locale) {
  if (Object.hasOwn(WEEK_START_CHOICES, pref)) return WEEK_START_CHOICES[pref];
  return regionWeekStart(tag);
}

/**
 * The seven `getDay()` indexes in the order a week is read, starting from
 * the active first day: [1, 2, 3, 4, 5, 6, 0] for a Monday start.
 */
export function weekOrder(start = weekStart) {
  return Array.from({ length: 7 }, (_, i) => (start + i) % 7);
}

/** How far `day` (a `getDay()` index) is into the week: 0 for its first day. */
export function weekdayOffset(day, start = weekStart) {
  return (day - start + 7) % 7;
}

/** A whole number with the locale's separators: "1,234". */
export function fmtInt(n) {
  return Math.round(Number(n) || 0).toLocaleString(locale);
}

/** A sample of the formats for `tag`, for a settings row: "1,234.5 · Nov 14, 2026 · 2:30 PM". */
export function localeSample(tag, at = new Date(2026, 10, 14, 14, 30)) {
  const use = supported(tag) ? tag : DEFAULT_LOCALE;
  const number = (1234.5).toLocaleString(use);
  const date = at.toLocaleDateString(use, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = at.toLocaleTimeString(use, { hour: 'numeric', minute: '2-digit' });
  return `${number} · ${date} · ${time}`;
}
