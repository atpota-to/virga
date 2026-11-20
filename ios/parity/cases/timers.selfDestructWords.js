// src/posting/timers/selfDestruct.js in words: every phrase and sentence it
// builds (plural, formatLifespan, describeFrom, describeAllow,
// describeEffects, describeClauses, describeDeleteAt, describeWhen,
// describeTimer, timerChipLabel, timeUntil, and the scheduled refusal that
// names a pinned time), word for word. Numbers follow the active locale and
// times the local zone, so those run in several locales (setActiveLocale)
// and zones (inZone), across clock changes and the turn of a year; the Swift
// port takes both as parameters. Swift: VirgaPosting/Timers/SelfDestruct+Words.swift.
//
// Inputs from selfDestruct.test.js and selfDestructGateChange.test.js, over
// the corpus in _timers.js.

import * as SD from '../../../src/posting/timers/selfDestruct.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { each } from './_helpers.js';
import { ZONES, inZone } from './_zones.js';
import {
  GRID_RULES,
  H,
  LIST,
  MIN,
  NOW,
  RULES,
  atClock,
  pick,
} from './_timers.js';

export const sources = ['src/posting/timers/selfDestruct.js'];

const LOCALES = ['en-US', 'en-GB', 'en-IN', 'en-CH', 'en-DE'];

/** Runs `fn` in `locale` and `zone`, then puts the defaults back. */
function inFormats(locale, zone, fn) {
  setActiveLocale(locale);
  try {
    return inZone(zone, fn);
  } finally {
    setActiveLocale(DEFAULT_LOCALE);
  }
}

/** Epoch ms of a wall-clock time in `zone`. */
const local = (zone, y, m, d, h = 0, mi = 0) =>
  inZone(zone, () => new Date(y, m - 1, d, h, mi).getTime());

// Moments to say a time from, as wall-clock times in each zone: the web
// test's noon, the night before the US clocks go forward, the night before
// Europe's go back, the day before the southern changes, and New Year's Eve.
const NOWS = [
  ['noon', [2026, 8, 27, 12, 0]],
  ['before spring forward', [2026, 3, 7, 22, 0]],
  ['before fall back', [2026, 10, 24, 23, 30]],
  ['before the southern change', [2026, 4, 4, 12, 0]],
  ['new year’s eve', [2026, 12, 31, 23, 0]],
];

// Pinned times as [days after now's date, hour, minute], local.
const AHEAD = [
  [0, 23, 30],
  [0, 0, 0],
  [0, 12, 5],
  [1, 0, 0],
  [1, 9, 30],
  [2, 18, 30],
  [6, 23, 59],
  [7, 0, 0],
  [20, 18, 30],
  [-1, 12, 0],
  [-7, 12, 0],
  [400, 9, 0],
];

function deleteAtCases(zones, locales, nows) {
  const out = [];
  for (const zone of zones)
    for (const locale of locales)
      for (const [nn, [y, m, d, h, mi]] of nows) {
        const now = local(zone, y, m, d, h, mi);
        for (const [days, hour, minute] of AHEAD)
          out.push({
            $id: `${zone} ${locale} ${nn} +${days}d ${hour}:${minute}`,
            zone,
            locale,
            now,
            iso: new Date(
              local(zone, y, m, d + days, hour, minute),
            ).toISOString(),
          });
      }
  return out;
}

const SAY_RULES = [
  ...GRID_RULES,
  ...pick(
    'ten minutes',
    'legacy',
    'legacy all',
    'extend, no count',
    'extend, too many',
    'reply limit to nobody',
    'a huge threshold',
    'pinned soon',
    'pinned on the ceiling',
    'pinned with an offset',
  ),
];

