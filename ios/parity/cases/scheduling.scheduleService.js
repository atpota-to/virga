// src/posting/schedule/scheduleService.js: scheduled and queued posts
// through Virga's server, as recorded exchanges (_fetch.js) through the real
// requester (backendClient.js createBackendRequester): list, get, media,
// create, every kind of update, skip, stop, retry, acknowledge, reorder (in
// one request, refused, and row by row where the endpoint is missing),
// cancel and the limits, with every refusal the server sends and the
// virga:scheduled-changed events each write announces. Plus the pure
// readers of rows and limits. Swift: VirgaPosting/Schedule/ScheduleService
// .swift over VirgaNetwork's VirgaBackend.
//
// Inputs from scheduleService.test.js. Times without an offset are read in
// the zone a case names (`tz`).

import * as S from '../../../src/posting/schedule/scheduleService.js';
import { SCHEDULED_CHANGED_EVENT } from '../../../src/posting/events.js';
import { createBackendRequester } from '../../../src/session/backendClient.js';
import { each, toJSON, value, withTimeZone } from './_helpers.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = ['src/posting/schedule/scheduleService.js'];

const SERVER = 'https://server.example';
const TOKEN = `vg_${'0f'.repeat(32)}`;
const DID = 'did:plc:writer';

const ok = (data, extra = {}) => json({ success: true, data, ...extra });
const refused = (status, code, error = 'no', extra = {}) =>
  json({ success: false, error, ...(code ? { code } : {}), ...extra }, status);

/** An error as a case records it. */
function errorJSON(err) {
  if (!err) return null;
  return {
    name: err.name ?? null,
    message: err.message ?? null,
    code: err.code ?? null,
    status: err.status ?? null,
    detail: err.detail ?? null,
    payload: err.payload ?? null,
  };
}

/**
 * `call(req)` through a real requester (or none, or one with no DID),
 * recorded, with the events it announced.
 */
function called(answers, call, { requester = 'backend', tz = 'UTC' } = {}) {
  return withTimeZone(tz, () =>
    recordFetch(inTurn(...answers), async () => {
      const heard = [];
      const previous = globalThis.window;
      globalThis.window = new EventTarget();
      globalThis.window.addEventListener(SCHEDULED_CHANGED_EVENT, (e) =>
        heard.push(e.detail),
      );
      try {
        const req =
          requester === 'none'
            ? null
            : createBackendRequester({
                backendUrl: SERVER,
                token: () => TOKEN,
                did: requester === 'no-did' ? undefined : DID,
              });
        try {
          return { value: (await call(req)) ?? null, heard };
        } catch (err) {
          return { $error: errorJSON(err), heard };
        }
      } finally {
        globalThis.window = previous;
      }
    }),
  );
}

const ROW = {
  id: 'a',
  status: 'pending',
  scheduledFor: '2026-11-13T09:00:00+00:00',
};
const BODY = {
  scheduledFor: '2026-11-13T09:00:00.000Z',
  target: 'bluesky',
  queued: false,
  payload: {
    posts: [{ record: { text: 'hi' } }],
    gates: { threadgate: null, postgate: null },
    mediaBytes: {},
    selfDestruct: null,
  },
};
const MOVES = [
  { id: 'a', scheduledFor: '2026-11-14T09:00:00+00:00' },
  { id: 'b', scheduledFor: '2026-11-13T09:00:00.000Z' },
];

