// src/posting/composer/{actions,defaults,gatesModel,intent,submit}.js: the
// split button's actions and labels, a fresh post's default timer and the
// words for its reply settings, the reply rules editor, reading an intent,
// and the words around sending (progress, failures, toasts, scheduled
// messages in several zones), the queue's slot rows and finishing the
// source. Swift: VirgaPosting/Composer/*.swift.
//
// Inputs are the modules' own tests' plus loose shapes and boundaries.
// finishSource's calls are scripted: each case lists what every call does.

import {
  DRAFT_MAX_GRAPHEMES,
  OVER_LIMIT_HINT,
  EMPTY_HINT,
  VIDEO_PENDING_HINT,
  MEDIA_MISSING_HINT,
  SIGNED_OUT_HINT,
  postFacts,
  composerActions,
  actionLabel,
} from '../../../src/posting/composer/actions.js';
import {
  TIMER_NEEDS_SERVER,
  TIMER_LIMITS_UNKNOWN,
  NO_FREE_TIMER,
  defaultTimerFor,
  gatesSourceLine,
  gatesSummary,
  gatesShortSummary,
} from '../../../src/posting/composer/defaults.js';
import {
  RULE_OPTIONS,
  replyMode,
  hasRule,
  toggleRule,
  rulesNote,
  isForeignListRule,
  gatesForAccount,
  unlistedRules,
} from '../../../src/posting/composer/gatesModel.js';
import {
  readTargetRef,
  normalizeIntent,
  intentLoads,
  seedFromIntent,
} from '../../../src/posting/composer/intent.js';
import {
  SLOW_PUBLISH_MS,
  HARD_PUBLISH_MS,
  SLOW_PUBLISH_NOTE,
  HARD_PUBLISH_ERROR,
  SCHEDULED_COPY_REMAINS,
  DRAFT_NOT_DELETED,
  progressLine,
  publishErrorView,
  accountLabel,
  postedToast,
  whenWords,
  scheduledMessage,
  queueSlotRows,
  finishSource,
} from '../../../src/posting/composer/submit.js';
import {
  emptyComposerState,
  emptyPost,
} from '../../../src/posting/lib/composerModel.js';
import { defaultPostingSettings } from '../../../src/posting/settings.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { each, value, inZone } from './_helpers.js';
import { canonIds, file, markFiles, withFiles } from './_composer.js';

export const sources = [
  'src/posting/composer/actions.js',
  'src/posting/composer/defaults.js',
  'src/posting/composer/gatesModel.js',
  'src/posting/composer/intent.js',
  'src/posting/composer/submit.js',
];

const ME = 'did:plc:mira';
const settle = (result, input) =>
  canonIds(JSON.parse(JSON.stringify(markFiles(result) ?? null)), input);

const QUEUE = {
  timezone: 'UTC',
  slots: {
    mon: ['09:00'],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  },
};
const EMPTY_QUEUE = {
  timezone: 'UTC',
  slots: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
};

function stateWith(text, patch = {}) {
  const s = JSON.parse(JSON.stringify(emptyComposerState({ asDid: ME })));
  s.posts[0].id = 'p1';
  s.posts[0].text = text;
  return { ...s, ...patch };
}
const twoPosts = (a, b) => {
  const s = stateWith(a);
  return { ...s, posts: [s.posts[0], { ...s.posts[0], id: 'p2', text: b }] };
};

// ---- actions -----------------------------------------------------------------