/** Rules with a pin a day or so out, for the locale and zone grids. */
const PINNED = (now) => [
  [
    'pinned',
    { enabled: true, deleteAt: new Date(now + 20 * H * 1000).toISOString() },
  ],
  [
    'pinned, unless, extend',
    {
      enabled: true,
      deleteAt: new Date(now + 3 * 24 * H * 1000).toISOString(),
      conditions: {
        clauses: [
          { metric: 'likes', value: 5 },
          { metric: 'quotes', value: 12000, from: { followersOver: 100000 } },
        ],
        onSpare: 'extend',
        maxExtensions: 2,
      },
    },
  ],
  [
    'pinned, only if, gates',
    {
      enabled: true,
      deleteAt: new Date(now + 9 * 24 * H * 1000).toISOString(),
      conditions: {
        sense: 'onlyIf',
        logic: 'all',
        clauses: [
          {
            metric: 'quotes',
            value: 1500,
            from: { notFollowed: true, followersOver: 1234567, match: 'all' },
          },
          { metric: 'selfReplies', value: 1 },
        ],
      },
      effects: [
        {
          action: 'limitReplies',
          allow: ['mention', { list: LIST, name: 'Pals' }],
        },
        { action: 'disableQuotes' },
      ],
    },
  ],
  ['a length', { enabled: true, lifespanSeconds: 90 * MIN }],
];

