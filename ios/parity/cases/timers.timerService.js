// src/posting/timers/timerService.js: everything but the HTTP call. The
// helpers (the account in a post URI, the snippet, which failures are lost
// answers or definite refusals, live rows, the post's page), the create
// body, and the flows (createTimer, its confirmation of a lost answer,
// armAfterPublish, listTimers, loadTimerUsage, cancelTimer, the
// availability probe) played as scripts against a fake requester: the
// `req.request(path, opts)` seam the Swift port keeps as TimerRequester.
// Each script records every request made (path, method, query, body), every
// virga:timers-changed event heard, the availability left behind and the
// outcome. Swift: VirgaPosting/Timers/TimerService.swift.
//
// Inputs from timerService.test.js, plus failures of every kind, odd
// publish results and loose arguments.

import * as TS from '../../../src/posting/timers/timerService.js';
import { TIMERS_CHANGED_EVENT } from '../../../src/posting/events.js';
import { composerTimerFit } from '../../../src/posting/timers/selfDestruct.js';
import { each, value } from './_helpers.js';
import { inZone } from './_zones.js';

export const sources = ['src/posting/timers/timerService.js'];

const WRITER = 'did:plc:writer';
const POST = `at://${WRITER}/app.bsky.feed.post/3kpost`;
const RULE = { enabled: true, lifespanSeconds: 3600 };
const FIT = composerTimerFit({});
const NOW = Date.parse('2026-09-01T12:00:00Z');
const POSTED = '2026-09-01T12:00:00.000Z';
const CREATE = '/api/self-destruct/create';
const LIST = '/api/self-destruct/list';
const CANCEL = '/api/self-destruct/cancel';

// ---- errors, as data ---------------------------------------------------------

/** An Error from `{ name, message, code, status, payload }`. */
function makeError(desc) {
  const err =
    desc.name === 'TypeError'
      ? new TypeError(desc.message)
      : new Error(desc.message);
  if (desc.name && desc.name !== 'TypeError') err.name = desc.name;
  for (const key of ['code', 'status', 'payload'])
    if (desc[key] !== undefined) err[key] = desc[key];
  return err;
}

/** An error as the fixture holds it. */
function errorJSON(err) {
  if (!err) return null;
  return {
    name: err.name ?? null,
    message: err.message ?? null,
    code: err.code ?? null,
    status: err.status ?? null,
    payload: err.payload ?? null,
  };
}

const timeout = {
  message: 'Virga’s server didn’t answer in time.',
  status: 0,
  code: 'TIMEOUT',
};
const offline = {
  message: 'Couldn’t reach Virga’s server.',
  status: 0,
  code: 'NETWORK_ERROR',
};
const refused = (status, code = null, message = 'no') => ({
  message,
  status,
  ...(code ? { code } : {}),
  payload: { success: false, error: message, code },
});
const armed = (id = 't1') => ({ answer: { success: true, data: { id } } });
const listing = (data, extra = {}) => ({
  answer: { success: true, data, ...extra },
});

// ---- the fake requester -----------------------------------------------------

/**
 * A requester answering each path from a queue; every call is recorded.
 * `did` null is a requester that knows no account.
 */
function fakeRequester(did, script = {}) {
  const queues = JSON.parse(JSON.stringify(script));
  const calls = [];
  const req = {
    calls,
    async request(path, opts = {}) {
      calls.push({
        path,
        method: opts.method ?? null,
        query: opts.query ?? null,
        body: opts.body ?? null,
      });
      const next = (queues[path] || []).shift();
      if (next === undefined)
        throw makeError({ message: `no answer queued for ${path}` });
      if (next.error) throw makeError(next.error);
      return next.answer;
    },
  };
  if (did !== null) req.did = did;
  return req;
}

const outcome = (r) =>
  r && {
    status: r.status,
    row: r.row ?? null,
    error: errorJSON(r.error),
    adjusted: r.adjusted ?? null,
    note: r.note ?? null,
  };