const calls = {
  listScheduled: (req) => S.listScheduled(req),
  getScheduled: (req, a) => S.getScheduled(req, a.id),
  getScheduledMedia: (req, a) => S.getScheduledMedia(req, a.id),
  createScheduled: (req, a) => S.createScheduled(req, a.body),
  updateScheduled: (req, a) =>
    'patch' in a
      ? S.updateScheduled(req, a.id, a.patch)
      : S.updateScheduled(req, a.id),
  skipScheduled: (req, a) => S.skipScheduled(req, a.id),
  stopRepeating: (req, a) => S.stopRepeating(req, a.id),
  retryScheduled: (req, a) => S.retryScheduled(req, a.id),
  acknowledgeTimerNote: (req, a) => S.acknowledgeTimerNote(req, a.id),
  reorderScheduled: async (req, a) => {
    const out = await S.reorderScheduled(req, a.moves);
    return {
      ...out,
      failed: out.failed.map((f) => ({ id: f.id, error: errorJSON(f.error) })),
      refusal: errorJSON(out.refusal),
    };
  },
  cancelScheduled: (req, a) => S.cancelScheduled(req, a.id),
  getLimits: (req) => S.getLimits(req),
};

const LIMITS_BODY = {
  success: true,
  tier: 'caterpillar',
  isMember: false,
  policy: 'membership',
  features: {
    scheduledPosts: { isUnlimited: false, limit: 3, freeLimit: 3 },
    postTimers: { isUnlimited: false, limit: 1 },
    conditionalTimers: { isUnlimited: true, limit: null },
    postLists: { isUnlimited: false, limit: 3 },
  },
  usage: { scheduledPosts: 2, postTimers: 1 },
};

const many = Array.from({ length: 51 }, (_, i) => ({
  id: `r${i}`,
  scheduledFor: '2026-11-14T09:00:00Z',
}));

