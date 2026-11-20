// src/posting/timers/selfDestruct.js, changing and fitting a rule: gates
// from the reply settings, fitting a timer to the post it is on, keeping the
// parts an editor hid, what fitting changed; pinned instants against the
// publish moment and what each publish path sends; stored rules, the
// posting default and the session draft. Swift:
// VirgaPosting/Timers/SelfDestruct+Rules.swift (and +Words for the
// refusals).
//
// Over the corpus in _timers.js. Some functions say a pinned time against
// the clock (describeDeleteAt without a `now`); those run with Date.now()
// held at the case's `now`, which the Swift port takes as a parameter.

import * as SD from '../../../src/posting/timers/selfDestruct.js';
import { each } from './_helpers.js';
import { inZone } from './_zones.js';
import {
  D,
  FITS,
  GRID_RULES,
  H,
  LIST,
  MIN,
  MOMENTS,
  NOW,
  ON,
  PIN_RULES,
  RULES,
  after,
  atClock,
  grid2,
  pick,
  rulesInput,
  timerAndFit,
} from './_timers.js';

export const sources = ['src/posting/timers/selfDestruct.js'];

export default async function cases() {
  const out = [];
  const add = async (fn, inputs, compute) =>
    out.push(...(await each(fn, inputs, compute)));

  await add('fitTimerToPost', timerAndFit(), ({ timer, fit }) =>
    SD.fitTimerToPost(timer, fit),
  );
  // From the reply settings.
  const gateInputs = [];
  for (const [name, timer] of GRID_RULES.filter((_, i) => i % 3 !== 2))
    for (const action of ['limitReplies', 'disableQuotes', 'delete'])
      for (const on of [true, false])
        gateInputs.push({
          $id: `${name} / ${action} / ${on}`,
          timer,
          action,
          on,
        });
  await add('withScheduledGateChange', gateInputs, ({ timer, action, on }) =>
    SD.withScheduledGateChange(timer, action, on),
  );
  const gateLengthInputs = [];
  for (const [name, timer] of pick(
    'undefined',
    'on',
    'only if',
    'pinned',
    'gates only',
    'off, carrying a rule',
  ))
    for (const seconds of [H, 60, '7200', null, 1e12])
      gateLengthInputs.push({ $id: `${name} / ${seconds}`, timer, seconds });
  await add(
    'withScheduledGateLifespan',
    gateLengthInputs,
    ({ timer, seconds }) => SD.withScheduledGateLifespan(timer, seconds),
  );
  await add('scheduledGateChange', rulesInput(), ({ timer }) =>
    SD.scheduledGateChange(timer),
  );
  await add(
    'withScheduledGateChange (chained)',
    [
      {
        $id: 'arm a gate, add the other, take both away',
        steps: [
          ['limitReplies', true],
          ['disableQuotes', true],
          ['limitReplies', false],
          ['disableQuotes', false],
        ],
      },
      {
        $id: 'beside a live delete',
        start: { enabled: true, lifespanSeconds: 7200 },
        steps: [
          ['disableQuotes', true],
          ['disableQuotes', false],
        ],
      },
    ],
    ({ start, steps }) =>
      steps.reduce(
        (t, [action, on]) => SD.withScheduledGateChange(t, action, on),
        SD.normalizeTimer(start ?? { enabled: false }),
      ),
  );

  // Same timer, and keeping hidden parts across an edit.
  const pairs = [];
  const PAIR_RULES = pick(
    'undefined',
    'on',
    'an hour',
    'truthy switch',
    'legacy',
    'unless, extend',
    'quote filters',
    'gates only',
    'everything',
    'pinned',
    'off, carrying a rule',
  );
  const SAME = PAIR_RULES.filter((_, i) => i !== 3 && i !== 6 && i !== 9);
  for (const [an, a] of SAME)
    for (const [bn, b] of SAME) pairs.push({ $id: `${an} | ${bn}`, a, b });
  pairs.push(
    { $id: 'normalized and not', a: ON, b: SD.normalizeTimer(ON) },
    { $id: 'off and off', a: { enabled: false, lifespanSeconds: 60 }, b: null },
    {
      $id: 'composed text',
      a: {
        ...ON,
        effects: [
          { action: 'limitReplies', allow: [{ list: LIST, name: 'é' }] },
        ],
      },
      b: {
        ...ON,
        effects: [
          { action: 'limitReplies', allow: [{ list: LIST, name: 'é' }] },
        ],
      },
    },
  );
  await add('sameTimer', pairs, ({ a, b }) => SD.sameTimer(a, b));

  const STORED = SD.normalizeTimer({
    enabled: true,
    lifespanSeconds: H,
    conditions: { clauses: [{ metric: 'likes', value: 5 }] },
    effects: [{ action: 'disableQuotes' }, { action: 'delete' }],
  });
  const NO_GATES = { gatesSupported: false, conditionsSupported: false };
  const REPLY = { replyLimitSupported: false };
  const keepInputs = [
    {
      $id: 'hidden conditions and gates',
      edited: {
        ...SD.fitTimerToPost(STORED, NO_GATES),
        lifespanSeconds: 6 * H,
      },
      stored: STORED,
      fit: NO_GATES,
    },
    {
      $id: 'a hidden only-if gives way',
      edited: { enabled: true, lifespanSeconds: 2 * H },
      stored: SD.normalizeTimer({
        enabled: true,
        conditions: {
          sense: 'onlyIf',
          clauses: [{ metric: 'replies', value: 5 }],
        },
      }),
      fit: NO_GATES,
    },
    {
      $id: 'never armed',
      edited: { enabled: true },
      stored: SD.normalizeTimer({
        enabled: false,
        conditions: { clauses: [{ metric: 'likes', value: 5 }] },
      }),
      fit: NO_GATES,
    },
    {
      $id: 'a reply limit on a reply',
      edited: {
        enabled: true,
        lifespanSeconds: 3 * H,
        effects: [{ action: 'delete' }],
      },
      stored: SD.normalizeTimer({
        enabled: true,
        effects: [
          { action: 'limitReplies', allow: ['follower'] },
          { action: 'delete' },
        ],
      }),
      fit: REPLY,
    },
  ];
  for (const [en, edited] of PAIR_RULES.slice(1, 8))
    for (const [sn, stored] of [
      ['stored', STORED],
      ['only if', RULES.find(([n]) => n === 'only if')[1]],
      ['everything', RULES.find(([n]) => n === 'everything')[1]],
    ])
      for (const [fn, fit] of [
        ['default', undefined],
        ['no gates or counts', NO_GATES],
        ['reply', REPLY],
      ])
        keepInputs.push({ $id: `${en} | ${sn} | ${fn}`, edited, stored, fit });
  await add('keepHiddenRuleParts', keepInputs, ({ edited, stored, fit }) =>
    SD.keepHiddenRuleParts(edited, stored, fit),
  );
  await add('describeFitChange', timerAndFit(), ({ timer, fit }) =>
    SD.describeFitChange(timer, fit),
  );

  // ---- pinned instants and publishing ------------------------------------------

  const DELETE_ATS = [
    undefined,
    null,
    '',
    'sometime next week',
    0,
    1,
    true,
    false,
    [],
    {},
    after(H),
    after(-H),
    after(60),
    after(5 * MIN),
    after(5 * MIN + 1),
    after(30 * D),
    after(30 * D + 1),
    after(31 * D),
    NOW + 2 * H * 1000,
    '2026-08-27T13:00:00Z',
    '2026-08-27T13:00:00',
    '2026-08-28',
    '2026-08-27T18:30:00+05:30',
    'Aug 28 2026 10:00',
    ['2026-08-28T00:00:00Z'],
    '+275760-09-13T00:00:00Z',
    '-000001-01-01T00:00:00Z',
    8.64e15,
    8.64e15 + 1,
  ];
  await add(
    'parseDeleteAt',
    DELETE_ATS.map((v) => ({ value: v })),
    ({ value: v }) => SD.parseDeleteAt(v),
  );
  const LOCAL_ZONES = ['America/New_York', 'Asia/Kolkata', 'Pacific/Chatham'];
  await add(
    'parseDeleteAt (zones)',
    LOCAL_ZONES.flatMap((zone) =>
      [
        '2026-08-27T13:00:00',
        'Aug 28 2026 10:00',
        '2026-03-08T02:30:00',
        '2026-08-28',
      ].map((v) => ({ zone, value: v })),
    ),
    ({ zone, value: v }) => inZone(zone, () => SD.parseDeleteAt(v)),
  );
  const normalizeAtInputs = [];
  for (const v of DELETE_ATS)
    for (const [mn, now] of MOMENTS.slice(0, 3))
      normalizeAtInputs.push({
        $id: `${JSON.stringify(v) ?? 'undefined'} @ ${mn}`,
        value: v,
        now,
      });
  await add('normalizeDeleteAt', normalizeAtInputs, ({ value: v, now }) =>
    SD.normalizeDeleteAt(v, now),
  );

  const momentInputs = () =>
    grid2(PIN_RULES, MOMENTS, (rn, timer, mn, now) => ({
      $id: `${rn} @ ${mn}`,
      timer,
      now,
    }));
  await add('pinnedDeadlineStatus', momentInputs(), ({ timer, now }) =>
    SD.pinnedDeadlineStatus(timer, now),
  );
  await add('immediateTimerProblem', momentInputs(), ({ timer, now }) =>
    SD.immediateTimerProblem(timer, now),
  );
  // Three moments are enough for what the timer becomes.
  const fewMoments = () =>
    grid2(
      PIN_RULES,
      [MOMENTS[0], MOMENTS[1], MOMENTS[5]],
      (rn, timer, mn, now) => ({
        $id: `${rn} @ ${mn}`,
        timer,
        now,
      }),
    );
  await add('settleForPublish', fewMoments(), ({ timer, now }) =>
    SD.settleForPublish(timer, now),
  );
  await add('extendWindowSeconds', momentInputs(), ({ timer, now }) =>
    SD.extendWindowSeconds(timer, now),
  );
  await add('toWireSpec', fewMoments(), ({ timer, now }) =>
    SD.toWireSpec(timer, now),
  );
  const notes = [];
  for (const adjusted of [null, 'floor', 'other', ''])
    for (const [en, effects] of [
      ['none', undefined],
      ['delete', [{ action: 'delete' }]],
      ['quotes off', [{ action: 'disableQuotes' }]],
      [
        'quotes off and delete',
        [{ action: 'disableQuotes' }, { action: 'delete' }],
      ],
      ['unknown', [{ action: 'archive' }]],
      ['limit replies', [{ action: 'limitReplies' }]],
    ])
      notes.push({ $id: `${adjusted} / ${en}`, adjusted, effects });
  await add('timerAdjustmentNote', notes, ({ adjusted, effects }) =>
    SD.timerAdjustmentNote(adjusted, effects),
  );
  const sendInputs = [];
  for (const [rn, timer] of PIN_RULES.filter((_, i) => i % 2 === 0))
    for (const [fn, fit] of [FITS[0], FITS[2]])
      for (const [mn, now] of MOMENTS.slice(0, 2))
        sendInputs.push({ $id: `${rn} / ${fn} @ ${mn}`, timer, fit, now });
  for (const [rn, timer] of GRID_RULES.slice(5, 20))
    for (const [fn, fit] of [FITS[0], FITS[1], FITS[3]])
      sendInputs.push({ $id: `${rn} / ${fn}`, timer, fit, now: NOW });
  await add('immediateTimerToSend', sendInputs, ({ timer, fit, now }) =>
    SD.immediateTimerToSend(timer, fit, now),
  );
  // Said against the clock, held at NOW; measured from publishAt.
  const scheduledInputs = [];
  for (const [rn, timer] of PIN_RULES)
    for (const [fn, fit] of rn === 'pinned' || rn === 'an hour'
      ? [FITS[0], FITS[2], FITS[3]]
      : [FITS[0]])
      for (const [mn, publishAt] of [
        ['now', NOW],
        ['in 21 hours 58', NOW + (22 * H - 2 * MIN) * 1000],
        ['a day ago', NOW - D * 1000],
        ['unreadable', NaN],
      ])
        scheduledInputs.push({
          $id: `${rn} / ${fn} @ ${mn}`,
          timer,
          fit,
          publishAt,
          now: NOW,
        });
  await add(
    'scheduledTimerToSend',
    scheduledInputs,
    ({ timer, fit, publishAt, now }) =>
      atClock(now, () =>
        SD.scheduledTimerToSend(timer, { fit, bluesky: true }, publishAt),
      ),
  );
  // `publishAt` the moment; the pin said against the clock (`clock`).
  await add(
    'scheduledTimerProblem',
    momentInputs().map(({ now, ...rest }) => ({
      ...rest,
      publishAt: now,
      clock: NOW,
    })),
    ({ timer, publishAt, clock }) =>
      atClock(clock, () => SD.scheduledTimerProblem(timer, publishAt)),
  );
  const row = (deleteAt, extra = {}) => ({
    id: 'r',
    payload: {
      selfDestruct: {
        lifespanSeconds: H,
        deleteAt,
        conditions: {},
        effects: [],
        ...extra,
      },
    },
  });
  const ROWS = [
    ['pinned', row('2026-09-03T22:00:00.000Z')],
    [
      'pinned, gates',
      row('2026-09-03T22:00:00.000Z', {
        effects: [{ action: 'disableQuotes' }],
      }),
    ],
    ['not pinned', row(null)],
    ['unreadable pin', row('whenever')],
    ['spec off', row('2026-09-03T22:00:00.000Z', { enabled: false })],
    ['no spec', { id: 'plain', payload: {} }],
    ['no payload', { id: 'x' }],
    ['spec a string', { payload: { selfDestruct: 'yes' } }],
    ['null', null],
  ];
  const WHENS = [
    '2026-09-03T18:00:00.000Z',
    '2026-09-03T21:58:00.000Z',
    '2026-09-03T21:55:00.000Z',
    '2026-09-03T21:54:59.999Z',
    '2026-09-03T23:00:00.000Z',
    '2026-08-01T18:00:00.000Z',
    '2026-09-03T18:00:00',
    'soon',
    null,
  ];
  const rowInputs = [];
  for (const [rn, r] of ROWS)
    for (const whenISO of WHENS)
      rowInputs.push({ $id: `${rn} @ ${whenISO}`, row: r, whenISO });
  const ROW_CLOCK = Date.parse('2026-09-03T12:00:00Z');
  await add(
    'scheduledRowTimerProblem',
    rowInputs.map((input) => ({ ...input, clock: ROW_CLOCK })),
    ({ row: r, whenISO, clock }) =>
      atClock(clock, () => SD.scheduledRowTimerProblem(r, whenISO)),
  );
  await add('scheduledRowDeadlineStatus', rowInputs, ({ row: r, whenISO }) =>
    SD.scheduledRowDeadlineStatus(r, whenISO),
  );

  // ---- stored rules and drafts ----------------------------------------------------

  await add('unreadableRuleParts', rulesInput(), ({ timer }) =>
    SD.unreadableRuleParts(timer),
  );
  await add(
    'unreadableRuleParts (more)',
    [
      { raw: { conditions: { minLikes: 5 } } },
      {
        raw: {
          conditions: { clauses: [{ metric: 'likes', op: 'gte', value: 0 }] },
        },
      },
      { raw: { conditions: { sense: 'whenever', clauses: [] } } },
      { raw: { conditions: { logic: 'most', clauses: [] } } },
      { raw: { conditions: { sense: null, logic: false } } },
      { raw: { conditions: [{ sense: 'x' }], effects: {} } },
      {
        raw: {
          conditions: {
            clauses: [
              { metric: { a: 1 } },
              { metric: [1, 2] },
              { metric: 'likes', op: 7 },
              { metric: 'quotes', from: 0 },
              { metric: 'quotes', from: { notFollowed: true } },
              false,
              '',
            ],
          },
          effects: [
            { action: null },
            { action: { x: 1 } },
            {},
            0,
            { action: 'delete' },
          ],
        },
      },
    ],
    ({ raw }) => SD.unreadableRuleParts(raw),
  );
  await add('readStoredTimer', rulesInput(), ({ timer }) =>
    SD.readStoredTimer(timer),
  );
  await add(
    'defaultRuleFromSettings',
    [
      ...GRID_RULES.map(([name, timer]) => ({ $id: name, lifespan: timer })),
      {
        $id: 'defaultOn',
        lifespan: {
          defaultOn: true,
          lifespanSeconds: H,
          deleteAt: '2026-09-01T00:00:00Z',
        },
      },
      { $id: 'no switch', lifespan: { lifespanSeconds: H } },
      { $id: 'enabled wins', lifespan: { enabled: false, defaultOn: true } },
      { $id: 'enabled null', lifespan: { enabled: null, defaultOn: true } },
      {
        $id: 'unreadable',
        lifespan: {
          enabled: true,
          lifespanSeconds: H,
          conditions: { clauses: [{ metric: 'bookmarks', value: 3 }] },
        },
      },
      {
        $id: 'a default with counts',
        lifespan: {
          defaultOn: true,
          lifespanSeconds: 6 * H,
          conditions: { minLikes: 5 },
          effects: [],
        },
      },
    ],
    ({ lifespan }) => SD.defaultRuleFromSettings(lifespan),
  );
  const DEFAULT_ON = SD.normalizeTimer({ enabled: true, lifespanSeconds: D });
  const DEFAULT_OFF = SD.normalizeTimer({ enabled: false, lifespanSeconds: D });
  const draftInputs = [];
  for (const [rn, rule] of PAIR_RULES)
    for (const touched of [true, false])
      for (const [dn, defaults] of [
        ['on', DEFAULT_ON],
        ['off', DEFAULT_OFF],
        ['hour', ON],
      ])
        draftInputs.push({
          $id: `${rn} / ${touched} / ${dn}`,
          rule,
          touched,
          defaults,
        });
  draftInputs.push(
    { $id: 'touched loosely', rule: ON, touched: 1, defaults: DEFAULT_OFF },
    { $id: 'untouched loosely', rule: ON, touched: '', defaults: DEFAULT_OFF },
  );
  await add('draftTimerNote', draftInputs, ({ rule, touched, defaults }) =>
    SD.draftTimerNote(rule, touched, defaults),
  );
  await add(
    'sessionDraftTimer',
    pick(
      'undefined',
      'on',
      'legacy',
      'everything',
      'pinned',
      'allow lists',
    ).flatMap(([name, timer]) =>
      [true, false, 'yes', null].map((touched) => ({
        $id: `${name} / ${touched}`,
        timer,
        touched,
      })),
    ),
    ({ timer, touched }) => SD.sessionDraftTimer(timer, touched),
  );
  const savedInputs = [
    { $id: 'undefined', now: NOW },
    { $id: 'a string', saved: 'nonsense', now: NOW },
    { $id: 'untouched', saved: { timer: ON, touched: false }, now: NOW },
    { $id: 'touched truthy', saved: { timer: ON, touched: 'yes' }, now: NOW },
    { $id: 'no timer', saved: { touched: true }, now: NOW },
    { $id: 'an array', saved: [ON], now: NOW },
  ];
  for (const [rn, timer] of PIN_RULES)
    for (const [mn, now] of MOMENTS.slice(0, 2))
      savedInputs.push({
        $id: `${rn} @ ${mn}`,
        saved: SD.sessionDraftTimer(timer, true),
        now,
      });
  await add('restoreSessionDraftTimer', savedInputs, ({ saved, now }) =>
    SD.restoreSessionDraftTimer(saved, now),
  );

  return out;
}
