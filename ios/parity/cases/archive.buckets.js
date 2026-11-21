// The dashboard's buckets in local time: where a day, a week (from each first
// day Settings offers) and a month start, in several zones and across clock
// changes; the dense, zero-filled series built on them; and a bucket's name.
// Swift: VirgaArchive/Lib/Analytics.swift.

import {
  bucketLabel,
  bucketSeries,
  bucketStartMs,
  engagementOf,
  nextBucketMs,
} from '../../../src/lib/analytics.js';
import { ZONES, inZone } from './_helpers.js';
import { LOCALES, eachN, local, under } from './_archive.js';

export const sources = ['src/lib/analytics.js'];

/** Instants to bucket, as functions of the zone's own clock. */
const TIMES = [
  ['june-wed', () => local(2026, 6, 10, 23, 30)],
  ['june-mon', () => local(2026, 6, 8, 0, 0)],
  ['june-sun', () => local(2026, 6, 7, 12)],
  ['june-sat', () => local(2026, 6, 6, 1)],
  ['month-end', () => local(2026, 1, 31, 23, 59)],
  ['new-year', () => local(2026, 1, 1, 0, 0)],
  ['year-end', () => local(2025, 12, 31, 18)],
  ['leap-day', () => local(2028, 2, 29, 9)],
  ['us-spring', () => local(2026, 3, 8, 2, 30)],
  ['us-fall', () => local(2026, 11, 1, 1, 30)],
  ['eu-spring', () => local(2026, 3, 29, 1, 30)],
  ['eu-fall', () => local(2026, 10, 25, 2, 30)],
  ['south-april', () => local(2026, 4, 5, 1, 45)],
  ['south-spring', () => local(2026, 10, 4, 2, 15)],
  ['chatham-sept', () => local(2026, 9, 27, 2, 50)],
  ['week-over-dst', () => local(2026, 3, 30, 12)],
  ['before-1970', () => local(1965, 7, 4, 10)],
  ['epoch', () => 0],
  ['fraction', () => local(2026, 6, 10) + 0.5],
  ['huge', () => 8.64e15],
  ['too-big', () => 8.64e15 + 1],
  ['nan', () => '$NaN'],
  ['iso', () => '2026-06-10T23:30:00Z'],
  ['local-string', () => '2026-06-10T00:30:00'],
  ['date-only', () => '2026-06-10'],
  ['garbage', () => 'not a date'],
  ['null', () => null],
  ['true', () => true],
];

const UNITS = ['day', 'week', 'month', 'fortnight'];

function bucketCases() {
  const inputs = [];
  for (const zone of ZONES) {
    for (const [name, make] of TIMES) {
      for (const unit of UNITS) {
        const starts = unit === 'week' ? [1, 0, 6] : [1];
        for (const weekStart of starts) {
          inputs.push({
            $id: `${zone} ${name} ${unit} ${weekStart}`,
            zone,
            weekStart,
            unit,
            t: inZone(zone, make),
          });
        }
      }
    }
  }
  return inputs;
}

const PICK_TIME = {
  at: undefined,
  followedAt: (f) => f?.followedAt,
};
const PICK_VALUE = {
  count: undefined,
  likes: (p) => p.likes,
  engagement: (p) => engagementOf(p),
};

const SERIES_ZONES = [
  'UTC',
  'America/New_York',
  'Europe/London',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
];

function seriesItems(zone) {
  return inZone(zone, () => [
    { at: local(2026, 3, 7, 23), likes: 1 },
    { at: local(2026, 3, 8, 3), likes: 2 },
    { at: local(2026, 3, 8, 23, 59), likes: 3 },
    { at: new Date(local(2026, 3, 9, 0, 1)).toISOString(), likes: 4 },
    { at: '2026-03-10T08:00:00', likes: 5 },
    { at: '2026-03-11', likes: '6' },
    { at: 'garbage', likes: 7 },
    { at: null, likes: 8 },
    { likes: 9 },
    { at: local(2026, 3, 12, 12), likes: 'x' },
    { at: local(2026, 3, 12, 13), likes: null },
    { at: local(2026, 3, 12, 14), likes: true },
    { at: local(2026, 4, 2, 12), likes: 10 },
    { at: local(2026, 10, 31, 12), likes: 11 },
    { at: local(2026, 11, 2, 12), likes: 12 },
    { at: local(2025, 12, 31, 23, 30), likes: 13 },
  ]);
}

