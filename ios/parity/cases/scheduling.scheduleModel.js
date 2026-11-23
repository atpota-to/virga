// src/posting/pages/scheduleModel.js: what the Scheduled, Weekly schedule
// and Timers pages (and the time picker) show. The list's sections, a row's
// facts, tags, state and actions, timer notes, times in the queue's zone,
// reordering, the limits lines, timer rows, the week's summary and edits,
// its open times, the quick picks, and posting a scheduled row now as a
// script against fake deps (each call recorded). Swift:
// VirgaPosting/Pages/ScheduleModel*.swift.
//
// Inputs from scheduleModel.test.js plus loose rows, zones that can't be
// read, clock changes and locales. Local times are read in the zone a case
// names (`tz`); the timer sentences are said against Date.now(), held at
// the case's `now`.

import * as M from '../../../src/posting/pages/scheduleModel.js';
import { DEFAULT_POSTING_QUEUE } from '../../../src/posting/schedule/postingQueue.js';
import { normalizeLimits } from '../../../src/posting/schedule/scheduleService.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { each, inZone, value } from './_helpers.js';
import { atClock } from './_timers.js';

export const sources = ['src/posting/pages/scheduleModel.js'];

const NOW = Date.parse('2026-11-12T12:00:00Z'); // a Thursday
const ZONES = ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Chatham'];

const week = (slots, timezone = 'UTC') => ({
  timezone,
  slots: {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
    ...slots,
  },
});
const row = (id, scheduledFor, extra = {}) => ({
  id,
  scheduledFor,
  status: 'pending',
  queued: true,
  clientKey: 'virga',
  payload: {
    posts: [{ record: { text: `Post ${id}` } }],
    gates: { threadgate: null, postgate: null },
  },
  ...extra,
});

/** Runs `fn` in `tz`, `locale` active, Date.now() at `now`. */
function under(tz, locale, now, fn) {
  return inZone(tz, () => {
    setActiveLocale(locale);
    try {
      return atClock(now, fn);
    } finally {
      setActiveLocale(DEFAULT_LOCALE);
    }
  });
}

/** Every input once in each zone, en-US. */
const zoned = (inputs, zones = ZONES) =>
  zones.flatMap((tz) =>
    inputs.map((input) => ({ tz, locale: 'en-US', ...input })),
  );

// ---- the list ------------------------------------------------------------------

const LIST = [
  row('b', '2026-11-14T09:00:00Z'),
  row('a', '2026-11-13T09:00:00Z'),
  row('t', '2026-11-13T10:00:00Z', { queued: false }),
  row('f', '2026-11-10T10:00:00Z', { status: 'failed', queued: false }),
  row('p', '2026-11-12T12:00:00Z', { status: 'publishing' }),
  row('x', '2026-11-12T12:00:00Z', { status: 'cancelled' }),
  row('local', '2026-11-13T08:00'),
  row('bad', 'whenever'),
  row('f2', '2026-11-09T10:00:00Z', { status: 'failed', queued: true }),
  null,
];

const PARENT = { uri: 'at://did:plc:other/app.bsky.feed.post/3kp', cid: 'c' };
const REPLY = { root: PARENT, parent: PARENT };
const REPEAT = {
  every: 'week',
  tz: 'UTC',
  until: null,
  count: null,
  anchor: { date: '2026-11-13', time: '09:00', occurrence: 1 },
};
const repeating = (extra = {}) =>
  row('r', '2026-11-13T09:00:00Z', {
    queued: false,
    seriesId: 's',
    occurrence: 1,
    payload: { posts: [{ record: { text: 'weekly' } }], repeat: REPEAT },
    ...extra,
  });

const FACT_ROWS = [
  {
    payload: {
      posts: [
        {
          record: { text: '  Hello  ' },
          embed: { type: 'images', images: [{}, {}] },
        },
        {
          record: { text: 'Two' },
          embed: {
            type: 'recordWithMedia',
            uri: 'at://x',
            cid: 'c',
            media: { type: 'external', uri: 'https://e' },
          },
        },
      ],
      gates: { threadgate: [], postgate: null },
      selfDestruct: {
        lifespanSeconds: 3600,
        conditions: {},
        effects: [{ action: 'delete' }],
      },
    },
  },
  {
    payload: {
      posts: [{ record: { text: 'x' } }],
      gates: { threadgate: null, postgate: [] },
    },
  },
  {
    payload: {
      posts: [
        {
          record: { text: 'q' },
          embed: { type: 'record', uri: 'at://x', cid: 'c' },
        },
        {
          record: {},
          embed: {
            type: 'recordWithMedia',
            media: { type: 'images', images: [{}, {}, {}] },
          },
        },
        { record: {}, embed: { type: 'external' } },
        { embed: 'images' },
        { embed: { type: 'images', images: 'abc' } },
        null,
      ],
      gates: { threadgate: null, postgate: [{ $type: 'x' }] },
      selfDestruct: {
        lifespanSeconds: 86400,
        conditions: {
          logic: 'any',
          clauses: [{ metric: 'likes', op: 'lt', value: 10 }],
          sense: 'keepIf',
        },
        effects: [
          { action: 'limitReplies', allow: ['follower'] },
          { action: 'delete' },
        ],
        deleteAt: '2026-11-14T18:00:00.000Z',
      },
    },
  },
  {
    payload: {
      posts: [{ record: { text: 'unreadable timer' } }],
      selfDestruct: { lifespanSeconds: 3600, effects: [{ action: 'explode' }] },
    },
  },
  {
    payload: {
      posts: [{ record: { text: 'yes' } }],
      reply: REPLY,
      replyTo: {
        handle: ' ada.example.com ',
        displayName: 'Ada',
        text: ' two\nlines ',
      },
    },
  },
  {
    payload: {
      posts: [{ record: { text: 'yes' } }],
      reply: REPLY,
      replyTo: { displayName: 'Ada' },
    },
  },
  { payload: { posts: [{ record: { text: 'yes' } }], reply: REPLY } },
  {
    payload: {
      posts: [{ record: { text: 'yes' } }],
      reply: REPLY,
      replyTo: 'nope',
    },
  },
  { payload: { posts: [] } },
  { payload: { posts: 'nope' } },
  null,
  row('a', 'x'),
];

