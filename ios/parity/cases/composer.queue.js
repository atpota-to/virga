// src/posting/schedule/{publishActions,postingQueue}.js: the split button's
// actions and their refusals, and the weekly queue's slot math (the next
// open slot, re-packing, the horizon, date buckets). Swift:
// VirgaPosting/Schedule/{PublishActions,PostingQueue}.swift. Repeats are
// composer.repeat.js.
//
// The slot math is time-zone work: cases run over ZONES and the
// zones with a clock change, across each change (spring forward into a gap,
// fall back into an overlap, Lord Howe's half hour, Chatham's 2:45), with
// local times read in the zone the case names (`tz`). Inputs are the
// modules' own tests' plus loose and malformed shapes.

import {
  PUBLISH_ACTIONS,
  DEFAULT_PUBLISH_ACTION,
  PUBLISH_ACTION_OPTIONS,
  EMPTY_QUEUE_HINT,
  NEEDS_BACKEND_HINT,
  NO_BACKEND_HINT,
  QUEUE_REPLY_HINT,
  VIDEO_HINT,
  needsBackendHint,
  normalizePublishAction,
  getPublishActionLabel,
  scheduleBlockReason,
  queueBlockReason,
  resolvePrimaryPublishAction,
  publishActionBlockReason,
} from '../../../src/posting/schedule/publishActions.js';
import {
  QUEUE_HORIZON_DAYS,
  MIN_LEAD_MS,
  DEFAULT_POSTING_QUEUE,
  WEEKDAYS,
  dayDiff,
  dateBucketLabel,
  groupByDateBucket,
  resolveTimezone,
  isScheduleEmpty,
  isShippedDefaultSchedule,
  zonedWallTimeToUtc,
  zonedWallTime,
  enumerateSlots,
  nextOpenSlot,
  recomputeQueueAssignment,
  summarizeQueue,
  relativeWhen,
  postSnippet,
  queueSlotMoveNote,
} from '../../../src/posting/schedule/postingQueue.js';

import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { each, grid, value, inZone, ZONES } from './_helpers.js';

export const sources = [
  'src/posting/schedule/publishActions.js',
  'src/posting/schedule/postingQueue.js',
];

// Zones whose clocks change, and when, for the slot and repeat cases.
const DST_ZONES = [
  'America/New_York',
  'Europe/London',
  'Europe/Paris',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
];
const ALL_ZONES = [...new Set([...ZONES, ...DST_ZONES, 'Pacific/Honolulu'])];

/** Runs `fn` in `tz` with `locale` active. */
function under(tz, locale, fn) {
  return inZone(tz, () => {
    setActiveLocale(locale);
    try {
      return fn();
    } finally {
      setActiveLocale(DEFAULT_LOCALE);
    }
  });
}

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const at = (s) => Date.parse(s);

// ---- publish actions ------------------------------------------------------

const ACTIONS = [
  'post',
  'schedule',
  'queue',
  'draft',
  'publish',
  'Post',
  'drafts',
  '',
  null,
  undefined,
  5,
  true,
  ['post'],
];

async function publishActionCases() {
  const all = [
    value('publishActionConstants', {
      PUBLISH_ACTIONS,
      DEFAULT_PUBLISH_ACTION,
      PUBLISH_ACTION_OPTIONS,
      EMPTY_QUEUE_HINT,
      NEEDS_BACKEND_HINT,
      NO_BACKEND_HINT,
      QUEUE_REPLY_HINT,
      VIDEO_HINT,
    }),
  ];
  all.push(
    ...(await each(
      'needsBackendHint',
      [
        {},
        { authMode: 'backend' },
        { authMode: 'browser' },
        { authMode: null },
        { authMode: '' },
      ],
      ({ authMode }) => needsBackendHint(authMode),
    )),
    ...(await each(
      'normalizePublishAction',
      ACTIONS.map((v) => ({ value: v })),
      (i) => normalizePublishAction(i.value),
    )),
    ...(await each(
      'getPublishActionLabel',
      ACTIONS.map((v) => ({ action: v })),
      (i) => getPublishActionLabel(i.action),
    )),
    ...(await each(
      'scheduleBlockReason',
      grid({
        canSchedule: [true, false, undefined],
        video: [true, false, undefined],
        authMode: [undefined, 'backend', 'browser'],
      }),
      (i) => scheduleBlockReason(i),
    )),
    ...(await each(
      'queueBlockReason',
      [{ reply: true }, { reply: false }, {}],
      (i) => queueBlockReason(i),
    )),
    ...(await each(
      'resolvePrimaryPublishAction',
      grid({
        preferred: [
          'post',
          'schedule',
          'queue',
          'draft',
          'publish',
          'other',
          undefined,
        ],
        canSchedule: [true, false, undefined],
        canSaveDraft: [true, false, undefined],
      }),
      (i) => resolvePrimaryPublishAction(i),
    )),
    ...(await each(
      'publishActionBlockReason',
      grid({
        action: ['post', 'schedule', 'queue', 'draft', 'publish', null],
        queueEmpty: [true, false, undefined],
        scheduleBlock: [null, 'Scheduling is off.', ''],
        queueBlock: [null, QUEUE_REPLY_HINT],
      }),
      ({ action, ...options }) => publishActionBlockReason(action, options),
    )),
  );
  return all;
}