function windows(zone) {
  return inZone(zone, () => [
    ['dst-week', local(2026, 3, 6, 0), local(2026, 3, 13, 23)],
    ['quarter', local(2026, 1, 1, 0), local(2026, 4, 30, 23)],
    ['fall', local(2026, 10, 24, 0), local(2026, 11, 8, 23)],
    ['single', local(2026, 3, 8, 0), local(2026, 3, 8, 23)],
    ['instant', local(2026, 3, 8, 3), local(2026, 3, 8, 3)],
    ['inverted', local(2026, 3, 13), local(2026, 3, 6)],
  ]);
}

export default async function cases() {
  const out = [];
  out.push(
    ...(await eachN('buckets', bucketCases(), ({ zone, weekStart, unit, t }) =>
      under({ zone, weekStart }, () => ({
        start: bucketStartMs(t, unit),
        next: nextBucketMs(t, unit),
      })),
    )),
  );

  // Dense series: zones, units, week starts, pickers and odd windows.
  const seriesInputs = [];
  for (const zone of SERIES_ZONES) {
    for (const [name, t0, t1] of windows(zone)) {
      for (const unit of ['day', 'week', 'month']) {
        const starts = unit === 'week' ? [1, 0] : [1];
        for (const weekStart of starts) {
          seriesInputs.push({
            $id: `${zone} ${name} ${unit} ${weekStart}`,
            zone,
            weekStart,
            unit,
            t0,
            t1,
            pickValue: name === 'quarter' ? 'likes' : 'count',
            items: seriesItems(zone),
          });
        }
      }
    }
  }
  seriesInputs.push(
    { $id: 'nan-t0', unit: 'day', t0: '$NaN', t1: 0, items: [] },
    {
      $id: 'null-t0',
      unit: 'month',
      t0: null,
      t1: Date.UTC(1970, 3, 1),
      items: [{ at: 5 }, { at: -5 }],
    },
    { $id: 'missing-t1', unit: 'day', t0: 0, items: [] },
    {
      $id: 'no-items',
      unit: 'day',
      t0: Date.UTC(2026, 0, 1),
      t1: Date.UTC(2026, 0, 3),
    },
    {
      $id: 'capped',
      unit: 'day',
      t0: Date.UTC(2020, 0, 1),
      t1: Date.UTC(2023, 6, 1),
      items: [
        { at: Date.UTC(2020, 0, 1) },
        { at: Date.UTC(2022, 8, 26, 23) },
        { at: Date.UTC(2022, 8, 27, 1) },
      ],
    },
    {
      $id: 'followers',
      unit: 'week',
      t0: Date.UTC(2026, 0, 1),
      t1: Date.UTC(2026, 1, 1),
      pickTime: 'followedAt',
      items: [
        { followedAt: '2026-01-05T00:00:00.000Z' },
        { followedAt: null },
        { followedAt: '2026-01-20T10:00:00Z' },
      ],
    },
  );
  out.push(
    ...(await eachN(
      'bucketSeries',
      seriesInputs,
      ({ zone, weekStart, unit, t0, t1, items, pickTime, pickValue }) =>
        under({ zone, weekStart }, () =>
          bucketSeries(items, {
            unit,
            t0,
            t1,
            pickTime: PICK_TIME[pickTime || 'at'],
            pickValue: PICK_VALUE[pickValue || 'count'],
          }),
        ),
    )),
  );

  out.push(
    ...(await eachN(
      'bucketLabel',
      ZONES.flatMap((zone) =>
        LOCALES.flatMap((locale) =>
          ['day', 'week', 'month'].map((unit) => ({
            $id: `${zone} ${locale} ${unit}`,
            zone,
            locale,
            unit,
            t: inZone(zone, () => local(2026, 6, 3, 0)),
          })),
        ),
      ).concat([
        { $id: 'nan', unit: 'day', t: '$NaN' },
        {
          $id: 'july',
          zone: 'Asia/Kolkata',
          locale: 'en-AU',
          unit: 'week',
          t: Date.UTC(2026, 6, 1),
        },
      ]),
      ({ zone, locale, unit, t }) =>
        under({ zone, locale }, () => bucketLabel(t, unit)),
    )),
  );

  return out;
}
