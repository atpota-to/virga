// src/posting/ui/lifespanModel.js: the lifespan editor's decisions, apart
// from the view. Which length is pressed, setting a length or a pin, what
// pressing an effect does, who may still reply, a metric's clause, the
// conditions and the quote filter, the picker's bounds, the notes under the
// rule (in locales and zones, since they name a pinned time), curate lists,
// when a timer first acts and where it starts counting. Swift:
// VirgaPosting/UI/LifespanModel.swift.
//
// Inputs from lifespanModel.test.js, over the corpus in _timers.js, plus
// loose values. editorNotes says a pinned time against the clock, so it runs
// with Date.now() held at the case's `now`.

import * as LM from '../../../src/posting/ui/lifespanModel.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { normalizeLimits } from '../../../src/posting/schedule/scheduleService.js';
import { normalizeTimer } from '../../../src/posting/timers/selfDestruct.js';
import { each, value } from './_helpers.js';
import { inZone } from './_zones.js';
import { GRID_RULES, LIST, LIST2, atClock, pick } from './_timers.js';

export const sources = ['src/posting/ui/lifespanModel.js'];

const NOW = Date.parse('2026-11-12T12:00:00Z');
const on = (extra = {}) =>
  normalizeTimer({ enabled: true, lifespanSeconds: 3600, ...extra });

/** Runs `fn` in `locale` and `zone`, then puts the defaults back. */
function inFormats(locale, zone, fn) {
  setActiveLocale(locale);
  try {
    return inZone(zone, fn);
  } finally {
    setActiveLocale(DEFAULT_LOCALE);
  }
}

const RULES = [
  ['on', on()],
  ['ninety minutes', on({ lifespanSeconds: 5400 })],
  ['pinned', on({ deleteAt: '2026-11-13T12:00:00Z' })],
  ['a week', on({ lifespanSeconds: 604800 })],
  [
    'quotes from',
    on({
      conditions: {
        clauses: [
          { metric: 'quotes', value: 2, from: { notFollowed: true } },
          { metric: 'likes', value: 4 },
        ],
      },
    }),
  ],
  [
    'quotes, no filter',
    on({ conditions: { clauses: [{ metric: 'quotes', op: 'gt', value: 7 }] } }),
  ],
  [
    'extend',
    on({
      conditions: {
        clauses: [{ metric: 'likes', value: 3 }],
        onSpare: 'extend',
        maxExtensions: 4,
      },
    }),
  ],
  [
    'limited',
    on({ effects: [{ action: 'limitReplies', allow: ['mention'] }] }),
  ],
  [
    'gates and delete',
    on({
      effects: [
        { action: 'limitReplies', allow: [] },
        { action: 'disableQuotes' },
        { action: 'delete' },
      ],
    }),
  ],
  ['off', normalizeTimer({ enabled: false })],
  ...pick(
    'undefined',
    'a string',
    'legacy',
    'everything',
    'allow lists',
    'pinned far',
    'off, carrying a rule',
  ),
];

const LIMITS = normalizeLimits({
  features: { postTimers: { limit: 1 }, conditionalTimers: { limit: 1 } },
  usage: { postTimers: 1, conditionalTimers: 0 },
});

