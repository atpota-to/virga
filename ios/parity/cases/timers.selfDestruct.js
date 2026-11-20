// src/posting/timers/selfDestruct.js, the rule model's normalizers: the
// constants, lifespans and the custom box, thresholds, actor filters,
// clauses and conditions (the legacy shape too), effects and allow entries,
// whole timers, the preview evaluator, the timer list and the account's
// slots. Swift: VirgaPosting/Timers/SelfDestruct*.swift.
//
// Every function runs over one corpus of timers (_timers.js RULES: what the
// web is handed, from nothing at all to stored rules a newer build wrote),
// so each branch is met from every side. Inputs from selfDestruct.test.js,
// plus loose values of every JSON type. Changing and fitting rules,
// publishing and drafts are timers.selfDestructRules; the sentences, in
// several locales and zones, timers.selfDestructWords.

import * as SD from '../../../src/posting/timers/selfDestruct.js';
import { each, value } from './_helpers.js';
import { inZone } from './_zones.js';
import {
  CONDITIONAL,
  GATE_ONLY,
  GRID_RULES,
  LIST,
  LIST2,
  LIST_ROWS,
  ODD_ROWS,
  PLAIN,
  RULES,
  limits,
  rulesInput,
} from './_timers.js';

export const sources = ['src/posting/timers/selfDestruct.js'];

const LOCAL_ZONES = ['America/New_York', 'Asia/Kolkata', 'Pacific/Chatham'];

