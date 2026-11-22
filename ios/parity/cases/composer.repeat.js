// src/posting/schedule/repeat.js: repeating posts (normalizing, the
// problems, anchoring, when each occurrence falls, the words). Swift:
// VirgaPosting/Schedule/Repeat.swift.
//
// The repeat math is time-zone work: cases run over ZONES and the
// zones with a clock change, across each change (spring forward into a gap,
// fall back into an overlap, Lord Howe's half hour, Chatham's 2:45), with
// local times read in the zone the case names (`tz`). Inputs are the
// modules' own tests' plus loose and malformed shapes.

import {
  REPEAT_EVERY,
  MAX_REPEAT_COUNT,
  REPEAT_OPTIONS,
  REPEAT_REPLY_HINT,
  REPEAT_QUEUE_HINT,
  normalizeRepeat,
  repeatEnds,
  repeatProblem,
  repeatForServer,
  anchoredRepeat,
  occurrenceTime,
  nextOccurrence,
  repeatLabel,
  repeatProgress,
  repeatSummary,
  repeatClause,
  rowRepeat,
} from '../../../src/posting/schedule/repeat.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { each, value, inZone, ZONES } from './_helpers.js';
import { atNow } from './_composer.js';

export const sources = ['src/posting/schedule/repeat.js'];

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

const at = (s) => Date.parse(s);

// ---- repeats ---------------------------------------------------------------

const stored = (every, date, time, tz, extra = {}) => ({
  every,
  tz,
  until: null,
  count: null,
  anchor: { date, time, occurrence: 1 },
  ...extra,
});

const RAW_RULES = [
  null,
  undefined,
  '',
  'week',
  5,
  [],
  {},
  { every: 'year' },
  { every: 'week' },
  { every: 'day', count: 5 },
  { every: 'day', count: '5' },
  { every: 'day', count: 1 },
  { every: 'day', count: 0 },
  { every: 'day', count: -2 },
  { every: 'day', count: 2.5 },
  { every: 'day', count: true },
  { every: 'day', count: [3] },
  { every: 'day', count: '' },
  { every: 'day', count: null },
  { every: 'day', count: 'x' },
  { every: 'day', count: 401 },
  { every: 'day', count: 1e21 },
  { every: 'day', until: '2026-12-01' },
  { every: 'day', until: '2026-02-30' },
  { every: 'day', until: '2026-2-3' },
  { every: 'day', until: 'soon' },
  { every: 'day', until: ['2026-12-01'] },
  { every: 'day', until: '' },
  { every: 'day', count: 3, until: '2026-12-01' },
  { every: 'day', ends: 'on', until: '2026-12-01', count: 4 },
  { every: 'day', ends: 'after', until: '2026-12-01', count: 4 },
  { every: 'day', ends: 'on', until: '' },
  { every: 'day', ends: 'after', count: '' },
  { every: 'day', ends: 'after' },
  { every: 'day', ends: 'never', count: 3 },
  { every: '2weeks', until: '2026-11-15' },
  { every: 'month', count: 12 },
  { every: 'Week' },
  stored('month', '2026-01-31', '09:00', 'UTC', { count: 12 }),
  stored('week', '2026-01-05', '09:00', 'UTC'),
  stored('day', '2026-01-05', '09:00', 'UTC', { until: '2026-01-20' }),
];

const OCCURRENCE_RULES = [
  ['daily-paris', stored('day', '2026-10-24', '09:00', 'Europe/Paris')],
  ['daily-ny-gap', stored('day', '2026-03-07', '02:30', 'America/New_York')],
  [
    'daily-ny-overlap',
    stored('day', '2026-10-31', '01:30', 'America/New_York'),
  ],
  [
    'weekly-lord-howe',
    stored('week', '2026-09-27', '02:15', 'Australia/Lord_Howe'),
  ],
  [
    'fortnight-chatham',
    stored('2weeks', '2026-09-13', '02:50', 'Pacific/Chatham'),
  ],
  ['monthly-31st', stored('month', '2026-01-31', '09:00', 'UTC')],
  ['monthly-29th-leap', stored('month', '2027-12-29', '23:30', 'Asia/Kolkata')],
  ['monthly-dec', stored('month', '2026-11-30', '09:00', 'UTC')],
  [
    'anchored-3',
    stored('week', '2026-11-16', '09:00', 'UTC', {
      anchor: { date: '2026-11-16', time: '09:00', occurrence: 3 },
    }),
  ],
  [
    'anchor-occurrence-0',
    stored('week', '2026-11-16', '09:00', 'UTC', {
      anchor: { date: '2026-11-16', time: '09:00', occurrence: 0 },
    }),
  ],
  [
    'anchor-occurrence-text',
    stored('week', '2026-11-16', '09:00', 'UTC', {
      anchor: { date: '2026-11-16', time: '09:00', occurrence: '2' },
    }),
  ],
  ['bad-zone', stored('day', '2026-11-16', '09:00', 'Nowhere/Land')],
  ['no-zone', stored('day', '2026-11-16', '09:00', '')],
  ['bad-time', stored('day', '2026-11-16', '9:00', 'UTC')],
  ['bad-date', stored('day', '2026-11-31', '09:00', 'UTC')],
  ['no-anchor', { every: 'day', tz: 'UTC' }],
  ['bad-every', stored('year', '2026-11-16', '09:00', 'UTC')],
  ['null', null],
  ['old-year', stored('day', '0050-01-01', '09:00', 'UTC')],
];

