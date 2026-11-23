// The corpus the timers.selfDestruct* generators share: timers in every
// shape the web is handed (RULES, with cross-sections for grids), fits,
// publish moments, timer-list rows and slot fixtures. Not a generator (the
// runner skips files starting with an underscore).

import * as SD from '../../../src/posting/timers/selfDestruct.js';

export const MIN = 60;
export const H = 3600;
export const D = 86400;
export const NOW = Date.parse('2026-08-27T12:00:00Z');
export const iso = (ms) => new Date(ms).toISOString();
export const after = (seconds, from = NOW) => iso(from + seconds * 1000);
export const LIST = 'at://did:plc:me/app.bsky.graph.list/3l';
export const LIST2 = 'at://did:plc:me/app.bsky.graph.list/3m';

/** Runs `fn` with Date.now() reading `now`. */
export function atClock(now, fn) {
  const real = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

// ---- the corpus ------------------------------------------------------------

export const ON = { enabled: true, lifespanSeconds: H };

/** [name, timer] pairs: every shape a timer arrives in. */
export const RULES = [
  ['undefined', undefined],
  ['null', null],
  ['a string', 'nonsense'],
  ['a number', 5],
  ['true', true],
  ['an array', [{ enabled: true }]],
  ['empty', {}],
  ['off', { enabled: false }],
  ['on', { enabled: true }],
  ['truthy switch', { enabled: 'yes', lifespanSeconds: '3600' }],
  ['falsy switch', { enabled: 0, lifespanSeconds: H }],
  ['an hour', ON],
  ['ten minutes', { enabled: true, lifespanSeconds: 10 * MIN }],
  ['a fraction', { enabled: true, lifespanSeconds: 4000.7 }],
  ['negative', { enabled: true, lifespanSeconds: -50 }],
  ['too short', { enabled: true, lifespanSeconds: 1 }],
  ['too long', { enabled: true, lifespanSeconds: 1e12 }],
  ['Infinity', { enabled: true, lifespanSeconds: 'Infinity' }],
  ['null length', { enabled: true, lifespanSeconds: null }],
  ['boolean length', { enabled: true, lifespanSeconds: true }],
  ['array length', { enabled: true, lifespanSeconds: [7200] }],
  ['hex length', { enabled: true, lifespanSeconds: '0x1c20' }],
  ['legacy', { ...ON, conditions: { minLikes: 5 } }],
  [
    'legacy extend',
    {
      ...ON,
      conditions: { minReplies: 1, onSpare: 'extend', maxExtensions: 3 },
    },
  ],
  [
    'legacy all',
    {
      ...ON,
      conditions: {
        mode: 'all',
        minLikes: 5,
        minReplies: 2,
        minReposts: '3',
        onSpare: 'extend',
        maxExtensions: 3,
      },
    },
  ],
  [
    'legacy beside clauses',
    {
      ...ON,
      conditions: {
        clauses: [{ metric: 'likes', op: 'gt', value: 9 }],
        minLikes: 5,
        minReposts: 0,
        logic: 'all',
        mode: 'any',
      },
    },
  ],
  [
    'only if',
    {
      ...ON,
      conditions: {
        sense: 'onlyIf',
        clauses: [{ metric: 'replies', op: 'gt', value: 5 }],
      },
    },
  ],
  [
    'unless, extend',
    {
      ...ON,
      conditions: {
        sense: 'unless',
        clauses: [{ metric: 'likes', value: 5 }],
        onSpare: 'extend',
        maxExtensions: 2,
      },
    },
  ],
  [
    'extend, no count',
    {
      ...ON,
      conditions: {
        clauses: [{ metric: 'reposts', value: '2' }],
        onSpare: 'extend',
      },
    },
  ],
  [
    'extend, too many',
    {
      ...ON,
      conditions: {
        clauses: [{ metric: 'quotes', value: 1 }],
        onSpare: 'extend',
        maxExtensions: 500,
      },
    },
  ],
  [
    'extend, unreadable count',
    {
      ...ON,
      conditions: {
        clauses: [{ metric: 'quotes', value: 1 }],
        onSpare: 'extend',
        maxExtensions: 'lots',
      },
    },
  ],
  [
    'keep with a count',
    {
      ...ON,
      conditions: {
        clauses: [{ metric: 'likes', value: 1 }],
        onSpare: 'keep',
        maxExtensions: 5,
      },
    },
  ],
  [
    'every metric, all',
    {
      ...ON,
      conditions: {
        logic: 'all',
        sense: 'onlyIf',
        clauses: [
          { metric: 'selfReplies', value: 2 },
          { metric: 'quotes', op: 'gt', value: 3 },
          { metric: 'likes', value: 1 },
          { metric: 'reposts', value: 1.9 },
          { metric: 'replies', op: 'gte', value: 1e9 },
        ],
      },
    },
  ],
  [
    'too many clauses',
    {
      ...ON,
      conditions: {
        clauses: [
          { metric: 'likes', value: 1 },
          { metric: 'likes', value: 2 },
          { metric: 'quotes', value: 1, from: { notFollowed: true } },
          { metric: 'quotes', value: 2, from: { followersOver: 100 } },
          { metric: 'quotes', value: 3, from: { notFollowed: true } },
          { metric: 'quotes', value: 4 },
          { metric: 'replies', value: 1 },
          { metric: 'reposts', value: 1 },
        ],
        minLikes: 3,
      },
    },
  ],
  [
    'clauses that say nothing',
    {
      ...ON,
      conditions: {
        clauses: [
          { metric: 'likes', value: 0 },
          { metric: 'replies' },
          { metric: 'reposts', value: '' },
          { metric: 'quotes', value: null },
          { metric: 'vibes', value: 3 },
          { value: 3 },
          null,
          'likes',
          { metric: 'likes', value: -2 },
          { metric: 'likes', value: 'abc' },
        ],
      },
    },
  ],
  [
    'quote filters',
    {
      ...ON,
      conditions: {
        clauses: [
          {
            metric: 'quotes',
            value: 10,
            from: { notFollowed: true, followersOver: 10000, match: 'all' },
          },
          { metric: 'likes', value: 3, from: { notFollowed: true } },
        ],
      },
    },
  ],
  [
    'a filter that tests nothing',
    {
      ...ON,
      conditions: {
        clauses: [
          {
            metric: 'quotes',
            value: 4,
            from: { match: 'all', notFollowed: 0, followersOver: 0 },
          },
        ],
      },
    },
  ],
  [
    'a huge threshold',
    {
      ...ON,
      conditions: {
        clauses: [
          {
            metric: 'quotes',
            value: '2500000',
            from: { followersOver: 99999999.5, match: 'most' },
          },
        ],
      },
    },
  ],
  [
    'unknown sense and logic',
    {
      ...ON,
      conditions: {
        sense: 'whenever',
        logic: 'most',
        clauses: [{ metric: 'likes', op: 'lt', value: 3 }],
      },
    },
  ],
  [
    'unknown metric',
    {
      ...ON,
      conditions: {
        sense: 'unless',
        clauses: [{ metric: 'bookmarks', op: 'gte', value: 5 }],
      },
    },
  ],
  [
    'unreadable parts',
    {
      ...ON,
      conditions: {
        sense: 5,
        logic: null,
        clauses: [
          7,
          { metric: null, value: 1 },
          { metric: 'likes', op: 'roughly', value: 5 },
          { metric: 'quotes', value: 5, from: { match: 'any' } },
          { metric: 'quotes', value: 6, from: 'friends' },
          { metric: 'quotes', value: 7, from: null },
          [],
        ],
      },
      effects: [{ action: 'archive' }, null, { action: 3 }, 'delete', []],
    },
  ],
  [
    'conditions not an object',
    { ...ON, conditions: 'likes', effects: { action: 'delete' } },
  ],
  [
    'gates only',
    {
      ...ON,
      effects: [
        { action: 'limitReplies', allow: ['follower'] },
        { action: 'disableQuotes' },
      ],
    },
  ],
  [
    'limit replies only',
    { ...ON, effects: [{ action: 'limitReplies', allow: ['following'] }] },
  ],
  ['quotes off only', { ...ON, effects: [{ action: 'disableQuotes' }] }],
  [
    'quotes off and delete',
    { ...ON, effects: [{ action: 'delete' }, { action: 'disableQuotes' }] },
  ],
  [
    'everything',
    {
      ...ON,
      conditions: {
        sense: 'onlyIf',
        clauses: [{ metric: 'quotes', op: 'gte', value: 10 }],
      },
      effects: [
        { action: 'delete' },
        { action: 'disableQuotes' },
        { action: 'limitReplies' },
        { action: 'delete' },
      ],
    },
  ],
  [
    'reply limit to nobody',
    { ...ON, effects: [{ action: 'limitReplies', allow: [] }] },
  ],
  [
    'allow lists',
    {
      ...ON,
      effects: [
        {
          action: 'limitReplies',
          allow: [
            'mention',
            { list: ` ${LIST} `, name: '  Pals  ' },
            { list: LIST },
            'mention',
            { list: LIST2, name: '' },
            'everyone',
            { list: 'at://did:plc:me/app.bsky.feed.post/3p' },
            { list: 'https://bsky.app/app.bsky.graph.list/x' },
            { list: 5 },
            null,
            'follower',
            'following',
          ],
        },
        { action: 'delete' },
      ],
    },
  ],
  [
    'a long list name',
    {
      ...ON,
      effects: [
        {
          action: 'limitReplies',
          allow: [
            { list: LIST, name: `${'n'.repeat(63)} tail` },
            { list: LIST2, name: `${'é'.repeat(62)}😀😀` },
          ],
        },
      ],
    },
  ],
  ['unknown effect', { ...ON, effects: [{ action: 'archive' }] }],
  ['effects not a list', { ...ON, effects: 'delete' }],
  ['pinned', { enabled: true, lifespanSeconds: 9999, deleteAt: after(2 * H) }],
  ['pinned soon', { enabled: true, deleteAt: after(2 * MIN) }],
  ['pinned on the floor', { ...ON, deleteAt: after(5 * MIN) }],
  ['pinned just passed', { ...ON, deleteAt: after(-30) }],
  ['pinned at the grace', { ...ON, deleteAt: after(-60) }],
  ['pinned past the grace', { ...ON, deleteAt: after(-61) }],
  ['pinned long passed', { ...ON, deleteAt: after(-10 * H) }],
  ['pinned on the ceiling', { ...ON, deleteAt: after(30 * D) }],
  ['pinned past the ceiling', { ...ON, deleteAt: after(30 * D + 1) }],
  ['pinned far', { ...ON, deleteAt: after(40 * D) }],
  ['pinned unreadable', { ...ON, deleteAt: 'not a date' }],
  ['pinned empty', { ...ON, deleteAt: '' }],
  ['pinned as a number', { ...ON, deleteAt: NOW + 3 * H * 1000 }],
  ['pinned as an array', { ...ON, deleteAt: ['2026-08-28T12:00:00Z'] }],
  ['pinned as an object', { ...ON, deleteAt: { at: 1 } }],
  ['pinned with an offset', { ...ON, deleteAt: '2026-08-27T18:30:00+05:30' }],
  ['pinned, off', { enabled: false, ...{ deleteAt: after(-10 * H) } }],
  [
    'pinned, conditions, gates',
    {
      enabled: true,
      lifespanSeconds: 10 * MIN,
      deleteAt: after(20 * H),
      conditions: {
        clauses: [{ metric: 'likes', value: 5 }],
        onSpare: 'extend',
        maxExtensions: 2,
      },
      effects: [
        { action: 'limitReplies', allow: ['mention', { list: LIST }] },
        { action: 'delete' },
      ],
    },
  ],
  [
    'off, carrying a rule',
    {
      enabled: false,
      lifespanSeconds: H,
      deleteAt: after(3 * H),
      conditions: {
        sense: 'onlyIf',
        clauses: [{ metric: 'replies', op: 'gt', value: 5 }],
        onSpare: 'extend',
        maxExtensions: 3,
      },
      effects: [{ action: 'limitReplies' }],
    },
  ],
];

export const rulesInput = () =>
  RULES.map(([name, timer]) => ({ $id: name, timer }));

export const pick = (...names) =>
  names.map((name) => {
    const found = RULES.find(([n]) => n === name);
    if (!found) throw new Error(`no rule named ${name}`);
    return found;
  });

/** A cross-section of the corpus for grids: a rule of every kind. */
export const GRID_RULES = pick(
  'undefined',
  'a string',
  'off',
  'on',
  'an hour',
  'a fraction',
  'legacy extend',
  'only if',
  'unless, extend',
  'every metric, all',
  'quote filters',
  'unknown metric',
  'unreadable parts',
  'gates only',
  'limit replies only',
  'quotes off only',
  'quotes off and delete',
  'everything',
  'allow lists',
  'a long list name',
  'pinned',
  'pinned just passed',
  'pinned long passed',
  'pinned far',
  'pinned, conditions, gates',
  'off, carrying a rule',
);

/** Every pinned rule, and a few without a pin, to judge against moments. */
export const PIN_RULES = [
  ...pick('undefined', 'off', 'an hour', 'unless, extend', 'quotes off only'),
  ...RULES.filter(([n]) => n.startsWith('pinned')),
];

/** Fits, from the composer and from the server's rule model. */
export const FITS = [
  ['default', undefined],
  ['reply', composerFit({ reply: true })],
  ['unavailable', composerFit({ unavailable: true })],
  ['no gates or counts', { gatesSupported: false, conditionsSupported: false }],
  ['no gates', { gatesSupported: false }],
  ['no counts', { conditionsSupported: false }],
  ['loose falsy', { gatesSupported: 0, replyLimitSupported: null }],
];

export function composerFit(options) {
  return SD.composerTimerFit(options);
}

export function grid2(as, bs, make) {
  const out = [];
  for (const [an, a] of as)
    for (const [bn, b] of bs) out.push(make(an, a, bn, b));
  return out;
}

export const timerAndFit = () =>
  grid2(GRID_RULES, FITS, (rn, timer, fn, fit) => ({
    $id: `${rn} / ${fn}`,
    timer,
    fit,
  }));

/** Publish moments to judge a pin against. */
export const MOMENTS = [
  ['now', NOW],
  ['an hour ago', NOW - H * 1000],
  ['in a day', NOW + D * 1000],
  ['in a month', NOW + 31 * D * 1000],
  ['a fraction', NOW + 0.5],
  ['unreadable', NaN],
];

// ---- rows -------------------------------------------------------------------

export const at = (minutes) => iso(NOW + minutes * 60 * 1000);

export const LIST_ROWS = [
  { id: 'acted', status: 'acted', resolvedAt: at(-60) },
  { id: 'b', status: 'armed', checkAt: at(30) },
  { id: 'failed', status: 'failed', checkAt: at(-5) },
  { id: 'a', status: 'checking', checkAt: at(-1) },
  {
    id: 'settled-old',
    status: 'deleted',
    resolvedAt: '2026-08-20T00:00:00Z',
    checkAt: '2026-08-20T00:00:00Z',
  },
  { id: 'live-later', status: 'armed', checkAt: '2026-08-28T00:00:00Z' },
  {
    id: 'settled-new',
    status: 'spared',
    resolvedAt: '2026-08-26T00:00:00Z',
    checkAt: '2026-08-26T00:00:00Z',
  },
  { id: 'live-soon', status: 'checking', checkAt: '2026-08-27T13:00:00Z' },
];

export const ODD_ROWS = [
  { id: 'no times', status: 'armed' },
  { id: 'unreadable', status: 'armed', checkAt: 'soon' },
  { id: 'settled, check only', status: 'cancelled', checkAt: at(10) },
  { id: 'settled, unreadable', status: 'deleted', resolvedAt: 'never' },
  { id: 'settled, empty', status: 'deleted', resolvedAt: '', checkAt: at(2) },
  { id: 'number time', status: 'armed', checkAt: NOW + 5000 },
  { id: 'local time', status: 'armed', checkAt: '2026-08-27T14:00:00' },
  { id: 'object time', status: 'checking', checkAt: { t: 1 } },
  null,
  { id: 'no status' },
  { id: 'Armed', status: 'Armed', checkAt: at(1) },
];

// ---- slots ------------------------------------------------------------------

export const PLAIN = { lifespanSeconds: 3600 };
export const CONDITIONAL = {
  lifespanSeconds: 3600,
  conditions: {
    sense: 'unless',
    clauses: [{ metric: 'replies', op: 'gte', value: 1 }],
  },
};
export const GATE_ONLY = {
  lifespanSeconds: 3600,
  effects: [{ action: 'disableQuotes' }],
};

export const limits = (usage, limit = 1) => ({
  features: {
    postTimers: { limit },
    conditionalTimers: { limit },
    scheduledPosts: { limit: 3 },
  },
  usage,
});