/** Plays one script: a fresh page (availability, window), then `run(req)`. */
async function play({ did = WRITER, requester = 'yes', script }, run) {
  TS.resetTimerAvailability();
  const heard = [];
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  globalThis.window.addEventListener(TIMERS_CHANGED_EVENT, (e) =>
    heard.push(e.detail),
  );
  const req =
    requester === 'none'
      ? null
      : requester === 'no request function'
        ? { did }
        : fakeRequester(did, script);
  let result;
  try {
    result = await run(req);
  } catch (err) {
    result = { $threw: errorJSON(err) };
  } finally {
    globalThis.window = previous;
  }
  const out = {
    calls: req?.calls ?? [],
    heard,
    availability: TS.timerAvailability(),
    result,
  };
  TS.resetTimerAvailability();
  return out;
}

// ---- the scripts ---------------------------------------------------------------

const GATE_ONLY = {
  enabled: true,
  lifespanSeconds: 3600,
  deleteAt: null,
  conditions: {
    clauses: [{ metric: 'quotes', op: 'gte', value: 10 }],
    logic: 'any',
    sense: 'onlyIf',
    onSpare: 'keep',
  },
  effects: [{ action: 'limitReplies', allow: ['follower'] }],
};

const CREATES = [
  {
    $id: 'armed',
    script: { [CREATE]: [armed()] },
    args: {
      uri: POST,
      cid: 'bafyabc',
      rule: GATE_ONLY,
      fit: FIT,
      postedAt: POSTED,
    },
  },
  { $id: 'off', args: { uri: POST, rule: { ...RULE, enabled: false } } },
  {
    $id: 'fitted off',
    args: {
      uri: POST,
      rule: { ...RULE, effects: [{ action: 'limitReplies' }] },
      fit: composerTimerFit({ reply: true }),
    },
  },
  {
    $id: 'refused',
    script: {
      [CREATE]: [
        {
          error: refused(
            400,
            null,
            'a post has to stand for at least 5 minutes',
          ),
        },
      ],
    },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'lost, the retry answers',
    script: { [CREATE]: [{ error: timeout }, armed()] },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'both lost, the list has it',
    script: {
      [CREATE]: [{ error: timeout }, { error: offline }],
      [LIST]: [listing([{ id: 't1', postUri: POST, status: 'armed' }])],
    },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'the retry refused',
    script: {
      [CREATE]: [
        { error: timeout },
        { error: refused(400, null, 'a timer can run for at most 30 days') },
      ],
    },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'the retry rate limited',
    script: {
      [CREATE]: [{ error: timeout }, { error: refused(429, 'RATE_LIMITED') }],
      [LIST]: [listing([{ id: 't1', postUri: POST, status: 'checking' }])],
    },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'the list without the post',
    script: {
      [CREATE]: [{ error: timeout }, { error: offline }],
      [LIST]: [
        listing([
          {
            id: 'other',
            postUri: `at://${WRITER}/app.bsky.feed.post/3kother`,
            status: 'armed',
          },
          { id: 'old', postUri: POST, status: 'cancelled' },
          null,
        ]),
      ],
    },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'nothing answers',
    script: {
      [CREATE]: [
        { error: { message: 'Load failed' } },
        { error: { message: 'anything' } },
      ],
      [LIST]: [{ error: { message: 'anything else' } }],
    },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'the retry unavailable',
    script: {
      [CREATE]: [
        { error: { name: 'TypeError', message: 'Failed to fetch' } },
        { error: refused(503, 'UNAVAILABLE') },
      ],
    },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'a gateway gave up',
    script: {
      [CREATE]: [{ error: refused(502) }, { error: refused(504) }],
      [LIST]: [listing([], { unavailable: true })],
    },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'aborted',
    script: {
      [CREATE]: [
        {
          error: { name: 'AbortError', message: 'The operation was aborted.' },
        },
        armed('t2'),
      ],
    },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'a pin already passed',
    args: {
      uri: POST,
      rule: { ...RULE, deleteAt: '2026-09-01T11:00:00Z' },
      fit: FIT,
      now: NOW,
    },
  },
  {
    $id: 'a pin too far',
    args: {
      uri: POST,
      rule: { ...RULE, deleteAt: '2026-10-11T11:00:00Z' },
      fit: FIT,
      now: NOW,
    },
  },
  {
    $id: 'a passed pin without preflight',
    script: { [CREATE]: [armed()] },
    args: {
      uri: POST,
      rule: { ...RULE, deleteAt: '2026-09-01T11:59:30Z' },
      fit: FIT,
      now: NOW,
      postedAt: POSTED,
      preflight: false,
    },
  },
  {
    $id: 'a pin kept',
    script: { [CREATE]: [armed()] },
    args: {
      uri: POST,
      rule: { ...RULE, deleteAt: '2026-09-01T17:00:00.000Z' },
      fit: FIT,
      now: NOW,
      postedAt: POSTED,
    },
  },
  {
    $id: 'measured from the clock',
    script: { [CREATE]: [armed()] },
    args: {
      uri: POST,
      rule: { ...RULE, deleteAt: '2026-09-01T15:00:00.000Z' },
      fit: FIT,
      now: NOW,
      postedAt: 'whenever',
    },
  },
  {
    $id: 'unavailable',
    script: { [CREATE]: [{ error: refused(503, 'UNAVAILABLE') }] },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'no route',
    script: { [CREATE]: [{ error: refused(404) }] },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'over quota',
    script: {
      [CREATE]: [
        {
          error: {
            message: 'This account can keep one plain timer at a time.',
            status: 402,
            code: 'QUOTA_EXCEEDED',
            payload: {
              success: false,
              code: 'QUOTA_EXCEEDED',
              feature: 'postTimers',
              limit: 1,
            },
          },
        },
      ],
    },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'another account',
    did: 'did:plc:other',
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'no requester',
    requester: 'none',
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'no request function',
    requester: 'no request function',
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  { $id: 'not a post URI', args: { uri: 'not a uri', rule: RULE, fit: FIT } },
  {
    $id: 'a handle URI',
    args: {
      uri: 'at://handle.example/app.bsky.feed.post/1',
      rule: RULE,
      fit: FIT,
    },
  },
  { $id: 'no URI', args: { rule: RULE, fit: FIT } },
  {
    $id: 'a requester that knows no account',
    did: null,
    script: { [CREATE]: [armed('t9')] },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'a requester with an empty account',
    did: '',
    script: { [CREATE]: [armed()] },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'an answer without data',
    script: { [CREATE]: [{ answer: { success: true } }] },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'no answer at all',
    script: { [CREATE]: [{}] },
    args: { uri: POST, rule: RULE, fit: FIT },
  },
  {
    $id: 'a thread, a long snippet and list names',
    script: { [CREATE]: [armed()] },
    args: {
      uri: POST,
      cid: '',
      extraUris: [
        `at://${WRITER}/app.bsky.feed.post/2`,
        null,
        '',
        ...Array.from(
          { length: 105 },
          (_, i) => `at://${WRITER}/app.bsky.feed.post/x${i}`,
        ),
      ],
      snippet: `  ${'word '.repeat(80)}  `,
      postedAt: POSTED,
      rule: {
        enabled: true,
        lifespanSeconds: 7200,
        conditions: {
          clauses: [
            { metric: 'quotes', value: 3, from: { notFollowed: true } },
          ],
          onSpare: 'extend',
        },
        effects: [
          {
            action: 'limitReplies',
            allow: [
              { list: 'at://did:plc:a/app.bsky.graph.list/l1', name: 'Pals' },
              'mention',
            ],
          },
        ],
      },
      fit: FIT,
      now: NOW,
    },
  },
];

const THREAD = {
  posts: [
    { uri: POST, cid: 'c0' },
    { uri: `at://${WRITER}/app.bsky.feed.post/3kb`, cid: 'c1' },
    { uri: `at://${WRITER}/app.bsky.feed.post/3kc`, cid: 'c2' },
  ],
  root: { uri: POST, cid: 'c0' },
};

const ARMS = [
  {
    $id: 'a thread',
    script: { [CREATE]: [armed()] },
    args: {
      publishResult: THREAD,
      rule: RULE,
      snippet: 'hello',
      fit: FIT,
      now: NOW,
    },
  },
  {
    $id: 'waits through a lost answer',
    script: {
      [CREATE]: [{ error: timeout }, { error: offline }],
      [LIST]: [listing([{ id: 't1', postUri: POST, status: 'armed' }])],
    },
    args: { publishResult: THREAD, rule: RULE, fit: FIT, now: NOW },
  },
  {
    $id: 'a lost answer it cannot confirm',
    script: {
      [CREATE]: [{ error: timeout }, { error: offline }],
      [LIST]: [{ error: offline }],
    },
    args: { publishResult: THREAD, rule: RULE, fit: FIT, now: NOW },
  },
  {
    $id: 'a pin that passed while it went out',
    script: { [CREATE]: [armed()] },
    args: {
      publishResult: THREAD,
      rule: { ...RULE, deleteAt: '2026-09-01T11:59:30Z' },
      fit: FIT,
      now: NOW,
      postedAt: POSTED,
    },
  },
  {
    $id: 'a pin that passed, gates only',
    script: { [CREATE]: [armed()] },
    args: {
      publishResult: THREAD,
      rule: {
        ...RULE,
        deleteAt: '2026-09-01T11:00:00Z',
        effects: [{ action: 'disableQuotes' }],
      },
      fit: FIT,
      now: NOW,
    },
  },
  {
    $id: 'a pin that passed, lost',
    script: { [CREATE]: [{ error: timeout }, armed()] },
    args: {
      publishResult: THREAD,
      rule: { ...RULE, deleteAt: '2026-09-01T11:59:30Z' },
      fit: FIT,
      now: NOW,
    },
  },
  {
    $id: 'nothing at all',
    requester: 'none',
    args: { publishResult: null, rule: RULE },
  },
  {
    $id: 'refused',
    script: { [CREATE]: [{ error: refused(500) }] },
    args: { publishResult: THREAD, rule: RULE, fit: FIT, now: NOW },
  },
  {
    $id: 'no timer',
    args: {
      publishResult: THREAD,
      rule: { enabled: false },
      fit: FIT,
      now: NOW,
    },
  },
  {
    $id: 'posts without a root',
    script: { [CREATE]: [armed()] },
    args: {
      publishResult: { posts: THREAD.posts.slice().reverse() },
      rule: RULE,
      fit: FIT,
      now: NOW,
    },
  },
  {
    $id: 'a root without a URI',
    args: {
      publishResult: { root: { cid: 'c0' }, posts: [] },
      rule: RULE,
      fit: FIT,
      now: NOW,
    },
  },
  {
    $id: 'repeats and blanks',
    script: { [CREATE]: [armed()] },
    args: {
      publishResult: {
        root: { uri: POST },
        posts: [
          { uri: POST },
          null,
          { uri: '' },
          {},
          { uri: `at://${WRITER}/app.bsky.feed.post/3kb` },
        ],
      },
      rule: RULE,
      fit: FIT,
      now: NOW,
    },
  },
  {
    $id: 'an unreadable clock',
    args: { publishResult: THREAD, rule: RULE, fit: FIT, now: NaN },
  },
  {
    $id: 'another account',
    did: 'did:plc:other',
    args: { publishResult: THREAD, rule: RULE, fit: FIT, now: NOW },
  },
  {
    $id: 'a reply',
    script: { [CREATE]: [armed()] },
    args: {
      publishResult: THREAD,
      rule: {
        ...RULE,
        effects: [{ action: 'limitReplies' }, { action: 'delete' }],
      },
      fit: composerTimerFit({ reply: true }),
      now: NOW,
    },
  },
];

const LISTS = [
  {
    $id: 'unavailable',
    script: { [LIST]: [listing([], { unavailable: true })] },
    args: {},
  },
  {
    $id: '503 UNAVAILABLE',
    script: { [LIST]: [{ error: refused(503, 'UNAVAILABLE') }] },
    args: {},
  },
  { $id: '404', script: { [LIST]: [{ error: refused(404) }] }, args: {} },
  {
    $id: 'history',
    script: { [LIST]: [listing([{ id: 't1', status: 'deleted' }])] },
    args: { history: true },
  },
  {
    $id: 'data not a list',
    script: { [LIST]: [listing({ id: 't1' })] },
    args: {},
  },
  { $id: 'no body', script: { [LIST]: [{ answer: null }] }, args: {} },
  {
    $id: 'unavailable, loosely',
    script: { [LIST]: [listing([], { unavailable: 'yes' })] },
    args: {},
  },
  { $id: 'no requester', requester: 'none', args: {} },
];

const USAGES = [
  {
    $id: 'live and scheduled',
    script: {
      [LIST]: [
        listing([{ id: 't1', status: 'armed', conditions: {}, effects: null }]),
      ],
    },
    args: {
      scheduledRows: [
        {
          id: 's1',
          status: 'pending',
          payload: {
            selfDestruct: {
              lifespanSeconds: 3600,
              conditions: { clauses: [{ metric: 'likes', value: 2 }] },
            },
          },
        },
      ],
    },
  },
  {
    $id: 'leaving out the row an edit rewrites',
    script: { [LIST]: [listing([{ id: 't1', status: 'checking' }])] },
    args: {
      scheduledRows: [
        {
          id: 's1',
          status: 'pending',
          payload: { selfDestruct: { lifespanSeconds: 60 } },
        },
      ],
      exceptScheduledId: 's1',
    },
  },
  {
    $id: 'a broken list',
    script: { [LIST]: [{ error: refused(500) }] },
    args: {},
  },
  {
    $id: 'unavailable',
    script: { [LIST]: [{ error: refused(503, 'UNAVAILABLE') }] },
    args: {},
  },
  { $id: 'no requester', requester: 'none', args: {} },
];

const CONFIRMS = [
  {
    $id: 'nothing answers',
    script: {
      [CREATE]: [{ error: { message: 'anything' } }],
      [LIST]: [{ error: { message: 'anything else' } }],
    },
    args: {
      body: { uri: POST, rule: RULE, fit: FIT, now: NOW },
      firstError: timeout,
    },
  },
  {
    $id: 'the retry lands',
    script: { [CREATE]: [armed('t3')] },
    args: { body: { uri: POST, rule: RULE, fit: FIT, now: NOW } },
  },
  {
    $id: 'found in the list, no first error',
    script: {
      [CREATE]: [{ error: refused(408) }],
      [LIST]: [listing([{ postUri: POST, status: 'armed' }])],
    },
    args: { body: { uri: POST, rule: RULE, fit: FIT, now: NOW } },
  },
  {
    $id: 'a refusal of the retry',
    script: { [CREATE]: [{ error: refused(409, 'CONFLICT') }] },
    args: {
      body: { uri: POST, rule: RULE, fit: FIT, now: NOW },
      firstError: offline,
    },
  },
  {
    $id: 'unconfirmed, keeping the first error',
    script: { [CREATE]: [{ error: refused(401) }], [LIST]: [listing([])] },
    args: {
      body: { uri: POST, rule: RULE, fit: FIT, now: NOW },
      firstError: timeout,
    },
  },
  {
    $id: 'a requester that knows no account',
    did: null,
    script: { [CREATE]: [armed('t4')] },
    args: { body: { uri: POST, rule: RULE, fit: FIT, now: NOW } },
  },
];

const CANCELS = [
  {
    $id: 'cancelled',
    script: {
      [CANCEL]: [
        { answer: { success: true, data: { id: 't1', status: 'cancelled' } } },
      ],
    },
    args: { id: 't1' },
  },
  {
    $id: 'a requester that knows no account',
    did: null,
    script: {
      [CANCEL]: [
        { answer: { success: true, data: { id: 't1', status: 'cancelled' } } },
      ],
    },
    args: { id: 't1' },
  },
  {
    $id: 'not cancellable',
    script: { [CANCEL]: [{ error: refused(409, 'NOT_CANCELLABLE') }] },
    args: { id: 't1' },
  },
  {
    $id: 'no data',
    script: { [CANCEL]: [{ answer: { success: true } }] },
    args: { id: 7 },
  },
  { $id: 'no requester', requester: 'none', args: { id: 't1' } },
];

const PROBES = [
  {
    $id: 'once per page',
    script: { [LIST]: [listing([], { unavailable: true })] },
    pattern: ['together', 'again'],
  },
  {
    $id: 'a dead network',
    script: { [LIST]: [{ error: offline }] },
    pattern: ['one', 'again'],
  },
  {
    $id: 'available',
    script: { [LIST]: [listing([])] },
    pattern: ['one', 'again'],
  },
  { $id: 'no requester', requester: 'none', pattern: ['one'] },
];

const MARKS = [
  {
    $id: 'only the explicit code',
    errors: [
      refused(404),
      { name: 'TypeError', message: 'Failed to fetch' },
      null,
      refused(503, 'UNAVAILABLE'),
      refused(404),
    ],
  },
];

// ---- the helpers ---------------------------------------------------------------

const ERRORS = [
  null,
  timeout,
  offline,
  refused(400),
  refused(402, 'QUOTA_EXCEEDED'),
  refused(401),
  refused(403),
  refused(404),
  refused(405),
  refused(408),
  refused(409, 'NOT_CANCELLABLE'),
  refused(429, 'RATE_LIMITED'),
  refused(500),
  refused(502),
  refused(503, 'UNAVAILABLE'),
  refused(503),
  refused(504),
  { message: 'x', code: 'NEEDS_BACKEND' },
  { message: 'x', code: 'UNAVAILABLE' },
  { name: 'TypeError', message: 'Failed to fetch' },
  { name: 'TypeError', message: 'whatever' },
  { name: 'TimeoutError', message: 'signal timed out' },
  { name: 'AbortError', message: 'The user aborted a request.' },
  { message: 'The request TIMED OUT' },
  { message: 'Load failed' },
  { message: 'NetworkError when attempting to fetch resource.' },
  { message: 'connection reset' },
  { message: 'Connection' },
  { message: 'tımeout, with a dotless i' },
  { message: 'nothing useful' },
  { message: '' },
  { message: 'timeout', status: 0 },
  { message: 'timeout', status: 418 },
  { message: 'timeout', code: 'ELSE' },
];

export default async function cases() {
  const out = [
    value('constants', {
      TIMER_SNIPPET_MAX: TS.TIMER_SNIPPET_MAX,
      MAX_EXTRA_URIS: TS.MAX_EXTRA_URIS,
    }),
  ];
  const add = async (fn, inputs, compute) =>
    out.push(...(await each(fn, inputs, compute)));

  await add(
    'timerDidForUri',
    [
      POST,
      'not a uri',
      'at://handle.example/app.bsky.feed.post/1',
      'at://did:plc:x',
      'at://did:',
      'at:///x',
      'AT://did:plc:x/y',
      ' at://did:plc:x/y',
      'at://did:web:example.com/app.bsky.feed.post/1',
      'at://did:plc:é/x',
      '',
      null,
      5,
      ['at://did:plc:x/y'],
    ].map((uri) => ({ uri })),
    ({ uri }) => TS.timerDidForUri(uri),
  );
  const long = 'a'.repeat(198);
  await add(
    'timerSnippet',
    [
      { text: '  a\n\nb  ' },
      { text: '' },
      { text: '   \n\t ' },
      { $id: 'undefined' },
      { text: null },
      { text: 0 },
      { text: 42 },
      { text: { a: 1 } },
      { text: ['a', 'b'] },
      { text: 'x'.repeat(200) },
      { text: 'x'.repeat(201) },
      { text: `${long} b` },
      { text: `${long}😀😀` },
      { text: `${'a'.repeat(199)}😀` },
      { text: `${'word '.repeat(80)}` },
      { text: 'a b c　d﻿e​f' },
      { text: '﻿leading' },
      { text: 'tabs\tand\r\nreturns' },
    ],
    ({ text }) => TS.timerSnippet(text),
  );
  const errors = () =>
    ERRORS.map((e, i) => ({
      $id: `#${i + 1} ${e?.code ?? e?.name ?? e?.status ?? e?.message ?? 'null'}`,
      error: e,
    }));
  await add('isTimersUnavailableError', errors(), ({ error }) =>
    TS.isTimersUnavailableError(error && makeError(error)),
  );
  await add('isTimersUnsupported', errors(), ({ error }) =>
    TS.isTimersUnsupported(error && makeError(error)),
  );
  await add('isArmOutcomeUnknown', errors(), ({ error }) =>
    TS.isArmOutcomeUnknown(error && makeError(error)),
  );
  await add('isDefiniteArmRefusal', errors(), ({ error }) =>
    TS.isDefiniteArmRefusal(error && makeError(error)),
  );
  const ROWS = [
    { status: 'armed' },
    { status: 'checking' },
    { status: 'deleted' },
    { status: 'failed' },
    { status: 'Armed' },
    {},
    null,
  ];
  await add(
    'isLiveTimer',
    ROWS.map((row) => ({ row })),
    ({ row }) => TS.isLiveTimer(row),
  );
  await add(
    'countLiveTimers',
    [{ rows: ROWS }, { rows: [] }, { rows: null }, { $id: 'undefined' }],
    ({ rows }) => TS.countLiveTimers(rows),
  );
  await add(
    'timerPostUrl',
    [
      { row: { postUri: POST, status: 'armed' } },
      { row: { postUri: POST, status: 'deleted' } },
      { row: {} },
      { row: null },
      {
        row: {
          postUri: `at://${WRITER}/app.bsky.feed.like/3k`,
          status: 'armed',
        },
      },
      { row: { postUri: 'at://did:plc:a b/app.bsky.feed.post/3k' } },
      {
        row: {
          postUri: 'at://alice.example/app.bsky.feed.post/3k',
          status: 'spared',
        },
      },
      { row: { postUri: 5 } },
      { row: { postUri: `${POST}/extra` } },
    ],
    ({ row }) => TS.timerPostUrl(row),
  );
  await add(
    'timerBody',
    [
      ...CREATES.filter((c) => c.args.uri).map((c) => ({
        $id: c.$id,
        ...c.args,
        now: c.args.now ?? NOW,
      })),
      {
        $id: 'a rule that is off',
        uri: POST,
        rule: { enabled: false },
        now: NOW,
      },
      {
        $id: 'no fit',
        uri: POST,
        rule: RULE,
        now: NOW,
        postedAt: '2026-09-01T12:00:00',
      },
      { $id: 'a number snippet', uri: POST, rule: RULE, now: NOW, snippet: 12 },
      {
        $id: 'no extra URIs',
        uri: POST,
        rule: RULE,
        now: NOW,
        extraUris: null,
      },
    ],
    ({ uri, cid, extraUris, snippet, postedAt, rule, fit, now }) =>
      TS.timerBody({ uri, cid, extraUris, snippet, postedAt, rule, fit, now }),
  );
  await add(
    'timerBody (zones)',
    ['America/New_York', 'Asia/Kolkata'].map((zone) => ({
      zone,
      uri: POST,
      rule: { ...RULE, deleteAt: '2026-09-01T23:00:00Z' },
      postedAt: '2026-09-01T12:00:00',
      now: NOW,
    })),
    ({ zone, uri, rule, postedAt, now }) =>
      inZone(zone, () => TS.timerBody({ uri, rule, postedAt, now })),
  );
  // A rule whose pin has no offset: read in the same zone as `postedAt`.
  await add(
    'timerBody (local pins)',
    ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Chatham'].flatMap(
      (zone) =>
        ['2026-09-01T23:00', '2026-09-01T12:04:00'].map((deleteAt) => ({
          $id: `${zone} ${deleteAt}`,
          zone,
          uri: POST,
          rule: {
            ...RULE,
            deleteAt,
            conditions: {
              clauses: [{ metric: 'likes', value: 2 }],
              onSpare: 'extend',
            },
          },
          postedAt: '2026-09-01T12:00:00',
          now: NOW,
        })),
    ),
    ({ zone, uri, rule, postedAt, now }) =>
      inZone(zone, () => TS.timerBody({ uri, rule, postedAt, now })),
  );

  // ---- the flows -------------------------------------------------------------------

  await add('createTimer', CREATES, (c) =>
    play(c, async (req) => {
      const r = await TS.createTimer(req, { now: NOW, ...c.args });
      return {
        ...outcome(r),
        confirmation: r.confirmation ? outcome(await r.confirmation) : null,
      };
    }),
  );
  await add('armAfterPublish', ARMS, (c) =>
    play(c, async (req) => {
      let confirming = 0;
      const { publishResult, rule, ...options } = c.args;
      const r = await TS.armAfterPublish(req, publishResult, rule, {
        ...options,
        onConfirming: () => {
          confirming += 1;
        },
      });
      return { ...outcome(r), confirming };
    }),
  );
  await add('listTimers', LISTS, (c) =>
    play(c, (req) => TS.listTimers(req, c.args)),
  );
  await add('loadTimerUsage', USAGES, (c) =>
    play(c, (req) => TS.loadTimerUsage(req, c.args)),
  );
  await add('confirmArmAfterUnknown', CONFIRMS, (c) =>
    play(c, async (req) => {
      const body = TS.timerBody(c.args.body);
      const first = c.args.firstError ? makeError(c.args.firstError) : null;
      return outcome(await TS.confirmArmAfterUnknown(req, body, first));
    }),
  );
  await add('cancelTimer', CANCELS, (c) =>
    play(c, (req) => TS.cancelTimer(req, c.args.id)),
  );
  await add('probeTimerAvailability', PROBES, (c) =>
    play(c, async (req) => {
      const answers = [];
      for (const step of c.pattern) {
        if (step === 'together')
          answers.push(
            ...(await Promise.all([
              TS.probeTimerAvailability(req),
              TS.probeTimerAvailability(req),
            ])),
          );
        else answers.push(await TS.probeTimerAvailability(req));
      }
      return answers;
    }),
  );
  await add(
    'probeTimerAvailability (then a requester)',
    [{ script: { [LIST]: [listing([])] } }],
    (c) =>
      play(c, async (req) => [
        await TS.probeTimerAvailability(null),
        await TS.probeTimerAvailability(req),
      ]),
  );
  await add('markTimersUnavailable', MARKS, (c) =>
    play({ requester: 'none' }, () =>
      c.errors.map((e) => [
        TS.markTimersUnavailable(e && makeError(e)),
        TS.timerAvailability(),
      ]),
    ),
  );

  return out;
}
