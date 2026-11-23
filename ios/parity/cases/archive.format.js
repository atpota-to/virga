// Chart formatting: the y scale and its rules, the dates under an axis, the
// trend's name, the heat map's steps and how each kind of number is written
// in the locales the app activates. Swift: VirgaArchive/Charts/ChartFormat.swift.

import {
  axisStops,
  chartScale,
  clamp,
  deltaText,
  fmtAverage,
  fmtCount,
  fmtFigure,
  fmtRate,
  fmtTick,
  heatSteps,
  niceScale,
  trendName,
  unitLabel,
  unitNoun,
} from '../../../src/charts/format.js';
import {
  movingAverage,
  rollingRate,
  rateSeries,
} from '../../../src/lib/analytics.js';
import { inZone } from './_helpers.js';
import { LOCALES, eachN, local, under } from './_archive.js';

export const sources = ['src/charts/format.js'];

const DAY = 86_400_000;

export default async function cases() {
  const out = [];

  out.push(
    ...(await eachN(
      'niceScale',
      [
        [0, 760],
        [0, 105],
        [4181, 5073],
        [0, 1],
        [0, 0],
        [5, 5],
        [5, 3],
        [-20, 20],
        [0.001, 0.002],
        [0, 1e9],
        [0, 3],
        [0, 7],
        [12, 13],
        [0, 2.5],
        [-5, -1],
      ].map(([min, max]) => ({ min, max })),
      ({ min, max }) => niceScale(min, max),
    )),
  );

  out.push(
    ...(await eachN(
      'chartScale',
      [
        { min: 0, max: 760, bars: true },
        { min: 0, max: 105, bars: true },
        { min: 4181, max: 5073, zeroBase: false },
        { min: 0, max: 1, bars: true },
        { min: 0, max: 0, bars: true },
        ...[2, 3, 4, 5, 7, 9, 13, 20, 99, 1234, 0.4, 2.5, 17.3, 1e6].map(
          (max) => ({ min: 0, max, bars: true }),
        ),
        { min: 0, max: 760 },
        { min: 0.2, max: 0.9, zeroBase: false },
        { min: -5, max: 12, zeroBase: false },
        { min: 100, max: 100, zeroBase: false },
        { min: 3, max: 4, zeroBase: false, bars: true },
        { min: 0, max: -3, bars: true },
      ],
      ({ min, max, ...opts }) => chartScale(min, max, opts),
    )),
  );

  const series = (zone, values) =>
    inZone(zone, () => {
      const t0 = local(2026, 11, 1, 0);
      return values.map((v, i) => ({ t: t0 + i * DAY, v }));
    });
  out.push(
    ...(await eachN(
      'axisStops',
      ['UTC', 'Asia/Kolkata', 'America/New_York']
        .flatMap((zone) =>
          LOCALES.flatMap((locale) =>
            ['day', 'week', 'month'].flatMap((unit) =>
              [1, 2, 3, 4, 5, 7, 8].map((n) => ({
                $id: `${zone} ${locale} ${unit} ${n}`,
                zone,
                locale,
                unit,
                series: series(
                  zone,
                  Array.from({ length: n }, (_, i) => i),
                ),
              })),
            ),
          ),
        )
        .concat([{ $id: 'empty', unit: 'day', series: [] }]),
      ({ zone, locale, unit, series: s }) =>
        under({ zone, locale }, () => axisStops(s, unit)),
    )),
  );

  const bumpy = series('UTC', [1, 4, 2, 8, 5, 7, 3, 9, 2]);
  const rated = rateSeries(
    [1, 2, 4].map((d) => ({
      at: new Date(Date.UTC(2026, 10, d, 12)).toISOString(),
      likes: d,
      reposts: 0,
      replies: 0,
      quotes: 0,
    })),
    { unit: 'day', t0: Date.UTC(2026, 10, 1), t1: Date.UTC(2026, 10, 9) },
  );
  out.push(
    ...(await eachN(
      'trendName',
      [
        {
          $id: 'seven-day',
          series: bumpy,
          trend: movingAverage(bumpy, 7),
          unit: 'day',
        },
        {
          $id: 'seven-week',
          series: bumpy,
          trend: movingAverage(bumpy, 7),
          unit: 'week',
        },
        {
          $id: 'seven-month',
          series: bumpy,
          trend: movingAverage(bumpy, 7),
          unit: 'month',
        },
        {
          $id: 'five',
          series: bumpy,
          trend: movingAverage(bumpy, 5),
          unit: 'day',
        },
        {
          $id: 'six',
          series: bumpy,
          trend: movingAverage(bumpy, 6),
          unit: 'day',
        },
        {
          $id: 'short',
          series: bumpy,
          trend: movingAverage(bumpy, 7).slice(1),
          unit: 'day',
        },
        {
          $id: 'rolling',
          series: rated.map(({ t, v }) => ({ t, v: v ?? 0 })),
          trend: rollingRate(rated, 5),
          unit: 'day',
        },
        { $id: 'empty', series: [], trend: [], unit: 'day' },
        {
          $id: 'nudged',
          series: bumpy,
          trend: movingAverage(bumpy, 7).map((p) => ({ ...p, v: p.v + 1e-10 })),
          unit: 'day',
        },
        {
          $id: 'off',
          series: bumpy,
          trend: movingAverage(bumpy, 7).map((p) => ({ ...p, v: p.v + 1e-8 })),
          unit: 'day',
        },
      ],
      ({ series: s, trend, unit }) => trendName(s, trend, unit),
    )),
  );

  out.push(
    ...(await eachN(
      'heatSteps',
      [
        [0, null, 1, 2, 3, 4, 5, 1000],
        [3, 3, 3, 9],
        [7],
        [0, 0, 0],
        [],
        [null, null],
        [-2, 0, 5, -2, 1, -0.5],
        [0.5, 0.25, 0.75, 1, 100, 2, 2, 50, 3, 4, 5, 6, 7],
        [1e9, 1],
        ['$Infinity', 1, 2],
      ].map((values) => ({ values })),
      ({ values }) => [...heatSteps(values).entries()],
    )),
  );

  out.push(
    ...(await eachN(
      'fmtTick',
      LOCALES.flatMap((locale) =>
        [0, 1, 400, 1234, 10000, 12500, 1.5, 2.25, 0.05, -0.05, 2.35, 1e6].map(
          (v) => ({ $id: `${locale} ${v}`, locale, v }),
        ),
      ),
      ({ locale, v }) => under({ locale }, () => fmtTick(v)),
    )),
  );

  out.push(
    ...(await eachN(
      'clamp',
      [
        [5, 0, 10],
        [-1, 0, 10],
        [11, 0, 10],
        ['$NaN', 0, 1],
        [5, 10, 0],
        [0, 0, 0],
        ['$Infinity', 0, 1],
      ].map(([v, lo, hi]) => ({ v, lo, hi })),
      ({ v, lo, hi }) => clamp(v, lo, hi),
    )),
  );

  const NUMBERS = [
    null,
    0,
    0.04,
    0.05,
    0.8,
    2,
    2.29,
    2.25,
    9.94,
    9.96,
    10,
    12.6,
    1234.5,
    12345.678,
    -3.25,
    -12.5,
    '$NaN',
  ];
  out.push(
    ...(await eachN(
      'numbers',
      LOCALES.flatMap((locale) =>
        NUMBERS.map((v) => ({ $id: `${locale} ${v}`, locale, v })),
      ),
      ({ locale, v }) =>
        under({ locale }, () => ({
          count: fmtCount(v),
          rate: fmtRate(v),
          average: fmtAverage(v),
          figure: fmtFigure(v),
          figureDecimals: fmtFigure(v, { decimals: true }),
          delta: deltaText(v),
        })),
    )),
  );

  out.push(
    ...(await eachN(
      'units',
      ['day', 'week', 'month', 'year', '', null].map((unit) => ({ unit })),
      ({ unit }) => ({ label: unitLabel(unit), noun: unitNoun(unit) }),
    )),
  );

  return out;
}
