// src/posting/schedule/queueReorder.js: re-packing the weekly queue after a
// drag. Which queued rows may move (splitQueueRows), the moves an
// assignment makes (pendingMoves), a move past a pinned delete time
// (queueTimerConflict) and the whole plan (planQueueReorder). Swift:
// VirgaPosting/Schedule/QueueReorder.swift.
//
// Inputs from queueReorder.test.js, plus rows due or waiting on a retry,
// loose and unreadable times, ids the web matches by key (Object.fromEntries)
// or by value (a Map), duplicated and forgotten ids, long and emoji names
// cut at 40 code units, and clock changes. Local times are read in the zone
// the case names (`tz`); the pin's words are said against Date.now(), held
// at the case's `now`.

import {
  pendingMoves,
  planQueueReorder,
  queueTimerConflict,
  splitQueueRows,
} from '../../../src/posting/schedule/queueReorder.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { each, inZone } from './_helpers.js';
import { atClock } from './_timers.js';

export const sources = ['src/posting/schedule/queueReorder.js'];

const ZONES = ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Chatham'];

const row = (id, scheduledFor, extra = {}) => ({
  id,
  queued: true,
  status: 'pending',
  clientKey: 'virga',
  scheduledFor,
  payload: {
    posts: [{ record: { text: `post ${id}` } }],
    ...(extra.selfDestruct ? { selfDestruct: extra.selfDestruct } : {}),
  },
  ...extra,
});

const pinned = (deleteAt, lifespanSeconds = 3600) => ({
  selfDestruct: { lifespanSeconds, deleteAt, conditions: {}, effects: [] },
});

/** Runs `fn` in `tz`, en-US active, Date.now() at `now`. */
function under(tz, now, fn) {
  return inZone(tz, () => {
    setActiveLocale('en-US');
    try {
      return atClock(now, fn);
    } finally {
      setActiveLocale(DEFAULT_LOCALE);
    }
  });
}

// ---- splitQueueRows ---------------------------------------------------------

const SPLIT_SETS = [
  {
    now: Date.parse('2026-08-30T12:00:00Z'),
    rows: [
      row('later', '2026-09-05T09:00:00Z'),
      row('sooner', '2026-09-04T09:00:00Z'),
      row('going', '2026-09-04T17:00:00Z', { status: 'publishing' }),
      row('partial', '2026-09-01T09:00:00Z', { partial: true }),
      row('failed', '2026-09-01T09:00:00Z', { status: 'failed' }),
      row('unkeyed', '2026-09-06T09:00:00Z', { clientKey: undefined }),
      { ...row('oneoff', '2026-09-06T09:00:00Z'), queued: false },
    ],
  },
  {
    now: Date.parse('2026-11-16T10:00:00Z'),
    rows: [
      row('due', '2026-11-16T09:00:00Z'),
      row('soon', '2026-11-16T10:00:30Z'),
      row('edge', '2026-11-16T10:01:00Z'),
      row('just-past-edge', '2026-11-16T10:01:00.001Z'),
      row('ahead', '2026-11-17T09:00:00Z'),
    ],
  },
  {
    now: Date.parse('2026-11-16T10:00:00Z'),
    rows: [
      row('local', '2026-11-16T10:00:30'),
      row('local-later', '2026-11-16T20:00'),
      row('date-only', '2026-11-17'),
      row('bad', 'not a time'),
      row('none', null),
      row('zero', 0),
      row('number', Date.parse('2026-11-18T09:00:00Z')),
      row('empty', ''),
      { ...row('truthy-queued', '2026-11-19T09:00:00Z'), queued: 1 },
      { ...row('string-false', '2026-11-19T09:00:00Z'), queued: 'false' },
      { ...row('partial-zero', '2026-11-19T09:00:00Z'), partial: 0 },
      { ...row('partial-empty', '2026-11-19T09:00:00Z'), partial: '' },
      { ...row('Pending', '2026-11-19T09:00:00Z'), status: 'Pending' },
      null,
      { queued: true, status: 'pending' },
      row('tie-a', '2026-11-20T09:00:00Z'),
      row('tie-b', '2026-11-20T09:00:00.000+00:00'),
    ],
  },
];

const splitInputs = [];
for (const tz of ZONES)
  for (const set of SPLIT_SETS) splitInputs.push({ tz, ...set });
splitInputs.push({ tz: 'UTC', rows: SPLIT_SETS[1].rows, now: 'soon' });
splitInputs.push({ tz: 'UTC', rows: SPLIT_SETS[1].rows, now: null });
splitInputs.push({ tz: 'UTC', rows: null, now: 0 });
splitInputs.push({ tz: 'UTC', rows: [], now: 0 });