const STATUS_ROWS = [
  { status: 'failed', lastErrorCode: 'SESSION_UNAVAILABLE' },
  { status: 'failed', partial: true, lastErrorCode: 'TIMED_OUT' },
  { status: 'failed', lastError: 'media download failed: Object not found' },
  { status: 'publishing' },
  { status: 'pending', partial: true },
  { status: 'pending', scheduledFor: '2026-11-12T11:00:00Z' },
  { status: 'pending', scheduledFor: '2026-11-12T12:00:00Z' },
  { status: 'pending', scheduledFor: '2026-11-13T11:00:00Z' },
  { status: 'pending', scheduledFor: '2026-11-12T12:00' },
  { status: 'pending', scheduledFor: 'whenever' },
  { status: 'cancelled' },
  null,
];

const ACTION_ROWS = [
  row('a', 'x'),
  { ...row('a', 'x'), clientKey: undefined },
  row('a', 'x', { status: 'failed' }),
  row('a', 'x', { status: 'failed', partial: true }),
  row('a', 'x', { status: 'publishing' }),
  row('due', '2026-11-12T11:59:00Z'),
  row('soon', new Date(NOW + M.POST_NOW_CUTOFF_MS).toISOString()),
  row('later', new Date(NOW + M.POST_NOW_CUTOFF_MS + 60_000).toISOString()),
  row('d', '2026-11-12T09:00:00Z', { status: 'failed' }),
  row('retry', '2026-11-12T11:00:00Z', {
    nextAttemptAt: '2026-11-12T12:30:00Z',
  }),
  row('retry-soon', '2026-11-12T11:00:00Z', {
    nextAttemptAt: '2026-11-12T12:01:00Z',
  }),
  row('retry-earlier', '2026-11-13T11:00:00Z', {
    nextAttemptAt: '2026-11-12T12:01:00Z',
  }),
  row('local', '2026-11-12T13:00'),
  repeating(),
  repeating({ status: 'failed' }),
  repeating({ status: 'publishing' }),
  repeating({ partial: true }),
  row('f', '2026-11-06T09:00:00Z', {
    status: 'failed',
    seriesId: 's',
    occurrence: 1,
  }),
  null,
];

const NOTE = (extra = {}) => ({
  id: 'n1',
  status: 'published',
  lastErrorCode: 'TIMER_NOT_ARMED',
  clientKey: 'virga',
  scheduledFor: '2026-11-11T09:00:00Z',
  resultUri: 'at://did:plc:me/app.bsky.feed.post/r1',
  payload: { posts: [{ record: { text: 'Hi' } }], rkeys: ['r1', 'r2'] },
  ...extra,
});
const NOTES = [
  NOTE(),
  NOTE({ resultUri: null }),
  NOTE({ resultUri: 'at://did:plc:me/app.bsky.feed.repost/r1' }),
  { ...NOTE(), clientKey: undefined },
  NOTE({ payload: { posts: [], rkeys: ['r1', '', 5, 'r3', null, 'r4'] } }),
  NOTE({
    payload: { posts: [{ record: { text: '  spaced  ' } }], rkeys: 'r1' },
  }),
  NOTE({ scheduledFor: undefined }),
  NOTE({ resultUri: 'app.bsky.feed.post' }),
  NOTE({ resultUri: 5 }),
  null,
];

// ---- zones ---------------------------------------------------------------------------

const GROUP_ROWS = [
  row('past', '2026-11-12T11:00:00Z'),
  row('a', '2026-11-12T23:30:00Z'),
  row('b', '2026-11-13T09:00:00Z'),
  row('c', '2026-11-25T09:00:00Z'),
  row('d', '2026-11-16T09:00:00Z'),
  row('e', '2026-11-18T23:00:00Z'),
  row('bad', 'whenever'),
  row('f', '2026-11-19T05:00:00Z'),
  row('g', '2026-11-19T06:00:00Z'),
];

const formatInputs = [];
for (const tz of ['UTC', 'America/New_York']) {
  for (const zone of [
    'America/New_York',
    'UTC',
    'Asia/Tokyo',
    '',
    'Not/AZone',
    null,
  ]) {
    for (const v of [
      '2026-11-13T14:00:00Z',
      '2027-01-13T14:00:00Z',
      '2025-12-31T23:30:00Z',
      'nope',
      '2026-11-13T14:00',
      null,
    ]) {
      formatInputs.push({ tz, locale: 'en-US', value: v, zone, now: NOW });
      formatInputs.push({
        tz,
        locale: 'en-US',
        value: v,
        zone,
        now: NOW,
        weekday: false,
      });
    }
  }
}
for (const locale of ['en-GB', 'en-AU', 'en-FR'])
  formatInputs.push({
    tz: 'UTC',
    locale,
    value: '2026-11-13T14:00:00Z',
    zone: 'Asia/Kolkata',
    now: NOW,
  });
