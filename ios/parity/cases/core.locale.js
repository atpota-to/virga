// How numbers, dates and times are written, and which day a week starts on.
// Swift: VirgaCore/Lib/AppLocale.swift (+Formatting), LanguageTag.swift and
// LocaleData.swift. The table itself is core.localeData; this holds the
// functions of src/lib/locale.js, and the formatting engine over every
// format the table has, to the web code.

import {
  DEFAULT_LOCALE,
  DEFAULT_WEEK_START,
  LOCALE_CHOICES,
  WEEK_START_CHOICES,
  activeLocale,
  activeWeekStart,
  fmtInt,
  localeSample,
  localeStamp,
  regionWeekStart,
  resolveLocale,
  resolveWeekStart,
  setActiveLocale,
  setActiveWeekStart,
  systemLocale,
  uses12Hour,
  weekOrder,
  weekdayOffset,
} from '../../../src/lib/locale.js';
import { each, value } from './_helpers.js';
import { DATE_OPTION_SETS, localeTable } from './_localeData.js';
import { inZone } from './_zones.js';

export const sources = ['src/lib/locale.js'];

/**
 * Whether `tag` is English (or no tag at all, which falls back to en-US).
 * The Swift port formats only in English, which is all the web app ever
 * activates (resolveLocale gives one of LOCALE_CHOICES or en-<region>); a
 * tag in another language formats as English in its region there, where
 * Intl would use that language. So formatting is compared for these only.
 */
function englishOrInvalid(tag) {
  try {
    return new Intl.Locale(tag).language === 'en';
  } catch {
    return true;
  }
}

/** Runs `fn` with the formats set, and puts them back to the defaults. */
function withFormats(locale, weekStart, fn) {
  try {
    if (locale !== undefined) setActiveLocale(locale);
    if (weekStart !== undefined) setActiveWeekStart(weekStart);
    return fn();
  } finally {
    setActiveLocale(DEFAULT_LOCALE);
    setActiveWeekStart(DEFAULT_WEEK_START);
  }
}

const TAGS = [
  'en-US',
  'en-GB',
  'en-DE',
  'en-FR',
  'en-CH',
  'en-IN',
  'en-AU',
  'en-CA',
  'en-JP',
  'en-ZA',
  'en-SE',
  'en-MV',
  'en-AE',
  'en-EG',
  'en-IL',
  'en-001',
  'en-150',
  'en-419',
  'en',
  'EN-gb',
  'en-Latn-GB',
  'en-UK',
  'en-SU',
  'eng-GB',
  'de',
  'de-DE',
  'fr-CA',
  'ar-EG',
  'he',
  'iw',
  'zh-Hant',
  'zh-Hans',
  'zh',
  'pt',
  'und',
  'und-GB',
  'tlh',
  'xx-YY',
  'english',
  'en_US',
  'not a locale',
  '',
  'en-',
  'root',
  'en-US-u-ca-gregory',
  'en-GB-x-private',
];

const LANGUAGE_LISTS = [
  ['de-DE', 'en'],
  ['en-AU'],
  ['fr'],
  ['ja-JP'],
  [],
  ['???'],
  null,
  ['nl-NL'],
  ['en'],
  ['en', 'de-DE'],
  ['de'],
  ['zh-Hant'],
  ['zh-Hant-HK'],
  ['zh-Hans-CN'],
  ['pt-BR'],
  ['pt'],
  ['es-419'],
  ['es-419', 'es'],
  ['en-419'],
  ['en-001'],
  ['ar'],
  ['hi-IN'],
  ['iw'],
  ['sh'],
  ['und'],
  ['und-FR'],
  ['tlh', 'fr'],
  ['xx'],
  ['xx-YY'],
  ['en_GB', 'sv'],
  ['', 'ko'],
  ['en-UK'],
  ['eng'],
  ['fil'],
  ['yue'],
  ['ckb'],
  ['sr-Latn'],
  ['uz-Arab'],
  ['de-CH-1996'],
];