// [fn, id, args, answers, options]
const flows = [
  [
    'listScheduled',
    'split-and-instants',
    {},
    [
      ok([
        { id: 'a', status: 'pending', scheduledFor: '2026-11-13 09:00:00+00' },
        {
          id: 'b',
          status: 'failed',
          scheduledFor: '2026-11-12T09:00:00+00:00',
        },
        {
          id: 'n',
          status: 'published',
          lastErrorCode: 'TIMER_NOT_ARMED',
          scheduledFor: '2026-11-10T09:00:00+00:00',
        },
        { id: 's', status: 'published', last_error_code: 'TIMER_NOT_ARMED' },
        { id: 'p', status: 'published', scheduledFor: '2026-11-09T09:00:00Z' },
        { id: 'g', status: 'publishing', scheduledFor: 'whenever' },
        { id: 'z', status: 'pending', scheduledFor: null },
        { id: 'num', status: 'pending', scheduledFor: 1794495600000 },
        null,
        'a string row',
      ]),
    ],
  ],
  ['listScheduled', 'unavailable-by-code', {}, [refused(404, 'UNAVAILABLE')]],
  [
    'listScheduled',
    'unavailable-in-the-body',
    {},
    [ok([], { unavailable: true })],
  ],
  [
    'listScheduled',
    'unavailable-not-true',
    {},
    [ok([], { unavailable: 'yes' })],
  ],
  ['listScheduled', 'internal', {}, [refused(500, 'INTERNAL')]],
  [
    'listScheduled',
    'signed-out',
    {},
    [refused(401, 'SIGNED_OUT', 'Sign in again.')],
  ],
  ['listScheduled', 'offline', {}, ['offline']],
  ['listScheduled', 'not-json', {}, [{ status: 200, text: '<html>' }]],
  ['listScheduled', 'data-not-a-list', {}, [ok({ id: 'a' })]],
  ['listScheduled', 'bare-body', {}, [json([ROW])]],
  ['listScheduled', 'no-requester', {}, [], { requester: 'none' }],
  ...['America/New_York', 'Asia/Kolkata', 'Pacific/Chatham'].map((tz) => [
    'listScheduled',
    `local-times-${tz}`,
    {},
    [
      ok([
        { id: 'l', status: 'pending', scheduledFor: '2026-11-13T09:00:00' },
        { id: 'd', status: 'pending', scheduledFor: '2026-11-13' },
        { id: 'o', status: 'pending', scheduledFor: '2026-11-13 09:00' },
      ]),
    ],
    { tz },
  ]),
  ['getScheduled', 'a-row', { id: 'a' }, [ok(ROW)]],
  [
    'getScheduled',
    'odd-id',
    { id: 'a b&c/é' },
    [ok({ ...ROW, id: 'a b&c/é' })],
  ],
  ['getScheduled', 'no-id', {}, [ok(null)]],
  ['getScheduled', 'number-id', { id: 42 }, [ok({ ...ROW, id: 42 })]],
  [
    'getScheduled',
    'gone',
    { id: 'a' },
    [refused(404, 'NOT_FOUND', 'not found')],
  ],
  ['getScheduled', 'no-data', { id: 'a' }, [json({ success: true })]],
  [
    'getScheduledMedia',
    'stored',
    { id: 'a' },
    [ok({ 'p0-img0': { base64: 'AAAA', encoding: 'image/png' } })],
  ],
  ['getScheduledMedia', 'none', { id: 'a' }, [json({ success: true })]],
  ['getScheduledMedia', 'a-string', { id: 'a' }, [ok('nothing')]],
  ['getScheduledMedia', 'a-list', { id: 'a' }, [ok([1, 2])]],
  [
    'getScheduledMedia',
    'refused',
    { id: 'a' },
    [refused(409, 'NOT_YOUR_CLIENT')],
  ],
  ['getScheduledMedia', 'no-requester', { id: 'a' }, [], { requester: 'none' }],
  [
    'createScheduled',
    'made',
    { body: BODY },
    [ok({ id: 'new', scheduledFor: '2026-11-13 09:00:00+00' })],
  ],
  [
    'createScheduled',
    'no-id-back',
    { body: BODY },
    [ok({ scheduledFor: '2026-11-13T09:00:00Z' })],
  ],
  [
    'createScheduled',
    'no-data-back',
    { body: BODY },
    [json({ success: true })],
  ],
  [
    'createScheduled',
    'quota-402',
    { body: BODY },
    [
      refused(402, 'QUOTA_EXCEEDED', 'quota', {
        feature: 'scheduledPosts',
        limit: 3,
      }),
    ],
  ],
  [
    'createScheduled',
    'quota-409',
    { body: BODY },
    [
      refused(409, 'QUOTA_EXCEEDED', 'quota', {
        feature: 'scheduledPosts',
        limit: 3,
      }),
    ],
  ],
  [
    'createScheduled',
    'rate-limited',
    { body: BODY },
    [refused(429, 'RATE_LIMITED', 'slow down')],
  ],
  [
    'createScheduled',
    'refused-in-200',
    { body: BODY },
    [json({ success: false, error: 'a thread can have at most 25 posts' })],
  ],
  [
    'createScheduled',
    'snake-error',
    { body: BODY },
    [json({ success: false, error: 'monthly_limit' }, 429)],
  ],
  [
    'createScheduled',
    'too-large',
    { body: BODY },
    [{ status: 413, text: 'Request Entity Too Large' }],
  ],
  ['createScheduled', 'offline', { body: BODY }, ['offline']],
  [
    'createScheduled',
    'no-did',
    { body: BODY },
    [ok({ id: 'new' })],
    { requester: 'no-did' },
  ],
  [
    'createScheduled',
    'no-requester',
    { body: BODY },
    [],
    { requester: 'none' },
  ],
  [
    'updateScheduled',
    'move-iso',
    { id: 'a', patch: { scheduledFor: '2026-11-14T09:00:00+00:00' } },
    [ok(ROW)],
  ],
  [
    'updateScheduled',
    'move-number',
    { id: 'a', patch: { scheduledFor: 1794646800000 } },
    [ok(ROW)],
  ],
  [
    'updateScheduled',
    'move-garbage',
    { id: 'a', patch: { scheduledFor: 'soon' } },
    [ok(ROW)],
  ],
  [
    'updateScheduled',
    'move-null',
    { id: 'a', patch: { scheduledFor: null } },
    [ok(ROW)],
  ],
  [
    'updateScheduled',
    'move-local',
    { id: 'a', patch: { scheduledFor: '2026-11-14T09:00' } },
    [ok(ROW)],
    { tz: 'America/New_York' },
  ],
  [
    'updateScheduled',
    'rewrite',
    { id: 'a', patch: BODY },
    [ok({ ...ROW, scheduledFor: '2026-11-13 09:00:00+00' })],
  ],
  ['updateScheduled', 'retry', { id: 'a', patch: { retry: true } }, [ok(ROW)]],
  [
    'updateScheduled',
    'acknowledge',
    { id: 'a', patch: { acknowledgeTimer: true } },
    [ok(ROW)],
  ],
  ['updateScheduled', 'skip', { id: 'a', patch: { skip: true } }, [ok(null)]],
  [
    'updateScheduled',
    'stop',
    { id: 'a', patch: { stopRepeat: true } },
    [ok(ROW)],
  ],
  [
    'updateScheduled',
    'retry-wins',
    { id: 'a', patch: { retry: true, skip: true, payload: {} } },
    [ok(ROW)],
  ],
  ['updateScheduled', 'empty-patch', { id: 'a', patch: {} }, [ok(ROW)]],
  ['updateScheduled', 'no-patch', { id: 'a' }, [ok(ROW)]],
  [
    'updateScheduled',
    'patch-own-id',
    { id: 'a', patch: { id: 'other', retry: true } },
    [ok(ROW)],
  ],
  [
    'updateScheduled',
    'falsy-payload',
    { id: 'a', patch: { payload: 0, scheduledFor: '2026-11-14T09:00:00Z' } },
    [ok(ROW)],
  ],
  [
    'updateScheduled',
    'not-reschedulable',
    { id: 'a', patch: { scheduledFor: '2026-11-14T09:00:00Z' } },
    [refused(409, 'NOT_RESCHEDULABLE')],
  ],
  [
    'updateScheduled',
    'no-requester',
    { id: 'a', patch: {} },
    [],
    { requester: 'none' },
  ],
  ['skipScheduled', 'next', { id: 'a' }, [ok({ ...ROW, id: 'a2' })]],
  ['skipScheduled', 'ended', { id: 'a' }, [ok(null)]],
  [
    'skipScheduled',
    'not-skippable',
    { id: 'a' },
    [refused(409, 'NOT_SKIPPABLE')],
  ],
  ['stopRepeating', 'stopped', { id: 'a' }, [ok(ROW)]],
  [
    'stopRepeating',
    'not-repeating',
    { id: 'a' },
    [refused(409, 'NOT_REPEATING')],
  ],
  ['retryScheduled', 'retried', { id: 'a' }, [ok(ROW)]],
  [
    'retryScheduled',
    'media-missing',
    { id: 'a' },
    [refused(409, 'MEDIA_MISSING', 'the images were cleared')],
  ],
  [
    'acknowledgeTimerNote',
    'cleared',
    { id: 'n' },
    [ok({ id: 'n', status: 'published' })],
  ],
  [
    'reorderScheduled',
    'one-request',
    { moves: MOVES },
    [json({ success: true, moved: 2 })],
  ],
  [
    'reorderScheduled',
    'moved-unsaid',
    { moves: MOVES },
    [json({ success: true })],
  ],
  [
    'reorderScheduled',
    'moved-a-string',
    { moves: MOVES },
    [json({ success: true, moved: '2' })],
  ],
  [
    'reorderScheduled',
    'refused',
    { moves: MOVES },
    [refused(409, 'NOT_REORDERABLE')],
  ],
  [
    'reorderScheduled',
    'too-early',
    { moves: MOVES },
    [
      refused(
        409,
        'DELETE_TIME_TOO_EARLY',
        'the delete time on "x" would come before…',
      ),
    ],
  ],
  [
    'reorderScheduled',
    'fallback-404',
    { moves: MOVES },
    [refused(404, 'UNAVAILABLE'), refused(409, 'NOT_RESCHEDULABLE'), ok({})],
  ],
  [
    'reorderScheduled',
    'fallback-405',
    { moves: MOVES },
    [{ status: 405, text: 'Method Not Allowed' }, ok({}), ok({})],
  ],
  [
    'reorderScheduled',
    'fallback-failures-without-codes',
    { moves: MOVES },
    [refused(404), { status: 500, text: 'oops' }, 'offline'],
  ],
  [
    'reorderScheduled',
    'fallback-all-fail',
    { moves: MOVES },
    [
      refused(404),
      { status: 502, text: 'bad gateway' },
      { status: 502, text: 'bad gateway' },
    ],
  ],
  ['reorderScheduled', 'past-the-limit', { moves: many }, [ok({})]],
  [
    'reorderScheduled',
    'nothing-to-move',
    { moves: [null, { id: 'x' }, { scheduledFor: '2026-11-14T09:00:00Z' }] },
    [],
  ],
  ['reorderScheduled', 'no-moves', { moves: null }, []],
  [
    'reorderScheduled',
    'loose-times',
    {
      moves: [
        { id: 'n', scheduledFor: 1794646800000 },
        { id: 'g', scheduledFor: 'whenever' },
        { id: 'l', scheduledFor: '2026-11-14T09:00' },
      ],
    },
    [json({ success: true, moved: 3 })],
    { tz: 'Asia/Kolkata' },
  ],
  [
    'reorderScheduled',
    'no-requester',
    { moves: MOVES },
    [],
    { requester: 'none' },
  ],
  [
    'cancelScheduled',
    'cancelled',
    { id: 'a' },
    [ok({ id: 'a', status: 'cancelled' })],
  ],
  ['cancelScheduled', 'no-data', { id: 'a' }, [json({ success: true })]],
  [
    'cancelScheduled',
    'not-cancellable',
    { id: 'a' },
    [refused(409, 'NOT_CANCELLABLE')],
  ],
  [
    'cancelScheduled',
    'no-did',
    { id: 'a' },
    [ok({ id: 'a' })],
    { requester: 'no-did' },
  ],
  ['getLimits', 'membership', {}, [json(LIMITS_BODY)]],
  [
    'getLimits',
    'flat',
    {},
    [
      json({
        success: true,
        policy: 'flat',
        features: { scheduledPosts: { isUnlimited: true, limit: null } },
        caps: { scheduledPosts: 50, timers: 200 },
      }),
    ],
  ],
  [
    'getLimits',
    'older-server',
    {},
    [json({ success: true, features: { scheduledPosts: { limit: 3 } } })],
  ],
  ['getLimits', 'not-json', {}, [{ status: 200, text: 'ok' }]],
  ['getLimits', 'refused', {}, [refused(503, 'UNAVAILABLE')]],
  ['getLimits', 'no-requester', {}, [], { requester: 'none' }],
];