formatInputs.push({
  tz: 'UTC',
  locale: 'en-US',
  value: '2026-01-01T00:30:00Z',
  zone: 'UTC',
  now: Date.parse('2025-12-31T23:30:00Z'),
});

const slotInputs = [
  '17:30',
  '09:00',
  '00:00',
  '12:00',
  '23:59',
  '24:00',
  '99:99',
  '9:00',
  'bad',
  '',
  null,
  5,
  '17:30 ',
  '０９:００',
].map((hhmm) => ({ hhmm }));

// ---- reordering ------------------------------------------------------------------------

const REORDER_ROWS = [
  row('a', '2026-11-13T09:00:00Z'),
  row('x', '2026-11-13T17:00:00Z', { status: 'failed' }),
  row('b', '2026-11-16T09:00:00Z'),
  row('c', '2026-11-16T17:00:00Z'),
];

const previewInputs = [
  { rows: REORDER_ROWS, ids: ['c', 'a', 'b'] },
  { rows: REORDER_ROWS, ids: ['c', 'a'] },
  { rows: REORDER_ROWS, ids: ['c', 'zz', 'a', 'b'] },
  { rows: REORDER_ROWS, ids: ['x', 'c'] },
  { rows: REORDER_ROWS, ids: [] },
  { rows: [], ids: ['a'] },
  {
    rows: [row(1, 'x'), row('1', 'y'), row('dup', 'z'), row('dup', 'w')],
    ids: ['1', 1, 'dup'],
  },
];

const moveInputs = [
  { ids: ['a', 'b', 'c'], id: 'c', delta: -1 },
  { ids: ['a', 'b', 'c'], id: 'a', delta: -1 },
  { ids: ['a', 'b', 'c'], id: 'zz', delta: 1 },
  { ids: ['a', 'b', 'c'], id: 'a', delta: 5 },
  { ids: ['a', 'b', 'c'], id: 'b', delta: 0 },
  { ids: ['a', 'b', 'c'], id: 'a', delta: 1.5 },
  { ids: ['a', 'b', 'c', 'd'], id: 'd', delta: -2.5 },
  { ids: ['a', 'b', 'c'], id: 'b', delta: null },
  { ids: [1, '1', 2], id: '1', delta: 1 },
  { ids: [], id: 'a', delta: 1 },
];
const moveToInputs = [
  { ids: ['a', 'b', 'c'], id: 'a', index: 2 },
  { ids: ['a', 'b', 'c'], id: 'c', index: 0 },
  { ids: ['a', 'b', 'c'], id: 'b', index: 1 },
  { ids: ['a', 'b', 'c'], id: 'b', index: 9 },
  { ids: ['a', 'b', 'c'], id: 'b', index: -3 },
  { ids: ['a', 'b', 'c'], id: 'z', index: 0 },
];

const assignInputs = [
  {
    rows: REORDER_ROWS,
    assignment: [
      { id: 'a', newScheduledFor: '2026-11-20T09:00:00.000Z' },
      { id: 'b', newScheduledFor: null },
      { id: 'zz', newScheduledFor: '2026-11-21T09:00:00.000Z' },
    ],
  },
  { rows: REORDER_ROWS, assignment: null },
  {
    rows: REORDER_ROWS,
    assignment: [
      { id: 'a', newScheduledFor: '2026-11-20T09:00:00.000Z' },
      { id: 'a', newScheduledFor: '2026-11-22T09:00:00.000Z' },
      { id: 'c', newScheduledFor: '' },
    ],
  },
];

// ---- limits -------------------------------------------------------------------------------

const BASE_LIMITS = {
  policy: 'membership',
  features: {
    scheduledPosts: { limit: 3 },
    postTimers: { limit: 1 },
    conditionalTimers: { limit: 1 },
  },
  usage: { scheduledPosts: 2, postTimers: 0, conditionalTimers: 1 },
};
const LIMITS = [
  normalizeLimits(BASE_LIMITS),
  normalizeLimits({ ...BASE_LIMITS, usage: {} }),
  normalizeLimits({
    policy: 'flat',
    features: {
      scheduledPosts: { isUnlimited: true },
      postTimers: { isUnlimited: true },
      conditionalTimers: { isUnlimited: true },
    },
    caps: { scheduledPosts: 50, timers: 200 },
  }),
  normalizeLimits({
    policy: 'membership',
    isMember: true,
    features: { scheduledPosts: { isUnlimited: true } },
  }),
  normalizeLimits({}),
  normalizeLimits({
    features: { scheduledPosts: { limit: 1 }, postTimers: { limit: 2 } },
    usage: { scheduledPosts: 4, postTimers: 2 },
  }),
  normalizeLimits({
    features: { conditionalTimers: { limit: 3 } },
    usage: { conditionalTimers: 5 },
  }),
  null,
  {
    features: { scheduledPosts: { limit: '3' } },
    usage: { scheduledPosts: 1 },
    policy: '',
  },
];
const FALLBACKS = [
  undefined,
  { plain: 1, conditional: 0 },
  { plain: 2 },
  { plain: '1', conditional: 1 },
  null,
];

// ---- timers --------------------------------------------------------------------------------