async function repeatCases() {
  const all = [
    value('repeatConstants', {
      REPEAT_EVERY,
      MAX_REPEAT_COUNT,
      REPEAT_OPTIONS,
      REPEAT_REPLY_HINT,
      REPEAT_QUEUE_HINT,
    }),
  ];
  all.push(
    ...(await each(
      'normalizeRepeat',
      RAW_RULES.map((raw) => ({ raw })),
      (i) => normalizeRepeat(i.raw),
    )),
    ...(await each(
      'repeatEnds',
      RAW_RULES.map((raw) => ({ raw })),
      (i) => repeatEnds(i.raw),
    )),
  );
  const problemInputs = [];
  const ATS = ['2026-11-16T09:00:00.000Z', '2026-11-16T09:00:00', 'junk', null];
  for (const raw of RAW_RULES)
    for (const atValue of ATS.slice(0, 2))
      problemInputs.push({
        raw,
        at: atValue,
        zone: 'UTC',
        tz: 'America/New_York',
      });
  for (const raw of RAW_RULES.filter((r) => r?.until))
    for (const atValue of ATS)
      for (const zone of ['Pacific/Honolulu', 'Pacific/Chatham'])
        problemInputs.push({ raw, at: atValue, zone, tz: 'Pacific/Chatham' });
  for (const occurrence of [1, 2, 5, 400, 0.5, -1])
    for (const raw of [
      { every: 'day', count: 3 },
      { every: 'day', count: 5 },
      { every: 'day', count: 400 },
      { every: 'day', until: '2026-11-15' },
    ])
      problemInputs.push({
        raw,
        at: ATS[0],
        zone: 'UTC',
        tz: 'UTC',
        occurrence,
      });
  for (const raw of [
    { every: 'day', until: '2026-11-15' },
    { every: 'day', until: '2026-11-16' },
    { every: 'day', until: ['2026-11-15'] },
    { every: 'day', until: '2026-11-15', ends: 'after', count: 3 },
  ])
    for (const zone of [
      'UTC',
      'Pacific/Honolulu',
      'Pacific/Kiritimati',
      'Nowhere/Land',
    ])
      problemInputs.push({ raw, at: ATS[0], zone, tz: 'UTC' });
  all.push(
    ...(await each('repeatProblem', problemInputs, (i) =>
      inZone(i.tz, () =>
        repeatProblem(
          i.raw,
          i.at,
          i.zone,
          i.occurrence === undefined ? undefined : { occurrence: i.occurrence },
        ),
      ),
    )),
  );
  all.push(
    ...(await each(
      'repeatForServer',
      [
        ...RAW_RULES.map((raw) => ({ raw, zone: 'Europe/Paris' })),
        { raw: { every: 'week', count: 6 }, zone: 'Europe/Paris' },
        { raw: { every: 'week', count: 6 } },
        { raw: { every: 'week' }, zone: null },
      ],
      (i) => repeatForServer(i.raw, i.zone),
    )),
  );
  const anchorInputs = [];
  for (const raw of [
    { every: 'week', count: 4 },
    { every: 'day', until: '2026-12-01' },
    { every: 'month' },
    null,
    { every: 'fortnight' },
  ])
    for (const atValue of [
      '2026-11-16T09:00:00.000Z',
      '2026-03-08T07:30:00.000Z',
      '2026-11-16T09:00:00',
      'junk',
    ])
      for (const zone of [
        'UTC',
        'America/New_York',
        'Australia/Lord_Howe',
        'Nowhere/Land',
      ])
        anchorInputs.push({ raw, at: atValue, zone, tz: 'Asia/Kolkata' });
  for (const occurrence of [2, 0, '3', null])
    anchorInputs.push({
      raw: { every: 'week', count: 4 },
      at: '2026-11-16T09:00:00.000Z',
      zone: 'America/New_York',
      tz: 'UTC',
      occurrence,
    });
  all.push(
    ...(await each('anchoredRepeat', anchorInputs, (i) =>
      inZone(i.tz, () =>
        i.occurrence === undefined
          ? anchoredRepeat(i.raw, i.at, i.zone)
          : anchoredRepeat(i.raw, i.at, i.zone, i.occurrence),
      ),
    )),
  );
  const occInputs = [];
  for (const [rid, rule] of OCCURRENCE_RULES)
    for (const k of [1, 2, 3, 4, 5, 13, 0, 2.5, '2', null, 100])
      occInputs.push({ $id: `${rid}/${JSON.stringify(k)}`, rule, k });
  // Every zone, across its spring and autumn changes (the southern ones
  // change the other way round).
  for (const zone of ALL_ZONES)
    for (const [date, time] of [
      ['2026-03-06', '02:30'],
      ['2026-03-27', '01:30'],
      ['2026-10-23', '02:15'],
      ['2026-09-25', '02:50'],
      ['2026-04-03', '02:30'],
    ])
      for (const k of [1, 2, 3, 4])
        occInputs.push({
          $id: `${zone}/${date}/${time}/${k}`,
          rule: stored('day', date, time, zone),
          k,
        });
  all.push(
    ...(await each('occurrenceTime', occInputs, (i) =>
      occurrenceTime(i.rule, i.k),
    )),
  );
  const nextInputs = [];
  const NEXT_NOWS = [
    0,
    at('2026-11-02T09:01:00Z'),
    at('2026-11-10T00:00:00Z'),
    at('2027-06-01T00:00:00Z'),
    at('2040-01-01T00:00:00Z'),
  ];
  const nextRules = [
    ...OCCURRENCE_RULES,
    [
      'weekly-count-3',
      stored('week', '2026-11-02', '09:00', 'UTC', { count: 3 }),
    ],
    [
      'weekly-until',
      stored('week', '2026-11-02', '09:00', 'UTC', { until: '2026-11-08' }),
    ],
    [
      'weekly-until-equal',
      stored('week', '2026-11-02', '09:00', 'UTC', { until: '2026-11-09' }),
    ],
    [
      'count-text',
      stored('week', '2026-11-02', '09:00', 'UTC', { count: '3' }),
    ],
    ['daily-forever', stored('day', '2026-11-02', '09:00', 'UTC')],
  ];
  for (const [rid, rule] of nextRules)
    // A daily series far behind its clock walks every missed slot: one case
    // of that (below) is enough.
    for (const [ni, nowMs] of NEXT_NOWS.slice(
      0,
      rid === 'old-year' ? 1 : rule?.every === 'day' ? 3 : 4,
    ).entries())
      for (const occurrence of [1, 3])
        nextInputs.push({
          $id: `${rid}/${ni}/${occurrence}`,
          rule,
          occurrence,
          now: nowMs,
        });
  for (const [rid, rule] of nextRules.slice(-6))
    for (const occurrence of [0, 'x', 1e300, 2.5])
      nextInputs.push({
        $id: `${rid}/0/${occurrence}`,
        rule,
        occurrence,
        now: NEXT_NOWS[0],
      });
  // Past every missed slot it looks at.
  for (const [rid, rule] of [nextRules.at(-1)])
    nextInputs.push({
      $id: `${rid}/far`,
      rule,
      occurrence: 1,
      now: NEXT_NOWS[4],
    });
  all.push(
    ...(await each('nextOccurrence', nextInputs, (i) =>
      nextOccurrence(i.rule, i.occurrence, i.now),
    )),
  );

  all.push(
    ...(await each(
      'repeatLabel',
      [
        ...REPEAT_EVERY.map((every) => ({ raw: every })),
        ...REPEAT_EVERY.map((every) => ({ raw: { every } })),
        { raw: '' },
        { raw: null },
        { raw: undefined },
        { raw: 'year' },
        { raw: {} },
        { raw: ['week'] },
        { raw: { every: ['week'] } },
      ],
      (i) => repeatLabel(i.raw),
    )),
    ...(await each(
      'repeatClause',
      [
        { raw: { every: 'week' } },
        { raw: { every: '2weeks' } },
        { raw: 'month' },
        { raw: null },
        { raw: { every: 'year' } },
      ],
      (i) => repeatClause(i.raw),
    )),
  );

  // The words that name a date read "this year" off the clock, in the
  // device's zone: the cases hold the clock still.
  const progressInputs = [];
  const PROGRESS_RULES = [
    { every: 'day', count: 10 },
    { every: 'day', count: '10' },
    { every: 'day', count: 10, anchor: { occurrence: 4 } },
    { every: 'day', count: 10, anchor: { occurrence: '4' } },
    { every: 'day', until: '2026-12-05' },
    { every: 'day', until: '2027-01-05' },
    { every: 'day', until: '2026-02-30' },
    { every: 'day', until: 'soon' },
    { every: 'day' },
    null,
  ];
  const CLOCKS = ['2026-11-14T12:00:00.000Z', '2026-12-31T23:30:00.000Z'];
  for (const raw of PROGRESS_RULES)
    for (const occurrence of [3, undefined, 2.5, '3', 0])
      progressInputs.push({
        raw,
        occurrence,
        clock: CLOCKS[0],
        tz: 'UTC',
        locale: 'en-US',
      });
  for (const raw of PROGRESS_RULES.slice(4, 6))
    for (const clock of CLOCKS)
      for (const [tz, locale] of [
        ['Pacific/Chatham', 'en-GB'],
        ['America/New_York', 'en-IN'],
        ['UTC', 'en-DE'],
      ])
        progressInputs.push({ raw, occurrence: 3, clock, tz, locale });
  all.push(
    ...(await each('repeatProgress', progressInputs, (i) =>
      atNow(at(i.clock), () =>
        under(i.tz, i.locale, () => repeatProgress(i.raw, i.occurrence)),
      ),
    )),
  );
  const summaryInputs = [];
  for (const raw of [
    { every: 'week' },
    { every: 'day', count: 5 },
    { every: 'month' },
    { every: 'month', until: '2027-06-30' },
    { every: 'month', until: '2026-12-15' },
    { every: '2weeks', ends: 'after', count: '' },
    null,
    { every: 'year' },
  ])
    for (const atValue of [
      '2027-01-31T09:00:00Z',
      '2027-01-30T09:00:00Z',
      '2027-01-29T09:00:00Z',
      '2027-01-28T09:00:00Z',
      '2027-01-12T09:00:00Z',
      '2027-01-31T23:30:00',
      'junk',
    ])
      summaryInputs.push({
        raw,
        at: atValue,
        zone: 'UTC',
        clock: CLOCKS[0],
        tz: 'UTC',
        locale: 'en-US',
      });
  for (const atValue of [
    '2027-01-31T09:00:00Z',
    '2027-02-01T09:00:00Z',
    '2027-01-29T09:00:00Z',
  ])
    for (const zone of [
      'Pacific/Chatham',
      'America/Los_Angeles',
      'Nowhere/Land',
    ])
      summaryInputs.push({
        raw: { every: 'month' },
        at: atValue,
        zone,
        clock: CLOCKS[0],
        tz: 'UTC',
        locale: 'en-US',
      });
  summaryInputs.push({
    raw: { every: 'day', until: '2026-12-01' },
    at: '2026-11-16T09:00:00Z',
    zone: 'UTC',
    clock: CLOCKS[0],
    tz: 'Pacific/Chatham',
    locale: 'en-GB',
  });
  all.push(
    ...(await each('repeatSummary', summaryInputs, (i) =>
      atNow(at(i.clock), () =>
        under(i.tz, i.locale, () => repeatSummary(i.raw, i.at, i.zone)),
      ),
    )),
  );

  const NOW = at('2026-11-14T12:00:00Z');
  const row = (extra = {}, repeat = {}) => ({
    scheduledFor: '2026-11-16T09:00:00.000Z',
    seriesId: 's',
    occurrence: 3,
    payload: {
      repeat: stored('week', '2026-11-16', '09:00', 'UTC', {
        count: 10,
        anchor: { date: '2026-11-16', time: '09:00', occurrence: 3 },
        ...repeat,
      }),
    },
    ...extra,
  });
  const rowInputs = [
    row(),
    row(
      { occurrence: 10 },
      { anchor: { date: '2026-11-16', time: '09:00', occurrence: 10 } },
    ),
    row({ occurrence: 9 }),
    row({ occurrence: undefined }),
    row({ occurrence: null }),
    row({}, { count: null, until: '2026-11-20' }),
    row({}, { count: null, until: '2026-11-30' }),
    row({}, { count: null }),
    row({ scheduledFor: '2026-12-31T09:00:00.000Z' }, { count: 10 }),
    row({ scheduledFor: null }),
    row({ scheduledFor: '2026-11-16T09:00:00' }),
    { seriesId: 's', occurrence: 2, payload: {} },
    { series_id: 's', payload: { repeat: { every: 'year' } } },
    { payload: {} },
    null,
    { seriesId: '', payload: { repeat: 'week' } },
  ];
  const rowCases = [];
  for (const r of rowInputs)
    for (const tz of ['UTC', 'America/New_York'])
      rowCases.push({ row: r, now: NOW, tz, locale: 'en-US' });
  rowCases.push({
    row: rowInputs[0],
    now: at('2027-03-01T00:00:00Z'),
    tz: 'UTC',
    locale: 'en-GB',
  });
  all.push(
    ...(await each('rowRepeat', rowCases, (i) =>
      atNow(i.now, () => under(i.tz, i.locale, () => rowRepeat(i.row, i.now))),
    )),
  );
  return all;
}

export default async function cases() {
  return repeatCases();
}
