// The chart window: presets and ranges picked by hand, read as local days
// (several zones, across clock changes), and the words for each, in the
// locales the app activates. Swift: VirgaArchive/Lib/Periods.swift.

import {
  CUSTOM_PERIOD,
  DEFAULT_PERIOD_KEY,
  customPeriod,
  dayKey,
  dayStartMs,
  periodBefore,
  periodEnd,
  periodLine,
  periodPhrase,
  periodStart,
  periodWindowWord,
  presetPeriod,
  rangeLabel,
  resolvePeriod,
} from '../../../src/lib/periods.js';
import { value, ZONES, inZone } from './_helpers.js';
import { LOCALES, eachN, local, under } from './_archive.js';

export const sources = ['src/lib/periods.js'];

const DAYS = [
  '2026-10-01',
  '2026-02-31',
  '2026-02-29',
  '2028-02-29',
  '2026-03-08',
  '2026-03-29',
  '2026-10-04',
  '2026-04-05',
  '2026-09-27',
  '2026-11-01',
  '0050-01-01',
  '1969-12-31',
  '9999-12-31',
  '2026-13-01',
  '2026-00-10',
  '2026-1-01',
  '2026-10-01 ',
  ' 2026-10-01',
  '2026-10-01\n',
  '１２３４-01-01',
  '1 Oct',
  '',
  null,
];

// Ranges, with a "now" in each zone's own clock.
const RANGES = [
  ['october', '2026-10-01', '2026-10-31'],
  ['across-years', '2025-12-20', '2026-01-05'],
  ['one-day', '2026-10-05', '2026-10-05'],
  ['to-today', '2026-11-01', '2026-11-14'],
  ['past-today', '2026-11-01', '2026-12-25'],
  ['starts-today', '2026-11-14', '2026-11-20'],
  ['backwards', '2026-10-31', '2026-10-01'],
  ['future', '2026-12-01', '2026-12-05'],
  ['empty-from', '', '2026-10-01'],
  ['bad-to', '2026-10-01', 'soon'],
  ['us-spring', '2026-03-08', '2026-03-08'],
  ['eu-fall-week', '2026-10-24', '2026-10-30'],
  ['south-april', '2026-04-04', '2026-04-06'],
  ['leap-year', '2028-02-01', '2028-03-01'],
  ['long', '2020-01-01', '2026-11-13'],
];