// ---- the queue -------------------------------------------------------------

const WEEK = (timezone, slots) => ({ timezone, slots });
const EVERY_DAY = (times) => ({
  mon: times,
  tue: times,
  wed: times,
  thu: times,
  fri: times,
  sat: times,
  sun: times,
});
const SCHEDULES = [
  ['default-utc', WEEK('UTC', DEFAULT_POSTING_QUEUE.slots)],
  ['default-local', WEEK('', DEFAULT_POSTING_QUEUE.slots)],
  ['ny-mornings', WEEK('America/New_York', EVERY_DAY(['09:00']))],
  [
    'ny-gap',
    WEEK('America/New_York', {
      sun: ['01:30', '02:30', '03:15'],
      mon: ['02:30'],
    }),
  ],
  [
    'ny-overlap',
    WEEK('America/New_York', { sun: ['00:30', '01:30', '02:00'] }),
  ],
  ['london-gap', WEEK('Europe/London', { sun: ['00:30', '01:30', '02:30'] })],
  [
    'lord-howe',
    WEEK('Australia/Lord_Howe', { sun: ['01:45', '02:00', '02:15', '02:45'] }),
  ],
  [
    'chatham',
    WEEK('Pacific/Chatham', { sun: ['02:30', '02:45', '03:00', '03:45'] }),
  ],
  ['sao-paulo', WEEK('America/Sao_Paulo', EVERY_DAY(['00:00', '23:59']))],
  [
    'kolkata',
    WEEK('Asia/Kolkata', { mon: ['09:00', '18:30'], sat: ['12:00'] }),
  ],
  [
    'unsorted',
    WEEK('UTC', { mon: ['17:00', '09:00', '09:00'], tue: ['23:59', '00:00'] }),
  ],
  [
    'loose-times',
    WEEK('UTC', {
      mon: ['9:5', ' 7:30', '08:00:30', 'x:00', '', '25:00', '09:75'],
    }),
  ],
  ['single-digit', WEEK('UTC', { wed: ['9'] })],
  ['number-time', WEEK('UTC', { wed: [9] })],
  ['string-day', WEEK('UTC', { mon: ['09:00'], tue: '10:00' })],
  ['object-day', WEEK('UTC', { mon: ['09:00'], tue: {} })],
  ['bad-zone', WEEK('Not/AZone', { mon: ['09:00'] })],
  ['lowercase-zone', WEEK('america/new_york', { mon: ['09:00'] })],
  ['empty', WEEK('UTC', {})],
  ['empty-days', WEEK('UTC', { mon: [], tue: [] })],
  ['null', null],
  ['no-slots', { timezone: 'UTC' }],
  ['dense', WEEK('UTC', EVERY_DAY(['00:00', '06:00', '12:00', '18:00']))],
];
const FROMS = [
  ['mid-march', '2026-03-05T12:00:00.000Z'],
  ['before-ny-spring', '2026-03-07T12:00:00.000Z'],
  ['before-london-spring', '2026-03-28T22:00:00.000Z'],
  ['before-ny-fall', '2026-10-31T12:00:00.000Z'],
  ['before-lord-howe-spring', '2026-10-03T10:00:00.000Z'],
  ['before-chatham-spring', '2026-09-26T10:00:00.000Z'],
  ['with-millis', '2026-08-16T23:59:59.999Z'],
  ['year-end', '2026-12-31T23:30:00.000Z'],
];