const STATES = [
  ['empty', stateWith('')],
  ['text', stateWith('hello')],
  ['spaces', stateWith('   ')],
  ['over', stateWith('x'.repeat(301))],
  ['at-limit', stateWith('x'.repeat(300))],
  ['emoji-limit', stateWith('😀'.repeat(300))],
  [
    'link-label',
    stateWith(`[${'x'.repeat(290)}](https://example.org/${'y'.repeat(50)})`),
  ],
  ['over-draft', stateWith('x'.repeat(1001))],
  ['thread', twoPosts('one', 'two')],
  ['thread-over', twoPosts('one', 'x'.repeat(400))],
  [
    'reply',
    stateWith('re', {
      reply: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' },
    }),
  ],
  [
    'video-uploading',
    (() => {
      const s = stateWith('v');
      s.posts[0].video = { status: 'uploading', alt: '' };
      return s;
    })(),
  ],
  [
    'video-ready',
    (() => {
      const s = stateWith('');
      s.posts[0].video = { status: 'ready', alt: '' };
      return s;
    })(),
  ],
  ['queued', stateWith('q', { schedule: { mode: 'queue' } })],
  [
    'at',
    stateWith('a', { schedule: { mode: 'at', at: '2026-04-01T09:00:00Z' } }),
  ],
  [
    'editing-scheduled',
    stateWith('x'.repeat(301), { source: { kind: 'scheduled', id: 's1' } }),
  ],
  [
    'editing-scheduled-at',
    stateWith('x', {
      source: { kind: 'scheduled', id: 's1' },
      schedule: { mode: 'at', at: 'x' },
    }),
  ],
  [
    'editing-scheduled-queue',
    stateWith('x', {
      source: { kind: 'scheduled', id: 's1' },
      schedule: { mode: 'queue' },
    }),
  ],
  ['from-draft', stateWith('x', { source: { kind: 'draft', id: 'd1' } })],
  ['null', null],
  ['no-posts', {}],
];

const OPTIONS = [
  {},
  {
    defaultAction: 'schedule',
    queue: QUEUE,
    caps: { canPost: true, canSchedule: true },
  },
  { defaultAction: 'queue', queue: EMPTY_QUEUE, caps: { canSchedule: true } },
  { defaultAction: 'queue', queue: QUEUE, caps: { canSchedule: false } },
  {
    defaultAction: 'queue',
    queue: QUEUE,
    caps: { canSchedule: false },
    authMode: 'browser',
  },
  { defaultAction: 'draft', caps: { canPost: false } },
  { defaultAction: 'post', signedOut: true, caps: { canSchedule: true } },
  {
    defaultAction: 'schedule',
    missingMedia: true,
    caps: { canSchedule: true },
    queue: QUEUE,
  },
  { defaultAction: 'schedule', postNow: true, caps: { canSchedule: true } },
  { defaultAction: 'publish', caps: { canSchedule: true } },
];

async function actionCases() {
  const all = [
    value('actionConstants', {
      DRAFT_MAX_GRAPHEMES,
      OVER_LIMIT_HINT,
      EMPTY_HINT,
      VIDEO_PENDING_HINT,
      MEDIA_MISSING_HINT,
      SIGNED_OUT_HINT,
    }),
  ];
  all.push(
    ...(await each(
      'postFacts',
      STATES.map(([$id, state]) => ({ $id, state })),
      (i) => postFacts(i.state),
    )),
  );
  const inputs = [];
  for (const [sid, state] of STATES)
    for (const [oi, options] of OPTIONS.entries())
      inputs.push({ $id: `${sid}/${oi}`, state, options });
  all.push(
    ...(await each('composerActions', inputs, (i) =>
      composerActions(i.state, i.options),
    )),
  );
  const labels = [];
  const LONG = new Set([
    'over',
    'at-limit',
    'emoji-limit',
    'link-label',
    'over-draft',
  ]);
  for (const [sid, state] of STATES.filter(([sid]) => !LONG.has(sid)))
    for (const action of ['post', 'schedule', 'queue', 'draft', 'other'])
      for (const short of [false, true])
        labels.push({ $id: `${sid}/${action}/${short}`, action, state, short });
  all.push(
    ...(await each(
      'actionLabel',
      labels.filter((l) => l.state),
      (i) => actionLabel(i.action, i.state, { short: i.short }),
    )),
  );
  return all;
}

// ---- defaults ----------------------------------------------------------------

const on = (patch = {}) => {
  const s = defaultPostingSettings({ language: 'en' });
  return {
    ...s,
    lifespan: { ...s.lifespan, enabled: true, lifespanSeconds: 3600, ...patch },
  };
};
const limits = (used, limit = 1) => ({
  policy: 'membership',
  features: {
    postTimers: { limit },
    conditionalTimers: { limit },
    scheduledPosts: { limit: 3 },
  },
  usage: { postTimers: used, conditionalTimers: 0, scheduledPosts: 0 },
});

