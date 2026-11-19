// The two date strings the dashboard prints: the short date and the
// relative time. Swift: VirgaCore/Lib/Time.swift. In several zones, since
// both read the local calendar, across clock changes, and in the formats
// of other regions.

import { formatDateShort, relativeTime } from '../../../src/lib/time.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { each } from './_helpers.js';
import { ZONES, inZone } from './_zones.js';

export const sources = ['src/lib/time.js'];

/** Local-time constructor, in whatever zone is in force. */
const at = (y, m, d, h = 12, min = 0, sec = 0) =>
  new Date(y, m - 1, d, h, min, sec).getTime();

function withLocale(locale, fn) {
  try {
    setActiveLocale(locale);
    return fn();
  } finally {
    setActiveLocale(DEFAULT_LOCALE);
  }
}

// [date, now] pairs as functions of the zone's own clock, so each zone sees
// the same local times (the web test's), plus the edges.
const PAIRS = [
  ['just-now', () => [at(2026, 11, 12, 14, 59, 30), at(2026, 11, 12, 15, 0)]],
  [
    'exactly-a-minute',
    () => [at(2026, 11, 12, 14, 59, 0), at(2026, 11, 12, 15, 0)],
  ],
  ['5m', () => [at(2026, 11, 12, 14, 55), at(2026, 11, 12, 15, 0)]],
  ['59m', () => [at(2026, 11, 12, 14, 0, 30), at(2026, 11, 12, 15, 0)]],
  ['6h', () => [at(2026, 11, 12, 9, 0), at(2026, 11, 12, 15, 0)]],
  ['2d-calendar', () => [at(2026, 11, 10, 23, 0), at(2026, 11, 12, 15, 0)]],
  ['17h-last-night', () => [at(2026, 11, 11, 22, 0), at(2026, 11, 12, 15, 0)]],
  ['1d', () => [at(2026, 11, 11, 9, 0), at(2026, 11, 12, 15, 0)]],
  ['6d', () => [at(2026, 11, 6, 9, 0), at(2026, 11, 12, 15, 0)]],
  ['1w', () => [at(2026, 11, 5, 9, 0), at(2026, 11, 12, 15, 0)]],
  ['2w', () => [at(2026, 10, 28), at(2026, 11, 12, 15, 0)]],
  ['29d', () => [at(2026, 10, 14), at(2026, 11, 12, 15, 0)]],
  ['30d', () => [at(2026, 10, 13), at(2026, 11, 12, 15, 0)]],
  ['months', () => [at(2026, 8, 3), at(2026, 11, 12, 15, 0)]],
  ['years', () => [at(2019, 2, 1), at(2026, 11, 12, 15, 0)]],
  ['future', () => [at(2026, 11, 13), at(2026, 11, 12, 15, 0)]],
  [
    'across-spring-forward',
    () => [at(2026, 3, 7, 23, 30), at(2026, 3, 9, 0, 30)],
  ],
  [
    'across-fall-back',
    () => [at(2026, 10, 31, 23, 30), at(2026, 11, 2, 0, 30)],
  ],
  [
    'across-southern-change',
    () => [at(2026, 4, 4, 23, 30), at(2026, 4, 6, 0, 30)],
  ],
  ['new-year', () => [at(2025, 12, 31, 23, 0), at(2026, 1, 1, 1, 0)]],
  [
    'iso-string',
    () => [
      new Date(at(2026, 11, 12, 14, 0)).toISOString(),
      at(2026, 11, 12, 15, 0),
    ],
  ],
  ['date-only-string', () => ['2026-11-01', at(2026, 11, 12, 15, 0)]],
  ['not-a-date', () => ['not a date', at(2026, 11, 12, 15, 0)]],
  ['null', () => [null, at(2026, 11, 12, 15, 0)]],
  ['now-unreadable', () => [at(2026, 11, 12, 15, 0), 'never']],
  ['out-of-range', () => [-1e16, at(2026, 11, 12, 15, 0)]],
  [
    'fraction-ms',
    () => [at(2026, 11, 12, 14, 0) + 0.75, at(2026, 11, 12, 15, 0) + 0.25],
  ],
];

const DATES = [
  ['local-noon', () => at(2025, 1, 29)],
  ['local-midnight', () => at(2025, 1, 29, 0, 0)],
  ['last-minute', () => at(2025, 12, 31, 23, 59)],
  ['iso', () => '2025-01-29T12:00:00Z'],
  ['iso-late-utc', () => '2025-01-29T23:30:00Z'],
  ['date-only', () => '2025-01-29'],
  ['legacy', () => 'Jan 29 2025 10:00'],
  ['nope', () => 'nope'],
  ['null', () => null],
  ['epoch', () => 0],
  ['out-of-range', () => 1e16],
  // Local mean time, which platforms keep differently that far back: UTC only.
  ['year-999', () => at(999, 6, 1)],
];

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'formatDateShort',
      ZONES.flatMap((zone) =>
        ['en-US', 'en-GB', 'en-IN'].flatMap((locale) =>
          DATES.filter(
            ([$id]) => zone === 'UTC' || !$id.startsWith('year-'),
          ).map(([$id, make]) => ({
            $id: `${zone} ${locale} ${$id}`,
            zone,
            locale,
            date: inZone(zone, make),
          })),
        ),
      ),
      ({ zone, locale, date }) =>
        inZone(zone, () => withLocale(locale, () => formatDateShort(date))),
    )),
  );
  out.push(
    ...(await each(
      'relativeTime',
      ZONES.flatMap((zone) =>
        PAIRS.map(([$id, make]) => {
          const [date, now] = inZone(zone, make);
          return { $id: `${zone} ${$id}`, zone, date, now };
        }),
      ),
      ({ zone, date, now }) =>
        inZone(zone, () => withLocale('en-GB', () => relativeTime(date, now))),
    )),
  );
  return out;
}