export default async function cases() {
  const out = [
    value('constants', {
      MIN_LIFESPAN_SECONDS: SD.MIN_LIFESPAN_SECONDS,
      MAX_LIFESPAN_SECONDS: SD.MAX_LIFESPAN_SECONDS,
      MAX_EXTENSIONS_CAP: SD.MAX_EXTENSIONS_CAP,
      LIFESPAN_PRESETS: SD.LIFESPAN_PRESETS,
      DEFAULT_LIFESPAN_SECONDS: SD.DEFAULT_LIFESPAN_SECONDS,
      LIFESPAN_UNITS: SD.LIFESPAN_UNITS,
      CONDITION_MODES: SD.CONDITION_MODES,
      SPARE_ACTIONS: SD.SPARE_ACTIONS,
      CONDITION_SENSES: SD.CONDITION_SENSES,
      METRICS: SD.METRICS,
      METRIC_KEYS: SD.METRIC_KEYS,
      OPERATORS: SD.OPERATORS,
      OPERATOR_KEYS: SD.OPERATOR_KEYS,
      MAX_CLAUSES: SD.MAX_CLAUSES,
      FILTERABLE_METRICS: SD.FILTERABLE_METRICS,
      ACTOR_TESTS: SD.ACTOR_TESTS,
      DEFAULT_FOLLOWERS_OVER: SD.DEFAULT_FOLLOWERS_OVER,
      EFFECTS: SD.EFFECTS,
      EFFECT_KEYS: SD.EFFECT_KEYS,
      ALLOW_OPTIONS: SD.ALLOW_OPTIONS,
      ALLOW_KEYS: SD.ALLOW_KEYS,
      MAX_ALLOW_RULES: SD.MAX_ALLOW_RULES,
      BLUESKY_ONLY_EFFECTS: SD.BLUESKY_ONLY_EFFECTS,
      PAST_DEADLINE_GRACE_SECONDS: SD.PAST_DEADLINE_GRACE_SECONDS,
      TIMERS_UNAVAILABLE_NOTE: SD.TIMERS_UNAVAILABLE_NOTE,
      EXPIRED_DRAFT_TIMER_NOTE: SD.EXPIRED_DRAFT_TIMER_NOTE,
      TIMER_BUCKET_FEATURE: SD.TIMER_BUCKET_FEATURE,
      TIMER_SLOT_FEATURE_BUCKET: SD.TIMER_SLOT_FEATURE_BUCKET,
    }),
  ];
  const add = async (fn, inputs, compute) =>
    out.push(...(await each(fn, inputs, compute)));

  // ---- lengths ---------------------------------------------------------------

  const LENGTHS = [
    1,
    299,
    300,
    301,
    599,
    600,
    1800,
    2700,
    3600,
    5400,
    7200,
    4000.7,
    21600,
    43200,
    86400,
    90000,
    172800,
    259200,
    450000,
    604800,
    2591999,
    2592000,
    2592001,
    1e12,
    -50,
    0,
    -0.5,
    '3600',
    ' 7200 ',
    '',
    'nonsense',
    null,
    true,
    false,
    [600],
    [1, 2],
    {},
    'Infinity',
    '-Infinity',
    '1e3',
    '0x12c',
  ];
  const lengths = () => [
    { $id: 'undefined' },
    ...LENGTHS.map((seconds) => ({ seconds })),
  ];
  await add('normalizeLifespan', lengths(), ({ seconds }) =>
    SD.normalizeLifespan(seconds),
  );
  await add('isPresetLifespan', lengths(), ({ seconds }) =>
    SD.isPresetLifespan(seconds),
  );
  await add('splitLifespan', lengths(), ({ seconds }) =>
    SD.splitLifespan(seconds),
  );
  const UNITS = ['minutes', 'hours', 'days', 'weeks', '', null, undefined];
  const AMOUNTS = [
    '',
    '1',
    '4',
    '5',
    '5.9',
    '0',
    '-3',
    '15',
    '90',
    '720',
    '721',
    '30',
    '31',
    '900',
    'abc',
    ' 6 ',
    0.5,
    2,
    1e3,
    null,
    true,
    [2],
    'Infinity',
  ];
  const parts = [];
  for (const unitKey of UNITS)
    for (const amount of AMOUNTS) parts.push({ amount, unitKey });
  await add('lifespanFromParts', parts, ({ amount, unitKey }) =>
    SD.lifespanFromParts(amount, unitKey),
  );
  await add(
    'maxAmountForUnit',
    UNITS.map((unitKey) => ({ unitKey })),
    ({ unitKey }) => SD.maxAmountForUnit(unitKey),
  );

  // ---- thresholds, filters, clauses ------------------------------------------

  const THRESHOLDS = [
    0,
    1,
    1.9,
    5,
    -1,
    999999,
    1000000,
    1000001,
    1e300,
    '',
    ' ',
    '5',
    '5.5',
    'x',
    null,
    true,
    false,
    [],
    [3],
    [1, 2],
    {},
    'Infinity',
    NaN,
    -0.5,
  ];
  await add(
    'normalizeThreshold',
    [{ $id: 'undefined' }, ...THRESHOLDS.map((v) => ({ value: v }))],
    ({ value: v }) => SD.normalizeThreshold(v),
  );
  const FILTERS = [
    undefined,
    null,
    'friends',
    5,
    [],
    {},
    { notFollowed: false, followersOver: 0 },
    { notFollowed: true },
    { followersOver: 10000 },
    { followersOver: '2500', match: 'all' },
    { match: 'all', notFollowed: 1, followersOver: 1.5 },
    { match: 'most', notFollowed: 'yes', followersOver: -4 },
    { match: 'any' },
    { match: ['all'], notFollowed: true },
  ];
  await add(
    'normalizeActorFilter',
    FILTERS.map((raw) => ({ raw })),
    ({ raw }) => SD.normalizeActorFilter(raw),
  );
  const CLAUSES = [
    undefined,
    null,
    'likes',
    7,
    [],
    {},
    { metric: 'likes' },
    { metric: 'likes', value: 0 },
    { metric: 'likes', value: 5 },
    { metric: 'likes', op: 'gt', value: '5' },
    { metric: 'likes', op: 'lt', value: 3 },
    { metric: 'likes', op: null, value: 3 },
    { metric: 'vibes', value: 3 },
    { metric: 'Likes', value: 3 },
    { metric: 'selfReplies', op: 'gte', value: 2.7 },
    { metric: 'quotes', value: 10, from: { notFollowed: true } },
    { metric: 'quotes', value: 10, from: { match: 'any' } },
    { metric: 'quotes', value: 10, from: null },
    { metric: 'likes', value: 10, from: { notFollowed: true } },
    {
      metric: 'quotes',
      value: 3,
      from: { followersOver: 10000, notFollowed: true, match: 'all' },
    },
    { metric: 'replies', value: 5000000 },
  ];
  await add(
    'normalizeClause',
    CLAUSES.map((raw) => ({ raw })),
    ({ raw }) => SD.normalizeClause(raw),
  );
  await add(
    'clauseCountKey',
    [
      ...CLAUSES.map((clause) => ({ clause })),
      ...CLAUSES.map((raw) => ({ clause: SD.normalizeClause(raw) })),
      {
        clause: {
          metric: 'quotes',
          from: { match: 'all', followersOver: [1, 2] },
        },
      },
      { clause: { from: { notFollowed: true } } },
      { clause: { metric: 5, from: { match: null, followersOver: 0 } } },
    ],
    ({ clause }) => SD.clauseCountKey(clause),
  );

  // ---- conditions ---------------------------------------------------------------

  const CONDITIONS = [
    ...RULES.map(([name, timer]) => [`of ${name}`, timer?.conditions]),
    ['legacy zero', { minLikes: 0, minReplies: '', minReposts: null }],
    ['legacy only reposts', { minReposts: 4, sense: 'onlyIf' }],
    ['mode all', { mode: 'all' }],
    ['logic beats mode', { logic: 'any', mode: 'all' }],
    ['extend zero', { onSpare: 'extend', maxExtensions: 0 }],
    ['extend negative', { onSpare: 'extend', maxExtensions: -3 }],
    ['extend fraction', { onSpare: 'extend', maxExtensions: 2.9 }],
    ['extend string', { onSpare: 'extend', maxExtensions: '4' }],
    ['extend null', { onSpare: 'extend', maxExtensions: null }],
    ['extend Infinity', { onSpare: 'extend', maxExtensions: 'Infinity' }],
    ['spare unknown', { onSpare: 'discard', maxExtensions: 3 }],
    ['clauses not a list', { clauses: { metric: 'likes', value: 1 } }],
    ['an array', [{ metric: 'likes', value: 1 }]],
  ];
  const conditionsInput = () =>
    CONDITIONS.map(([name, conditions]) => ({ $id: name, conditions }));
  await add('normalizeConditions', conditionsInput(), ({ conditions }) =>
    SD.normalizeConditions(conditions),
  );
  await add('hasClauses', conditionsInput(), ({ conditions }) =>
    SD.hasClauses(conditions),
  );
  const forInputs = [];
  for (const [name, conditions] of CONDITIONS.filter((_, i) => i % 3 === 0))
    for (const metric of ['likes', 'quotes', 'selfReplies', 'vibes'])
      forInputs.push({ $id: `${name} / ${metric}`, conditions, metric });
  await add('clauseFor', forInputs, ({ conditions, metric }) =>
    SD.clauseFor(conditions, metric),
  );

  const FILTERED = SD.normalizeConditions({
    clauses: [{ metric: 'quotes', value: 10, from: { notFollowed: true } }],
  });
  const TWO = SD.normalizeConditions({
    clauses: [
      { metric: 'likes', value: 5 },
      { metric: 'quotes', value: 2 },
    ],
  });
  const PATCHES = [
    ['set', { op: 'gt', value: 2 }],
    ['number only', { value: 12 }],
    ['op only', { op: 'gt' }],
    ['clear', { op: 'gt', value: '' }],
    ['zero', { value: 0 }],
    ['string', { value: '7' }],
    ['from null', { value: 10, from: null }],
    ['from set', { value: 10, from: { followersOver: 1000 } }],
    ['from nothing', { value: 10, from: { notFollowed: false } }],
    ['empty', {}],
  ];
  const withInputs = [];
  for (const [cn, conditions] of [
    ['none', undefined],
    ['empty', {}],
    ['filtered', FILTERED],
    ['two', TWO],
    ['legacy', { minLikes: 5, logic: 'all', onSpare: 'extend' }],
  ])
    for (const metric of ['likes', 'quotes', 'vibes'])
      for (const [pn, patch] of PATCHES)
        withInputs.push({
          $id: `${cn} / ${metric} / ${pn}`,
          conditions,
          metric,
          patch,
        });
  withInputs.push({ $id: 'no patch', conditions: TWO, metric: 'likes' });
  await add('withClause', withInputs, ({ conditions, metric, patch }) =>
    SD.withClause(conditions, metric, patch),
  );
  // Clearing and retyping keeps metric order.
  await add(
    'withClause (chained)',
    [
      {
        steps: [
          ['quotes', { value: 5 }],
          ['likes', { value: 1 }],
        ],
      },
      {
        steps: [
          ['likes', { value: 1 }],
          ['selfReplies', { value: 3 }],
          ['replies', { op: 'gt', value: 2 }],
          ['likes', { value: '' }],
          ['likes', { value: 4 }],
        ],
      },
    ],
    ({ steps }) =>
      steps.reduce((c, [metric, patch]) => SD.withClause(c, metric, patch), {}),
  );

  // ---- effects and allow entries ----------------------------------------------

  const ENTRIES = [
    'follower',
    'following',
    'mention',
    'everyone',
    'Follower',
    '',
    null,
    5,
    [],
    {},
    { list: LIST },
    { list: ` ${LIST}\n`, name: ' Pals ' },
    { list: LIST, name: '   ' },
    { list: LIST, name: 7 },
    { list: LIST, name: `${'x'.repeat(70)}` },
    { list: LIST, name: `${'a'.repeat(63)}😀` },
    { list: 'at://did:plc:me/app.bsky.feed.post/3p' },
    { list: ' at://x/app.bsky.graph.list/' },
    { list: 'https://at://x/app.bsky.graph.list/y' },
    { list: ['at://x/app.bsky.graph.list/y'] },
    { name: 'no list' },
  ];
  await add(
    'normalizeAllowEntry',
    ENTRIES.map((entry) => ({ entry })),
    ({ entry }) => SD.normalizeAllowEntry(entry),
  );
  await add(
    'allowEntryKey',
    ENTRIES.map((entry) => SD.normalizeAllowEntry(entry))
      .filter(Boolean)
      .map((entry) => ({ entry })),
    ({ entry }) => SD.allowEntryKey(entry),
  );
  const EFFECT_ITEMS = [
    undefined,
    null,
    'delete',
    3,
    [],
    {},
    { action: 'delete' },
    { action: 'disableQuotes', allow: ['follower'] },
    { action: 'limitReplies' },
    { action: 'limitReplies', allow: [] },
    { action: 'limitReplies', allow: 'follower' },
    { action: 'limitReplies', allow: null },
    {
      action: 'limitReplies',
      allow: [
        'follower',
        'follower',
        'mention',
        { list: LIST },
        { list: ` ${LIST}` },
        { list: LIST2, name: 'Two' },
        'following',
        'x',
        { list: `${LIST}9` },
      ],
    },
    { action: 'archive' },
    { action: 'Delete' },
  ];
  await add(
    'normalizeEffect',
    EFFECT_ITEMS.map((raw) => ({ raw })),
    ({ raw }) => SD.normalizeEffect(raw),
  );
  const EFFECT_LISTS = [
    ...RULES.map(([name, timer]) => [`of ${name}`, timer?.effects]),
    ['empty', []],
    ['unknown', [{ action: 'somethingElse' }]],
    ['delete first', [{ action: 'delete' }, { action: 'disableQuotes' }]],
    [
      'reversed',
      [
        { action: 'delete' },
        { action: 'disableQuotes' },
        { action: 'limitReplies', allow: ['mention'] },
      ],
    ],
    ['repeats', [{ action: 'disableQuotes' }, { action: 'disableQuotes' }]],
    ['all loose', EFFECT_ITEMS],
  ];
  const effectsInput = () =>
    EFFECT_LISTS.map(([name, effects]) => ({ $id: name, effects }));
  await add('normalizeEffects', effectsInput(), ({ effects }) =>
    SD.normalizeEffects(effects),
  );
  await add('effectsDelete', effectsInput(), ({ effects }) =>
    SD.effectsDelete(effects),
  );
  const effectForInputs = [];
  for (const [name, effects] of EFFECT_LISTS.filter((_, i) => i % 4 === 0))
    for (const action of ['limitReplies', 'disableQuotes', 'delete', 'archive'])
      effectForInputs.push({ $id: `${name} / ${action}`, effects, action });
  await add('effectFor', effectForInputs, ({ effects, action }) =>
    SD.effectFor(effects, action),
  );
  const withEffectInputs = [];
  for (const [name, effects] of [
    ['none', undefined],
    ['empty', []],
    ['delete', [{ action: 'delete' }]],
    ['quotes and delete', [{ action: 'disableQuotes' }, { action: 'delete' }]],
    ['limit', [{ action: 'limitReplies', allow: ['mention'] }]],
    ['all', EFFECT_LISTS.find(([n]) => n === 'reversed')[1]],
  ])
    for (const action of ['limitReplies', 'disableQuotes', 'delete', 'archive'])
      for (const on of [true, false])
        for (const [xn, extra] of [
          ['no extra', undefined],
          ['allow', { allow: ['follower', 'mention'] }],
          ['action override', { action: 'delete' }],
        ])
          withEffectInputs.push({
            $id: `${name} / ${action} / ${on} / ${xn}`,
            effects,
            action,
            on,
            extra,
          });
  await add('withEffect', withEffectInputs, ({ effects, action, on, extra }) =>
    SD.withEffect(effects, action, on, extra),
  );

  // ---- whole timers --------------------------------------------------------------

  await add('normalizeTimer', rulesInput(), ({ timer }) =>
    SD.normalizeTimer(timer),
  );
  // Normalizing twice gives what normalizing once does, but for a list name
  // the first pass cut to end in a space.
  await add(
    'normalizeTimer (twice)',
    RULES.filter(([n]) => /list|legacy|everything/.test(n)).map(
      ([name, timer]) => ({ $id: name, timer }),
    ),
    ({ timer }) => SD.normalizeTimer(SD.normalizeTimer(timer)),
  );
  await add('withoutGateEffects', rulesInput(), ({ timer }) =>
    SD.withoutGateEffects(timer),
  );
  const withoutInputs = [];
  for (const [name, timer] of GRID_RULES.filter((_, i) => i % 2 === 1))
    for (const actions of [
      [],
      ['delete'],
      ['limitReplies'],
      ['disableQuotes', 'delete'],
    ])
      withoutInputs.push({
        $id: `${name} / ${actions.join('+') || 'none'}`,
        timer,
        actions,
      });
  await add('withoutEffects', withoutInputs, ({ timer, actions }) =>
    SD.withoutEffects(timer, actions),
  );
  await add('withoutConditions', rulesInput(), ({ timer }) =>
    SD.withoutConditions(timer),
  );
  await add(
    'composerTimerFit',
    [
      { $id: 'undefined' },
      { options: {} },
      { options: { reply: true } },
      { options: { unavailable: true } },
      { options: { editingExisting: true } },
      { options: { editingExisting: true, unavailable: true, reply: true } },
      { options: { reply: 'yes', unavailable: 0, editingExisting: null } },
      { options: { reply: '', unavailable: [], editingExisting: {} } },
    ],
    ({ options }) => SD.composerTimerFit(options),
  );

  // ---- evaluation ---------------------------------------------------------------

  const COUNTS = [
    [
      'the test’s',
      { likes: 5, replies: 2, reposts: 1, quotes: 6, selfReplies: 0 },
    ],
    ['none', undefined],
    ['empty', {}],
    ['many replies', { replies: 9 }],
    [
      'strings',
      {
        likes: '5',
        replies: 'x',
        quotes: '',
        reposts: null,
        selfReplies: true,
      },
    ],
    ['huge', { likes: 1e9, replies: 'Infinity', quotes: [7] }],
    ['negative', { likes: -5, selfReplies: 3 }],
    ['a number', 5],
  ];
  const evalInputs = [];
  for (const [cn, conditions] of CONDITIONS.filter((_, i) => i % 3 === 0))
    for (const [kn, counts] of COUNTS)
      evalInputs.push({ $id: `${cn} / ${kn}`, conditions, counts });
  await add('evaluateConditions', evalInputs, ({ conditions, counts }) =>
    SD.evaluateConditions(conditions, counts),
  );
  await add(
    'readCounts',
    COUNTS.map(([name, counts]) => ({ $id: name, counts })),
    ({ counts }) => SD.readCounts(counts),
  );

  // ---- the timer list -------------------------------------------------------------

  const listInputs = [
    { $id: 'the test’s', rows: LIST_ROWS.slice(0, 4) },
    { $id: 'the test’s, history', rows: LIST_ROWS.slice(0, 4), history: true },
    { $id: 'all', rows: LIST_ROWS },
    { $id: 'odd', rows: ODD_ROWS },
    { $id: 'odd, history', rows: [...ODD_ROWS, ...LIST_ROWS], history: true },
    { $id: 'empty', rows: [] },
    { $id: 'null', rows: null },
    {
      $id: 'only live',
      rows: [{ id: 'x', status: 'armed', checkAt: '2026-08-27T12:00:00Z' }],
    },
    { $id: 'reversed', rows: [...LIST_ROWS].reverse() },
  ];
  await add('groupTimers', listInputs, ({ rows, history }) =>
    SD.groupTimers(rows, { history }),
  );
  await add(
    'groupTimers (zones)',
    LOCAL_ZONES.map((zone) => ({ zone, rows: [...ODD_ROWS, ...LIST_ROWS] })),
    ({ zone, rows }) => inZone(zone, () => SD.groupTimers(rows)),
  );
  // Sorting with the comparator as V8 does (rows whose time can't be read
  // sort beside everything).
  await add(
    'compareTimers (sort)',
    listInputs.filter((c) => Array.isArray(c.rows)),
    ({ rows }) => [...rows].sort(SD.compareTimers).map((r) => r?.id ?? null),
  );
  const cmpPairs = [];
  const CMP = [...LIST_ROWS.slice(3, 8), ...ODD_ROWS.slice(0, 9)];
  for (const a of CMP)
    for (const b of CMP) cmpPairs.push({ $id: `${a?.id} | ${b?.id}`, a, b });
  await add('compareTimers', cmpPairs, ({ a, b }) => SD.compareTimers(a, b));

  const srow = (
    id,
    status,
    scheduledFor,
    selfDestruct = { lifespanSeconds: 3600 },
  ) => ({
    id,
    status,
    scheduledFor,
    payload: { posts: [], ...(selfDestruct ? { selfDestruct } : {}) },
  });
  const SCHEDULED = [
    srow('later', 'pending', '2026-10-10T12:00:00Z'),
    srow('none', 'pending', '2026-10-09T12:00:00Z', null),
    srow('failed', 'failed', '2026-10-09T13:00:00Z'),
    srow('out', 'publishing', '2026-10-09T09:00:00Z'),
    srow('sooner', 'pending', '2026-10-09T10:00:00Z'),
  ];
  const ODD_SCHEDULED = [
    srow('unreadable', 'pending', 'whenever'),
    srow('no time', 'pending', undefined),
    srow('null time', 'pending', null),
    srow('local', 'pending', '2026-10-09T09:30:00'),
    srow('number', 'publishing', Date.parse('2026-10-09T09:15:00Z')),
    srow('falsy spec', 'pending', '2026-10-01T00:00:00Z', 0),
    srow('conditional', 'pending', '2026-10-09T11:00:00Z', CONDITIONAL),
    srow('sent', 'sent', '2026-10-01T00:00:00Z'),
    null,
    { id: 'no payload', status: 'pending' },
  ];
  const waitingInputs = [
    { $id: 'the test’s', rows: SCHEDULED },
    { $id: 'odd', rows: [...SCHEDULED, ...ODD_SCHEDULED] },
    { $id: 'null', rows: null },
    { $id: 'undefined' },
    { $id: 'empty', rows: [] },
  ];
  await add('waitingTimerRows', waitingInputs, ({ rows }) =>
    SD.waitingTimerRows(rows),
  );
  await add(
    'waitingTimerRows (zones)',
    LOCAL_ZONES.map((zone) => ({
      zone,
      rows: [...SCHEDULED, ...ODD_SCHEDULED],
    })),
    ({ zone, rows }) => inZone(zone, () => SD.waitingTimerRows(rows)),
  );

  // ---- slots --------------------------------------------------------------------

  const BUCKETS = [
    ['plain', PLAIN],
    ['delete', { ...PLAIN, effects: [{ action: 'delete' }] }],
    ['conditional', CONDITIONAL],
    ['gate only', GATE_ONLY],
    [
      'delete and a gate',
      {
        ...PLAIN,
        effects: [{ action: 'delete' }, { action: 'disableQuotes' }],
      },
    ],
    ['unknown effect', { ...PLAIN, effects: [{ action: 'archive' }] }],
    [
      'empty clauses',
      { ...PLAIN, conditions: { clauses: [{ metric: 'likes', value: 0 }] } },
    ],
    ['legacy threshold', { conditions: { minLikes: 1 } }],
    ...RULES.map(([name, timer]) => [`rule: ${name}`, timer]),
  ];
  await add(
    'timerBucket',
    BUCKETS.map(([name, timer]) => ({ $id: name, timer })),
    ({ timer }) => SD.timerBucket(timer),
  );
  await add(
    'timerUsage',
    [
      {
        $id: 'the test’s',
        options: {
          liveRows: [
            { status: 'armed', ...PLAIN },
            { status: 'checking', ...GATE_ONLY },
            { status: 'deleted', ...PLAIN },
            { status: 'acted', ...CONDITIONAL },
          ],
          scheduledRows: [
            {
              id: 's1',
              status: 'pending',
              payload: { selfDestruct: CONDITIONAL },
            },
            { id: 's2', status: 'failed', payload: { selfDestruct: PLAIN } },
            { id: 's3', status: 'pending', payload: {} },
          ],
        },
      },
      {
        $id: 'except the row an edit rewrites',
        options: {
          scheduledRows: [
            { id: 's1', status: 'pending', payload: { selfDestruct: PLAIN } },
          ],
          exceptScheduledId: 's1',
        },
      },
      {
        $id: 'except by number, and nothing',
        options: {
          scheduledRows: [
            { id: 7, status: 'publishing', payload: { selfDestruct: PLAIN } },
            {
              id: '7',
              status: 'pending',
              payload: { selfDestruct: GATE_ONLY },
            },
            { status: 'pending', payload: { selfDestruct: CONDITIONAL } },
          ],
          exceptScheduledId: 7,
        },
      },
      {
        $id: 'except a falsy id',
        options: {
          scheduledRows: [
            { id: '', status: 'pending', payload: { selfDestruct: PLAIN } },
          ],
          exceptScheduledId: '',
        },
      },
      {
        $id: 'loose',
        options: {
          liveRows: [
            null,
            { status: 'Armed' },
            { status: 'armed', effects: 'x' },
          ],
          scheduledRows: [
            null,
            { status: 'pending', payload: { selfDestruct: 'yes' } },
          ],
        },
      },
      { $id: 'nulls', options: { liveRows: null, scheduledRows: null } },
      { $id: 'nothing' },
    ],
    ({ options }) => SD.timerUsage(options),
  );
  const slotInputs = [];
  for (const bucket of ['plain', 'conditional', 'other'])
    for (const limit of [null, undefined, 0, 1, 2, 2.5])
      for (const [un, usage] of [
        ['none', null],
        ['free', { plain: 0, conditional: 0 }],
        ['one each', { plain: 1, conditional: 1 }],
        ['two plain', { plain: 2, conditional: 0 }],
        ['conditional only', { conditional: 3 }],
      ])
        slotInputs.push({
          $id: `${bucket} / ${limit} / ${un}`,
          bucket,
          limit,
          usage,
        });
  await add('timerSlotProblem', slotInputs, (input) =>
    SD.timerSlotProblem(input),
  );
  await add(
    'timerSlotSentence',
    [
      { bucket: 'plain' },
      { bucket: 'conditional' },
      { bucket: 'other' },
      { bucket: null },
      ...['plain', 'conditional'].flatMap((bucket) =>
        [1, 2, 3, 0, 2.5, '1', '3', null].map((limit) => ({ bucket, limit })),
      ),
    ],
    ({ bucket, limit }) => SD.timerSlotSentence(bucket, limit),
  );
  await add(
    'timerSlotRefusal',
    [
      {
        payload: {
          code: 'QUOTA_EXCEEDED',
          feature: 'conditionalTimers',
          limit: 1,
        },
      },
      { payload: { code: 'QUOTA_EXCEEDED', feature: 'postTimers' } },
      { payload: { code: 'QUOTA_EXCEEDED', feature: 'postTimers', limit: 3 } },
      { payload: { feature: 'postTimers', limit: null } },
      { payload: { feature: 'postTimers', limit: '2' } },
      { payload: { code: 'QUOTA_EXCEEDED', feature: 'scheduledPosts' } },
      { payload: { feature: 'PostTimers' } },
      { payload: null },
      { payload: 'postTimers' },
      { $id: 'undefined' },
    ],
    ({ payload }) => SD.timerSlotRefusal(payload),
  );
  const PLAIN_RULE = { enabled: true, lifespanSeconds: 3600 };
  const CONDITIONAL_RULE = {
    enabled: true,
    lifespanSeconds: 3600,
    conditions: { clauses: [{ metric: 'likes', value: 3 }] },
  };
  const HELD = {
    lifespanSeconds: 3600,
    conditions: {},
    effects: [{ action: 'delete' }],
  };
  const roomInputs = [];
  const LIMITS = [
    ['plain free', limits({ postTimers: 0, conditionalTimers: 1 })],
    ['plain full', limits({ postTimers: 1, conditionalTimers: 0 })],
    ['both full', limits({ postTimers: 1, conditionalTimers: 1 })],
    ['three of three', limits({ postTimers: 3, conditionalTimers: 3 }, 3)],
    ['unlimited', limits({ postTimers: 5 }, null)],
    ['unread usage', limits({})],
    ['usage as text', limits({ postTimers: '1', conditionalTimers: '1' })],
    ['limit as text', limits({ postTimers: 1, conditionalTimers: 1 }, '1')],
    ['Infinity', limits({ postTimers: 1, conditionalTimers: 1 }, Infinity)],
    ['no features', { usage: { postTimers: 1 } }],
    ['null', null],
    ['a string', 'limits'],
  ];
  for (const [rn, rule] of [
    ['plain', PLAIN_RULE],
    ['conditional', CONDITIONAL_RULE],
    ['off', { ...PLAIN_RULE, enabled: false }],
    ['gates', { ...PLAIN_RULE, effects: [{ action: 'limitReplies' }] }],
  ])
    for (const [ln, lim] of LIMITS)
      for (const [hn, holds] of /full|three/.test(ln)
        ? [
            ['nothing held', undefined],
            ['holds plain', HELD],
            ['holds conditional', CONDITIONAL],
            ['holds a string', 'x'],
          ]
        : [['nothing held', undefined]])
        roomInputs.push({
          $id: `${rn} / ${ln} / ${hn}`,
          rule,
          limits: lim,
          holds,
        });
  await add('timerRoomProblem', roomInputs, ({ rule, limits: lim, holds }) =>
    SD.timerRoomProblem(rule, lim, { holds }),
  );

  return out;
}