const LIVE = {
  id: 't1',
  postUri: 'at://did:plc:me/app.bsky.feed.post/3abc',
  snippet: 'A post',
  status: 'armed',
  checkAt: '2026-11-12T16:00:00Z',
  lifespanSeconds: 3600,
  conditions: {
    clauses: [{ metric: 'likes', op: 'gte', value: 5 }],
    sense: 'unless',
  },
  effects: [{ action: 'delete' }],
  extensions: 2,
  clientKey: 'virga',
};
const TIMER_ROWS = [
  LIVE,
  { ...LIVE, status: 'checking' },
  { ...LIVE, extensions: 1, checkAt: '2026-11-12T12:00:10Z' },
  { ...LIVE, extensions: '3', checkAt: 'whenever' },
  {
    ...LIVE,
    status: 'acted',
    resolution: 'limited replies',
    acted: [
      {
        action: 'limitReplies',
        ok: false,
        detail: 'the rule would have opened them up',
      },
      { action: 'disableQuotes', ok: true, detail: '' },
    ],
  },
  {
    ...LIVE,
    status: 'deleted',
    acted: [{ action: 'delete', ok: true, detail: 'deleted' }],
  },
  {
    ...LIVE,
    status: 'deleted',
    acted: [
      { action: 'disableQuotes', ok: true },
      { action: 'delete', ok: true, detail: 'deleted' },
    ],
  },
  {
    ...LIVE,
    status: 'deleted',
    acted: [{ action: 'delete', ok: false, detail: 'post not found.' }],
  },
  {
    ...LIVE,
    status: 'acted',
    acted: [
      { action: 'limitReplies', ok: true, detail: 'limited' },
      { action: 'mystery', ok: true, detail: 'did a thing.' },
      { action: 'mystery', ok: false },
      { action: 'disableQuotes', ok: true, detail: 'DISABLEQUOTES' },
      { action: 'delete', detail: 'Deleted the post' },
      null,
      'nope',
      ['delete'],
    ],
  },
  // A step without an action but with a detail: the web throws reading
  // `entry.action.toLowerCase()`.
  {
    ...LIVE,
    status: 'acted',
    acted: [{ ok: true, detail: 'replies limited' }],
  },
  { ...LIVE, status: 'acted', acted: [{ action: 5, ok: true, detail: 'x' }] },
  {
    ...LIVE,
    status: 'acted',
    acted: [{ action: null, ok: false, detail: 'x' }],
  },
  { ...LIVE, status: 'spared', resolution: 'kept it: 12 likes!' },
  { ...LIVE, status: 'cancelled', resolution: 'ßtraße called off' },
  { ...LIVE, status: 'failed', lastErrorCode: 'ENGAGEMENT_UNAVAILABLE' },
  { ...LIVE, status: 'failed', lastError: 'session expired' },
  {
    ...LIVE,
    status: 'failed',
    lastError: 'rate exceeded',
    lastErrorCode: 'unknown',
  },
  { ...LIVE, status: 'failed', lastErrorCode: 'timed_out' },
  { ...LIVE, status: 'mystery' },
  { ...LIVE, effects: null, conditions: null, lifespanSeconds: 600 },
  { status: 'spared' },
  {},
  null,
];

const friendlyInputs = [
  [null, 'session expired'],
  [null, ''],
  ['SESSION_UNAVAILABLE', ''],
  ['engagement_unavailable', ''],
  [' TIMED_OUT', ''],
  ['REFUSED', 'session'],
  [null, 'Rate limited'],
  [5, 'nothing'],
  ['ſession_unavailable', ''],
].map(([code, raw]) => ({ code, raw }));

const GROUPS = [
  { key: 'live', title: 'Counting down', rows: [{ id: 1 }] },
  { key: 'failed', title: 'Gave up', rows: [{ id: 2 }] },
  { key: 'settled', title: 'Settled', rows: [{ id: 3 }] },
];
const sectionInputs = [
  { groups: GROUPS, waiting: [{ id: 'w' }] },
  { groups: GROUPS.slice(1), waiting: [{ id: 'w' }] },
  { groups: [GROUPS[2]], waiting: [] },
  { groups: [], waiting: [{ id: 'w' }] },
  { groups: [GROUPS[0], { ...GROUPS[0], title: 'Again' }], waiting: [] },
];

// ---- the week --------------------------------------------------------------------------------

const WEEKS = [
  DEFAULT_POSTING_QUEUE,
  week({ sat: ['10:00'], sun: ['10:00'] }),
  week({ mon: ['09:00'], wed: ['09:00'], fri: ['18:00'] }),
  week({ mon: ['09:00'], wed: ['09:00'], fri: ['09:00'] }),
  week({ tue: ['09:00'], wed: ['09:00'], thu: ['09:00'] }),
  week({}),
  week({
    mon: ['09:00', '12:30', '17:00'],
    tue: ['17:00', '09:00', '12:30'],
    sat: ['11:00'],
    sun: ['11:00'],
  }),
  week({
    mon: ['08:00'],
    tue: ['08:00'],
    wed: ['08:00'],
    thu: ['08:00'],
    fri: ['08:00'],
    sat: ['08:00'],
    sun: ['08:00'],
  }),
  week({
    mon: ['08:00'],
    tue: ['08:00'],
    wed: ['08:00'],
    thu: ['08:00'],
    fri: ['08:00'],
    sat: ['09:00'],
    sun: ['09:00'],
  }),
  week({ sun: ['07:00'], mon: ['07:00'], fri: ['07:00'], sat: ['07:00'] }),
  week({ mon: ['bad', '9:5'], thu: ['23:59', null, 7] }),
  null,
  { slots: { mon: ['09:00'] } },
];