export default async function cases() {
  const out = [
    value('constants', {
      FOLLOWER_THRESHOLDS: LM.FOLLOWER_THRESHOLDS,
      EXTENSION_CHOICES: LM.EXTENSION_CHOICES,
    }),
  ];
  const add = async (fn, inputs, compute) =>
    out.push(...(await each(fn, inputs, compute)));
  const rules = () => RULES.map(([name, rule]) => ({ $id: name, rule }));

  // ---- lengths -------------------------------------------------------------

  await add(
    'patchRule',
    [
      { $id: 'nothing', rule: on(), patch: {} },
      { $id: 'a length', rule: on(), patch: { lifespanSeconds: 600 } },
      { $id: 'off', rule: on(), patch: { enabled: false } },
      {
        $id: 'a pin',
        rule: on(),
        patch: { deleteAt: '2026-11-13T00:00:00+01:00' },
      },
      {
        $id: 'loose',
        rule: 'x',
        patch: { enabled: 1, effects: 'delete', conditions: { minLikes: '2' } },
      },
      {
        $id: 'a null',
        rule: on({ lifespanSeconds: 7200 }),
        patch: { lifespanSeconds: null },
      },
    ],
    ({ rule, patch }) => LM.patchRule(rule, patch),
  );
  await add(
    'lengthChoice',
    [
      ...rules(),
      { $id: 'every preset', rule: on({ lifespanSeconds: 300 }) },
      { $id: 'clamped up', rule: on({ lifespanSeconds: 1 }) },
      { $id: 'clamped down', rule: on({ lifespanSeconds: 1e9 }) },
    ],
    ({ rule }) => LM.lengthChoice(rule),
  );
  const lengthCases = [];
  for (const [name, rule] of RULES.slice(0, 6))
    for (const seconds of [300, 3600, '7200', 1, null, 'x'])
      lengthCases.push({ $id: `${name} / ${seconds}`, rule, seconds });
  await add('withLength', lengthCases, ({ rule, seconds }) =>
    LM.withLength(rule, seconds),
  );
  const pinCases = [];
  for (const [name, rule] of RULES.slice(0, 6))
    for (const iso of [
      '2026-11-13T12:00:00Z',
      '2026-11-13T12:00:00',
      '',
      null,
      'soon',
      1.8e12,
    ])
      pinCases.push({ $id: `${name} / ${iso}`, rule, iso });
  await add('withPin', pinCases, ({ rule, iso }) => LM.withPin(rule, iso));
  await add(
    'withPin (zones)',
    ['America/New_York', 'Asia/Kolkata'].map((zone) => ({
      zone,
      rule: on({ lifespanSeconds: 7200 }),
      iso: '2026-11-13T12:00:00',
    })),
    ({ zone, rule, iso }) => inZone(zone, () => LM.withPin(rule, iso)),
  );
  await add(
    'pinBounds',
    [
      { from: NOW },
      { from: NOW + 0.5 },
      { from: 0 },
      { from: -1e15 },
      { from: 8.64e15 },
      { from: NaN },
    ],
    ({ from }) => LM.pinBounds(from),
  );

  // ---- what happens ---------------------------------------------------------

  const toggleCases = [];
  for (const [name, rule] of RULES)
    for (const action of ['limitReplies', 'disableQuotes', 'delete', 'archive'])
      toggleCases.push({ $id: `${name} / ${action}`, rule, action });
  for (const allow of [
    [],
    ['mention', { list: LIST, name: 'Pals' }],
    null,
    'follower',
  ])
    toggleCases.push({
      $id: `on / limitReplies / ${JSON.stringify(allow)}`,
      rule: on(),
      action: 'limitReplies',
      allow,
    });
  await add('toggleEffect', toggleCases, ({ rule, action, allow }) =>
    LM.toggleEffect(rule, action, allow === undefined ? undefined : { allow }),
  );
  await add(
    'toggleEffect (chained)',
    [
      { steps: ['disableQuotes', 'delete', 'disableQuotes', 'delete'] },
      {
        steps: [
          'limitReplies',
          'disableQuotes',
          'limitReplies',
          'disableQuotes',
        ],
      },
      { steps: ['delete', 'delete'] },
    ],
    ({ steps }) =>
      steps.reduce((t, action) => LM.toggleEffect(t, action), on()),
  );
  const allowCases = [];
  const limited = LM.toggleEffect(on(), 'limitReplies');
  for (const [name, rule] of [
    ['limited by the toggle', limited],
    ['on', on()],
    ...RULES.slice(7, 9),
  ])
    for (const allow of [
      [],
      ['mention'],
      [
        'follower',
        'following',
        'mention',
        { list: LIST },
        { list: LIST2, name: 'Two' },
        { list: `${LIST}3` },
      ],
      null,
      undefined,
      'mention',
    ])
      allowCases.push({
        $id: `${name} / ${JSON.stringify(allow)}`,
        rule,
        allow,
      });
  await add('withAllow', allowCases, ({ rule, allow }) =>
    LM.withAllow(rule, allow),
  );
  const list = 'at://did:plc:me/app.bsky.graph.list/abc';
  await add(
    'toggleAllow',
    [
      { allow: ['follower'], entry: { list, name: 'Friends' } },
      { allow: ['follower', 'mention'], entry: 'follower' },
      {
        allow: [
          'follower',
          'following',
          'mention',
          { list },
          { list: `${list}2` },
        ],
        entry: { list: `${list}3` },
      },
      {
        allow: [
          'follower',
          'following',
          'mention',
          { list },
          { list: `${list}2` },
        ],
        entry: { list },
      },
      { allow: ['follower'], entry: 'everyone' },
      {
        allow: [{ list, name: 'Old name' }],
        entry: { list: ` ${list} `, name: 'New' },
      },
      { allow: [], entry: { list: 'at://did:plc:me/app.bsky.feed.post/x' } },
      { $id: 'no list yet', entry: 'mention' },
      { allow: ['mention'], entry: null },
    ],
    ({ allow, entry }) => LM.toggleAllow(allow, entry),
  );

  // ---- conditions -------------------------------------------------------------

  const metricCases = [];
  for (const [name, rule] of RULES.slice(0, 10))
    for (const [metric, patch] of [
      ['likes', { op: 'gt', value: '5' }],
      ['likes', { op: 'gt', value: '' }],
      ['quotes', { value: 2 }],
      ['quotes', { value: 2, from: null }],
      ['selfReplies', { value: 0 }],
      ['vibes', { value: 3 }],
    ])
      metricCases.push({
        $id: `${name} / ${metric} ${JSON.stringify(patch)}`,
        rule,
        metric,
        patch,
      });
  await add('withMetric', metricCases, ({ rule, metric, patch }) =>
    LM.withMetric(rule, metric, patch),
  );
  const condCases = [];
  for (const [name, rule] of [
    ['likes', LM.withMetric(on(), 'likes', { value: 3 })],
    ...RULES.slice(4, 7),
    ['off', RULES[9][1]],
  ])
    for (const patch of [
      { onSpare: 'extend' },
      { onSpare: 'extend', maxExtensions: 5 },
      { onSpare: 'extend', maxExtensions: null },
      { onSpare: 'keep' },
      { maxExtensions: 5 },
      { sense: 'onlyIf', logic: 'all' },
      { sense: 'sideways', clauses: [] },
      {},
    ])
      condCases.push({
        $id: `${name} / ${JSON.stringify(patch)}`,
        rule,
        patch,
      });
  await add('withConditions', condCases, ({ rule, patch }) =>
    LM.withConditions(rule, patch),
  );
  const quoted = LM.withMetric(on(), 'quotes', { value: 2 });
  const filtered = LM.withQuoteFilter(quoted, { notFollowed: true });
  const filterCases = [];
  for (const [name, rule] of [
    ['quoted', quoted],
    ['filtered', filtered],
    ['on', on()],
    ...RULES.slice(4, 6),
  ])
    for (const patch of [
      { notFollowed: true },
      { followersOver: 10000, match: 'all' },
      { notFollowed: false },
      { followersOver: 0 },
      { match: 'any', followersOver: '1000' },
      null,
      {},
    ])
      filterCases.push({
        $id: `${name} / ${JSON.stringify(patch)}`,
        rule,
        patch,
      });
  await add('withQuoteFilter', filterCases, ({ rule, patch }) =>
    LM.withQuoteFilter(rule, patch),
  );

  // ---- the notes under the rule ----------------------------------------------------

  const noteCases = [];
  const FITS = [
    ['none', undefined],
    ['root', {}],
    ['reply', { reply: true }],
    ['thread', { thread: true }],
    ['editing', { editingExisting: true }],
    ['reply in a thread', { reply: 1, thread: 'yes' }],
  ];
  const limitedRule = LM.toggleEffect(on(), 'limitReplies');
  for (const [rn, rule] of [...RULES, ['limited from on', limitedRule]])
    for (const [fn, fit] of FITS)
      noteCases.push({ $id: `${rn} / ${fn}`, rule, fit, now: NOW });
  const pinned = on({ deleteAt: '2026-11-13T12:00:00Z' });
  for (const [pn, rule] of [
    ['pinned', pinned],
    ['passed', on({ deleteAt: '2026-11-12T11:00:00Z' })],
    ['near', on({ deleteAt: '2026-11-12T12:02:00Z' })],
    ['on the floor', on({ deleteAt: '2026-11-12T12:05:00Z' })],
    ['far', on({ deleteAt: '2026-12-20T12:00:00Z' })],
    [
      'quotes off, near',
      on({
        deleteAt: '2026-11-12T12:02:00Z',
        effects: [{ action: 'disableQuotes' }],
      }),
    ],
  ])
    for (const publishAt of [
      undefined,
      null,
      '',
      '2026-11-13T11:58:00Z',
      '2026-11-13T11:56:00Z',
      '2026-11-12T13:00:00Z',
      '2026-10-01T12:00:00Z',
      'soon',
    ])
      noteCases.push({
        $id: `${pn} @ ${publishAt}`,
        rule,
        publishAt,
        now: NOW,
      });
  for (const countFrom of ['goesUp', 'now', 'wentUp', 'later'])
    noteCases.push({
      $id: `counted from ${countFrom}`,
      rule: on(),
      countFrom,
      now: NOW,
    });
  for (const [ln, limits] of [
    ['full plain', LIMITS],
    ['unlimited', normalizeLimits({})],
    [
      'the raw answer',
      { features: { postTimers: { limit: 1 } }, usage: { postTimers: 1 } },
    ],
  ])
    for (const [rn, rule, holds] of [
      ['plain', on(), undefined],
      ['plain, holding one', on(), on()],
      ['conditional', LM.withMetric(on(), 'likes', { value: 1 }), undefined],
      ['off', normalizeTimer({ enabled: false }), undefined],
    ])
      noteCases.push({ $id: `${ln} / ${rn}`, rule, limits, holds, now: NOW });
  await add(
    'editorNotes',
    noteCases,
    ({ rule, fit, publishAt, limits, holds, countFrom, now }) =>
      atClock(now, () =>
        LM.editorNotes(rule, { fit, publishAt, limits, holds, countFrom, now }),
      ),
  );
  const zoned = [];
  for (const zone of ['America/New_York', 'Asia/Kolkata', 'Pacific/Chatham'])
    for (const locale of ['en-US', 'en-GB'])
      for (const [rn, rule] of [
        ['pinned', pinned],
        ['near', on({ deleteAt: '2026-11-12T12:02:00Z' })],
        [
          'quotes over a threshold',
          on({
            deleteAt: '2026-11-14T03:00:00Z',
            conditions: {
              clauses: [
                { metric: 'quotes', value: 3, from: { followersOver: 100000 } },
              ],
            },
          }),
        ],
      ])
        for (const publishAt of [
          undefined,
          '2026-11-13T11:58:00Z',
          '2026-11-13T06:00:00',
        ])
          zoned.push({
            $id: `${zone} ${locale} ${rn} @ ${publishAt}`,
            zone,
            locale,
            rule,
            publishAt,
            now: NOW,
          });
  await add(
    'editorNotes (zones)',
    zoned,
    ({ zone, locale, rule, publishAt, now }) =>
      inFormats(locale, zone, () =>
        atClock(now, () => LM.editorNotes(rule, { publishAt, now })),
      ),
  );
  // A rule handed over with a pin that has no offset (as a date-time
  // picker writes one): read in the zone the notes are said in.
  const localPins = [];
  for (const zone of [
    'UTC',
    'America/New_York',
    'Asia/Kolkata',
    'Pacific/Chatham',
  ])
    for (const deleteAt of ['2026-11-13T09:00', '2026-11-12T12:03:00'])
      for (const publishAt of [undefined, '2026-11-13T06:00:00'])
        localPins.push({
          $id: `${zone} ${deleteAt} @ ${publishAt}`,
          zone,
          locale: 'en-US',
          rule: {
            enabled: true,
            lifespanSeconds: 3600,
            deleteAt,
            conditions: {
              clauses: [{ metric: 'likes', value: 2 }],
              onSpare: 'extend',
            },
          },
          publishAt,
          now: NOW,
        });
  await add(
    'editorNotes (local pins)',
    localPins,
    ({ zone, locale, rule, publishAt, now }) =>
      inFormats(locale, zone, () =>
        atClock(now, () => LM.editorNotes(rule, { publishAt, now })),
      ),
  );

  // ---- lists, and a post that's out -----------------------------------------------

  await add(
    'curateLists',
    [
      {
        lists: [
          {
            uri: 'at://a/app.bsky.graph.list/1',
            name: 'Friends',
            purpose: 'app.bsky.graph.defs#curatelist',
          },
          {
            uri: 'at://a/app.bsky.graph.list/2',
            name: 'Mutes',
            purpose: 'app.bsky.graph.defs#modlist',
          },
        ],
      },
      {
        lists: [
          {
            uri: 'at://a/app.bsky.graph.list/3',
            purpose: 'app.bsky.graph.defs#curatelist',
          },
          {
            uri: 'at://a/app.bsky.graph.list/4',
            name: '',
            purpose: 'app.bsky.graph.defs#curatelist',
          },
          {
            uri: 'at://a/app.bsky.graph.list/5',
            name: 7,
            purpose: 'app.bsky.graph.defs#curatelist',
          },
          {
            uri: 'at://a/app.bsky.graph.list/6',
            name: 'x'.repeat(80),
            purpose: 'app.bsky.graph.defs#curatelist',
          },
          {
            uri: 'at://a/app.bsky.graph.list/7',
            name: `${'é'.repeat(63)}😀`,
            purpose: 'app.bsky.graph.defs#curatelist',
          },
          { uri: 5, name: 'No URI', purpose: 'app.bsky.graph.defs#curatelist' },
          { uri: 'at://a/app.bsky.graph.list/8', name: 'No purpose' },
          null,
          'list',
        ],
      },
      { lists: null },
      { $id: 'undefined' },
      { lists: [] },
    ],
    ({ lists }) => LM.curateLists(lists),
  );
  const actCases = [];
  for (const [rn, rule] of [
    ['on', on()],
    ['pinned', on({ deleteAt: '2026-11-20T00:00:00Z' })],
    ['pinned near', on({ deleteAt: '2026-11-12T12:01:00Z' })],
    ['off', normalizeTimer({})],
    ['a week', on({ lifespanSeconds: 604800 })],
    ['undefined', undefined],
  ])
    for (const [sn, startedAt] of [
      ['now', NOW],
      ['a day ago', NOW - 86_400_000],
      ['half an hour ago', NOW - 1_800_000],
      ['in an hour', NOW + 3_600_000],
      ['unreadable', NaN],
    ])
      actCases.push({ $id: `${rn} / ${sn}`, rule, startedAt, now: NOW });
  actCases.push({
    $id: 'now unreadable',
    rule: on(),
    startedAt: NOW,
    now: NaN,
  });
  await add('firstActAt', actCases, ({ rule, startedAt, now }) =>
    LM.firstActAt(rule, { startedAt, now }),
  );
  const startCases = [];
  for (const [rn, rule] of [
    ['on', on()],
    ['pinned', on({ deleteAt: '2026-11-13T00:00:00Z' })],
    ['off', normalizeTimer({ enabled: false })],
    ['a day', on({ lifespanSeconds: 86400 })],
    ['ten minutes', on({ lifespanSeconds: 600 })],
  ])
    for (const start of ['now', 'posted', undefined, 'Posted'])
      for (const postedAt of [
        '2026-11-12T11:30:00Z',
        '2026-11-12T11:02:00Z',
        '2026-11-12T11:05:00Z',
        '2026-11-12T11:00:00Z',
        '2026-11-11T00:00:00Z',
        '2026-11-12T12:30:00Z',
        '2026-11-12T12:00:00Z',
        '2026-11-12T11:58:00Z',
        'soon',
        '',
        null,
        undefined,
      ])
        startCases.push({
          $id: `${rn} / ${start} / ${postedAt}`,
          rule,
          start,
          postedAt,
          now: NOW,
        });
  await add('timerStart', startCases, ({ rule, start, postedAt, now }) =>
    LM.timerStart(rule, { start, postedAt, now }),
  );
  await add(
    'timerStart (zones)',
    ['America/New_York', 'Asia/Kolkata'].map((zone) => ({
      zone,
      rule: on({ lifespanSeconds: 86400 }),
      start: 'posted',
      postedAt: '2026-11-12T06:00:00',
      now: NOW,
    })),
    ({ zone, rule, start, postedAt, now }) =>
      inZone(zone, () => LM.timerStart(rule, { start, postedAt, now })),
  );
  // The corpus's rules through every length choice.
  await add(
    'lengthChoice (corpus)',
    GRID_RULES.map(([name, rule]) => ({ $id: name, rule })),
    ({ rule }) => LM.lengthChoice(rule),
  );

  return out;
}
