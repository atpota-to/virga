// A card as a picture to post (src/share/shareSpec.js): the spec each
// shareable card type gives over the harness's accounts and the hand-made
// archives, for every period, kind, row count, title and set of notes; the
// description written from its numbers, and the post's first line; then
// descriptions of made-up specs at the edges (nothing live, a long chart,
// the clip at 1,800 characters). Each spec's `format` is recorded by name.
// insights.chartImage.js draws them. Swift: VirgaInsights/Share/ShareSpec.swift.

import {
  canShare,
  shareAltText,
  sharePostText,
  shareSpec,
} from '../../../src/share/shareSpec.js';
import { customPeriod } from '../../../src/lib/periods.js';
import { fmtCount, fmtRate } from '../../../src/charts/format.js';
import { each } from './_helpers.js';
import { under } from './_archive.js';
import {
  EDGE_NOW,
  NOW,
  compact,
  contexts,
  edgeArchives,
  harnessArchives,
  preset,
} from './_reports.js';

export const sources = ['src/share/shareSpec.js'];

export const TYPES = [
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
  'stat-followers',
  'stat-new-followers',
  'stat-engagement',
  'stat-per-post',
  'stat-given',
  'stat-posts',
];

/** A spec as a fixture holds it: `format` by name. */
export function named(spec) {
  if (!spec || spec.kind !== 'series') return spec;
  return {
    ...spec,
    format:
      spec.format === fmtRate
        ? 'fmtRate'
        : spec.format === fmtCount
          ? 'fmtCount'
          : String(spec.format),
  };
}

export const NOTES = [
  { id: 'a', day: '2026-11-10', label: 'Zine went out' },
  { id: 'b', day: '2026-10-03', label: 'Changed my handle' },
  { id: 'c', day: '2026-11-10', label: 'Same day' },
  { id: 'd', day: '2020-01-01', label: 'Before everything' },
];

/** Every case's spec inputs: archive, now, period, options, formats. */
export function specInputs() {
  const inputs = [];
  const add = (input) => inputs.push({ nowMs: NOW, options: {}, ...input });
  for (const type of TYPES)
    for (const key of ['7d', '30d', '90d', '1y', 'all'])
      add({
        $id: `mira-${type}-${key}`,
        archive: 'mira',
        type,
        period: preset(key),
        options: { notes: NOTES },
      });
  for (const type of TYPES)
    add({
      $id: `mira-${type}-custom`,
      archive: 'mira',
      type,
      period: customPeriod('2026-10-01', '2026-10-31', NOW),
    });
  for (const type of [
    'engagement-over-time',
    'engagement-rate',
    'engagement-given',
    'stat-per-post',
  ])
    for (const kind of ['like', 'repost', 'reply', 'quote'])
      add({
        $id: `mira-${type}-${kind}`,
        archive: 'mira',
        type,
        period: preset('90d'),
        options: { kind },
      });
  for (const type of ['top-tags', 'top-links'])
    for (const rows of [3, 0, -1, 20, 2.5, 8, null])
      add({
        $id: `mira-${type}-rows-${rows}`,
        archive: 'mira',
        type,
        period: preset('all'),
        options: { rows },
      });
  add({
    $id: 'mira-title',
    archive: 'mira',
    type: 'engagement-over-time',
    period: preset('7d'),
    options: { title: 'My week', kind: 'like' },
  });
  add({
    $id: 'mira-empty-title',
    archive: 'mira',
    type: 'posting-cadence',
    period: preset('7d'),
    options: { title: '' },
  });
  for (const type of TYPES)
    for (const key of ['30d', 'all'])
      add({
        $id: `lab-${type}-${key}`,
        archive: 'lab',
        type,
        period: preset(key),
      });
  for (const name of ['empty', 'content', 'contentOld', 'people', 'bestTime'])
    for (const type of TYPES)
      add({
        $id: `${name}-${type}`,
        archive: name,
        nowMs: EDGE_NOW,
        type,
        period: preset('30d'),
        options: {
          notes: [{ id: 'n', day: '2026-11-01', label: 'A note' }],
          rows: 5,
        },
      });
  for (const type of [
    'top-engagers',
    'posting-next',
    'stat-typical-post',
    '',
    'TOP-TAGS',
  ])
    add({
      $id: `unknown-${type}`,
      archive: 'mira',
      type,
      period: preset('30d'),
    });
  for (const formats of [
    { zone: 'America/New_York', locale: 'en-US', weekStart: 0 },
    { zone: 'Asia/Kolkata', locale: 'en-IN', weekStart: 1 },
    { zone: 'Europe/London', locale: 'en-GB', weekStart: 1 },
  ])
    for (const type of [
      'follower-growth',
      'engagement-rate',
      'posting-cadence',
      'engagement-by-type',
      'content-formats',
    ])
      for (const key of ['7d', '90d'])
        add({
          $id: `mira-${type}-${key}-${formats.zone}`,
          archive: 'mira',
          type,
          period: preset(key),
          options: { notes: NOTES },
          ...formats,
        });
  return inputs;
}