// ---- pure readers -------------------------------------------------------------

const ROWS = [
  { status: 'pending' },
  { status: 'publishing' },
  { status: 'failed' },
  { status: 'published' },
  { status: 'published', lastErrorCode: 'TIMER_NOT_ARMED' },
  { status: 'published', last_error_code: 'TIMER_NOT_ARMED' },
  { status: 'failed', lastErrorCode: 'TIMER_NOT_ARMED' },
  { status: 'pending', partial: true },
  { status: 'failed', partial: 1 },
  { status: 'pending', clientKey: 'virga' },
  { status: 'pending', clientKey: 'other' },
  { status: 'pending', clientKey: '' },
  { clientKey: 5 },
  { status: 'PENDING' },
  { payload: { repeat: { every: 'week' } } },
  { payload: { repeat: { every: '' } } },
  { payload: { repeat: {} } },
  { payload: { repeat: 'week' } },
  {},
  null,
];

const rowFns = [
  'isActiveScheduledRow',
  'isTimerNoteRow',
  'rowClientKey',
  'canEditScheduledRow',
  'canCancelScheduledRow',
  'isRepeatingRow',
];

const limitsBodies = [
  LIMITS_BODY,
  null,
  {},
  {
    policy: 'flat',
    features: { scheduledPosts: { isUnlimited: true, limit: null } },
    caps: { scheduledPosts: 50, timers: 200 },
  },
  { caps: { scheduledPosts: 'x', timers: 0 } },
  { caps: { scheduledPosts: -5, timers: 2.5 } },
  { features: { scheduledPosts: { limit: 3 } } },
  {
    features: { scheduledPosts: { limit: '3' } },
    usage: { scheduledPosts: '2' },
  },
  {
    features: { scheduledPosts: { limit: 3, isUnlimited: 'true' } },
    usage: { scheduledPosts: 3 },
  },
  {
    features: { scheduledPosts: null, postTimers: 0 },
    usage: null,
    isMember: 'true',
    policy: 5,
  },
  {
    features: { scheduledPosts: { limit: 0 } },
    usage: { scheduledPosts: 0 },
    isMember: true,
    policy: '',
  },
  { features: { scheduledPosts: { limit: 1 } }, usage: { scheduledPosts: 1 } },
  { features: { scheduledPosts: { limit: 3 } }, usage: { scheduledPosts: 5 } },
  {
    features: { scheduledPosts: { limit: 2.5 } },
    usage: { scheduledPosts: 2 },
  },
];