const ONE = { timezone: '', slots: week({ mon: ['17:00'] }).slots };
const EMPTY = { timezone: '', slots: week({}).slots };
const editInputs = [
  {
    op: 'add',
    schedule: EMPTY,
    day: 'mon',
    time: '17:00',
    deviceZone: 'Europe/London',
  },
  {
    op: 'add',
    schedule: ONE,
    day: 'mon',
    time: '09:00',
    deviceZone: 'Europe/London',
  },
  { op: 'add', schedule: ONE, day: 'mon', time: '17:00' },
  { op: 'add', schedule: ONE, day: 'mon', time: '9am' },
  { op: 'add', schedule: ONE, day: 'mon', time: '24:00' },
  { op: 'add', schedule: ONE, day: 'mon', time: '23:59' },
  { op: 'add', schedule: ONE, day: 'holiday', time: '10:00' },
  {
    op: 'add',
    schedule: week({ tue: ['18:00'] }, 'Asia/Tokyo'),
    day: 'tue',
    time: '06:30',
  },
  { op: 'add', schedule: null, day: 'wed', time: '06:30', deviceZone: 'UTC' },
  { op: 'add', schedule: EMPTY, day: 'fri', time: '08:15' },
  { op: 'remove', schedule: ONE, day: 'mon', time: '17:00' },
  { op: 'remove', schedule: ONE, day: 'mon', time: '18:00' },
  { op: 'remove', schedule: ONE, day: 'holiday', time: '17:00' },
  {
    op: 'clear',
    schedule: week({ tue: ['08:00'], mon: ['17:00'] }),
    day: 'tue',
  },
  { op: 'clear', schedule: ONE, day: 'holiday' },
  {
    op: 'copy',
    schedule: ONE,
    from: 'mon',
    to: ['mon', 'tue', 'wed', 'thu', 'fri'],
  },
  { op: 'copy', schedule: ONE, from: 'tue', to: ['mon'] },
  {
    op: 'copy',
    schedule: week({ sat: ['10:00'] }, ''),
    from: 'sat',
    to: ['sun', 'holiday'],
  },
  {
    op: 'copy',
    schedule: week({ sat: ['10:00'] }, 'Asia/Tokyo'),
    from: 'sat',
    to: [],
  },
  { op: 'zone', schedule: ONE, timezone: 'Asia/Tokyo' },
  { op: 'zone', schedule: null, timezone: null },
  { op: 'zone', schedule: { timezone: 5, slots: { mon: 'ab' } }, timezone: '' },
];

const OPEN = week({ thu: ['09:00', '17:00'], fri: ['09:00'] });
const openInputs = [
  {
    schedule: OPEN,
    rows: [row('x', '2026-11-12T17:00:00Z', { status: 'failed' })],
    now: NOW,
    count: 3,
  },
  { schedule: OPEN, rows: [], now: NOW, count: 5 },
  { schedule: OPEN, rows: [], now: NOW, count: 0 },
  {
    schedule: OPEN,
    rows: [row('y', '2026-11-13T09:00:30Z'), row('z', 'whenever')],
    now: NOW,
    count: 2,
  },
  { schedule: week({}), rows: [], now: NOW, count: 5 },
  {
    schedule: { slots: { thu: ['12:00', '12:01'] } },
    rows: [],
    now: NOW,
    count: 2,
  },
  {
    schedule: {
      timezone: 'America/New_York',
      slots: { sun: ['01:30', '02:30'] },
    },
    rows: [],
    now: Date.parse('2027-03-12T00:00:00Z'),
    count: 4,
  },
  {
    schedule: { timezone: 'Not/AZone', slots: { mon: ['09:00'] } },
    rows: [],
    now: NOW,
    count: 1,
  },
];

const offInputs = [
  {
    schedule: week({ fri: ['09:00'] }),
    rows: [
      row('on', '2026-11-13T09:00:00Z'),
      row('off', '2026-11-13T10:00:00Z'),
      row('stuck', '2026-11-13T11:00:00Z', { status: 'failed' }),
    ],
  },
  {
    schedule: week({}),
    rows: [
      row('on', '2026-11-13T09:00:00Z'),
      row('off', '2026-11-13T10:00:00Z'),
      row('stuck', '2026-11-13T11:00:00Z', { status: 'failed' }),
    ],
  },
  {
    schedule: week({ thu: ['09:00'], fri: ['09:00'] }),
    rows: [
      row('overdue', '2026-11-12T10:30:00Z'),
      row('on', '2026-11-13T09:00:00Z'),
    ],
  },
  {
    schedule: week({ fri: ['09:00'] }),
    rows: [row('far', '2027-01-15T09:00:00Z'), row('bad', 'whenever')],
  },
  { schedule: week({ fri: ['09:00'] }), rows: [] },
];

// ---- the picker -------------------------------------------------------------------------------

const pickInputs = [];
for (const tz of ZONES) {
  for (const now of [
    NOW,
    Date.parse('2026-11-12T19:00:00Z'),
    Date.parse('2026-11-14T23:50:00Z'),
    Date.parse('2026-11-16T03:00:00Z'),
  ]) {
    pickInputs.push({ tz, now, zone: 'UTC' });
    pickInputs.push({ tz, now, zone: null });
  }
}
pickInputs.push({ tz: 'UTC', now: NOW, zone: 'UTC', max: NOW + 3 * 3600_000 });
pickInputs.push({
  tz: 'UTC',
  now: NOW,
  zone: 'UTC',
  min: NOW + 7 * 86_400_000,
});
pickInputs.push({ tz: 'UTC', now: NOW, zone: 'Asia/Tokyo' });
pickInputs.push({ tz: 'UTC', now: NOW, zone: 'Not/AZone' });
pickInputs.push({
  tz: 'UTC',
  now: Date.parse('2027-03-13T23:00:00Z'),
  zone: 'America/New_York',
});
pickInputs.push({
  tz: 'UTC',
  now: Date.parse('2026-11-01T04:30:00Z'),
  zone: 'America/New_York',
});
pickInputs.push({
  tz: 'UTC',
  now: Date.parse('2026-11-12T12:57:00Z'),
  zone: 'UTC',
});