const NUMBERS = [
  0,
  1,
  12,
  123,
  1234,
  12345,
  123456,
  1234567,
  1234567.891,
  -1234.5,
  0.5,
  1.5,
  2.5,
  -0.5,
  0.0004,
  0.0005,
  -0.0004,
  1.0005,
  1.005,
  999.9995,
  999999.9999,
  0.1 + 0.2,
  1e21,
  1.5e21,
  123456789012345680000,
  1e-7,
  5e-324,
  2 ** 53,
];

const FMT_INT = [
  1234567,
  0,
  -0.4,
  0.4,
  0.5,
  -0.5,
  -1234.5,
  999.5,
  'abc',
  null,
  '12.5',
  '1e3',
  'Infinity',
  true,
  [],
  [42],
  1e21,
  1234,
  12345,
];

const INSTANTS = [
  Date.UTC(2026, 2, 5, 9, 5, 7),
  Date.UTC(2026, 10, 14, 14, 30, 45),
  Date.UTC(2026, 8, 1, 0, 30, 0),
  Date.UTC(2025, 11, 31, 23, 59, 59),
  Date.UTC(1999, 0, 9, 12, 0, 0),
];

export default async function cases() {
  const out = [];
  out.push(
    value('constants', {
      DEFAULT_LOCALE,
      DEFAULT_WEEK_START,
      LOCALE_CHOICES,
      WEEK_START_CHOICES: Object.entries(WEEK_START_CHOICES),
    }),
    value('initial', {
      activeLocale: activeLocale(),
      activeWeekStart: activeWeekStart(),
      uses12Hour: uses12Hour(),
      localeStamp: localeStamp(),
    }),
  );
  out.push(
    ...(await each(
      'setActiveLocale',
      [...TAGS, null, 42].map((tag) => ({ tag })),
      ({ tag }) =>
        withFormats(undefined, undefined, () => {
          const result = setActiveLocale(tag);
          return {
            result,
            activeLocale: activeLocale(),
            ...(englishOrInvalid(tag) ? { uses12Hour: uses12Hour() } : {}),
            localeStamp: localeStamp(),
          };
        }),
    )),
  );
  out.push(
    ...(await each(
      'setActiveWeekStart',
      [0, 1, 3, 6, 7, -1, 9, 2.5, 'sunday', '3', null, true].map((day) => ({
        day,
      })),
      ({ day }) =>
        withFormats(undefined, undefined, () => {
          const result = setActiveWeekStart(day);
          return {
            result,
            activeWeekStart: activeWeekStart(),
            localeStamp: localeStamp(),
          };
        }),
    )),
  );
  out.push(
    ...(await each(
      'systemLocale',
      LANGUAGE_LISTS.map((languages) => ({ languages })),
      ({ languages }) => systemLocale(languages),
    )),
  );
  out.push(
    ...(await each(
      'resolveLocale',
      [
        ...['system', 'en-GB', 'en-IN', 'xx-YY', 'en-AU', null, ''].flatMap(
          (pref) =>
            [['nl-NL'], ['en-NZ'], []].map((languages) => ({
              pref,
              languages,
            })),
        ),
      ],
      ({ pref, languages }) => resolveLocale(pref, languages),
    )),
  );
  out.push(
    ...(await each(
      'regionWeekStart',
      TAGS.map((tag) => ({ tag })),
      ({ tag }) => regionWeekStart(tag),
    )),
  );
  out.push(
    ...(await each(
      'resolveWeekStart',
      [
        'system',
        'monday',
        'sunday',
        'saturday',
        'someday',
        null,
        'toString',
      ].flatMap((pref) =>
        ['en-US', 'en-GB', 'en-AE', 'en-MV', null].map((tag) => ({
          pref,
          tag,
        })),
      ),
      ({ pref, tag }) =>
        withFormats('en-IN', undefined, () =>
          tag === null ? resolveWeekStart(pref) : resolveWeekStart(pref, tag),
        ),
    )),
  );
  out.push(
    ...(await each(
      'weekOrder',
      [0, 1, 2, 3, 4, 5, 6, null].map((start) => ({ start })),
      ({ start }) =>
        withFormats(undefined, 6, () =>
          start === null ? weekOrder() : weekOrder(start),
        ),
    )),
  );
  out.push(
    ...(await each(
      'weekdayOffset',
      [0, 1, 3, 6].flatMap((day) =>
        [0, 1, 6, null].map((start) => ({ day, start })),
      ),
      ({ day, start }) =>
        withFormats(undefined, 0, () =>
          start === null ? weekdayOffset(day) : weekdayOffset(day, start),
        ),
    )),
  );
  out.push(
    ...(await each(
      'fmtInt',
      ['en-US', 'en-DE', 'en-FR', 'en-CH', 'en-IN', 'en-ES', 'en-SE'].flatMap(
        (locale) => FMT_INT.map((n) => ({ locale, n })),
      ),
      ({ locale, n }) => withFormats(locale, undefined, () => fmtInt(n)),
    )),
  );
  out.push(
    ...(await each(
      'localeSample',
      ['UTC', 'America/New_York', 'Pacific/Chatham'].flatMap((zone) =>
        TAGS.filter(englishOrInvalid).map((tag) => ({ zone, tag })),
      ),
      ({ zone, tag }) => inZone(zone, () => localeSample(tag)),
    )),
  );

  // The engines, over one region of every format the table has.
  const table = localeTable();
  const representatives = table.formats.map(
    (_, index) =>
      Object.entries(table.regions).find(([, r]) => r.format === index)[0],
  );
  out.push(
    ...(await each(
      'formatNumber',
      representatives.flatMap((region) =>
        [
          {},
          { minimumFractionDigits: 1, maximumFractionDigits: 1 },
          { maximumFractionDigits: 0 },
          { minimumFractionDigits: 2, maximumFractionDigits: 2 },
        ].map((options) => ({
          locale: `en-${region}`,
          options,
          numbers: NUMBERS,
        })),
      ),
      ({ locale, options, numbers }) =>
        numbers.map((n) => n.toLocaleString(locale, options)),
    )),
  );
  out.push(
    ...(await each(
      'formatDate',
      representatives.flatMap((region) =>
        DATE_OPTION_SETS.map((options) => ({
          locale: `en-${region}`,
          options,
        })),
      ),
      // At INSTANTS, which the Swift test lists too.
      ({ locale, options }) =>
        INSTANTS.map((ms) =>
          new Intl.DateTimeFormat(locale, {
            ...options,
            timeZone: 'UTC',
          }).format(new Date(ms)),
        ),
    )),
  );
  // The toLocale*String defaults, and local time in other zones.
  out.push(
    ...(await each(
      'toLocaleStrings',
      ['America/New_York', 'Asia/Kolkata', 'Australia/Lord_Howe'].flatMap(
        (zone) =>
          ['en-US', 'en-GB', 'en-CA', 'en-IN', 'en-DK'].map((locale) => ({
            zone,
            locale,
          })),
      ),
      ({ zone, locale }) =>
        inZone(zone, () =>
          INSTANTS.map((ms) => {
            const d = new Date(ms);
            return {
              date: d.toLocaleDateString(locale),
              time: d.toLocaleTimeString(locale),
              both: d.toLocaleString(locale),
              weekday: d.toLocaleDateString(locale, { weekday: 'long' }),
              hour: d.toLocaleTimeString(locale, { hour: 'numeric' }),
              format: new Intl.DateTimeFormat(locale).format(d),
              short: d.toLocaleDateString(locale, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              }),
            };
          }),
        ),
    )),
  );
  out.push(
    ...(await each('invalidDate', [{ locale: 'en-US' }], ({ locale }) => ({
      date: new Date(NaN).toLocaleDateString(locale),
      time: new Date(NaN).toLocaleTimeString(locale),
      both: new Date(NaN).toLocaleString(locale),
    }))),
  );
  return out;
}