const errors = [
  { status: 404 },
  { status: 405 },
  { reorderUnsupported: true },
  { reorderUnsupported: 'true' },
  { status: '404' },
  { status: 409, code: 'NOT_REORDERABLE' },
  null,
  undefined,
  {},
];

async function pure() {
  const out = [
    value('constants', {
      MAX_PENDING_SCHEDULED: S.MAX_PENDING_SCHEDULED,
      MAX_REORDER_MOVES: S.MAX_REORDER_MOVES,
      LIMIT_FEATURES: S.LIMIT_FEATURES,
    }),
    ...(await each(
      'countActiveScheduled',
      [{ rows: ROWS }, { rows: null }, {}, { rows: [] }],
      ({ rows }) => S.countActiveScheduled(rows),
    )),
    ...(await each(
      'isReorderUnsupported',
      errors.map((err) => ({ err })),
      ({ err }) => S.isReorderUnsupported(err),
    )),
    ...(await each(
      'normalizeLimits',
      limitsBodies.map((body) => ({ body })),
      ({ body }) => S.normalizeLimits(body),
    )),
  ];
  for (const fn of rowFns)
    out.push(
      ...(await each(
        fn,
        ROWS.map((row) => ({ row })),
        ({ row }) => S[fn](row),
      )),
    );
  const limits = limitsBodies.map((b) => S.normalizeLimits(b));
  const roomInputs = [
    ...limits.map((l) => ({ limits: l })),
    ...limits.map((l) => ({ limits: l, editing: true })),
    { limits: null },
    {
      limits: {
        features: { scheduledPosts: { limit: 2 } },
        usage: { scheduledPosts: 2 },
      },
    },
    {
      limits: {
        features: { scheduledPosts: { limit: 2 } },
        usage: { scheduledPosts: 2 },
      },
      editing: 0,
    },
  ];
  out.push(
    ...(await each(
      'scheduledRoomProblem',
      roomInputs,
      ({ limits: l, editing }) =>
        editing === undefined
          ? S.scheduledRoomProblem(l)
          : S.scheduledRoomProblem(l, { editing }),
    )),
    ...(await each(
      'scheduledUsageLine',
      limits.map((l) => ({ limits: l })),
      ({ limits: l }) => S.scheduledUsageLine(l),
    )),
  );
  return out;
}

export default async function cases() {
  const out = [];
  for (const [fn, id, args, answers, options = {}] of flows) {
    out.push({
      id,
      fn,
      input: toJSON({
        ...args,
        tz: options.tz || 'UTC',
        requester: options.requester || 'backend',
      }),
      output: await called(answers, (req) => calls[fn](req, args), options),
    });
  }
  return [...out, ...(await pure())];
}