async function defaultCases() {
  const all = [
    value('defaultConstants', {
      TIMER_NEEDS_SERVER,
      TIMER_LIMITS_UNKNOWN,
      NO_FREE_TIMER,
    }),
  ];
  const settings = [
    ['off', defaultPostingSettings({ language: 'en' })],
    ['on', on()],
    [
      'on-conditional',
      on({
        conditions: { clauses: [{ metric: 'likes', op: 'lt', value: 5 }] },
      }),
    ],
    ['default-on', { lifespan: { defaultOn: true, lifespanSeconds: 7200 } }],
    ['none', null],
  ];
  const situations = [
    { canSchedule: false },
    { canSchedule: true, limitsStatus: 'idle' },
    { canSchedule: true, limitsStatus: 'loading' },
    { canSchedule: true, limitsStatus: 'error' },
    { canSchedule: true, limitsStatus: 'ready', limits: limits(0) },
    { canSchedule: true, limitsStatus: 'ready', limits: limits(1) },
    { canSchedule: true, limitsStatus: 'ready', limits: limits(1, 0) },
    { canSchedule: true, limitsStatus: 'ready', limits: null },
    {
      canSchedule: true,
      limitsStatus: 'ready',
      limits: limits(0),
      fit: { available: false },
    },
    {
      canSchedule: true,
      limitsStatus: 'ready',
      limits: limits(0),
      fit: { available: true },
    },
  ];
  const inputs = [];
  for (const [sid, s] of settings)
    for (const [i, situation] of situations.entries())
      inputs.push({ $id: `${sid}/${i}`, settings: s, ...situation });
  all.push(
    ...(await each('defaultTimerFor', inputs, ({ settings: s, ...o }) =>
      defaultTimerFor(s, o),
    )),
    ...(await each(
      'gatesSourceLine',
      [
        { info: null },
        { info: { custom: true, source: 'settings' } },
        { info: { status: 'loading' } },
        { info: { source: 'settings' } },
        { info: { source: 'bluesky' } },
        { info: { source: 'everyone', notice: 'Couldn’t read them.' } },
        { info: { source: 'everyone' } },
        { info: { source: 'settings' }, reply: true },
        { info: null, reply: true },
      ],
      (i) =>
        gatesSourceLine(
          i.info,
          i.reply === undefined ? undefined : { reply: i.reply },
        ),
    )),
  );
  const list = (n) => ({
    type: 'list',
    list: `at://${ME}/app.bsky.graph.list/l${n}`,
  });
  const GATES = [
    null,
    {},
    { reply: null },
    { reply: null, quotes: false },
    { reply: [] },
    { reply: [], quotes: false },
    { reply: [{ type: 'mention' }] },
    { reply: [{ type: 'following' }, { type: 'mention' }] },
    {
      reply: [{ type: 'mention' }, { type: 'following' }, { type: 'follower' }],
    },
    { reply: [{ type: 'follower' }, { type: 'follower' }] },
    { reply: [list(1)] },
    { reply: [list(1), list(2)] },
    { reply: [list(1), { type: 'mention' }] },
    { reply: [{ type: 'bogus' }, null] },
    {
      reply: [{ type: 'following' }, list(1), list(2), list(3)],
      quotes: false,
    },
  ];
  all.push(
    ...(await each(
      'gatesSummary',
      GATES.map((gates) => ({ gates })),
      (i) => gatesSummary(i.gates),
    )),
    ...(await each(
      'gatesShortSummary',
      GATES.map((gates) => ({ gates })),
      (i) => gatesShortSummary(i.gates),
    )),
  );
  return all;
}

// ---- gates model -------------------------------------------------------------