export default async function cases() {
  const out = [];
  const archives = { ...harnessArchives(), ...edgeArchives() };
  const context = contexts(9000);
  out.push(
    ...(await each('shareSpec', specInputs(), (input) =>
      under(input, () => {
        const archive = context(archives[input.archive], input.nowMs);
        input.rev = archive.rev;
        const spec = shareSpec(
          input.type,
          archive,
          input.period,
          input.nowMs,
          input.options,
        );
        return compact({
          spec: named(spec),
          alt: shareAltText(spec),
          post: sharePostText(spec, input.period),
        });
      }),
    )),
  );

  out.push(
    ...(await each(
      'canShare',
      [
        ...TYPES,
        'top-engagers',
        'posting-next',
        '',
        'Follower-growth',
        'constructor',
        'toString',
        '__proto__',
      ].map((type) => ({ type })),
      ({ type }) => canShare(type),
    )),
  );

  // Descriptions of made-up specs.
  const DAY = 86_400_000;
  const T0 = Date.UTC(2026, 10, 1, 0);
  const points = (values, step = DAY) =>
    values.map((v, i) => ({ t: T0 + i * step, v }));
  const base = {
    kind: 'series',
    title: 'Made up',
    subtitle: '@mira.example.com, the last 7 days',
    figure: { value: '12', label: 'things' },
    unit: 'day',
    mode: 'bars',
    trend: null,
    zeroBase: true,
    format: 'fmtCount',
    marks: [],
    noun: 'things',
    ghost: null,
  };
  const specs = [
    {
      $id: 'nothing-live',
      spec: { ...base, series: points([null, null, null]), format: 'fmtRate' },
    },
    { $id: 'one-value', spec: { ...base, series: points([5]) } },
    { $id: 'flat', spec: { ...base, series: points([3, 3, 3, 3]) } },
    { $id: 'peaks', spec: { ...base, series: points([1, 9, 2, 9, 1]) } },
    {
      $id: 'rate-gaps',
      spec: {
        ...base,
        format: 'fmtRate',
        series: points([null, 2.25, null, 12.5, 0.04]),
      },
    },
    {
      $id: 'line',
      spec: { ...base, mode: 'line', series: points([100, 104, 103, 120]) },
    },
    {
      $id: 'line-ghost',
      spec: {
        ...base,
        mode: 'line',
        series: points([100, 120]),
        ghost: { v: 1234567 },
      },
    },
    {
      $id: 'weeks',
      spec: { ...base, unit: 'week', series: points([4, 8, 2], 7 * DAY) },
    },
    {
      $id: 'months',
      spec: {
        ...base,
        unit: 'month',
        series: [T0, Date.UTC(2026, 11, 1), Date.UTC(2027, 0, 1)].map(
          (t, i) => ({ t, v: i * 1000 }),
        ),
      },
    },
    {
      $id: 'marked',
      spec: {
        ...base,
        unit: 'week',
        series: points([4, 8, 2], 7 * DAY),
        marks: [
          {
            i: 1,
            t: T0 + 7 * DAY,
            kind: 'note',
            items: [
              { label: 'One', kind: 'note' },
              { label: 'Two', kind: 'milestone' },
            ],
          },
          {
            i: 2,
            t: T0 + 14 * DAY,
            kind: 'milestone',
            items: [{ label: '1,000 followers', kind: 'milestone' }],
          },
        ],
      },
    },
    {
      $id: 'forty',
      spec: {
        ...base,
        series: points(Array.from({ length: 40 }, (_, i) => i * 37)),
      },
    },
    {
      $id: 'forty-one',
      spec: {
        ...base,
        series: points(Array.from({ length: 41 }, (_, i) => i)),
      },
    },
    {
      $id: 'long-words',
      spec: { ...base, title: 'x'.repeat(1700), series: points([1, 2, 3]) },
    },
    {
      $id: 'clip-emoji',
      spec: {
        ...base,
        title: `${'y'.repeat(1797)}👍👍 end`,
        series: points([1]),
      },
    },
    {
      $id: 'clip-spaces',
      spec: {
        ...base,
        title: `${'z'.repeat(1790)}         tail`,
        series: points([1]),
      },
    },
    {
      $id: 'no-figure',
      spec: { ...base, figure: null, subtitle: '', series: points([1, 2]) },
    },
    {
      $id: 'bars',
      spec: {
        kind: 'bars',
        title: 'Formats',
        subtitle: '',
        figure: null,
        measure: 'for a typical post',
        rows: [
          { label: 'Text only', value: 5, display: '5' },
          { label: 'Images', value: 60, display: '60' },
        ],
      },
    },
    {
      $id: 'bars-many',
      spec: {
        kind: 'bars',
        title: 'Tags',
        subtitle: 'x',
        figure: { value: '9', label: 'tags' },
        measure: 'posts',
        rows: Array.from({ length: 12 }, (_, i) => ({
          label: `#tag${i}`,
          value: i,
          display: String(i),
        })),
      },
    },
    {
      $id: 'bars-huge',
      spec: {
        kind: 'bars',
        title: 'Huge',
        subtitle: '',
        figure: null,
        measure: 'posts',
        rows: Array.from({ length: 200 }, (_, i) => ({
          label: `#${'long'.repeat(5)}${i}`,
          value: i,
          display: String(i),
        })),
      },
    },
  ];
  const altInputs = [];
  for (const s of specs)
    for (const formats of [
      { zone: 'UTC', locale: 'en-US' },
      { zone: 'Pacific/Chatham', locale: 'en-GB' },
    ])
      altInputs.push({ ...s, $id: `${s.$id}-${formats.zone}`, ...formats });
  out.push(
    ...(await each('shareAltText', altInputs, (input) =>
      under(input, () => {
        const spec =
          input.spec.kind === 'series'
            ? {
                ...input.spec,
                format: input.spec.format === 'fmtRate' ? fmtRate : fmtCount,
              }
            : input.spec;
        return shareAltText(spec);
      }),
    )),
  );
  out.push(
    ...(await each('shareAltText', [{ $id: 'null', spec: null }], () =>
      shareAltText(null),
    )),
  );
  out.push(
    ...(await each(
      'sharePostText',
      [
        { spec: { title: 'Posts' }, period: preset('7d') },
        { spec: { title: 'Follower growth' }, period: preset('1y') },
        { spec: { title: 'Posts' }, period: preset('all') },
        { spec: null, period: preset('7d') },
      ],
      ({ spec, period }) => sharePostText(spec, period),
    )),
  );
  return out;
}