const whenInputs = [
  null,
  '2026-11-12T11:00:00Z',
  '2026-11-12T12:00:00Z',
  '2026-11-12T12:00:30Z',
  '2026-11-12T12:01:00Z',
  '2027-06-01T00:00:00Z',
  '2026-11-13T12:00:00Z',
  '2026-11-13T12:00',
  'whenever',
  0,
].map((v) => ({ value: v, now: NOW }));
whenInputs.push({
  value: '2026-11-12T13:00:00Z',
  now: NOW,
  min: NOW + 2 * 3600_000,
});
whenInputs.push({
  value: '2026-11-12T13:00:00Z',
  now: NOW,
  max: NOW + 1800_000,
});

// ---- posting a row now -----------------------------------------------------------------------

const SCHEDULED = row('r1', '2026-11-13T09:00:00Z', {
  payload: {
    posts: [{ record: { text: 'Hi' } }],
    gates: { threadgate: null, postgate: null },
    media: {},
    selfDestruct: {
      lifespanSeconds: 3600,
      conditions: {},
      effects: [{ action: 'delete' }],
    },
  },
});
const STATE = {
  posts: [{ text: 'Hi', images: [] }],
  schedule: { mode: 'at', at: 'x' },
  lifespan: { enabled: true },
};
const RESULT = { written: [{ uri: 'at://p' }], root: { uri: 'at://p' } };
const notCancellable = { message: 'x', status: 409, code: 'NOT_CANCELLABLE' };

const postNowScripts = [
  ['posts-cancels-arms', { row: SCHEDULED }],
  ['cancel-retried', { row: SCHEDULED, cancel: [{ message: 'net' }, 'ok'] }],
  [
    'cancel-fails-twice',
    { row: SCHEDULED, cancel: [{ message: 'net' }, { message: 'net again' }] },
  ],
  ['cancel-refused', { row: SCHEDULED, cancel: [notCancellable] }],
  [
    'cancel-409',
    { row: SCHEDULED, cancel: [{ message: 'gone', status: 409 }] },
  ],
  [
    'media-read-first',
    {
      row: {
        ...SCHEDULED,
        payload: { ...SCHEDULED.payload, media: { 'p0-img0': {} } },
      },
      state: {
        posts: [
          {
            images: [
              { id: 'i', file: { $file: true, type: 'image/png', size: 3 } },
            ],
          },
        ],
        lifespan: { enabled: false },
      },
    },
  ],
  [
    'image-gone',
    {
      row: {
        ...SCHEDULED,
        payload: { ...SCHEDULED.payload, media: { 'p0-img0': {} } },
      },
      state: {
        posts: [{ images: [{ id: 'i' }] }],
        lifespan: { enabled: false },
      },
    },
  ],
  [
    'image-by-blob',
    {
      row: SCHEDULED,
      state: {
        posts: [{ images: [{ id: 'i', blob: { ref: 'x' } }] }],
        lifespan: { enabled: false },
      },
    },
  ],
  [
    'media-as-a-string',
    { row: { ...SCHEDULED, payload: { ...SCHEDULED.payload, media: 'x' } } },
  ],
  [
    'media-read-fails',
    {
      row: { ...SCHEDULED, payload: { ...SCHEDULED.payload, media: { a: 1 } } },
      media: 'throw',
    },
  ],
  ['partial', { row: { ...SCHEDULED, partial: true } }],
  ['no-id', { row: { ...SCHEDULED, id: '' } }],
  ['no-row', { row: null }],
  ['publish-fails', { row: SCHEDULED, publish: { throws: 'down' } }],
  [
    'timer-failed',
    {
      row: SCHEDULED,
      arm: { status: 'failed', error: { message: 'No room.' } },
    },
  ],
  ['timer-failed-quietly', { row: SCHEDULED, arm: { status: 'failed' } }],
  ['timer-unconfirmed', { row: SCHEDULED, arm: { status: 'unconfirmed' } }],
  ['timer-none', { row: SCHEDULED, arm: null }],
  ['no-arm-dep', { row: SCHEDULED, noArm: true }],
  [
    'timer-off',
    { row: SCHEDULED, state: { ...STATE, lifespan: { enabled: false } } },
  ],
  ['due', { row: { ...SCHEDULED, scheduledFor: '2026-11-12T11:00:00Z' } }],
  [
    'about-due',
    { row: { ...SCHEDULED, scheduledFor: '2026-11-12T12:01:30Z' } },
  ],
  [
    'failed-row-due',
    {
      row: {
        ...SCHEDULED,
        status: 'failed',
        scheduledFor: '2026-11-12T11:00:00Z',
      },
    },
  ],
  ['emit-throws', { row: SCHEDULED, emit: 'throw' }],
  [
    'no-written',
    { row: SCHEDULED, publish: { result: { root: { uri: 'at://p' } } } },
  ],
  [
    'repeating-skips',
    {
      row: repeating(),
      state: {
        posts: [{ text: 'weekly', images: [] }],
        lifespan: { enabled: false },
      },
      skip: ['ok'],
    },
  ],
  [
    'repeating-skip-refused',
    {
      row: repeating(),
      state: { posts: [], lifespan: { enabled: false } },
      skip: [{ message: 'no', code: 'NOT_SKIPPABLE', status: 409 }],
    },
  ],
  // A code matches by code unit: with a Kelvin sign it isn't a refusal,
  // so the skip is tried again.
  [
    'repeating-skip-kelvin',
    {
      row: repeating(),
      state: { posts: [], lifespan: { enabled: false } },
      skip: [{ message: 'no', code: 'NOT_S\u212AIPPABLE' }, 'ok'],
    },
  ],
  [
    'repeating-no-skip-dep',
    { row: repeating(), state: { posts: [], lifespan: { enabled: false } } },
  ],
  [
    'repeating-failed-cancels',
    {
      row: repeating({ status: 'failed' }),
      state: { posts: [], lifespan: { enabled: false } },
      skip: ['ok'],
    },
  ],
];