// ---- pendingMoves -----------------------------------------------------------

const MOVE_SETS = [
  [
    {
      id: 'same',
      oldScheduledFor: '2026-09-03T18:00:00+00:00',
      newScheduledFor: '2026-09-03T18:00:00.000Z',
    },
    {
      id: 'moved',
      oldScheduledFor: '2026-09-03T18:00:00+00:00',
      newScheduledFor: '2026-09-04T18:00:00.000Z',
    },
    { id: 'past horizon', oldScheduledFor: null, newScheduledFor: null },
  ],
  null,
  [],
  [
    {
      id: 'from-nothing',
      oldScheduledFor: null,
      newScheduledFor: '2026-09-04T18:00:00.000Z',
    },
    { id: 'both-bad', oldScheduledFor: 'x', newScheduledFor: 'y' },
    {
      oldScheduledFor: '2026-09-03T18:00:00Z',
      newScheduledFor: '2026-09-05T18:00:00Z',
    },
    {
      id: 7,
      oldScheduledFor: '2026-09-03T18:00:00Z',
      newScheduledFor: '2026-09-06T18:00:00Z',
    },
    {
      id: 'empty-new',
      oldScheduledFor: '2026-09-03T18:00:00Z',
      newScheduledFor: '',
    },
    null,
    {
      id: 'local',
      oldScheduledFor: '2026-09-03T18:00',
      newScheduledFor: '2026-09-03T18:00:00.000Z',
    },
    {
      id: 'number',
      oldScheduledFor: Date.parse('2026-09-03T18:00:00Z'),
      newScheduledFor: '2026-09-03T18:00:00.000Z',
    },
    {
      id: 'number-new',
      oldScheduledFor: '2026-09-03T18:00:00Z',
      newScheduledFor: 12345,
    },
  ],
];
const moveInputs = [];
for (const tz of ZONES)
  for (const assignment of MOVE_SETS) moveInputs.push({ tz, assignment });

// ---- queueTimerConflict -----------------------------------------------------

const PIN = '2026-09-03T22:00:00.000Z';
const CONFLICT_ROWS = [
  row('a', '2026-09-03T18:00:00.000Z', pinned(PIN)),
  row('b', '2026-09-04T09:00:00.000Z'),
];
const far = row(
  'far',
  '2026-10-01T18:00:00.000Z',
  pinned('2026-10-20T18:00:00.000Z'),
);
const silent = {
  ...CONFLICT_ROWS[0],
  payload: { ...CONFLICT_ROWS[0].payload, posts: [{ record: { text: '' } }] },
};
const named = (text) => ({
  ...CONFLICT_ROWS[0],
  payload: { ...CONFLICT_ROWS[0].payload, posts: [{ record: { text } }] },
});
const swap = [
  {
    id: 'a',
    oldScheduledFor: '2026-09-03T18:00:00+00:00',
    newScheduledFor: '2026-09-04T09:00:00.000Z',
  },
  {
    id: 'b',
    oldScheduledFor: '2026-09-04T09:00:00+00:00',
    newScheduledFor: '2026-09-03T18:00:00.000Z',
  },
];
const CLOCK = Date.parse('2026-09-01T12:00:00Z');
const conflictSets = [
  { rows: CONFLICT_ROWS, assignment: swap },
  {
    rows: [far],
    assignment: [
      {
        id: 'far',
        oldScheduledFor: '2026-10-01T18:00:00+00:00',
        newScheduledFor: '2026-09-10T18:00:00.000Z',
      },
    ],
  },
  {
    rows: CONFLICT_ROWS,
    assignment: [
      {
        id: 'a',
        oldScheduledFor: '2026-09-03T18:00:00+00:00',
        newScheduledFor: '2026-09-03T20:00:00.000Z',
      },
      {
        id: 'b',
        oldScheduledFor: '2026-09-04T09:00:00+00:00',
        newScheduledFor: '2026-09-05T09:00:00.000Z',
      },
    ],
  },
  {
    rows: CONFLICT_ROWS,
    assignment: [
      {
        id: 'a',
        oldScheduledFor: '2026-09-03T18:00:00+00:00',
        newScheduledFor: '2026-09-03T18:00:00.000Z',
      },
    ],
  },
  {
    rows: [silent],
    assignment: [
      {
        id: 'a',
        oldScheduledFor: '2026-09-03T18:00:00Z',
        newScheduledFor: '2026-09-04T09:00:00Z',
      },
    ],
  },
  ...[
    'a short one',
    '   lots   of\n\nspace\there   ',
    'x'.repeat(40),
    'x'.repeat(41),
    `${'word '.repeat(8)}tail`,
    `${'x'.repeat(39)}😀 after`,
    `${'x'.repeat(38)}😀 after`,
    `${'x'.repeat(39)}\u00a0\u00a0more words`,
    'é'.repeat(45),
  ].map((text) => ({ rows: [named(text)], assignment: swap.slice(0, 1) })),
  {
    rows: [
      {
        ...CONFLICT_ROWS[0],
        payload: {
          ...CONFLICT_ROWS[0].payload,
          posts: { 0: { record: { text: 'keyed' } } },
        },
      },
    ],
    assignment: swap.slice(0, 1),
  },
  {
    rows: [
      {
        ...CONFLICT_ROWS[0],
        payload: { ...CONFLICT_ROWS[0].payload, posts: [] },
      },
    ],
    assignment: swap.slice(0, 1),
  },
  {
    rows: [
      {
        ...CONFLICT_ROWS[0],
        payload: {
          ...CONFLICT_ROWS[0].payload,
          posts: [{ record: { text: 42 } }],
        },
      },
    ],
    assignment: swap.slice(0, 1),
  },
  // Ids looked up by key: a number id finds a row whose id is its string.
  {
    rows: [{ ...CONFLICT_ROWS[0], id: '5' }],
    assignment: [{ ...swap[0], id: 5 }],
  },
  {
    rows: [{ ...CONFLICT_ROWS[0], id: undefined }],
    assignment: [{ ...swap[0], id: undefined }],
  },
  // The last row with an id wins.
  {
    rows: [CONFLICT_ROWS[0], { ...CONFLICT_ROWS[1], id: 'a' }],
    assignment: swap.slice(0, 1),
  },
  { rows: null, assignment: swap },
  { rows: CONFLICT_ROWS, assignment: null },
  // A pin with no offset, read in the zone.
  {
    rows: [row('local', '2026-09-03T18:00:00Z', pinned('2026-09-03T22:00'))],
    assignment: [
      {
        id: 'local',
        oldScheduledFor: '2026-09-03T18:00:00Z',
        newScheduledFor: '2026-09-04T01:00:00Z',
      },
    ],
  },
  {
    rows: [row('local', '2026-09-03T18:00:00Z', pinned('2026-09-03T22:00'))],
    assignment: [
      {
        id: 'local',
        oldScheduledFor: '2026-09-03T18:00:00Z',
        newScheduledFor: '2026-09-03T23:00',
      },
    ],
  },
];
const conflictInputs = [];
for (const tz of ZONES)
  for (const set of conflictSets)
    conflictInputs.push({ tz, now: CLOCK, ...set });

