// The share picture's layout and drawing (src/share/chartImage.js): the
// page's colours as readShareTheme reads them in every sky, theme, contrast
// and a few accents; where a series sits in the plot; the dates under it;
// text cut to fit; and every canvas call drawShareImage makes, for each kind
// of card (bars, a line, a line with a ghost reach, a trend, marks, bars by
// label) in several themes and formats. The calls are recorded by a canvas
// that measures text by a fixed rule (ios/parity/cases/_share.js); a long
// recording is kept as its length, SHA-256 and ends. Swift:
// VirgaInsights/Share/ChartImage*.swift.

import {
  SHARE_HEIGHT,
  SHARE_WIDTH,
  axisLabels,
  drawShareImage,
  fitText,
  seriesLayout,
} from '../../../src/share/chartImage.js';
import { shareSpec } from '../../../src/share/shareSpec.js';
import { fmtCount, fmtRate } from '../../../src/charts/format.js';
import { each, value } from './_helpers.js';
import { under } from './_archive.js';
import {
  NOW,
  compact,
  contexts,
  edgeArchives,
  harnessArchives,
  preset,
} from './_reports.js';
import { logRecord, recordingContext, shareThemeFor } from './_share.js';
import { NOTES, named } from './insights.share.js';

export const sources = ['src/share/chartImage.js'];

const SKIES = ['dawn', 'day', 'dusk', 'night'];

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1);
const points = (values, step = DAY) =>
  values.map((v, i) => ({ t: T0 + i * step, v }));

/** The picture-sized specs a fixture names, with `format` by name. */
function specs() {
  const archives = { ...harnessArchives(), ...edgeArchives() };
  const context = contexts(11000);
  const out = {};
  const types = [
    'follower-growth',
    'new-followers',
    'engagement-over-time',
    'engagement-rate',
    'engagement-given',
    'posting-cadence',
    'repo-activity',
    'engagement-by-type',
    'content-formats',
    'content-length',
    'top-tags',
    'top-links',
  ];
  for (const type of types)
    for (const key of ['7d', '30d', '90d', '1y', 'all']) {
      const spec = shareSpec(
        type,
        context(archives.mira, NOW),
        preset(key),
        NOW,
        { notes: NOTES },
      );
      if (spec) out[`mira-${type}-${key}`] = named(spec);
    }
  const base = {
    kind: 'series',
    title: 'Follower growth',
    subtitle: '@mira.example.com, the last 7 days',
    figure: { value: '5,073', label: 'followers' },
    unit: 'day',
    mode: 'bars',
    trend: null,
    zeroBase: true,
    format: 'fmtCount',
    marks: [],
    noun: 'things',
    ghost: null,
  };
  Object.assign(out, {
    'test-line': {
      ...base,
      series: points([1, 2, 3, 4, 5, 6, 7]),
      mode: 'line',
      zeroBase: false,
      marks: [{ i: 2, t: T0 + 2 * DAY, kind: 'note', items: [] }],
    },
    'test-bars': {
      kind: 'bars',
      title: 'Formats',
      subtitle: '',
      figure: null,
      measure: 'posts',
      rows: [
        { label: 'Text only', value: 5, display: '5' },
        { label: 'Images', value: 60, display: '60' },
      ],
    },
    zeros: { ...base, series: points([0, null, 0]) },
    single: { ...base, series: points([42]) },
    'single-line': { ...base, mode: 'line', series: points([42]) },
    negative: { ...base, series: points([-5, 3, -1]), zeroBase: false },
    'trend-gaps': {
      ...base,
      series: points([1, 5, 2, 8, 3]),
      trend: points([null, 3, null, 4.5, 6]),
    },
    'rate-line': {
      ...base,
      mode: 'line',
      format: 'fmtRate',
      series: points([0.5, null, 2.25]),
      trend: points([0.5, 1, 2]),
    },
    'ghost-flat': {
      ...base,
      mode: 'line',
      zeroBase: false,
      series: points([10, 10, 10]),
      ghost: { v: 10 },
    },
    'ghost-below': {
      ...base,
      mode: 'line',
      zeroBase: false,
      series: points([100, 120]),
      ghost: { v: 50 },
    },
    milestones: {
      ...base,
      series: points([1, 2, 3, 4]),
      marks: [
        { i: 0, t: T0, kind: 'milestone', items: [] },
        { i: 3, t: T0 + 3 * DAY, kind: 'note', items: [] },
      ],
    },
    'long-title': {
      ...base,
      title:
        'A title far too long for the picture, that goes on and on past the edge of the card and further',
      subtitle:
        'An equally long subtitle that also has to be cut somewhere before it runs out of the picture entirely',
      figure: {
        value: '1,234,567,890',
        label:
          'a label that is long enough to need cutting at the right edge of the picture as well',
      },
      series: points([3, 1]),
    },
    'emoji-title': {
      ...base,
      title: `${'👍'.repeat(40)}`,
      series: points([1]),
    },
    'bars-eight': {
      kind: 'bars',
      title: 'Tags',
      subtitle: 'x',
      figure: { value: '9', label: 'tags' },
      measure: 'posts',
      rows: Array.from({ length: 11 }, (_, i) => ({
        label:
          i === 3
            ? 'a label far too long to fit in the label column of the bars'
            : `#tag${i}`,
        value: i * 3,
        display: String(i * 3),
      })),
    },
    'bars-zero': {
      kind: 'bars',
      title: 'Zeros',
      subtitle: '',
      figure: null,
      measure: 'posts',
      rows: [
        { label: 'none', value: 0, display: '0' },
        { label: 'neg', value: -2, display: '-2' },
      ],
    },
    'bars-one': {
      kind: 'bars',
      title: 'One',
      subtitle: '',
      figure: { value: '—', label: 'for a typical post' },
      measure: 'posts',
      rows: [{ label: 'Only', value: 0.4, display: '0.4' }],
    },
    // No buckets at all, which shareSpec never gives: the web's drawing of
    // a line throws reading the last point (drawShareImagePartly).
    'empty-line': { ...base, mode: 'line', series: [] },
    'empty-bars': { ...base, series: [], trend: [] },
  });
  return out;
}

