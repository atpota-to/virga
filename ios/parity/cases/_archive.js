// Shared by the archive's case generators (archive.*.js): running web code
// in a zone with a locale and a first day of the week, local times, and the
// locales the app activates.

import {
  DEFAULT_LOCALE,
  DEFAULT_WEEK_START,
  setActiveLocale,
  setActiveWeekStart,
} from '../../../src/lib/locale.js';
import { each, inZone } from './_helpers.js';

/** Runs `fn` in `zone`, with `locale` and the week starting on `weekStart`. */
export function under(
  {
    zone = 'UTC',
    locale = DEFAULT_LOCALE,
    weekStart = DEFAULT_WEEK_START,
  } = {},
  fn,
) {
  return inZone(zone, () => {
    setActiveLocale(locale);
    setActiveWeekStart(weekStart);
    try {
      return fn();
    } finally {
      setActiveLocale(DEFAULT_LOCALE);
      setActiveWeekStart(DEFAULT_WEEK_START);
    }
  });
}

/** `new Date(y, m - 1, d, h, min).getTime()` in whatever zone is in force. */
export const local = (y, m, d, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

/** The locales the app activates (LOCALE_CHOICES), and one more region. */
export const LOCALES = ['en-US', 'en-GB', 'en-DE', 'en-FR', 'en-CH', 'en-IN'];

const MARKERS = { $NaN: NaN, $Infinity: Infinity, '$-Infinity': -Infinity };

/**
 * The numbers JSON can't carry, written into an input as '$NaN',
 * '$Infinity' and '$-Infinity' and read back before the web code runs (the
 * Swift tests read them the same way). Without them a NaN would reach the
 * fixture as null, which the web code reads differently.
 */
export function numbers(value) {
  if (typeof value === 'string' && value in MARKERS) return MARKERS[value];
  if (Array.isArray(value)) return value.map(numbers);
  if (
    value &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, numbers(v)]),
    );
  }
  return value;
}

/** `each`, with the markers read back first. */
export function eachN(fn, inputs, compute) {
  return each(fn, inputs, (input) => compute(numbers(input)));
}
