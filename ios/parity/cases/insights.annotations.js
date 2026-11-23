// Chart notes and follower milestones (src/reports/annotations.js), and the
// hook that holds them (src/reports/useAnnotations.js): what a stored list
// reads as and is written back as, adding and removing, the round numbers
// and the day each was reached, where marks land on a series in every unit,
// zone and first day of the week, and their words. useAnnotations runs as a
// component would (react-dom/server, a window that takes the change event),
// with the clock and the random numbers its ids come from held still.
// Swift: VirgaInsights/Reports/Annotations.swift, AnnotationsModel.swift.

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { vi } from 'vitest';
import {
  ANNOTATIONS_MAX,
  ANNOTATION_LABEL_MAX,
  addAnnotation,
  annotationsKey,
  cleanAnnotations,
  followerMilestones,
  markText,
  marksOnSeries,
  milestoneSteps,
  noteMark,
  readAnnotations,
  removeAnnotation,
  todayKey,
  writeAnnotations,
} from '../../../src/reports/annotations.js';
import { useAnnotations } from '../../../src/reports/useAnnotations.js';
import { bucketSeries } from '../../../src/lib/analytics.js';
import { ZONES, each, value } from './_helpers.js';
import { local, under } from './_archive.js';

export const sources = [
  'src/reports/annotations.js',
  'src/reports/useAnnotations.js',
];

const DAY = 86_400_000;

const store = (items) => ({
  getItem: (k) => (items.has(k) ? items.get(k) : null),
  setItem: (k, v) => void items.set(k, String(v)),
  removeItem: (k) => void items.delete(k),
});

const LONG = 'x'.repeat(79) + '👍' + 'tail';
const RAW_LISTS = [
  [
    { id: 'b', day: '2026-10-03', label: '  Zine went out  ' },
    { id: 'a', day: '2026-09-16', label: 'Changed my handle' },
    { id: 'a', day: '2026-09-17', label: 'same id again' },
    { id: 'c', day: 'October', label: 'no day' },
    { id: 'd', day: '2026-10-04', label: '   ' },
    { day: '2026-10-05', label: 'no id' },
    null,
  ],
  'nope',
  null,
  {},
  [],
  [{ id: 'x', day: '2026-02-31', label: 'rolls over' }],
  [{ id: 'x', day: '2026-2-3', label: 'short' }],
  [{ id: 'x', day: ' 2026-10-03', label: 'spaced' }],
  [{ id: 'x', day: '2026-10-03 ', label: 'spaced' }],
  [{ id: 'x', day: 20261003, label: 'a number' }],
  [{ id: 'x', day: null, label: 'nothing' }],
  [{ id: 7, day: '2026-10-03', label: 'number id' }],
  [{ id: '', day: '2026-10-03', label: 'empty id' }],
  [{ id: 'x', day: '2026-10-03', label: 42 }],
  [{ id: 'x', day: '2026-10-03', label: LONG }],
  [{ id: 'x', day: '2026-10-03', label: '﻿  Trimmed \t' }],
  [{ id: 'x', day: '2026-10-03', label: '​' }],
  [
    { id: 'café', day: '2026-10-03', label: 'one' },
    { id: 'café', day: '2026-10-02', label: 'two' },
    { id: 'café', day: '2026-10-01', label: 'three' },
  ],
  [
    { id: 'p', day: '2026-10-03', label: 'first on the day' },
    { id: 'q', day: '2026-10-03', label: 'second on the day' },
    { id: 'r', day: '2025-10-03', label: 'a year before' },
    { id: 's', day: '9999-12-31', label: 'far off' },
    { id: 't', day: '0001-01-01', label: 'long ago' },
  ],
  [{ id: 'x', day: '2026-10-03', label: 'extra', more: true, color: 'red' }],
  Array.from({ length: 230 }, (_, i) => ({
    id: `n${i}`,
    day: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    label: `Note ${i}`,
  })),
];

const STORED = [
  null,
  '',
  '[]',
  'null',
  '{broken',
  '"text"',
  '{"a":1}',
  '42',
  '﻿[]',
  JSON.stringify(RAW_LISTS[0]),
  JSON.stringify(RAW_LISTS[RAW_LISTS.length - 1]),
  '[{"id":"x","day":"2026-10-03","label":"a"},{"id":"x","day":"2026-10-03","label":"b"}]',
  '[{"id":"x","day":"2026-10-03","label":"\\ud83d lone"}]',
];