/** postScheduledNow over scripted deps, every call recorded. */
async function postNow(script) {
  const calls = [];
  const cancels = [...(script.cancel || ['ok'])];
  const skips = script.skip ? [...script.skip] : null;
  const outcome = (list) => {
    const next = list.length ? list.shift() : 'ok';
    if (next === 'ok') return {};
    throw Object.assign(
      new Error(next.message),
      next.code ? { code: next.code } : {},
      next.status ? { status: next.status } : {},
    );
  };
  const deps = {
    requester: { did: 'did:plc:me' },
    getScheduledMedia: async (req, id) => {
      calls.push(['getScheduledMedia', req.did, id]);
      if (script.media === 'throw') throw new Error('media gone');
      return (
        script.media || { 'p0-img0': { base64: 'AAAA', encoding: 'image/png' } }
      );
    },
    reconstructFromScheduled: (row, media, options) => {
      calls.push(['reconstructFromScheduled', row.id, media, options.asDid]);
      return script.state || STATE;
    },
    targetFor: async (did) => {
      calls.push(['targetFor', did]);
      return { did };
    },
    publish: async (state, target, options) => {
      calls.push(['publish', state, target, typeof options.resolveMention]);
      if (script.publish?.throws) throw new Error(script.publish.throws);
      return script.publish?.result || RESULT;
    },
    resolveMention: async () => null,
    cancelScheduled: async (req, id) => {
      calls.push(['cancelScheduled', id]);
      return outcome(cancels);
    },
    emitPostsChanged: (did, detail) => {
      calls.push(['emitPostsChanged', did, detail.added]);
      if (script.emit === 'throw') throw new Error('listener broke');
    },
  };
  if (skips)
    deps.skipScheduled = async (req, id) => {
      calls.push(['skipScheduled', id]);
      return outcome(skips);
    };
  if (!script.noArm)
    deps.armTimer = async (result, state) => {
      calls.push(['armTimer', result, state.lifespan]);
      if ('arm' in script) {
        const a = script.arm;
        return a && a.error ? { ...a, error: new Error(a.error.message) } : a;
      }
      return { status: 'armed' };
    };
  try {
    const out = await M.postScheduledNow(script.row, {
      did: 'did:plc:me',
      deps,
      now: NOW,
    });
    return {
      ...out,
      timer: out.timer
        ? {
            status: out.timer.status,
            error: out.timer.error
              ? { message: out.timer.error.message }
              : null,
          }
        : null,
      calls,
    };
  } catch (err) {
    return { $error: { message: err.message, code: err.code ?? null }, calls };
  }
}