async function gatesModelCases() {
  const OTHER = 'did:plc:other';
  const mine = (n) => ({
    type: 'list',
    list: `at://${ME}/app.bsky.graph.list/l${n}`,
  });
  const theirs = (n) => ({
    type: 'list',
    list: `at://${OTHER}/app.bsky.graph.list/t${n}`,
  });
  const REPLIES = [
    null,
    undefined,
    [],
    [{ type: 'mention' }],
    [{ type: 'mention' }, { type: 'following' }],
    [
      mine(1),
      mine(2),
      { type: 'mention' },
      { type: 'follower' },
      { type: 'following' },
    ],
    [mine(1), theirs(1)],
    [theirs(1), theirs(2)],
    [{ type: 'list', list: 'not a uri' }, { type: 'list' }],
    'nobody',
  ];
  const RULES = [
    { type: 'mention' },
    { type: 'follower' },
    mine(1),
    mine(9),
    theirs(1),
    { type: 'list' },
  ];
  const all = [value('gatesModelConstants', { RULE_OPTIONS })];
  const pairs = [];
  for (const reply of REPLIES)
    for (const rule of RULES) pairs.push({ reply, rule });
  all.push(
    ...(await each(
      'replyMode',
      REPLIES.map((reply) => ({ reply })),
      (i) => replyMode(i.reply),
    )),
    ...(await each('hasRule', pairs, (i) => hasRule(i.reply, i.rule))),
    ...(await each('toggleRule', pairs, (i) => toggleRule(i.reply, i.rule))),
    ...(await each(
      'rulesNote',
      REPLIES.map((reply) => ({ reply })),
      (i) => rulesNote(i.reply),
    )),
    ...(await each(
      'isForeignListRule',
      [...RULES, null, { type: 'list', list: 5 }].map((rule) => ({
        rule,
        did: ME,
      })),
      (i) => isForeignListRule(i.rule, i.did),
    )),
    ...(await each(
      'gatesForAccount',
      [
        ...REPLIES.map((reply) => ({
          gates: { custom: true, reply, quotes: false },
          did: ME,
        })),
        { gates: null, did: ME },
        { gates: undefined, did: ME },
        { gates: { reply: [theirs(1)] }, did: OTHER },
      ],
      (i) => gatesForAccount(i.gates, i.did),
    )),
    ...(await each(
      'unlistedRules',
      [
        ...REPLIES.map((reply) => ({ reply, listUris: [mine(1).list] })),
        { reply: [mine(1), mine(2)], listUris: [] },
        { reply: [mine(1), mine(2)] },
      ],
      (i) =>
        i.listUris === undefined
          ? unlistedRules(i.reply)
          : unlistedRules(i.reply, i.listUris),
    )),
  );
  return all;
}

// ---- intents -----------------------------------------------------------------

const TARGETS = [
  'at://did:plc:abc/app.bsky.feed.post/3k',
  'at://did:plc:abc/app.bsky.feed.generator/gen',
  'at://did:plc:abc/app.bsky.graph.list/l1',
  'at://did:plc:abc/app.bsky.graph.starterpack/sp',
  'at://alice.example/app.bsky.feed.post/3k',
  'https://bsky.app/profile/alice.example/post/3k',
  'https://bsky.app/profile/did:plc:abc/post/3k',
  'https://bsky.app/profile/alice.example/feed/gen',
  'https://bsky.app/profile/alice.example/lists/l1',
  'https://bsky.app/starter-pack/alice.example/sp',
  '  https://bsky.app/profile/alice.example/post/3k  ',
  { uri: 'at://did:plc:abc/app.bsky.feed.post/3k' },
  { url: 'https://bsky.app/profile/alice.example/post/3k' },
  { uri: '', url: 'https://bsky.app/profile/alice.example/post/3k' },
  { uri: 5 },
  'https://example.org/post/3k',
  'nonsense',
  '',
  null,
  5,
  ['at://did:plc:abc/app.bsky.feed.post/3k'],
];