/** Runs useAnnotations as a component, with a window for its event. */
function withWindow(fn) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });
  try {
    return fn();
  } finally {
    if (before) Object.defineProperty(globalThis, 'window', before);
    else delete globalThis.window;
  }
}

function withStorage(items, fn) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: store(items),
  });
  try {
    return fn();
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete globalThis.localStorage;
  }
}

function mount(did) {
  let api = null;
  function Probe() {
    api = useAnnotations(did);
    return null;
  }
  renderToString(createElement(Probe));
  return api;
}

export default async function cases() {
  const out = [];
  out.push(value('constants', { ANNOTATION_LABEL_MAX, ANNOTATIONS_MAX }));
  out.push(
    ...(await each(
      'annotationsKey',
      ['did:plc:me', 'did:web:example.com', '', 'did:plc:café'].map((did) => ({
        did,
      })),
      ({ did }) => annotationsKey(did),
    )),
  );

  const cleanInputs = [];
  for (const raw of RAW_LISTS)
    for (const zone of ['UTC', 'Pacific/Chatham'])
      cleanInputs.push({ raw, zone });
  out.push(
    ...(await each('cleanAnnotations', cleanInputs, (input) =>
      under(input, () => cleanAnnotations(input.raw)),
    )),
  );

  out.push(
    ...(await each(
      'readAnnotations',
      STORED.map((stored) => ({ did: 'did:plc:a', stored })),
      ({ did, stored }) => {
        const items = new Map(
          stored === null ? [] : [[annotationsKey(did), stored]],
        );
        return {
          list: readAnnotations(did, store(items)),
          other: readAnnotations('did:plc:b', store(items)),
        };
      },
    )),
  );
  out.push(
    ...(await each(
      'writeAnnotations',
      RAW_LISTS.filter(Array.isArray).map((list) => ({
        did: 'did:plc:a',
        list,
      })),
      ({ did, list }) => {
        const items = new Map();
        writeAnnotations(did, list, store(items));
        return Object.fromEntries(items);
      },
    )),
  );

  const base = cleanAnnotations(RAW_LISTS[0]);
  const full = cleanAnnotations(RAW_LISTS[RAW_LISTS.length - 1]);
  const adds = [
    { list: [], day: '2026-10-03', label: 'Zine went out', id: 'x' },
    { list: base, day: '2026-10-04', label: '', id: 'y' },
    { list: base, day: 'soon', label: 'A day that isn’t one', id: 'y' },
    { list: base, day: '2026-01-01', label: 'x'.repeat(200), id: 'y' },
    { list: base, day: '2026-01-01', label: '  padded  ', id: 'y' },
    { list: base, day: '2026-12-01', label: 'Same id as one held', id: 'a' },
    { list: base, day: '2026-12-01', label: 'Composed', id: 'café' },
    { list: null, day: '2026-10-03', label: 'Onto nothing', id: 'z' },
    {
      list: full,
      day: '2020-01-01',
      label: 'Older than the 200 kept',
      id: 'old',
    },
    { list: full, day: '2027-01-01', label: 'Newer than all', id: 'new' },
    { list: base, day: '2026-02-29', label: 'Not a leap year', id: 'w' },
    { list: base, day: '2028-02-29', label: 'A leap year', id: 'w' },
  ];
  out.push(
    ...(await each('addAnnotation', adds, ({ list, day, label, id }) => {
      const next = addAnnotation(list, { day, label, id });
      return { next, same: next === list };
    })),
  );
  out.push(
    ...(await each(
      'removeAnnotation',
      [
        { list: base, id: 'a' },
        { list: base, id: 'nope' },
        { list: null, id: 'a' },
        {
          list: [...base, { id: 'a', day: '2026-12-01', label: 'twice' }],
          id: 'a',
        },
        { list: [{ id: 'café', day: '2026-12-01', label: 'c' }], id: 'café' },
      ],
      ({ list, id }) => removeAnnotation(list, id),
    )),
  );

  out.push(
    ...(await each(
      'milestoneSteps',
      [
        0, 1, 99, 100, 101, 249, 250, 499, 500, 999, 1000, 6000, 25_000, 1e6,
        2.5e7, -5, 99.5, 250.5,
      ].map((max) => ({ max })),
      ({ max }) => milestoneSteps(max),
    )),
  );

  // Follower lists from a recipe (the Swift side builds the same): `dated`
  // followers a step apart from `from`, newest first when `reverse`, then
  // `undated` with no date and the `extra` rows as they are.
  const startOf2026 = Date.UTC(2026, 0, 1, 12);
  const followersOf = ({
    dated = 0,
    from = startOf2026,
    step = DAY,
    reverse = false,
    undated = 0,
    extra = [],
  }) => {
    const list = Array.from({ length: dated }, (_, i) => ({
      followedAt: new Date(from + i * step).toISOString(),
    }));
    if (reverse) list.reverse();
    return [
      ...list,
      ...Array.from({ length: undated }, () => ({ followedAt: null })),
      ...extra,
    ];
  };
  const recipes = [
    { $id: 'reverse-260', recipe: { dated: 260, reverse: true } },
    { $id: 'undated-50', recipe: { dated: 60, undated: 50 } },
    { $id: 'undated-120', recipe: { dated: 60, undated: 120 } },
    { $id: 'empty', recipe: {} },
    {
      $id: 'unreadable',
      recipe: {
        dated: 150,
        extra: [{ followedAt: 'not a date' }, { followedAt: '' }],
      },
    },
    {
      $id: 'local-times',
      recipe: {
        extra: Array.from({ length: 120 }, (_, i) => ({
          followedAt: `2026-03-${String((i % 28) + 1).padStart(2, '0')}T0${i % 10}:30:00`,
        })),
      },
    },
    {
      $id: 'ties',
      recipe: {
        extra: Array.from({ length: 260 }, () => ({
          followedAt: '2026-05-01T00:00:00.000Z',
        })),
      },
    },
    {
      $id: 'thousands',
      recipe: { dated: 5300, from: startOf2026 - 400 * DAY, step: DAY / 12 },
    },
  ];
  const milestoneInputs = [{ $id: 'none', recipe: null }];
  for (const set of recipes)
    for (const formats of [
      { zone: 'UTC', locale: 'en-US' },
      { zone: 'America/Sao_Paulo', locale: 'en-DE' },
      { zone: 'Asia/Kolkata', locale: 'en-IN' },
    ])
      milestoneInputs.push({
        ...set,
        $id: `${set.$id}-${formats.zone}`,
        ...formats,
      });
  out.push(
    ...(await each('followerMilestones', milestoneInputs, (input) =>
      under(input, () =>
        followerMilestones(input.recipe ? followersOf(input.recipe) : null),
      ),
    )),
  );

  const notes = [
    { id: 'a', day: '2026-10-03', label: 'Zine went out' },
    { id: 'b', day: '2026-03-29', label: 'Clocks went forward' },
    { id: 'c', day: '2026-10-25', label: 'Clocks went back' },
    { id: 'd', day: '2026-01-01', label: 'New year' },
  ];
  const noteInputs = [];
  for (const zone of ZONES)
    for (const annotation of notes) noteInputs.push({ annotation, zone });
  out.push(
    ...(await each('noteMark', noteInputs, (input) =>
      under(input, () => noteMark(input.annotation)),
    )),
  );

  // Marks on daily, weekly and monthly series, in every zone and from each
  // first day of the week.
  const markInputs = [];
  for (const zone of ZONES)
    for (const weekStart of [1, 0, 6])
      for (const unit of ['day', 'week', 'month']) {
        const input = under({ zone, weekStart }, () => {
          const t0 = local(2026, 9, 20, 0);
          const t1 = local(2026, 11, 8, 23);
          const series = bucketSeries([], { unit, t0, t1, pickTime: (x) => x });
          const marks = [
            noteMark(notes[0]),
            noteMark(notes[2]),
            {
              t: local(2026, 10, 20, 9),
              label: '5,000 followers',
              kind: 'milestone',
            },
            {
              t: local(2026, 10, 3, 8),
              label: '1,000 followers',
              kind: 'milestone',
            },
            {
              t: local(2026, 10, 25, 1, 30),
              label: 'In the repeated hour',
              kind: 'milestone',
            },
            { t: local(2025, 1, 1), label: 'Long ago', kind: 'note' },
            { t: local(2027, 1, 1), label: 'Far off', kind: 'note' },
            { t: '$NaN', label: 'No time', kind: 'note' },
            {
              t: local(2026, 11, 8, 23, 59),
              label: 'Last minute',
              kind: 'milestone',
            },
            { t: t0, label: 'First moment', kind: 'note' },
          ];
          return { series: series.map(({ t }) => ({ t })), marks };
        });
        markInputs.push({
          $id: `${zone}-${weekStart}-${unit}`,
          zone,
          weekStart,
          unit,
          ...input,
        });
      }
  markInputs.push({
    $id: 'empty-series',
    unit: 'day',
    series: [],
    marks: [{ t: 1, label: 'x', kind: 'note' }],
  });
  markInputs.push({
    $id: 'no-marks',
    unit: 'day',
    series: [{ t: 0 }],
    marks: null,
  });
  markInputs.push({
    $id: 'empty-marks',
    unit: 'day',
    series: [{ t: 0 }],
    marks: [],
  });
  markInputs.push({
    $id: 'repeated-starts',
    unit: 'day',
    series: [{ t: 0 }, { t: DAY }, { t: 0 }],
    marks: [
      { t: 3600, label: 'Repeated start', kind: 'milestone' },
      { t: DAY + 5, label: 'Second', kind: 'milestone' },
    ],
  });
  const NUMS = { $NaN: NaN };
  out.push(
    ...(await each('marksOnSeries', markInputs, (input) =>
      under(input, () => {
        const marks = input.marks?.map((m) => ({ ...m, t: NUMS[m.t] ?? m.t }));
        const placed = marksOnSeries(input.series, input.unit, marks);
        return { placed, text: placed.map((m) => markText(m, input.unit)) };
      }),
    )),
  );

  const nows = [
    Date.UTC(2026, 10, 14, 12),
    Date.UTC(2026, 10, 14, 23, 30),
    Date.UTC(2026, 11, 31, 11),
    Date.UTC(2026, 2, 29, 1),
  ];
  const todays = [];
  for (const zone of ZONES) for (const now of nows) todays.push({ now, zone });
  out.push(
    ...(await each('todayKey', todays, (input) =>
      under(input, () => todayKey(input.now)),
    )),
  );

  // The hook: each step mounts it afresh (reading what is stored), records
  // what it holds, then adds or removes, which writes the new list.
  const scenarios = [
    {
      $id: 'add-then-remove',
      did: 'did:plc:me',
      stored: null,
      steps: [
        { op: 'add', day: '2026-10-03', label: 'Zine went out' },
        { op: 'add', day: '2026-09-16', label: '  Changed my handle  ' },
        { op: 'add', day: '2026-10-04', label: '' },
        { op: 'add', day: 'soon', label: 'Not a day' },
        { op: 'remove', index: 0 },
        { op: 'remove', id: 'nope' },
      ],
    },
    {
      $id: 'from-broken',
      did: 'did:plc:me',
      stored: '{broken',
      steps: [{ op: 'add', day: '2026-11-01', label: 'Fresh start' }],
    },
    {
      $id: 'from-messy',
      did: 'did:plc:me',
      stored: JSON.stringify(RAW_LISTS[0]),
      steps: [
        { op: 'remove', index: 1 },
        { op: 'add', day: '2026-01-01', label: 'x'.repeat(100) },
      ],
    },
    {
      $id: 'another-account',
      did: 'did:plc:other',
      stored: null,
      others: {
        'virga:annotations:did:plc:me':
          '[{"id":"keep","day":"2026-10-03","label":"Mine"}]',
      },
      steps: [{ op: 'add', day: '2026-10-05', label: 'Theirs' }],
    },
  ];
  out.push(
    ...(await each(
      'useAnnotations',
      scenarios,
      ({ did, stored, others = {}, steps }) => {
        const items = new Map(Object.entries(others));
        if (stored !== null) items.set(annotationsKey(did), stored);
        const key = annotationsKey(did);
        let clock = Date.UTC(2026, 10, 14, 12);
        let n = 0;
        const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
        const random = vi
          .spyOn(Math, 'random')
          .mockImplementation(
            () => [0.123456789, 0.5, 0.987654321, 0.25][n++ % 4],
          );
        try {
          return withWindow(() =>
            withStorage(items, () => {
              const states = [];
              const ids = [];
              const look = () => {
                const api = mount(did);
                states.push({
                  list: api.list,
                  stored: items.has(key) ? items.get(key) : null,
                });
                return api;
              };
              let api = look();
              for (const step of steps) {
                clock += 61_000;
                if (step.op === 'add') {
                  const before = n;
                  api.add(step.day, step.label);
                  ids.push(
                    `n${clock.toString(36)}${[0.123456789, 0.5, 0.987654321, 0.25][before % 4].toString(36).slice(2, 6)}`,
                  );
                } else {
                  api.remove(step.id ?? api.list[step.index]?.id);
                }
                api = look();
              }
              const rest = Object.fromEntries(
                [...items].filter(([k]) => k !== key),
              );
              return { states, ids, others: rest };
            }),
          );
        } finally {
          now.mockRestore();
          random.mockRestore();
        }
      },
    )),
  );
  return out;
}