// Slots across the horizon are a long list: the count, the first dozen and
// the last few say whether two ports agree.
const sample = (slots) => ({
  count: slots.length,
  first: slots.slice(0, 8).map((d) => d.toISOString()),
  last: slots.slice(-3).map((d) => d.toISOString()),
});

const ROWS = [
  { id: 'a', scheduledFor: '2026-03-09T09:00:00.000Z' },
  { id: 'b', scheduledFor: '2026-03-09T17:00:30.000Z' },
  { id: 'c', scheduledFor: '2026-03-10T09:00:00+00:00' },
  { id: 'd', scheduledFor: '2026-03-10T17:00:00' },
  { id: 'e', scheduledFor: null },
  { id: 'f', scheduledFor: 'not a date' },
  { id: 'g' },
];

const NOWS = [
  ['sunday', '2026-03-08T12:00:00.000Z'],
  ['monday-8:59:30', '2026-03-09T08:59:30.000Z'],
  ['monday-8:58', '2026-03-09T08:58:00.000Z'],
  ['friday-night', '2026-03-13T22:00:00.000Z'],
];

async function queueCases() {
  const all = [
    value('queueConstants', {
      QUEUE_HORIZON_DAYS,
      MIN_LEAD_MS,
      DEFAULT_POSTING_QUEUE,
      WEEKDAYS,
    }),
  ];

  // Days and buckets, in each zone and the app's locales.
  const NOW_ISO = [
    '2026-03-08T12:00:00.000Z',
    '2026-03-08T03:30:00.000Z',
    '2026-11-01T05:30:00.000Z',
    '2026-12-31T23:59:00.000Z',
  ];
  const ISOS = [
    '2026-03-08T12:00:00.000Z',
    '2026-03-07T23:00:00.000Z',
    '2026-03-09T00:30:00.000Z',
    '2026-03-09T04:00:00.000Z',
    '2026-03-10T12:00:00.000Z',
    '2026-03-14T12:00:00.000Z',
    '2026-03-15T12:00:00.000Z',
    '2026-03-16T12:00:00.000Z',
    '2026-11-01T12:00:00.000Z',
    '2026-11-02T04:00:00.000Z',
    '2027-01-02T10:00:00.000Z',
    '2026-03-09T12:00:00',
    '2026-03-20',
    'not a date',
    null,
    1773000000000,
  ];
  const bucketInputs = [];
  for (const tz of ZONES)
    for (const now of NOW_ISO)
      for (const isoValue of ISOS.slice(0, 11))
        bucketInputs.push({ tz, now, iso: isoValue });
  for (const tz of ['America/New_York', 'Pacific/Chatham'])
    for (const isoValue of ISOS.slice(11))
      bucketInputs.push({ tz, now: NOW_ISO[0], iso: isoValue });
  all.push(
    ...(await each('dayDiff', bucketInputs, (i) =>
      inZone(i.tz, () => dayDiff(i.iso, new Date(i.now))),
    )),
  );
  const labelInputs = [];
  for (const locale of ['en-US', 'en-GB', 'en-IN'])
    for (const tz of [
      'UTC',
      'America/New_York',
      'Pacific/Chatham',
      'Asia/Kolkata',
    ])
      for (const isoValue of ISOS)
        labelInputs.push({ locale, tz, now: NOW_ISO[0], iso: isoValue });
  all.push(
    ...(await each('dateBucketLabel', labelInputs, (i) =>
      under(i.tz, i.locale, () => dateBucketLabel(i.iso, new Date(i.now))),
    )),
  );
  const groupRows = [
    { id: 1, scheduledFor: '2026-03-07T12:00:00.000Z' },
    { id: 2, scheduledFor: '2026-03-08T13:00:00.000Z' },
    { id: 3, scheduledFor: '2026-03-08T20:00:00.000Z' },
    { id: 4, scheduledFor: '2026-03-09T09:00:00.000Z' },
    { id: 5, scheduledFor: '2026-03-12T09:00:00.000Z' },
    { id: 6, scheduledFor: '2026-03-20T09:00:00.000Z' },
    { id: 7, scheduledFor: '2026-03-20T22:00:00.000Z' },
    { id: 8, scheduledFor: '2026-03-08T21:00:00.000Z' },
  ];
  const groupInputs = [];
  for (const tz of ['UTC', 'America/New_York', 'Pacific/Chatham'])
    for (const locale of ['en-US', 'en-GB'])
      groupInputs.push({ tz, locale, now: NOW_ISO[0], rows: groupRows });
  groupInputs.push({ tz: 'UTC', locale: 'en-US', now: NOW_ISO[0], rows: [] });
  all.push(
    ...(await each('groupByDateBucket', groupInputs, (i) =>
      under(i.tz, i.locale, () =>
        groupByDateBucket(i.rows, undefined, new Date(i.now)),
      ),
    )),
  );

  all.push(
    ...(await each(
      'resolveTimezone',
      grid({
        tz: ['UTC', 'America/New_York', 'Asia/Kolkata'],
        schedule: [
          null,
          {},
          { timezone: '' },
          { timezone: 'Europe/Paris' },
          { timezone: 0 },
          { timezone: 'Nowhere/Land' },
        ],
      }),
      (i) => inZone(i.tz, () => resolveTimezone(i.schedule)),
    )),
    ...(await each(
      'isScheduleEmpty',
      [
        { schedule: { slots: { mon: [] } } },
        { schedule: undefined },
        { schedule: null },
        { schedule: { slots: { fri: ['10:00'] } } },
        { schedule: { slots: null } },
        { schedule: { slots: 'mon' } },
        { schedule: { slots: [['09:00']] } },
        { schedule: { slots: [[]] } },
        { schedule: { slots: { mon: '09:00' } } },
        { schedule: { slots: { mon: {} } } },
        { schedule: 'x' },
        { schedule: DEFAULT_POSTING_QUEUE },
      ],
      (i) => isScheduleEmpty(i.schedule),
    )),
    ...(await each(
      'isShippedDefaultSchedule',
      [
        { slots: DEFAULT_POSTING_QUEUE.slots },
        {
          slots: {
            mon: ['17:00', '09:00'],
            tue: ['09:00', '17:00'],
            wed: ['09:00', '17:00'],
            thu: ['09:00', '17:00'],
            fri: ['09:00', '17:00'],
          },
        },
        { slots: { ...DEFAULT_POSTING_QUEUE.slots, sat: ['10:00'] } },
        { slots: { ...DEFAULT_POSTING_QUEUE.slots, mon: ['09:00'] } },
        { slots: { ...DEFAULT_POSTING_QUEUE.slots, mon: ['09:00', '09:00'] } },
        { slots: {} },
        { slots: null },
        { slots: undefined },
        { slots: { ...DEFAULT_POSTING_QUEUE.slots, fri: ['9:00', '17:00'] } },
        {
          slots: { ...DEFAULT_POSTING_QUEUE.slots, sat: null, sun: undefined },
        },
      ],
      (i) => isShippedDefaultSchedule(i.slots),
    )),
  );

  // Wall times to instants, and back, across every kind of clock change.
  const WALLS = [
    ['2026-03-08', '02:30'],
    ['2026-03-08', '01:59'],
    ['2026-03-08', '03:00'],
    ['2026-11-01', '01:30'],
    ['2026-11-01', '00:59'],
    ['2026-03-29', '01:30'],
    ['2026-10-25', '01:30'],
    ['2026-10-04', '02:15'],
    ['2026-04-05', '01:45'],
    ['2026-09-27', '02:50'],
    ['2026-04-05', '03:00'],
    ['2026-02-28', '23:59'],
    ['2028-02-29', '12:00'],
    ['2026-02-29', '12:00'],
    ['2026-02-31', '12:00'],
    ['2026-04-31', '12:00'],
    ['2026-13-01', '12:00'],
    ['2026-00-10', '12:00'],
    ['2026-01-00', '12:00'],
    ['2026-01-10', '24:00'],
    ['2026-01-10', '23:60'],
    ['2026-1-10', '12:00'],
    ['2026-01-10', '9:00'],
    ['2026-01-10 ', '12:00'],
    ['2026-01-10', '12:00\n'],
    ['', '12:00'],
    [null, null],
    ['0050-06-01', '12:00'],
    ['1969-12-31', '23:59'],
  ];
  const wallInputs = [];
  for (const tz of [...ALL_ZONES, 'Not/AZone', 'america/new_york'])
    for (const [date, time] of WALLS) wallInputs.push({ date, time, tz });
  all.push(
    ...(await each('zonedWallTimeToUtc', wallInputs, (i) =>
      iso(zonedWallTimeToUtc(i.date, i.time, i.tz)?.getTime()),
    )),
  );
  const INSTANTS = [
    '2026-03-08T06:59:00.000Z',
    '2026-03-08T07:00:00.000Z',
    '2026-11-01T05:30:00.000Z',
    '2026-11-01T06:30:00.000Z',
    '2026-03-29T01:00:00.000Z',
    '2026-10-03T15:30:00.000Z',
    '2026-09-26T14:00:00.000Z',
    '2026-11-16T09:00:00.000Z',
    '2026-11-16T09:00:59.999Z',
    '2026-11-16T09:00:00',
    '2026-11-16',
    '',
    null,
    0,
    1773000000000,
    'soon',
  ];
  const wallTimeInputs = [];
  for (const zone of [...ALL_ZONES, 'Not/AZone'])
    for (const v of INSTANTS)
      wallTimeInputs.push({ tz: 'UTC', zone, value: v });
  // A time without an offset is read on the device's clock.
  for (const tz of ['America/New_York', 'Pacific/Chatham'])
    for (const zone of ['UTC', 'America/New_York', 'Australia/Lord_Howe'])
      for (const v of [
        '2026-11-16T09:00:00',
        '2026-03-08T02:30:00',
        '2026-11-16',
        0,
      ])
        wallTimeInputs.push({ tz, zone, value: v });
  // The web's offset reads the wall clock back through formatToParts and
  // Date.UTC: an era year without its era (1 BC is "1") and a year under
  // 100 read as 19xx, so instants before the year 100 come out centuries
  // off, as do the earliest a Date holds.
  const ANCIENT = [
    '0050-06-01T12:00:00.000Z',
    '0099-12-31T23:59:59.999Z',
    '0100-01-01T00:00:00.000Z',
    '0150-06-01T12:00:00.000Z',
    '0001-01-01T00:00:00.000Z',
    '0000-06-01T12:00:00.000Z',
    '-000050-06-01T12:00:00.000Z',
    -8.64e15,
    -62135596800001,
  ];
  for (const zone of [
    'UTC',
    'America/New_York',
    'Asia/Kolkata',
    'Pacific/Chatham',
  ])
    for (const v of ANCIENT) wallTimeInputs.push({ tz: 'UTC', zone, value: v });
  // The latest a Date holds, in zones at or behind UTC (ahead of it the
  // web's wall clock is past the end of time: 'NaN-NaN-NaN').
  for (const zone of ['UTC', 'America/New_York', 'Pacific/Honolulu'])
    wallTimeInputs.push({ tz: 'UTC', zone, value: 8.64e15 });
  all.push(
    ...(await each('zonedWallTime', wallTimeInputs, (i) =>
      inZone(i.tz, () => zonedWallTime(i.value, i.zone)),
    )),
  );

  // The slot walk.
  // Every schedule from a few starts; the ones with a clock change from
  // just before it; the one without a zone in two device zones.
  const slotInputs = [];
  const FROM = Object.fromEntries(FROMS);
  const NEAR = {
    'ny-gap': ['before-ny-spring', 'before-ny-fall'],
    'ny-overlap': ['before-ny-fall', 'before-ny-spring'],
    'london-gap': ['before-london-spring'],
    'lord-howe': ['before-lord-howe-spring'],
    chatham: ['before-chatham-spring'],
    'default-local': FROMS.map(([fid]) => fid),
  };
  for (const [sid, schedule] of SCHEDULES) {
    const froms = [
      ...new Set([
        'mid-march',
        'with-millis',
        'year-end',
        ...(NEAR[sid] || []),
      ]),
    ];
    const zones =
      sid === 'default-local'
        ? ['UTC', 'America/New_York', 'Pacific/Chatham']
        : ['UTC'];
    for (const fid of froms)
      for (const tz of zones)
        slotInputs.push({
          $id: `${sid}/${fid}/${tz}`,
          schedule,
          from: FROM[fid],
          tz,
        });
  }
  all.push(
    ...(await each('enumerateSlots', slotInputs, (i) =>
      inZone(i.tz, () => sample([...enumerateSlots(i.schedule, at(i.from))])),
    )),
  );
  // From an ancient instant the walk starts on the web's bent calendar.
  all.push(
    ...(await each(
      'enumerateSlots',
      [
        ['0050-06-01T00:00:00.000Z', 'UTC'],
        ['0050-06-01T00:00:00.000Z', 'America/New_York'],
        ['0150-06-01T00:00:00.000Z', 'Asia/Kolkata'],
        ['-000050-06-01T00:00:00.000Z', 'UTC'],
        ['+275760-08-01T00:00:00.000Z', 'UTC'],
      ].map(([from, zone]) => ({
        $id: `ancient-${from}-${zone}`,
        schedule: WEEK(zone, EVERY_DAY(['09:00'])),
        from,
        tz: 'UTC',
      })),
      (i) =>
        inZone(i.tz, () => sample([...enumerateSlots(i.schedule, at(i.from))])),
    )),
  );
  // An explicit zone overrides the schedule's.
  all.push(
    ...(await each(
      'enumerateSlots',
      ['Europe/Paris', 'Pacific/Chatham', 'Nowhere/Land'].map((zone) => ({
        $id: `explicit-${zone}`,
        schedule: SCHEDULES[0][1],
        from: FROMS[0][1],
        tz: 'UTC',
        zone,
      })),
      (i) =>
        inZone(i.tz, () =>
          sample([...enumerateSlots(i.schedule, at(i.from), i.zone)]),
        ),
    )),
  );

  const nextInputs = [];
  for (const [sid, schedule] of SCHEDULES)
    for (const [nid, now] of NOWS)
      for (const tz of ['UTC', 'America/New_York'])
        nextInputs.push({
          $id: `${sid}/${nid}/${tz}`,
          schedule,
          now,
          tz,
          rows: [],
        });
  for (const [nid, now] of NOWS)
    for (const tz of ['UTC', 'Pacific/Chatham'])
      nextInputs.push({
        $id: `taken/${nid}/${tz}`,
        schedule: SCHEDULES[0][1],
        now,
        tz,
        rows: ROWS,
      });
  // A queue full to the horizon has nothing left.
  const weekly = WEEK('UTC', { mon: ['09:00'] });
  const full = [
    ...enumerateSlots(weekly, at('2026-03-08T12:00:00.000Z'), 'UTC'),
  ].map((d) => ({ scheduledFor: d.toISOString() }));
  nextInputs.push({
    $id: 'full',
    schedule: weekly,
    now: '2026-03-08T12:00:00.000Z',
    tz: 'UTC',
    rows: full,
  });
  nextInputs.push({
    $id: 'all-but-last',
    schedule: weekly,
    now: '2026-03-08T12:00:00.000Z',
    tz: 'UTC',
    rows: full.slice(0, -1),
  });
  all.push(
    ...(await each('nextOpenSlot', nextInputs, (i) =>
      inZone(i.tz, () =>
        iso(nextOpenSlot(i.schedule, i.rows, new Date(i.now))?.getTime()),
      ),
    )),
  );

  const ORDERED = [
    { id: 'r1', scheduledFor: '2026-03-09T09:00:00.000Z' },
    { id: 'r2', scheduledFor: '2026-03-09T17:00:00+00:00' },
    { id: 'r3', scheduledFor: null },
    { id: 'r4' },
    { scheduledFor: '2026-03-12T09:00:00' },
    { id: 6, scheduledFor: 'junk' },
  ];
  const OCCUPIED = [
    [],
    [
      { scheduledFor: '2026-03-09T09:00:30.000Z' },
      { scheduledFor: '2026-03-10T17:00:00.000Z' },
    ],
    [null, { scheduledFor: null }, {}, { scheduledFor: 'junk' }],
  ];
  const repackInputs = [];
  for (const [sid, schedule] of SCHEDULES.slice(0, 6))
    for (const [oi, occupied] of OCCUPIED.entries())
      for (const tz of ['UTC', 'America/New_York'])
        repackInputs.push({
          $id: `${sid}/occupied${oi}/${tz}`,
          schedule,
          rows: ORDERED,
          occupied,
          now: NOWS[0][1],
          tz,
        });
  repackInputs.push({
    $id: 'empty-order',
    schedule: SCHEDULES[0][1],
    rows: [],
    occupied: [],
    now: NOWS[0][1],
    tz: 'UTC',
  });
  repackInputs.push({
    $id: 'null-occupied',
    schedule: SCHEDULES[0][1],
    rows: ORDERED,
    occupied: null,
    now: NOWS[0][1],
    tz: 'UTC',
  });
  repackInputs.push({
    $id: 'empty-week',
    schedule: SCHEDULES[18][1],
    rows: ORDERED,
    occupied: [],
    now: NOWS[0][1],
    tz: 'UTC',
  });
  repackInputs.push({
    $id: 'bad-zone',
    schedule: SCHEDULES[16][1],
    rows: ORDERED,
    occupied: [],
    now: NOWS[0][1],
    tz: 'UTC',
  });
  // More rows than the horizon holds.
  repackInputs.push({
    $id: 'outrun',
    schedule: weekly,
    rows: Array.from({ length: 16 }, (_, n) => ({
      id: `q${n}`,
      scheduledFor: null,
    })),
    occupied: [],
    now: '2026-03-08T12:00:00.000Z',
    tz: 'UTC',
  });
  all.push(
    ...(await each('recomputeQueueAssignment', repackInputs, (i) =>
      inZone(i.tz, () =>
        recomputeQueueAssignment(i.schedule, i.rows, new Date(i.now), {
          occupied: i.occupied,
        }),
      ),
    )),
  );

  const SUMMARY_ROWS = [
    {
      id: 'later',
      queued: true,
      status: 'pending',
      scheduledFor: '2026-03-12T09:00:00.000Z',
    },
    {
      id: 'sooner',
      queued: true,
      status: 'pending',
      scheduledFor: '2026-03-09T09:00:00.000Z',
    },
    {
      id: 'middle',
      queued: 1,
      status: 'pending',
      scheduledFor: '2026-03-10T09:00:00.000Z',
    },
    {
      id: 'going',
      queued: true,
      status: 'publishing',
      scheduledFor: '2026-03-09T08:00:00.000Z',
    },
    {
      id: 'one-off',
      queued: false,
      status: 'pending',
      scheduledFor: '2026-03-11T09:00:00.000Z',
    },
    { id: 'one-off-going', status: 'publishing' },
    { id: 'failed', queued: true, status: 'failed' },
    { id: 'failed-2', status: 'failed' },
    { id: 'sent', status: 'published' },
    { id: 'undated-1', queued: true, status: 'pending', scheduledFor: 'junk' },
    { id: 'undated-2', queued: true, status: 'pending' },
    {
      id: 'local',
      queued: true,
      status: 'pending',
      scheduledFor: '2026-03-09T04:30:00',
    },
    null,
  ];
  all.push(
    ...(await each(
      'summarizeQueue',
      [
        { rows: SUMMARY_ROWS, tz: 'UTC' },
        { rows: SUMMARY_ROWS, tz: 'Asia/Kolkata' },
        { rows: [], tz: 'UTC' },
        { rows: [null, null], tz: 'UTC' },
      ],
      (i) => inZone(i.tz, () => summarizeQueue(i.rows)),
    )),
  );

  const NOW = at('2026-03-08T12:00:00.000Z');
  const OFFSETS = [
    -60000,
    0,
    1,
    29_999,
    30_000,
    89_999,
    20 * 60000,
    59 * 60000 + 29_999,
    59 * 60000 + 30_000,
    3 * 3600000,
    23.5 * 3600000,
    24 * 3600000,
    36 * 3600000 - 1,
    36 * 3600000,
    50 * 3600000,
    400 * 24 * 3600000,
  ];
  all.push(
    ...(await each(
      'relativeWhen',
      [
        ...OFFSETS.map((ms) => ({
          iso: new Date(NOW + ms).toISOString(),
          now: NOW,
        })),
        { iso: 'not a date', now: NOW },
        { iso: undefined, now: NOW },
        { iso: null, now: NOW },
        { iso: NOW + 3600000, now: NOW },
        { iso: '2026-03-08T13:00:00', now: NOW, tz: 'America/New_York' },
      ],
      (i) => inZone(i.tz || 'UTC', () => relativeWhen(i.iso, i.now)),
    )),
  );
  const withText = (text) => ({ payload: { posts: [{ record: { text } }] } });
  all.push(
    ...(await each(
      'postSnippet',
      [
        {
          row: {
            payload: {
              posts: [
                { record: { text: 'first' } },
                { record: { text: 'second' } },
              ],
            },
          },
        },
        { row: withText('a'.repeat(80)), max: 10 },
        { row: withText('short'), max: 10 },
        { row: withText('   ') },
        { row: {} },
        { row: null },
        { row: withText('  padded  ') },
        { row: withText('x'.repeat(60)) },
        { row: withText('x'.repeat(61)) },
        { row: withText('😀'.repeat(40)), max: 10 },
        { row: withText('ab😀cd'), max: 3 },
        { row: withText('é́ 👩‍🔬 text'), max: 4 },
        { row: withText('   spaced ﻿') },
        { row: withText(''), max: 0 },
        { row: withText('abc'), max: 0 },
        { row: { payload: { posts: [] } } },
        { row: { payload: { posts: [{}] } } },
      ],
      (i) => postSnippet(i.row, i.max),
    )),
  );
  const MOVE_NOW = at('2026-03-09T08:59:30.000Z');
  all.push(
    ...(await each(
      'queueSlotMoveNote',
      [
        {
          row: { queued: true, scheduledFor: '2026-03-09T09:00:00.000Z' },
          when: '2026-03-09T17:00:00.000Z',
        },
        {
          row: { queued: true, scheduledFor: '2026-03-09T09:00:00.000Z' },
          when: '2026-03-12T17:00:00.000Z',
        },
        {
          row: { queued: true, scheduledFor: '2026-03-09T09:00:00.000Z' },
          when: '2026-03-09T09:00:00.000Z',
        },
        {
          row: { queued: true, scheduledFor: '2026-03-09T09:05:00.000Z' },
          when: '2026-03-09T17:00:00.000Z',
        },
        {
          row: { queued: true, scheduledFor: '2026-03-09T09:00:00.000Z' },
          when: 'junk',
        },
        {
          row: { queued: true, scheduledFor: '2026-03-09T09:00:00.000Z' },
          when: null,
        },
        {
          row: { queued: true, scheduledFor: '2026-03-09T09:00:00.000Z' },
          when: '2026-03-09T17:00:00.000Z',
          minLeadMs: 0,
        },
        {
          row: { queued: true, scheduledFor: '2026-03-09T09:00:00.000Z' },
          when: '2026-03-09T17:00:00.000Z',
          minLeadMs: 3600000,
        },
        {
          row: { queued: true, scheduledFor: 'junk' },
          when: '2026-03-09T17:00:00.000Z',
        },
        { row: { queued: true }, when: '2026-03-09T17:00:00.000Z' },
        {
          row: { queued: false, scheduledFor: '2026-03-09T09:00:00.000Z' },
          when: '2026-03-09T17:00:00.000Z',
        },
        { row: null, when: '2026-03-09T17:00:00.000Z' },
        {
          row: { queued: true, scheduledFor: '2026-03-09T03:59:00' },
          when: '2026-03-09T17:00:00.000Z',
          tz: 'America/New_York',
        },
      ].map((c) => ({ ...c, now: MOVE_NOW })),
      (i) =>
        inZone(i.tz || 'UTC', () =>
          queueSlotMoveNote(
            i.row,
            i.when === null ? null : new Date(i.when),
            new Date(i.now),
            ...(i.minLeadMs === undefined ? [] : [i.minLeadMs]),
          ),
        ),
    )),
  );
  return all;
}

export default async function cases() {
  return [...(await publishActionCases()), ...(await queueCases())];
}