async function intentCases() {
  const pic = file('chart.png', 'image/png', 4);
  const INTENTS = [
    null,
    {},
    'text',
    { text: 'hello', asDid: 'did:plc:other', tags: ['a', '#b', 'a'] },
    { text: 5 },
    { posts: ['one', { text: 'two' }, 5, null] },
    { posts: [], text: 'fallback' },
    { posts: Array.from({ length: 30 }, (_, i) => `p${i}`) },
    { draftId: 'd1', draftOwnerDid: 'did:plc:owner', asDid: 'did:plc:other' },
    { draftId: 'd1', asDid: 'did:plc:other' },
    { draftId: 'd1' },
    { draftId: '' },
    { reply: 'at://did:plc:abc/app.bsky.feed.post/3k', mode: 'queue' },
    { reply: 'at://did:plc:abc/app.bsky.feed.post/3k', mode: 'schedule' },
    { reply: 'at://did:plc:abc/app.bsky.graph.list/l1' },
    { quote: 'https://bsky.app/profile/alice.example/post/3k' },
    { mode: 'queue' },
    { mode: 'later' },
    {
      scheduledId: 's1',
      draftId: 'd1',
      templateId: 't1',
      attach: { kind: 'x' },
    },
    { templateId: 't1', attach: ['x'] },
    { fromLink: true, url: 'https://example.org', text: 'from a link' },
    { fromLink: 1, url: 5 },
    { langs: ['en', 'es', 'en', 'fr', 'de', '', 5] },
    { langs: [] },
    { langs: 'en' },
    { tags: 'one, #two' },
    { tags: [] },
    { text: '   ' },
    {
      images: [
        { file: pic, alt: 'A chart' },
        { file: pic },
        { file: { type: 'image/png' }, alt: 'not a file' },
        null,
        { file: pic, alt: 5 },
        { file: pic, alt: 'four' },
        { file: pic, alt: 'five' },
      ],
    },
    { images: 'none' },
  ];
  const all = [
    ...(await each(
      'readTargetRef',
      TARGETS.map((input) => ({ input })),
      (i) => readTargetRef(i.input),
    )),
  ];
  const intentInputs = INTENTS.map((intent) => ({ intent, activeDid: ME }));
  intentInputs.push({ intent: { text: 'x' } });
  intentInputs.push({ intent: { draftId: 'd1' } });
  all.push(
    ...(await each('normalizeIntent', intentInputs, (i) =>
      settle(
        normalizeIntent(
          withFiles(i.intent),
          i.activeDid === undefined ? undefined : { activeDid: i.activeDid },
        ),
        {},
      ),
    )),
    ...(await each('intentLoads', intentInputs, (i) =>
      intentLoads(
        normalizeIntent(withFiles(i.intent), { activeDid: i.activeDid }),
      ),
    )),
    ...(await each('intentLoads', [{ $id: 'null', intent: null }], () =>
      intentLoads(null),
    )),
  );
  const base = JSON.parse(
    JSON.stringify(
      emptyComposerState({ asDid: ME, defaults: { langs: ['en'] } }),
    ),
  );
  base.posts[0].id = 'p1';
  const seeds = [
    ...INTENTS.map((intent) => ({ base, intent })),
    { base: { ...base, posts: [] }, intent: { posts: ['a', 'b'] } },
  ];
  all.push(
    ...(await each('seedFromIntent', seeds, (i) =>
      settle(
        seedFromIntent(
          i.base,
          normalizeIntent(withFiles(i.intent), { activeDid: ME }),
          { emptyPost },
        ),
        i,
      ),
    )),
  );
  return all;
}

// ---- submit ------------------------------------------------------------------

function errorOf(spec) {
  if (spec == null) return spec;
  const err = new Error(spec.message ?? '');
  for (const [k, v] of Object.entries(spec)) if (k !== 'message') err[k] = v;
  return err;
}