const live = (spec) =>
  spec?.kind === 'series'
    ? { ...spec, format: spec.format === 'fmtRate' ? fmtRate : fmtCount }
    : spec;

export default async function cases() {
  const out = [];
  out.push(value('constants', { SHARE_WIDTH, SHARE_HEIGHT }));

  const themes = [];
  for (const sky of SKIES)
    for (const theme of ['light', 'dark'])
      for (const contrast of ['normal', 'high'])
        for (const accent of ['blue', 'amber', 'graphite'])
          themes.push({ sky, theme, contrast, accent, density: 'comfortable' });
  out.push(
    ...(await each('readShareTheme', themes, (attrs) => shareThemeFor(attrs))),
  );

  const all = specs();
  out.push(
    ...Object.entries(all).map(([name, spec]) =>
      value('spec', compact(spec), name),
    ),
  );
  const series = Object.entries(all).filter(([, s]) => s.kind === 'series');

  const boxes = [
    undefined,
    { left: 0, right: 100, top: 0, bottom: 50 },
    { left: 120, right: 1144, top: 264, bottom: 545 },
  ];
  const layouts = [];
  for (const [name] of series)
    for (const [b, box] of boxes.entries())
      layouts.push({ $id: `${name}-${b}`, spec: name, box });
  out.push(
    ...(await each('seriesLayout', layouts, ({ spec: name, box }) => {
      const spec = live(all[name]);
      const L = box ? seriesLayout(spec, box) : seriesLayout(spec);
      const probes = [
        L.min,
        L.max,
        0,
        ...L.ticks,
        ...spec.series.map((p) => p.v ?? 0),
        ...(spec.ghost ? [spec.ghost.v] : []),
      ];
      return compact({
        n: L.n,
        min: L.min,
        max: L.max,
        slot: L.slot,
        barWidth: L.barWidth,
        ticks: L.ticks,
        labelled: L.labelled,
        xs: Array.from({ length: L.n }, (_, i) => L.x(i)),
        ys: probes.map((v) => L.y(v)),
      });
    })),
  );

  const labels = [];
  for (const formats of [
    { zone: 'UTC', locale: 'en-US' },
    { zone: 'Australia/Lord_Howe', locale: 'en-GB' },
    { zone: 'America/New_York', locale: 'en-DE' },
  ])
    for (const unit of ['day', 'week', 'month'])
      for (const n of [0, 1, 2, 4, 5, 7, 30])
        labels.push({
          $id: `${formats.zone}-${unit}-${n}`,
          unit,
          series: points(
            Array.from({ length: n }, (_, i) => i),
            unit === 'day' ? DAY : unit === 'week' ? 7 * DAY : 31 * DAY,
          ),
          ...formats,
        });
  out.push(
    ...(await each('axisLabels', labels, (input) =>
      under(input, () => axisLabels(input.series, input.unit)),
    )),
  );

  const fits = [];
  for (const text of [
    'Short',
    'A title far too long for the picture',
    '',
    'x',
    'trailing spaces          then more',
    `${'👍'.repeat(12)}`,
    'ab👍cd',
  ])
    for (const [size, spacing, width] of [
      [10, 0, 100],
      [10, 0, 120],
      [40, 0, 1088],
      [24, 0, 280],
      [64, -2.5, 300],
      [10, 0, 0],
      [10, 0, 5],
    ])
      fits.push({ text, size, spacing, width });
  out.push(
    ...(await each('fitText', fits, ({ text, size, spacing, width }) => {
      const ctx = recordingContext();
      ctx.font = `400 ${size}px sans-serif`;
      ctx.letterSpacing = `${spacing}px`;
      return fitText(ctx, text, width);
    })),
  );

  const drawThemes = {
    day: shareThemeFor({
      sky: 'day',
      theme: 'light',
      contrast: 'normal',
      accent: 'blue',
      density: 'comfortable',
    }),
    night: shareThemeFor({
      sky: 'night',
      theme: 'dark',
      contrast: 'normal',
      accent: 'amber',
      density: 'comfortable',
    }),
    high: shareThemeFor({
      sky: 'dusk',
      theme: 'light',
      contrast: 'high',
      accent: 'blue',
      density: 'comfortable',
    }),
  };
  out.push(
    ...Object.entries(drawThemes).map(([name, theme]) =>
      value('theme', theme, name),
    ),
  );
  const draws = [];
  const partly = ['empty-line'];
  for (const [name] of Object.entries(all))
    if (!partly.includes(name))
      draws.push({ $id: `${name}-day`, spec: name, theme: 'day' });
  for (const name of [
    'mira-follower-growth-90d',
    'mira-engagement-rate-30d',
    'mira-content-formats-all',
    'test-line',
    'test-bars',
    'trend-gaps',
  ])
    for (const theme of ['night', 'high'])
      draws.push({ $id: `${name}-${theme}`, spec: name, theme });
  for (const formats of [
    { zone: 'America/New_York', locale: 'en-DE' },
    { zone: 'Asia/Kolkata', locale: 'en-IN' },
  ])
    for (const name of [
      'mira-posting-cadence-1y',
      'mira-follower-growth-all',
      'rate-line',
    ])
      draws.push({
        $id: `${name}-${formats.zone}`,
        spec: name,
        theme: 'day',
        ...formats,
      });
  out.push(
    ...(await each('drawShareImage', draws, (input) =>
      under(input, () => {
        const ctx = recordingContext();
        drawShareImage(ctx, live(all[input.spec]), drawThemes[input.theme]);
        return compact(logRecord(ctx.log));
      }),
    )),
  );
  // A drawing that throws part way: the calls made before it did, and why.
  out.push(
    ...(await each(
      'drawShareImagePartly',
      partly.map((name) => ({ $id: name, spec: name, theme: 'day' })),
      (input) => {
        const ctx = recordingContext();
        let threw = null;
        try {
          drawShareImage(ctx, live(all[input.spec]), drawThemes[input.theme]);
        } catch (error) {
          threw = error.message;
        }
        return compact({ ...logRecord(ctx.log), threw });
      },
    )),
  );
  return out;
}