export default async function cases() {
  const out = [
    value('constants', {
      POST_NOW_CUTOFF_MS: M.POST_NOW_CUTOFF_MS,
      SETTLED_LABEL: M.SETTLED_LABEL,
      COPY_TARGETS: M.COPY_TARGETS,
    }),
    value('defaultLocale', Intl.DateTimeFormat().resolvedOptions().locale),
  ];
  const run = async (fn, inputs, compute) =>
    out.push(
      ...(await each(fn, inputs, (i) =>
        under(i.tz || 'UTC', i.locale || 'en-US', i.now ?? NOW, () =>
          compute(i),
        ),
      )),
    );

  await run(
    'scheduledSections',
    zoned([{ rows: LIST }, { rows: null }, { rows: [] }]),
    (i) => M.scheduledSections(i.rows),
  );
  await run(
    'rowFacts',
    zoned(
      FACT_ROWS.map((r) => ({ row: r })),
      ['UTC', 'Asia/Kolkata'],
    ),
    (i) => {
      const facts = M.rowFacts(i.row);
      return { facts, tags: M.rowTags(facts) };
    },
  );
  await run(
    'rowReply',
    FACT_ROWS.map((r) => ({ row: r })),
    (i) => M.rowReply(i.row),
  );
  await run('rowStatus', zoned(STATUS_ROWS.map((r) => ({ row: r }))), (i) =>
    M.rowStatus(i.row, NOW),
  );
  await run('rowActions', zoned(ACTION_ROWS.map((r) => ({ row: r }))), (i) => ({
    actions: M.rowActions(i.row, NOW),
    dueSoon: M.rowIsDueSoon(i.row, NOW),
  }));
  await run(
    'timerNoteActions',
    NOTES.map((r) => ({ row: r })),
    (i) => M.timerNoteActions(i.row),
  );
  await run(
    'zoneLabel',
    [
      'America/New_York',
      'America/Argentina/Buenos_Aires',
      '',
      null,
      5,
      '_x_',
    ].map((tz) => ({ zone: tz })),
    (i) => M.zoneLabel(i.zone),
  );
  await run('formatInZone', formatInputs, (i) =>
    'weekday' in i
      ? M.formatInZone(i.value, i.zone, i.now, { weekday: i.weekday })
      : M.formatInZone(i.value, i.zone, i.now),
  );
  await run(
    'timeInZone',
    zoned(
      [...formatInputs.slice(0, 12)].map(({ value: v, zone }) => ({
        value: v,
        zone,
      })),
      ['UTC', 'America/New_York'],
    ),
    (i) => M.timeInZone(i.value, i.zone),
  );
  await run('slotLabel', slotInputs, (i) => M.slotLabel(i.hhmm));
  await run(
    'groupByZonedDay',
    zoned(
      [
        'UTC',
        'Asia/Tokyo',
        'America/New_York',
        'Pacific/Chatham',
        '',
        'Not/AZone',
        // No zone is the device's (Intl's default); null is no zone at all.
        undefined,
        null,
      ].map((zone) => ({ rows: GROUP_ROWS, zone })),
      ['UTC', 'America/New_York', 'Pacific/Chatham'],
    ),
    (i) => M.groupByZonedDay(i.rows, i.zone, NOW),
  );
  await run('previewOrder', previewInputs, (i) =>
    M.previewOrder(i.rows, i.ids),
  );
  await run('moveId', moveInputs, (i) => M.moveId(i.ids, i.id, i.delta));
  await run('moveIdTo', moveToInputs, (i) => M.moveIdTo(i.ids, i.id, i.index));
  await run(
    'movableIds',
    zoned([{ rows: REORDER_ROWS }, { rows: LIST.filter(Boolean) }]),
    (i) => M.movableIds(i.rows, NOW),
  );
  await run('applyAssignment', assignInputs, (i) =>
    M.applyAssignment(i.rows, i.assignment),
  );
  await run(
    'scheduledLimitsLine',
    LIMITS.map((l) => ({ limits: l })),
    (i) => M.scheduledLimitsLine(i.limits),
  );
  await run(
    'timerLimitsLine',
    LIMITS.flatMap((l) =>
      FALLBACKS.map((f) => ({
        limits: l,
        ...(f === undefined ? {} : { fallback: f }),
      })),
    ),
    (i) =>
      'fallback' in i
        ? M.timerLimitsLine(i.limits, i.fallback)
        : M.timerLimitsLine(i.limits),
  );
  await run(
    'fullTimerBuckets',
    LIMITS.map((l) => ({ limits: l })),
    (i) => M.fullTimerBuckets(i.limits),
  );
  await run('friendlyTimerError', friendlyInputs, (i) =>
    M.friendlyTimerError(i.code, i.raw),
  );
  await run(
    'ruleOfTimerRow',
    TIMER_ROWS.map((r) => ({ row: r })),
    (i) => M.ruleOfTimerRow(i.row),
  );
  await run(
    'timerRowModel',
    zoned(
      TIMER_ROWS.map((r) => ({ row: r })),
      ['UTC', 'America/New_York'],
    ),
    (i) => M.timerRowModel(i.row, NOW),
  );
  await run('timerSections', sectionInputs, (i) =>
    M.timerSections(i.groups, i.waiting),
  );
  await run(
    'deletedPostUris',
    [
      {
        rows: [
          { status: 'deleted', postUri: 'at://a' },
          { status: 'spared', postUri: 'at://b' },
          { status: 'deleted', postUri: 5 },
          { status: 'deleted' },
        ],
      },
      { rows: null },
    ],
    (i) => M.deletedPostUris(i.rows),
  );
  await run(
    'weekly',
    WEEKS.map((w) => ({ schedule: w })),
    (i) => ({
      count: M.weeklyCount(i.schedule),
      summary: M.weekSummary(i.schedule),
      isDefault: M.isDefaultWeek(i.schedule),
    }),
  );
  await run('editWeek', zoned(editInputs, ['UTC', 'Asia/Kolkata']), (i) => {
    switch (i.op) {
      case 'add':
        return 'deviceZone' in i
          ? M.addSlot(i.schedule, i.day, i.time, i.deviceZone)
          : M.addSlot(i.schedule, i.day, i.time);
      case 'remove':
        return M.removeSlot(i.schedule, i.day, i.time);
      case 'clear':
        return M.clearDay(i.schedule, i.day);
      case 'copy':
        return M.copyDay(i.schedule, i.from, i.to);
      default:
        return M.moveToZone(i.schedule, i.timezone);
    }
  });
  await run('nextOpenSlots', zoned(openInputs, ['UTC', 'Asia/Kolkata']), (i) =>
    M.nextOpenSlots(i.schedule, i.rows, i.now, i.count),
  );
  await run('offScheduleRows', zoned(offInputs, ['UTC', 'Asia/Kolkata']), (i) =>
    M.offScheduleRows(i.schedule, i.rows, NOW),
  );
  await run('quickPicks', pickInputs, (i) => {
    const bounds = {};
    if ('min' in i) bounds.min = i.min;
    if ('max' in i) bounds.max = i.max;
    return M.quickPicks(i.now, i.zone, bounds);
  });
  await run('whenProblem', zoned(whenInputs, ['UTC', 'Asia/Kolkata']), (i) => {
    const bounds = {};
    if ('min' in i) bounds.min = i.min;
    if ('max' in i) bounds.max = i.max;
    return M.whenProblem(i.value, i.now, bounds);
  });
  for (const [id, script] of postNowScripts)
    out.push(
      ...(await each('postScheduledNow', [{ $id: id, ...script }], (i) =>
        under('UTC', 'en-US', NOW, () => postNow(i)),
      )),
    );
  return out;
}