export default async function cases() {
  const out = [];
  out.push(value('constants', { DEFAULT_PERIOD_KEY, CUSTOM_PERIOD }));

  out.push(
    ...(await eachN(
      'presetPeriod',
      ['7d', '30d', '90d', '1y', 'all', 'custom', '30D', '', null, 30].map(
        (key) => ({ key }),
      ),
      ({ key }) => presetPeriod(key),
    )),
  );

  out.push(
    ...(await eachN(
      'dayStartMs',
      ZONES.flatMap((zone) =>
        DAYS.map((day) => ({
          $id: `${zone} ${JSON.stringify(day)}`,
          zone,
          day,
        })),
      ),
      ({ zone, day }) => under({ zone }, () => dayStartMs(day)),
    )),
  );

  out.push(
    ...(await eachN(
      'dayKey',
      ZONES.flatMap((zone) =>
        [
          ['late', () => local(2026, 1, 5, 23, 59)],
          ['early', () => local(2026, 1, 5, 0, 0)],
          ['spring', () => local(2026, 3, 8, 3, 30)],
          ['epoch', () => 0],
          ['before-1970', () => local(1965, 7, 4)],
          ['year-50', () => -60_000_000_000_000],
          ['nan', () => '$NaN'],
        ].map(([name, make]) => ({
          $id: `${zone} ${name}`,
          zone,
          ms: inZone(zone, make),
        })),
      ),
      ({ zone, ms }) => under({ zone }, () => dayKey(ms)),
    )),
  );

  out.push(
    ...(await eachN(
      'rangeLabel',
      ['UTC', 'America/New_York', 'Pacific/Chatham']
        .flatMap((zone) =>
          LOCALES.flatMap((locale) =>
            [
              ['october', '2026-10-01', '2026-10-31'],
              ['across-years', '2025-12-20', '2026-01-05'],
              ['same-day', '2026-10-01', '2026-10-01'],
              ['june-july', '2026-06-17', '2026-07-02'],
            ].flatMap(([name, from, to]) =>
              [undefined, ' to '].map((joiner) => ({
                $id: `${zone} ${locale} ${name} ${joiner ? 'to' : 'dash'}`,
                zone,
                locale,
                from,
                to,
                joiner,
              })),
            ),
          ),
        )
        .concat([
          { $id: 'invalid', fromMs: '$NaN', toMs: '$NaN' },
          { $id: 'half-invalid', fromMs: '$NaN', toMs: 0 },
        ]),
      ({ zone, locale, from, to, fromMs, toMs, joiner }) =>
        under({ zone, locale }, () =>
          rangeLabel(
            fromMs ?? dayStartMs(from),
            toMs ?? dayStartMs(to),
            ...(joiner ? [joiner] : []),
          ),
        ),
    )),
  );

  const customInputs = ZONES.flatMap((zone) =>
    RANGES.map(([name, from, to]) => ({
      $id: `${zone} ${name}`,
      zone,
      from,
      to,
      now: inZone(zone, () => local(2026, 11, 14, 15)),
    })),
  ).concat(
    ['en-GB', 'en-IN', 'en-CH'].map((locale) => ({
      $id: `${locale} october`,
      locale,
      from: '2026-10-01',
      to: '2026-10-31',
      now: local(2026, 11, 14, 15),
    })),
  );
  out.push(
    ...(await eachN(
      'customPeriod',
      customInputs,
      ({ zone, locale, from, to, now }) =>
        under({ zone, locale }, () => customPeriod(from, to, now)),
    )),
  );

  out.push(
    ...(await eachN(
      'resolvePeriod',
      [
        { prefs: { period: '90d' } },
        {
          prefs: {
            period: 'custom',
            periodFrom: '2026-10-01',
            periodTo: '2026-10-31',
          },
        },
        { prefs: { period: 'custom', periodFrom: 'x', periodTo: 'y' } },
        { prefs: { period: 'fortnight' } },
        { prefs: { period: 'all' } },
        { prefs: { period: 'custom' } },
        { prefs: {} },
        { prefs: null },
        {
          prefs: {
            period: 'custom',
            periodFrom: '2026-03-08',
            periodTo: '2026-03-09',
          },
          zone: 'America/New_York',
        },
      ].map((input) => ({ ...input, now: Date.UTC(2026, 10, 14, 15) })),
      ({ prefs, zone, now }) =>
        under({ zone }, () => resolvePeriod(prefs ?? undefined, now)),
    )),
  );

  // The words, and where each window starts and ends, for each preset and
  // a few ranges, in each locale.
  const periodsIn = (zone, locale) =>
    under({ zone, locale }, () => {
      const now = local(2026, 11, 15, 12);
      return [
        ...['7d', '30d', '90d', '1y', 'all'].map((key) => [
          key,
          presetPeriod(key),
        ]),
        ['october', customPeriod('2026-10-01', '2026-10-31', now)],
        ['one-day', customPeriod('2026-10-05', '2026-10-05', now)],
        ['across-years', customPeriod('2025-12-20', '2026-01-05', now)],
        ['to-today', customPeriod('2026-11-01', '2026-11-20', now)],
      ].map(([name, period]) => ({ name, period, now }));
    });
  const wordInputs = [];
  for (const zone of ['UTC', 'America/New_York', 'Australia/Lord_Howe']) {
    for (const locale of LOCALES) {
      for (const { name, period, now } of periodsIn(zone, locale)) {
        wordInputs.push({
          $id: `${zone} ${locale} ${name}`,
          zone,
          locale,
          period,
          now,
        });
      }
    }
  }
  wordInputs.push(
    { $id: 'null', period: null, now: Date.UTC(2026, 10, 15) },
    {
      $id: 'days-zero',
      period: { key: 'x', days: 0, label: 'Nothing' },
      now: Date.UTC(2026, 10, 15),
    },
    {
      $id: 'odd-label',
      period: { key: 'x', days: 3, label: 'ΤΡΕΙΣ ΗΜΈΡΕΣ' },
      now: Date.UTC(2026, 10, 15),
    },
    {
      $id: 'custom-end-nan',
      period: {
        key: 'custom:a:b',
        days: 2,
        label: 'L',
        start: 5,
        end: '$NaN',
        from: 'a',
        to: 'b',
        custom: true,
      },
      now: Date.UTC(2026, 10, 15),
    },
  );
  out.push(
    ...(await eachN('words', wordInputs, ({ zone, locale, period, now }) =>
      under({ zone, locale }, () => ({
        phrase: periodPhrase(period),
        line: periodLine(period, now),
        windowWord: periodWindowWord(period),
        before: periodBefore(period),
        beforeCapital: periodBefore(period, true),
        start: periodStart(period, now),
        end: periodEnd(period, now),
      })),
    )),
  );

  return out;
}