async function submitCases() {
  const all = [
    value('submitConstants', {
      SLOW_PUBLISH_MS,
      HARD_PUBLISH_MS,
      SLOW_PUBLISH_NOTE,
      HARD_PUBLISH_ERROR,
      SCHEDULED_COPY_REMAINS,
      DRAFT_NOT_DELETED,
    }),
  ];
  const EVENTS = [
    null,
    'uploading',
    [],
    { phase: 'uploading', kind: 'images', done: 0, total: 1 },
    { phase: 'uploading', kind: 'images', done: 1, total: 1 },
    { phase: 'uploading', kind: 'images', done: 2, total: 4 },
    { phase: 'uploading', kind: 'images', done: 4, total: 4 },
    { phase: 'uploading', kind: 'images', total: 3 },
    { phase: 'uploading', kind: 'images', done: 1, total: 0 },
    { phase: 'uploading', kind: 'images', done: 1 },
    { phase: 'uploading', kind: 'card' },
    { phase: 'video', step: 'checking' },
    { phase: 'video', step: 'uploading' },
    { phase: 'video', step: 'processing' },
    { phase: 'video', step: 'processing', progress: 0.004 },
    { phase: 'video', step: 'processing', progress: 0.425 },
    { phase: 'video', step: 'processing', progress: 1 },
    { phase: 'video', step: 'processing', progress: 42.5 },
    { phase: 'video', step: 'other' },
    { phase: 'writing' },
    { phase: 'writing', count: 3 },
    { phase: 'writing', count: 1 },
    { phase: 'done' },
  ];
  const progress = [];
  for (const event of EVENTS) progress.push({ event });
  progress.push({ event: { phase: 'writing' }, posts: 5 });
  all.push(
    ...(await each('progressLine', progress, (i) =>
      progressLine(
        i.event,
        i.posts === undefined ? undefined : { posts: i.posts },
      ),
    )),
  );
  const ERRORS = [
    null,
    { name: 'AbortError', message: 'aborted' },
    { code: 'ABORTED', message: 'x' },
    { canceled: true, message: 'Cancelled.' },
    { code: 'MISSING_SCOPE', message: 'nope' },
    { error: 'ScopeMissingError', message: 'Missing required scope "repo"' },
    { message: 'insufficient scope for this' },
    { code: 'REAUTH_REQUIRED', message: 'sign in' },
    { status: 401, message: 'Unauthorized' },
    { status: 500, message: '  The PDS is down.  ' },
    { message: '' },
    { message: '   ' },
    { status: 403, message: 'InsufficientScope' },
  ];
  all.push(
    ...(await each(
      'publishErrorView',
      ERRORS.map((error) => ({ error })),
      (i) => publishErrorView(errorOf(i.error)),
    )),
    ...(await each(
      'accountLabel',
      [
        { account: { handle: 'mira.example' }, did: ME },
        { account: { displayName: 'Mira' }, did: ME },
        { account: { handle: '', displayName: '' }, did: ME },
        { account: null, did: ME },
        { account: null, did: '' },
        { account: null },
      ],
      (i) => accountLabel(i.account, i.did),
    )),
    ...(await each(
      'postedToast',
      [
        {
          account: { handle: 'mira.example' },
          did: ME,
          root: { uri: `at://${ME}/app.bsky.feed.post/3k` },
        },
        {
          account: null,
          did: ME,
          root: { uri: `at://${ME}/app.bsky.feed.post/3k` },
        },
        { account: { handle: 'mira.example' }, did: ME, root: null },
        {
          account: { handle: 'mira.example' },
          did: ME,
          root: { uri: 'nonsense' },
        },
      ],
      (i) => postedToast(i),
    )),
  );
  const NOW = Date.parse('2026-11-16T15:00:00Z');
  const WHENS = [
    '2026-11-16T17:00:00Z',
    '2026-11-17T09:00:00Z',
    '2026-11-17T23:30:00Z',
    '2026-11-19T09:05:00Z',
    '2026-11-16T09:00:00',
    'junk',
    null,
  ];
  const whenInputs = [];
  for (const tz of ['UTC', 'America/New_York', 'Pacific/Chatham'])
    for (const locale of ['en-US', 'en-GB'])
      for (const at of WHENS)
        for (const timeZone of [undefined, 'Asia/Kolkata'])
          whenInputs.push({ tz, locale, at, now: NOW, timeZone });
  all.push(
    ...(await each('whenWords', whenInputs, (i) =>
      inZone(i.tz, () =>
        whenWords(i.at, {
          now: i.now,
          locale: i.locale,
          ...(i.timeZone ? { timeZone: i.timeZone } : {}),
        }),
      ),
    )),
  );
  const messages = [];
  for (const queued of [false, true])
    for (const editing of [false, true])
      for (const repeat of [null, { every: 'week' }, { every: '2weeks' }])
        messages.push({
          at: '2026-11-17T09:00:00Z',
          queued,
          editing,
          repeat,
          account: { handle: 'mira.example' },
          did: ME,
          now: NOW,
          locale: 'en-US',
          timeZone: 'UTC',
          tz: 'UTC',
        });
  messages.push({
    at: '2026-11-17T09:00:00Z',
    did: ME,
    now: NOW,
    tz: 'America/New_York',
    locale: 'en-GB',
  });
  all.push(
    ...(await each('scheduledMessage', messages, ({ tz, locale, ...m }) =>
      inZone(tz, () => {
        setActiveLocale(locale);
        try {
          return scheduledMessage(m);
        } finally {
          setActiveLocale(DEFAULT_LOCALE);
        }
      }),
    )),
  );
  const ROWS = [
    { id: 'a', queued: true, status: 'pending' },
    { id: 'b', queued: true, status: 'publishing' },
    { id: 'c', queued: true, status: 'failed' },
    { id: 'd', queued: true, status: 'published' },
    { id: 'e', queued: false, status: 'pending' },
    { id: 'f', status: 'pending' },
    null,
    { id: null, queued: true, status: 'pending' },
    { queued: 1, status: 'pending' },
  ];
  all.push(
    ...(await each(
      'queueSlotRows',
      [
        { rows: ROWS },
        { rows: ROWS, excludeId: 'a' },
        { rows: ROWS, excludeId: null },
        { rows: null },
        { rows: ROWS, excludeId: 'zzz' },
      ],
      (i) =>
        queueSlotRows(
          i.rows,
          i.excludeId === undefined ? undefined : { excludeId: i.excludeId },
        ),
    )),
  );

  // finishSource: every call scripted, and recorded in order.
  const SCRIPTS = [
    { source: null },
    { source: { kind: 'draft' } },
    {
      source: { kind: 'draft', id: 'd1', ownerDid: 'did:plc:owner' },
      agent: 'ok',
      del: 'ok',
    },
    { source: { kind: 'draft', id: 'd1' }, agent: 'ok', del: 'ok' },
    { source: { kind: 'draft', id: 'd1' }, agent: 'fail', del: 'ok' },
    { source: { kind: 'draft', id: 'd1' }, agent: 'ok', del: 'fail' },
    { source: { kind: 'scheduled', id: 's1' }, req: true, cancel: ['ok'] },
    {
      source: { kind: 'scheduled', id: 's1' },
      req: true,
      cancel: ['fail', 'ok'],
    },
    {
      source: { kind: 'scheduled', id: 's1' },
      req: true,
      cancel: ['fail', 'fail'],
    },
    { source: { kind: 'scheduled', id: 's1' }, req: true, cancel: ['404'] },
    {
      source: { kind: 'scheduled', id: 's1' },
      req: true,
      cancel: ['fail', '404'],
    },
    { source: { kind: 'scheduled', id: 's1' }, req: false, cancel: ['ok'] },
    { source: { kind: 'other', id: 'x1' } },
  ];
  all.push(
    ...(await each('finishSource', SCRIPTS, async (s) => {
      const calls = [];
      const cancels = [...(s.cancel || [])];
      const result = await finishSource(s.source, {
        asDid: ME,
        agentFor: async (did) => {
          calls.push(['agentFor', did]);
          if (s.agent === 'fail') throw new Error('signed out');
          return 'agent';
        },
        backendFor: (did) => {
          calls.push(['backendFor', did]);
          return s.req ? 'req' : null;
        },
        deleteDraft: async (agent, id) => {
          calls.push(['deleteDraft', agent, id]);
          if (s.del === 'fail') throw new Error('nope');
        },
        cancelScheduled: async (req, id) => {
          calls.push(['cancelScheduled', req, id]);
          const step = cancels.shift();
          if (step === 'fail') throw new Error('down');
          if (step === '404')
            throw Object.assign(new Error('gone'), { status: 404 });
        },
        wait: async (ms) => {
          calls.push(['wait', ms]);
        },
      });
      return { result, calls };
    })),
  );
  return all;
}

export default async function cases() {
  return [
    ...(await actionCases()),
    ...(await defaultCases()),
    ...(await gatesModelCases()),
    ...(await intentCases()),
    ...(await submitCases()),
  ];
}