// ---- planQueueReorder -------------------------------------------------------

const WEEK4 = {
  timezone: 'UTC',
  slots: { mon: ['09:00'], tue: ['09:00'], wed: ['09:00'], thu: ['09:00'] },
};
const WEEKDAYS5 = {
  timezone: 'UTC',
  slots: {
    mon: ['09:00'],
    tue: ['09:00'],
    wed: ['09:00'],
    thu: ['09:00'],
    fri: ['09:00'],
  },
};
const AUG = Date.parse('2026-08-16T12:00:00Z');
const NOV = Date.parse('2026-11-16T10:00:00Z');
const RETRY_ROWS = [
  row('A', '2026-11-16T09:00:00+00:00'),
  row('B', '2026-11-17T09:00:00+00:00'),
  row('C', '2026-11-18T09:00:00+00:00'),
];
const planSets = [
  {
    schedule: WEEK4,
    now: AUG,
    rows: [
      row('a', '2026-08-17T09:00:00+00:00'),
      row('stuck', '2026-08-18T09:00:00+00:00', { status: 'failed' }),
      row('b', '2026-08-19T09:00:00+00:00'),
    ],
    orderedIds: ['b', 'a'],
  },
  {
    schedule: WEEK4,
    now: AUG,
    rows: [
      row('a', '2026-08-17T09:00:00Z'),
      row('b', '2026-08-18T09:00:00Z'),
      row('stuck', '2026-08-19T09:00:00Z', { partial: true }),
    ],
    orderedIds: ['stuck', 'b'],
  },
  {
    schedule: WEEK4,
    now: AUG,
    rows: [
      row('a', '2026-08-17T09:00:00Z', pinned('2026-08-17T12:00:00Z')),
      row('b', '2026-08-18T09:00:00Z'),
    ],
    orderedIds: ['b', 'a'],
  },
  { schedule: WEEKDAYS5, now: NOV, rows: RETRY_ROWS, orderedIds: ['C', 'B'] },
  {
    schedule: WEEKDAYS5,
    now: NOV,
    rows: RETRY_ROWS,
    orderedIds: ['A', 'C', 'B'],
  },
  {
    schedule: WEEKDAYS5,
    now: NOV,
    rows: RETRY_ROWS,
    orderedIds: ['B', 'B', 'C'],
  },
  { schedule: WEEKDAYS5, now: NOV, rows: RETRY_ROWS, orderedIds: [] },
  { schedule: WEEKDAYS5, now: NOV, rows: RETRY_ROWS, orderedIds: null },
  {
    schedule: WEEKDAYS5,
    now: NOV,
    rows: RETRY_ROWS,
    orderedIds: ['nobody', 'C'],
  },
  // Map keys by value: the number 1 isn't the string '1'.
  {
    schedule: WEEKDAYS5,
    now: NOV,
    rows: [row(1, '2026-11-17T09:00:00Z'), row('1', '2026-11-18T09:00:00Z')],
    orderedIds: ['1', 1],
  },
  {
    schedule: WEEKDAYS5,
    now: NOV,
    rows: [
      row('dup', '2026-11-17T09:00:00Z'),
      row('dup', '2026-11-18T09:00:00Z'),
      row('x', '2026-11-19T09:00:00Z'),
    ],
    orderedIds: ['x', 'dup'],
  },
  {
    schedule: { timezone: 'UTC', slots: {} },
    now: NOV,
    rows: RETRY_ROWS,
    orderedIds: ['C', 'B'],
  },
  { schedule: null, now: NOV, rows: RETRY_ROWS, orderedIds: ['C', 'B'] },
  {
    schedule: { slots: WEEKDAYS5.slots },
    now: NOV,
    rows: RETRY_ROWS,
    orderedIds: ['C', 'B'],
  },
  {
    schedule: { timezone: 'Not/AZone', slots: WEEKDAYS5.slots },
    now: NOV,
    rows: RETRY_ROWS,
    orderedIds: ['C', 'B'],
  },
  // Across New York's spring forward: a 02:30 slot that day doesn't exist.
  {
    schedule: {
      timezone: 'America/New_York',
      slots: {
        sat: ['02:30', '23:00'],
        sun: ['02:30', '09:00'],
        mon: ['02:30'],
      },
    },
    now: Date.parse('2027-03-13T12:00:00Z'),
    rows: [
      row('p', '2027-03-14T13:00:00Z'),
      row('q', '2027-03-14T07:30:00Z'),
      row('r', '2027-03-15T06:30:00Z'),
      row('s', '2027-03-14T04:00:00Z'),
    ],
    orderedIds: ['r', 'q', 'p', 's'],
  },
  // Chatham's 2:45 change, and a row past the horizon.
  {
    schedule: {
      timezone: 'Pacific/Chatham',
      slots: { sun: ['02:45', '03:45'], mon: ['08:00'] },
    },
    now: Date.parse('2026-09-26T00:00:00Z'),
    rows: [
      row('c1', '2026-09-27T13:00:00Z'),
      row('c2', '2026-09-28T19:15:00Z'),
      row('c3', '2026-12-31T19:15:00Z'),
    ],
    orderedIds: ['c3', 'c2', 'c1'],
  },
  // Every slot taken: the last row has nowhere to go.
  {
    schedule: { timezone: 'UTC', slots: { mon: ['09:00'] } },
    now: NOV,
    rows: Array.from({ length: 15 }, (_, i) =>
      row(
        `w${i}`,
        new Date(
          Date.parse('2026-11-23T09:00:00Z') + i * 7 * 86_400_000,
        ).toISOString(),
      ),
    ),
    orderedIds: ['w14', 'w0'],
  },
  // Local times without an offset, read in the zone.
  {
    schedule: { slots: { tue: ['09:00'], wed: ['09:00'] } },
    now: NOV,
    rows: [row('l1', '2026-11-17T09:00'), row('l2', '2026-11-18T09:00')],
    orderedIds: ['l2', 'l1'],
  },
];
const planInputs = [];
for (const tz of ZONES)
  for (const set of planSets) planInputs.push({ tz, ...set });

export default async function cases() {
  return [
    ...(await each('splitQueueRows', splitInputs, ({ tz, rows, now }) =>
      inZone(tz, () => splitQueueRows(rows, { now })),
    )),
    ...(await each('pendingMoves', moveInputs, ({ tz, assignment }) =>
      inZone(tz, () => pendingMoves(assignment)),
    )),
    ...(await each(
      'queueTimerConflict',
      conflictInputs,
      ({ tz, now, rows, assignment }) =>
        under(tz, now, () => queueTimerConflict(rows, assignment)),
    )),
    ...(await each(
      'planQueueReorder',
      planInputs,
      ({ tz, schedule, rows, orderedIds, now }) =>
        under(tz, now, () =>
          planQueueReorder(schedule, rows, orderedIds, new Date(now)),
        ),
    )),
  ];
}