export default async function cases() {
  const out = [];
  const add = async (fn, inputs, compute) =>
    out.push(...(await each(fn, inputs, compute)));

  // ---- phrases --------------------------------------------------------------

  const NOUNS = [
    'like',
    'reply',
    'reply of your own',
    'repost',
    'quote',
    'minute',
    'hour',
    'day',
    'time',
  ];
  const plurals = [];
  for (const noun of NOUNS)
    for (const n of [0, 1, 2, 3, 11, 21, 1.5, -1, 1e21, 0.000001, 1000000])
      plurals.push({ n, noun });
  await add('plural', plurals, ({ n, noun }) => SD.plural(n, noun));

  const LENGTHS = [
    1,
    300,
    600,
    1800,
    2700,
    3600,
    4799,
    4800,
    5399,
    5400,
    5401,
    7200,
    6000,
    71700,
    21600,
    43200,
    86400,
    90000,
    172799,
    172800,
    259200,
    450000,
    453600,
    604800,
    2592000,
    1e12,
    4000.7,
    '3600',
    'nonsense',
    null,
    [7200],
  ];
  await add(
    'formatLifespan',
    [{ $id: 'undefined' }, ...LENGTHS.map((seconds) => ({ seconds }))],
    ({ seconds }) => SD.formatLifespan(seconds),
  );

  const FROMS = [
    undefined,
    null,
    {},
    { notFollowed: true },
    { followersOver: 10000 },
    { notFollowed: true, followersOver: 10000 },
    { notFollowed: true, followersOver: 10000, match: 'all' },
    { followersOver: 100000, match: 'all' },
    { followersOver: 1234567 },
    { followersOver: 1000 },
    { followersOver: 0, notFollowed: false },
    { followersOver: 1234.5678 },
    { followersOver: '5000', notFollowed: 1 },
    { followersOver: [12, 34] },
    { followersOver: true },
    { match: 'all' },
    'friends',
  ];
  const fromCases = [];
  for (const locale of LOCALES)
    FROMS.forEach((from, i) =>
      fromCases.push({
        $id: `${locale} #${i + 1}`,
        locale,
        clause: { metric: 'quotes', value: 3, from },
      }),
    );
  fromCases.push({ $id: 'no clause', locale: 'en-US' });
  await add('describeFrom', fromCases, ({ locale, clause }) =>
    inFormats(locale, 'UTC', () => SD.describeFrom(clause)),
  );

  await add(
    'describeAllow',
    [
      { $id: 'undefined' },
      { entries: null },
      { entries: [] },
      { entries: ['follower'] },
      { entries: ['follower', 'following'] },
      { entries: ['follower', 'following', 'mention'] },
      { entries: [{ list: LIST, name: 'Pals' }] },
      { entries: [{ list: LIST }, 'mention', { list: LIST, name: '' }] },
      {
        entries: [
          'everyone',
          'Follower',
          null,
          5,
          {},
          { list: '' },
          { name: 'x' },
        ],
      },
      { entries: [{ list: LIST, name: 7 }, { list: 3 }, true, []] },
      { entries: 'follower' },
    ],
    ({ entries }) => SD.describeAllow(entries),
  );
  const EFFECTS = [
    undefined,
    [],
    [{ action: 'delete' }],
    [{ action: 'limitReplies', allow: ['follower'] }],
    [{ action: 'limitReplies', allow: [] }],
    [{ action: 'limitReplies' }],
    [{ action: 'disableQuotes' }, { action: 'delete' }],
    [
      { action: 'delete' },
      { action: 'disableQuotes' },
      {
        action: 'limitReplies',
        allow: ['mention', { list: LIST, name: 'Ünïcödé Ⅻ' }],
      },
    ],
    [
      { action: 'limitReplies', allow: ['following'] },
      { action: 'disableQuotes' },
    ],
    [{ action: 'archive' }],
  ];
  await add(
    'describeEffects',
    EFFECTS.map((effects) => ({ effects })),
    ({ effects }) => SD.describeEffects(effects),
  );

  const clauseCases = [];
  for (const [name, timer] of RULES)
    if (timer && typeof timer === 'object' && timer.conditions)
      clauseCases.push({
        $id: name,
        locale: 'en-US',
        conditions: timer.conditions,
      });
  clauseCases.push(
    { $id: 'nothing', locale: 'en-US', conditions: {} },
    {
      $id: 'any',
      locale: 'en-US',
      conditions: {
        logic: 'any',
        clauses: [
          { metric: 'likes', value: 5 },
          { metric: 'replies', value: 2 },
        ],
      },
    },
    {
      $id: 'all',
      locale: 'en-US',
      conditions: {
        logic: 'all',
        clauses: [
          { metric: 'likes', value: 5 },
          { metric: 'replies', value: 2 },
        ],
      },
    },
    {
      $id: 'one reply',
      locale: 'en-US',
      conditions: { clauses: [{ metric: 'replies', value: 1 }] },
    },
    {
      $id: 'more than',
      locale: 'en-US',
      conditions: { clauses: [{ metric: 'replies', op: 'gt', value: 5 }] },
    },
  );
  for (const locale of LOCALES)
    clauseCases.push({
      $id: `filters, ${locale}`,
      locale,
      conditions: {
        logic: 'all',
        clauses: [
          {
            metric: 'quotes',
            value: 10,
            from: { notFollowed: true, followersOver: 10000 },
          },
          {
            metric: 'quotes',
            value: 2500,
            op: 'gt',
            from: { followersOver: 1000000, match: 'all' },
          },
          { metric: 'likes', value: 999999 },
        ],
      },
    });
  await add('describeClauses', clauseCases, ({ locale, conditions }) =>
    inFormats(locale, 'UTC', () => SD.describeClauses(conditions)),
  );

  // ---- a pinned time ------------------------------------------------------------

  await add(
    'describeDeleteAt',
    [
      ...deleteAtCases(ZONES, ['en-US'], NOWS),
      ...deleteAtCases(
        ['UTC', 'Asia/Kolkata'],
        LOCALES.slice(1),
        NOWS.slice(0, 1),
      ),
      {
        $id: 'unreadable',
        zone: 'UTC',
        locale: 'en-US',
        now: NOW,
        iso: 'not a date',
      },
      { $id: 'empty', zone: 'UTC', locale: 'en-US', now: NOW, iso: '' },
      {
        $id: 'local text',
        zone: 'America/New_York',
        locale: 'en-US',
        now: NOW,
        iso: '2026-08-28T09:00',
      },
      {
        $id: 'an offset',
        zone: 'Asia/Kolkata',
        locale: 'en-GB',
        now: NOW,
        iso: '2026-08-27T23:30:00-04:00',
      },
      {
        $id: 'now unreadable',
        zone: 'UTC',
        locale: 'en-US',
        now: NaN,
        iso: '2026-08-28T09:00:00Z',
      },
    ],
    ({ zone, locale, now, iso }) =>
      inFormats(locale, zone, () => SD.describeDeleteAt(iso, now)),
  );

  // ---- sentences over the corpus ------------------------------------------------

  const ruleCases = [];
  for (const [name, timer] of SAY_RULES)
    ruleCases.push({
      $id: name,
      zone: 'UTC',
      locale: 'en-US',
      now: NOW,
      timer,
    });
  const gridCases = [];
  for (const zone of ['UTC', 'America/New_York', 'Pacific/Chatham'])
    for (const locale of zone === 'UTC' ? LOCALES : ['en-US', 'en-IN'])
      for (const [nn, [y, m, d, h, mi]] of [NOWS[0], NOWS[1], NOWS[4]]) {
        const now = local(zone, y, m, d, h, mi);
        for (const [name, timer] of PINNED(now))
          gridCases.push({
            $id: `${name}, ${zone} ${locale} ${nn}`,
            zone,
            locale,
            now,
            timer,
          });
      }

  await add(
    'describeWhen',
    [...ruleCases, ...gridCases],
    ({ zone, locale, now, timer }) =>
      inFormats(locale, zone, () => SD.describeWhen(timer, now)),
  );
  const timerCases = [];
  for (const c of ruleCases)
    for (const from of [undefined, 'goesUp', 'wentUp', 'now', 'bogus'])
      timerCases.push({ ...c, $id: `${c.$id} / ${from}`, from });
  await add(
    'describeTimer',
    [...timerCases, ...gridCases],
    ({ zone, locale, now, timer, from }) =>
      inFormats(locale, zone, () =>
        SD.describeTimer(timer, now, from === undefined ? undefined : { from }),
      ),
  );
  await add(
    'describeTimer (no options)',
    ruleCases.slice(0, 8),
    ({ zone, locale, now, timer }) =>
      inFormats(locale, zone, () => SD.describeTimer(timer, now)),
  );
  await add(
    'timerChipLabel',
    [...ruleCases, ...gridCases],
    ({ zone, locale, now, timer }) =>
      inFormats(locale, zone, () => SD.timerChipLabel(timer, now)),
  );
  // The gate-change sentences of selfDestructGateChange.test.js.
  const off = SD.normalizeTimer({ enabled: false });
  await add(
    'describeTimer (gate changes)',
    [
      { $id: 'armed from nothing', steps: [['limitReplies', true]] },
      {
        $id: 'from a stale rule',
        start: {
          enabled: false,
          lifespanSeconds: 3600,
          deleteAt: new Date(NOW + 3 * H * 1000).toISOString(),
          conditions: {
            sense: 'onlyIf',
            clauses: [{ metric: 'replies', op: 'gt', value: 5 }],
            onSpare: 'extend',
            maxExtensions: 3,
          },
        },
        steps: [['limitReplies', true]],
      },
      {
        $id: 'beside a live delete',
        start: {
          enabled: true,
          conditions: { clauses: [{ metric: 'likes', value: 5 }] },
        },
        steps: [
          ['disableQuotes', true],
          ['limitReplies', true],
        ],
      },
    ].map((c) => ({ ...c, zone: 'UTC', locale: 'en-US', now: NOW })),
    ({ start, steps, now }) =>
      SD.describeTimer(
        steps.reduce(
          (t, [action, on]) => SD.withScheduledGateChange(t, action, on),
          start ? SD.normalizeTimer(start) : off,
        ),
        now,
      ),
  );

  // ---- countdown --------------------------------------------------------------

  const untilCases = [];
  const U = [
    -8 * MIN,
    0,
    10,
    30,
    31,
    89,
    90,
    29.9 * MIN,
    30 * MIN,
    59 * MIN,
    59.5 * MIN,
    60 * MIN,
    89 * MIN,
    90 * MIN,
    3 * H,
    23 * H,
    23.5 * H,
    24 * H,
    47 * H,
    2 * 24 * H,
    35.9 * 24 * H,
    400 * 24 * H,
  ];
  for (const seconds of U)
    untilCases.push({
      $id: `+${seconds}s`,
      zone: 'UTC',
      now: NOW,
      iso: new Date(NOW + seconds * 1000).toISOString(),
    });
  untilCases.push(
    { $id: 'unreadable', zone: 'UTC', now: NOW, iso: 'not a date' },
    { $id: 'null', zone: 'UTC', now: NOW, iso: null },
    { $id: 'undefined', zone: 'UTC', now: NOW },
    { $id: 'a number', zone: 'UTC', now: NOW, iso: NOW + 3 * H * 1000 },
    { $id: 'an array', zone: 'UTC', now: NOW, iso: ['2026-08-28T12:00:00Z'] },
    {
      $id: 'now unreadable',
      zone: 'UTC',
      now: NaN,
      iso: '2026-08-28T12:00:00Z',
    },
  );
  for (const zone of [
    'America/New_York',
    'Asia/Kolkata',
    'Australia/Lord_Howe',
  ])
    untilCases.push({
      $id: `local text in ${zone}`,
      zone,
      now: NOW,
      iso: '2026-08-27T18:00:00',
    });
  await add('timeUntil', untilCases, ({ zone, now, iso }) =>
    inZone(zone, () => SD.timeUntil(iso, now)),
  );

  // ---- the scheduled refusal, which names the pin -------------------------------

  const refusals = [];
  for (const zone of [
    'UTC',
    'America/New_York',
    'Asia/Kolkata',
    'Pacific/Chatham',
  ])
    for (const locale of zone === 'UTC' ? LOCALES : ['en-US'])
      for (const [nn, [y, m, d, h, mi]] of [NOWS[0], NOWS[1]]) {
        const clock = local(zone, y, m, d, h, mi);
        for (const [pn, offset] of [
          ['before', -H],
          ['too soon', 4 * MIN],
          ['ok', 5 * H],
          ['too late', 31 * 24 * H],
        ])
          for (const [en, effects] of [
            ['delete', undefined],
            ['gates', [{ action: 'disableQuotes' }]],
          ]) {
            const publishAt = clock + 26 * H * 1000;
            refusals.push({
              $id: `${zone} ${locale} ${nn} ${pn} ${en}`,
              zone,
              locale,
              clock,
              publishAt,
              timer: {
                enabled: true,
                deleteAt: new Date(publishAt + offset * 1000).toISOString(),
                effects,
              },
            });
          }
      }
  await add(
    'scheduledTimerProblem',
    refusals,
    ({ zone, locale, clock, publishAt, timer }) =>
      inFormats(locale, zone, () =>
        atClock(clock, () => SD.scheduledTimerProblem(timer, publishAt)),
      ),
  );

  // ---- a pin without an offset, read in the zone it is said in -----------------
  // A rule straight from a date-time picker (or a stored record) can pin a
  // wall-clock time with no offset; the web reads it in the browser's zone,
  // the same zone it says the time in.

  const LOCAL_PINS = [
    '2026-08-27T23:30',
    '2026-08-28T09:00:00',
    '2026-08-30T18:30:00.000',
    'Aug 29 2026 07:15',
  ];
  const localPins = [];
  for (const zone of [
    'UTC',
    'America/New_York',
    'Asia/Kolkata',
    'Pacific/Chatham',
  ])
    for (const deleteAt of LOCAL_PINS)
      for (const [pn, publishAt] of [
        ['after the pin', NOW + 20 * H * 1000],
        ['a month before', NOW - 31 * 24 * H * 1000],
      ])
        localPins.push({
          $id: `${zone} ${deleteAt} ${pn}`,
          zone,
          locale: 'en-US',
          now: NOW,
          clock: NOW,
          publishAt,
          timer: {
            enabled: true,
            deleteAt,
            conditions: {
              clauses: [{ metric: 'likes', value: 3 }],
              onSpare: 'extend',
            },
          },
        });
  const once = localPins.filter((c) => c.$id.endsWith('after the pin'));
  await add('describeWhen (local pins)', once, ({ zone, locale, now, timer }) =>
    inFormats(locale, zone, () => SD.describeWhen(timer, now)),
  );
  await add(
    'describeTimer (local pins)',
    once,
    ({ zone, locale, now, timer }) =>
      inFormats(locale, zone, () => SD.describeTimer(timer, now)),
  );
  await add(
    'timerChipLabel (local pins)',
    once,
    ({ zone, locale, now, timer }) =>
      inFormats(locale, zone, () => SD.timerChipLabel(timer, now)),
  );
  await add(
    'scheduledTimerProblem (local pins)',
    localPins,
    ({ zone, locale, clock, publishAt, timer }) =>
      inFormats(locale, zone, () =>
        atClock(clock, () => SD.scheduledTimerProblem(timer, publishAt)),
      ),
  );

  return out;
}
