// Seeded random inputs for the timer model, the lifespan editor's model and
// the timer service's pure helpers: rules, conditions, effects, allow lists,
// fits, rows, limits and failures built at random from the shapes and
// values the web code has to cope with (stored settings written by other
// builds, a modal's half-typed state, the server's rows), run through
// selfDestruct.js, lifespanModel.js and timerService.js. The hand-picked
// generators (timers.selfDestruct*, timers.lifespanModel,
// timers.timerService) say what each branch does; this one looks for the
// combinations nobody thought to write down. Swift:
// Tests/VirgaPostingTests/TimerFuzzParityTests.swift.
//
// Left out on purpose (see the module map): names an object literal
// inherits ('constructor', 'toString') and arrays standing in for a table's
// key (['likes'] read as 'likes'), which the Swift port doesn't recognise;
// a `from` that is a string, which the web's clauseCountKey reads String
// methods off; non-integer statuses and non-string codes, which a
// TimerServiceError can't hold; and local date-times inside rules (read in
// the active zone, which other suites change), which the zone cases of
// the other generators cover.

import * as SD from '../../../src/posting/timers/selfDestruct.js';
import * as LM from '../../../src/posting/ui/lifespanModel.js';
import * as TS from '../../../src/posting/timers/timerService.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { each } from './_helpers.js';
import { inZone } from './_zones.js';
import { D, H, LIST, LIST2, MIN, NOW, atClock } from './_timers.js';

export const sources = [
  'src/posting/timers/selfDestruct.js',
  'src/posting/ui/lifespanModel.js',
  'src/posting/timers/timerService.js',
];

/** Cases per function. */
const N = 24;
const SEED = 0x7173;

/** mulberry32: the same seed gives the same inputs on every run. */
function random(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const pick = (list) => list[int(list.length)];
  const chance = (p) => next() < p;
  const some = (make, max) => Array.from({ length: int(max + 1) }, make);
  return { pick, chance, some, int };
}

// Seeded afresh by each run of the generator (the runner builds it twice).
let R = random(SEED);

/**
 * An object with each key of `spec` present with probability `p` (or
 * `p[key]`), its value picked from the key's list or made by its function.
 * A value that comes out undefined leaves the key out: JSON can't carry
 * `{ key: undefined }`, which the web reads differently from no key in
 * places (`hasOwnProperty(patch, 'from')`).
 */
function obj(spec, p = 0.6) {
  const out = {};
  for (const [key, values] of Object.entries(spec)) {
    const chance = typeof p === 'number' ? p : (p[key] ?? 0.6);
    if (!R.chance(chance)) continue;
    const v = typeof values === 'function' ? values() : R.pick(values);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

const isoAt = (seconds, from = NOW) =>
  new Date(from + seconds * 1000).toISOString();

// ---- values -------------------------------------------------------------------

const PIN_OFFSETS = [
  -10 * H,
  -2 * MIN,
  -61,
  -60,
  -59,
  -30,
  0,
  MIN,
  2 * MIN,
  299,
  5 * MIN,
  301,
  H,
  20 * H,
  3 * D,
  7 * D,
  29 * D,
  30 * D,
  30 * D + 1,
  40 * D,
  400 * D,
];
const deleteAt = () =>
  R.pick([
    null,
    '',
    'not a date',
    0,
    true,
    isoAt(R.pick(PIN_OFFSETS)),
    isoAt(R.pick(PIN_OFFSETS)),
    isoAt(R.pick(PIN_OFFSETS)),
    isoAt(R.pick(PIN_OFFSETS)),
    NOW + R.pick(PIN_OFFSETS) * 1000,
    '2026-08-27T18:30:00+05:30',
    '2026-08-28T09:00:00.5Z',
    [isoAt(H)],
    { at: 1 },
  ]);
const LENGTHS = [
  null,
  '',
  0,
  1,
  299,
  300,
  301,
  600,
  3600,
  4000.7,
  4799,
  5400,
  7200,
  86400,
  90000,
  172799,
  172800,
  604800,
  2592000,
  2592001,
  1e12,
  -50,
  '3600',
  ' 600 ',
  'abc',
  'Infinity',
  '0x1c20',
  true,
  [7200],
  [],
  {},
];
const COUNTS = [
  null,
  '',
  0,
  1,
  2,
  3,
  5,
  10,
  2.5,
  1.9,
  -2,
  1e6,
  1e6 + 1,
  2.5e6,
  '7',
  ' 4 ',
  'abc',
  '0x10',
  true,
  false,
  [3],
  [],
  {},
  'Infinity',
];
const METRIC_WORDS = [
  'likes',
  'replies',
  'reposts',
  'quotes',
  'selfReplies',
  'quotes',
  'quotes',
  'likes',
  'vibes',
  'Likes',
  '',
  null,
  5,
  true,
  {},
];
const OPS = ['gte', 'gt', 'gt', 'lt', 'GT', '', null, 3];
const LOGIC = ['any', 'all', 'all', 'most', null, 1];
const SENSE = ['unless', 'onlyIf', 'onlyIf', 'whenever', null, 0];
const SPARE = ['keep', 'extend', 'extend', 'never', null];
const MAX_EXT = [
  null,
  0,
  1,
  2,
  3,
  10,
  11,
  500,
  '2',
  'lots',
  -1,
  2.7,
  true,
  [4],
];
const MATCH = ['any', 'all', 'all', 'most', null, 1];
const FLAGS = [true, true, false, 0, 1, 'yes', '', null];
const FOLLOWERS = [
  null,
  0,
  1,
  100,
  1000,
  10000,
  1234567,
  99999999.5,
  1234.5678,
  '5000',
  -3,
  'x',
  [12],
  true,
];

const from = () =>
  R.chance(0.25)
    ? R.pick([null, 5, [], {}])
    : obj({ match: MATCH, notFollowed: FLAGS, followersOver: FOLLOWERS }, 0.6);

const clause = () =>
  R.chance(0.12)
    ? R.pick([null, 'likes', 7, []])
    : obj(
        { metric: METRIC_WORDS, op: OPS, value: COUNTS, from },
        { metric: 0.95, op: 0.6, value: 0.9, from: 0.35 },
      );

const conditions = () =>
  R.chance(0.08)
    ? R.pick([null, 'likes', [], 5])
    : obj(
        {
          logic: LOGIC,
          mode: LOGIC,
          sense: SENSE,
          onSpare: SPARE,
          maxExtensions: MAX_EXT,
          clauses: () =>
            R.chance(0.08) ? R.pick(['likes', {}, null]) : R.some(clause, 7),
          minLikes: COUNTS,
          minReplies: COUNTS,
          minReposts: COUNTS,
        },
        {
          logic: 0.5,
          mode: 0.15,
          sense: 0.6,
          onSpare: 0.5,
          maxExtensions: 0.5,
          clauses: 0.85,
          minLikes: 0.12,
          minReplies: 0.1,
          minReposts: 0.1,
        },
      );

const ALLOW_ENTRIES = [
  'follower',
  'following',
  'mention',
  'follower',
  'everyone',
  'Follower',
  null,
  5,
  true,
  [],
  {},
  { name: 'x' },
  { list: LIST },
  { list: LIST2 },
  { list: ` ${LIST} `, name: '  Pals  ' },
  { list: LIST2, name: '' },
  { list: LIST, name: 'Pals' },
  { list: LIST2, name: 7 },
  { list: 'at://did:plc:me/app.bsky.feed.post/3p' },
  { list: 'https://bsky.app/app.bsky.graph.list/x' },
  { list: 3 },
  { list: LIST, name: `${'n'.repeat(63)} tail` },
  { list: LIST2, name: `${'é'.repeat(62)}😀😀` },
  { list: LIST, name: 'Ünïcödé Ⅻ ΣΑΣ' },
  { list: LIST2, name: ['a', 'b'] },
];
const allow = () =>
  R.chance(0.15)
    ? R.pick([null, 'follower', {}, 5])
    : R.some(() => R.pick(ALLOW_ENTRIES), 7);

const ACTIONS = [
  'delete',
  'limitReplies',
  'disableQuotes',
  'limitReplies',
  'disableQuotes',
  'archive',
  'Delete',
  null,
  3,
];
const effect = () =>
  R.chance(0.1)
    ? R.pick([null, 'delete', [], 4])
    : obj({ action: ACTIONS, allow }, { action: 0.95, allow: 0.6 });
const effects = () =>
  R.chance(0.12)
    ? R.pick([null, 'delete', { action: 'delete' }, []])
    : R.some(effect, 4);

const rule = () =>
  R.chance(0.07)
    ? R.pick([null, 'nonsense', 5, true, [], [{ enabled: true }]])
    : obj(
        {
          enabled: [true, true, true, true, false, 1, 0, 'yes', '', null],
          lifespanSeconds: LENGTHS,
          deleteAt,
          conditions,
          effects,
        },
        {
          enabled: 0.95,
          lifespanSeconds: 0.7,
          deleteAt: 0.35,
          conditions: 0.6,
          effects: 0.6,
        },
      );

const fit = () =>
  R.chance(0.3)
    ? undefined
    : R.chance(0.3)
      ? SD.composerTimerFit(
          obj(
            { editingExisting: FLAGS, unavailable: FLAGS, reply: FLAGS },
            0.4,
          ),
        )
      : obj(
          {
            gatesSupported: FLAGS,
            conditionsSupported: FLAGS,
            replyLimitSupported: FLAGS,
            available: FLAGS,
          },
          0.4,
        );

const moment = () =>
  R.pick([
    NOW,
    NOW,
    NOW,
    NOW + 0.5,
    NOW - H * 1000,
    NOW + D * 1000,
    NOW + 31 * D * 1000,
    NaN,
  ]);

const LOCALES = ['en-US', 'en-GB', 'en-IN', 'en-DE'];
const ZONE_LIST = [
  'UTC',
  'America/New_York',
  'Asia/Kolkata',
  'Pacific/Chatham',
];

/** Runs `fn` in `locale` and `zone`, then puts the defaults back. */
function inFormats(locale, zone, fn) {
  setActiveLocale(locale);
  try {
    return inZone(zone, fn);
  } finally {
    setActiveLocale(DEFAULT_LOCALE);
  }
}

const ROW_STATUSES = [
  'armed',
  'checking',
  'failed',
  'acted',
  'deleted',
  'spared',
  'cancelled',
  'Armed',
  null,
];
const ROW_TIMES = [
  null,
  '',
  'soon',
  isoAt(-H),
  isoAt(-5 * MIN),
  isoAt(30 * MIN),
  isoAt(30 * MIN),
  isoAt(D),
  isoAt(-3 * D),
  NOW + 5000,
  0,
];
const row = (i) =>
  R.chance(0.05)
    ? null
    : {
        id: `r${i}`,
        ...obj(
          {
            status: ROW_STATUSES,
            checkAt: ROW_TIMES,
            resolvedAt: ROW_TIMES,
            conditions,
            effects,
          },
          { status: 0.9, checkAt: 0.8, resolvedAt: 0.5 },
        ),
      };
const scheduledRow = (i) =>
  R.chance(0.05)
    ? null
    : {
        id: R.pick([`s${i}`, `s${i}`, i, 's1']),
        ...obj(
          {
            status: [
              'pending',
              'publishing',
              'pending',
              'done',
              'failed',
              null,
            ],
            scheduledFor: [
              isoAt(H),
              isoAt(2 * H),
              isoAt(-H),
              isoAt(D),
              'never',
              '',
              null,
            ],
            payload: () =>
              R.chance(0.15)
                ? R.pick([null, {}, 'x'])
                : { selfDestruct: R.chance(0.2) ? null : rule() },
          },
          { status: 0.9, scheduledFor: 0.8, payload: 0.85 },
        ),
      };

const limits = () =>
  R.chance(0.15)
    ? R.pick([null, 'x', {}, { features: {} }])
    : {
        features: {
          postTimers: { limit: R.pick([0, 1, 1, 2, 3, null, '1']) },
          conditionalTimers: { limit: R.pick([0, 1, 1, 2, null, true]) },
        },
        usage: {
          postTimers: R.pick([0, 1, 2, 3, null, '1']),
          conditionalTimers: R.pick([0, 1, 2, null, [1]]),
        },
      };

const counts = () =>
  R.chance(0.1)
    ? R.pick([null, 'x', 5, []])
    : obj(
        {
          likes: COUNTS,
          replies: COUNTS,
          reposts: COUNTS,
          quotes: COUNTS,
          selfReplies: COUNTS,
          bookmarks: COUNTS,
        },
        0.7,
      );

const times = (n, make) => Array.from({ length: n }, (_, i) => make(i));

export default async function cases() {
  R = random(SEED);
  const out = [];
  const add = async (fn, inputs, compute) =>
    out.push(
      ...(await each(
        fn,
        inputs.map((input, i) => ({ $id: `#${i + 1}`, ...input })),
        compute,
      )),
    );

  // ---- normalizing ----------------------------------------------------------

  await add(
    'normalizeTimer',
    times(N, () => ({ timer: rule() })),
    (a) => SD.normalizeTimer(a.timer),
  );
  await add(
    'normalizeTimer (twice)',
    times(N / 2, () => ({ timer: rule() })),
    (a) => SD.normalizeTimer(SD.normalizeTimer(a.timer)),
  );
  await add(
    'normalizeConditions',
    times(N, () => ({ conditions: conditions() })),
    (a) => SD.normalizeConditions(a.conditions),
  );
  await add(
    'normalizeEffects',
    times(N, () => ({ effects: effects() })),
    (a) => SD.normalizeEffects(a.effects),
  );
  await add(
    'clauseCountKey',
    times(N, () => ({ clause: clause() })),
    (a) => SD.clauseCountKey(a.clause),
  );
  await add(
    'unreadableRuleParts',
    times(N, () => ({ timer: rule() })),
    (a) => SD.unreadableRuleParts(a.timer),
  );
  await add(
    'readStoredTimer',
    times(N / 2, () => ({ timer: rule() })),
    (a) => SD.readStoredTimer(a.timer),
  );
  await add(
    'defaultRuleFromSettings',
    times(N / 2, () => ({
      lifespan: R.chance(0.1)
        ? R.pick([null, 'x', []])
        : {
            ...rule(),
            ...obj({ enabled: FLAGS, defaultOn: FLAGS }, 0.5),
          },
    })),
    (a) => SD.defaultRuleFromSettings(a.lifespan),
  );

  // ---- changing and fitting -------------------------------------------------

  await add(
    'fitTimerToPost',
    times(N, () => ({ timer: rule(), fit: fit() })),
    (a) => SD.fitTimerToPost(a.timer, a.fit),
  );
  await add(
    'describeFitChange',
    times(N, () => ({ timer: rule(), fit: fit() })),
    (a) => SD.describeFitChange(a.timer, a.fit),
  );
  await add(
    'keepHiddenRuleParts',
    times(N, () => ({ edited: rule(), stored: rule(), fit: fit() })),
    (a) => SD.keepHiddenRuleParts(a.edited, a.stored, a.fit),
  );
  await add(
    'sameTimer',
    times(N, () => {
      const a = rule();
      return { a, b: R.chance(0.4) ? SD.normalizeTimer(a) : rule() };
    }),
    (a) => SD.sameTimer(a.a, a.b),
  );
  const GATES = ['limitReplies', 'disableQuotes', 'delete', 'bogus'];
  await add(
    'withScheduledGateChange',
    times(N, () => ({
      timer: rule(),
      action: R.pick(GATES),
      on: R.chance(0.5),
    })),
    (a) => SD.withScheduledGateChange(a.timer, a.action, a.on),
  );
  await add(
    'withScheduledGateLifespan',
    times(N / 2, () => ({ timer: rule(), seconds: R.pick(LENGTHS) })),
    (a) => SD.withScheduledGateLifespan(a.timer, a.seconds),
  );
  await add(
    'scheduledGateChange',
    times(N / 2, () => ({ timer: rule() })),
    (a) => SD.scheduledGateChange(a.timer),
  );
  await add(
    'withEffect',
    times(N, () => ({
      effects: effects(),
      action: R.pick(GATES),
      on: R.chance(0.6),
      extra: R.chance(0.3)
        ? undefined
        : R.pick([
            null,
            {},
            { allow: allow() },
            { allow: allow() },
            { action: 'delete' },
            { action: 'disableQuotes', allow: ['mention'] },
          ]),
    })),
    (a) => SD.withEffect(a.effects, a.action, a.on, a.extra),
  );
  await add(
    'withoutEffects',
    times(N / 2, () => ({
      timer: rule(),
      actions: R.some(() => R.pick(GATES), 3),
    })),
    (a) => SD.withoutEffects(a.timer, a.actions),
  );
  await add(
    'withoutConditions',
    times(N / 2, () => ({ timer: rule() })),
    (a) => SD.withoutConditions(a.timer),
  );

  // ---- pins and publishing ------------------------------------------------------

  await add(
    'normalizeDeleteAt',
    times(N, () => ({ value: deleteAt(), now: moment() })),
    (a) => SD.normalizeDeleteAt(a.value, a.now),
  );
  await add(
    'pinnedDeadlineStatus',
    times(N, () => ({ timer: rule(), now: moment() })),
    (a) => SD.pinnedDeadlineStatus(a.timer, a.now),
  );
  await add(
    'toWireSpec',
    times(N, () => ({ timer: rule(), now: moment() })),
    (a) => SD.toWireSpec(a.timer, a.now),
  );
  await add(
    'immediateTimerToSend',
    times(N, () => ({ timer: rule(), fit: fit(), now: moment() })),
    (a) => SD.immediateTimerToSend(a.timer, a.fit, a.now),
  );
  await add(
    'scheduledTimerToSend',
    times(N, () => ({
      timer: rule(),
      fit: fit(),
      publishAt: moment(),
      clock: NOW,
    })),
    (a) =>
      atClock(a.clock, () =>
        SD.scheduledTimerToSend(a.timer, { fit: a.fit }, a.publishAt),
      ),
  );
  await add(
    'scheduledRowTimerProblem',
    times(N, () => ({
      row: R.chance(0.1)
        ? R.pick([null, {}, { payload: null }])
        : { payload: { selfDestruct: rule() } },
      whenISO: R.pick([isoAt(H), isoAt(D), isoAt(-H), 'never', null, NOW]),
      clock: NOW,
    })),
    (a) =>
      atClock(a.clock, () => SD.scheduledRowTimerProblem(a.row, a.whenISO)),
  );
  await add(
    'timerAdjustmentNote',
    times(N / 4, () => ({
      adjusted: R.pick(['floor', null, 'ceiling']),
      effects: effects(),
    })),
    (a) => SD.timerAdjustmentNote(a.adjusted, a.effects),
  );
  await add(
    'restoreSessionDraftTimer',
    times(N / 2, () => ({
      saved: R.chance(0.15)
        ? R.pick([null, 'x', {}, { touched: true }])
        : { timer: rule(), touched: R.pick(FLAGS) },
      now: moment(),
    })),
    (a) => SD.restoreSessionDraftTimer(a.saved, a.now),
  );
  await add(
    'draftTimerNote',
    times(N / 2, () => {
      const r = rule();
      return {
        rule: r,
        touched: R.chance(0.8),
        defaults: R.chance(0.3) ? r : rule(),
      };
    }),
    (a) => SD.draftTimerNote(a.rule, a.touched, a.defaults),
  );

  // ---- words --------------------------------------------------------------------

  const said = () => ({
    timer: rule(),
    now: R.pick([NOW, NOW, NOW + 0.5, NaN]),
    locale: R.pick(LOCALES),
    zone: R.pick(ZONE_LIST),
  });
  await add(
    'describeTimer',
    times(N * 2, () => ({
      ...said(),
      from: R.pick([undefined, 'goesUp', 'wentUp', 'now', 'bogus']),
    })),
    (a) =>
      inFormats(a.locale, a.zone, () =>
        SD.describeTimer(
          a.timer,
          a.now,
          a.from === undefined ? undefined : { from: a.from },
        ),
      ),
  );
  await add('timerChipLabel', times(N, said), (a) =>
    inFormats(a.locale, a.zone, () => SD.timerChipLabel(a.timer, a.now)),
  );
  await add(
    'describeFrom',
    times(N, () => ({
      clause: R.chance(0.1)
        ? R.pick([null, 5])
        : { metric: 'quotes', from: from() },
      locale: R.pick(LOCALES),
    })),
    (a) => inFormats(a.locale, 'UTC', () => SD.describeFrom(a.clause)),
  );
  // Not a value the web can't iterate ({}, 5): it throws on those, where
  // the Swift port's loose describeAllow says 'nobody'.
  await add(
    'describeAllow',
    times(N, () => ({
      entries: R.chance(0.15)
        ? R.pick([null, 'follower', 0, ''])
        : R.some(() => R.pick(ALLOW_ENTRIES), 7),
    })),
    (a) => SD.describeAllow(a.entries),
  );
  await add(
    'scheduledTimerProblem',
    times(N, () => ({ ...said(), publishAt: moment(), clock: NOW })),
    (a) =>
      inFormats(a.locale, a.zone, () =>
        atClock(a.clock, () => SD.scheduledTimerProblem(a.timer, a.publishAt)),
      ),
  );

  // ---- the list and the slots ----------------------------------------------------

  await add(
    'evaluateConditions',
    times(N, () => ({ conditions: conditions(), counts: counts() })),
    (a) => SD.evaluateConditions(a.conditions, a.counts),
  );
  await add(
    'readCounts',
    times(N / 2, () => ({ counts: counts() })),
    (a) => SD.readCounts(a.counts),
  );
  await add(
    'groupTimers',
    times(N, () => ({ rows: times(R.int(13), row), history: R.chance(0.3) })),
    (a) => SD.groupTimers(a.rows, { history: a.history }),
  );
  await add(
    'waitingTimerRows',
    times(N / 2, () => ({ rows: times(R.int(10), scheduledRow) })),
    (a) => SD.waitingTimerRows(a.rows),
  );
  await add(
    'timerBucket',
    times(N, () => ({ timer: rule() })),
    (a) => SD.timerBucket(a.timer),
  );
  await add(
    'timerUsage',
    times(N / 2, () => ({
      liveRows: times(R.int(8), row),
      scheduledRows: times(R.int(8), scheduledRow),
      exceptScheduledId: R.pick([undefined, null, 's1', 's2', 0, 1, '']),
    })),
    (a) => SD.timerUsage(a),
  );
  await add(
    'timerRoomProblem',
    times(N, () => ({
      rule: rule(),
      limits: limits(),
      holds: R.chance(0.5) ? undefined : R.pick([null, 'x', [], rule()]),
    })),
    (a) => SD.timerRoomProblem(a.rule, a.limits, { holds: a.holds }),
  );
  await add(
    'timerSlotRefusal',
    times(N / 2, () => ({
      payload: R.chance(0.1)
        ? R.pick([null, 'x'])
        : obj(
            {
              feature: [
                'postTimers',
                'conditionalTimers',
                'scheduledPosts',
                'PostTimers',
                null,
              ],
              limit: [null, 0, 1, 2, 3, 2.5, '1', '4', true, [2], {}],
            },
            0.8,
          ),
    })),
    (a) => SD.timerSlotRefusal(a.payload),
  );

  // ---- the lifespan editor ---------------------------------------------------

  await add(
    'lengthChoice',
    times(N / 2, () => ({ rule: rule() })),
    (a) => LM.lengthChoice(a.rule),
  );
  await add(
    'patchRule',
    times(N, () => ({
      rule: rule(),
      patch: obj(
        {
          enabled: FLAGS,
          lifespanSeconds: LENGTHS,
          deleteAt,
          conditions,
          effects,
        },
        0.4,
      ),
    })),
    (a) => LM.patchRule(a.rule, a.patch),
  );
  await add(
    'withPin',
    times(N / 2, () => ({ rule: rule(), iso: deleteAt() })),
    (a) => LM.withPin(a.rule, a.iso),
  );
  await add(
    'toggleEffect',
    times(N, () => ({
      rule: rule(),
      action: R.pick(GATES),
      allow: R.chance(0.5) ? undefined : allow(),
    })),
    (a) =>
      LM.toggleEffect(
        a.rule,
        a.action,
        a.allow === undefined ? undefined : { allow: a.allow },
      ),
  );
  await add(
    'withAllow',
    times(N / 2, () => ({ rule: rule(), allow: allow() })),
    (a) => LM.withAllow(a.rule, a.allow),
  );
  await add(
    'toggleAllow',
    times(N / 2, () => ({
      allow: SD.normalizeEffect({ action: 'limitReplies', allow: allow() })
        .allow,
      entry: R.pick(ALLOW_ENTRIES),
    })),
    (a) => LM.toggleAllow(a.allow, a.entry),
  );
  await add(
    'withMetric',
    times(N, () => ({
      rule: rule(),
      metric: R.pick(METRIC_WORDS.filter((m) => typeof m === 'string')),
      patch: obj({ op: OPS, value: COUNTS, from }, 0.6),
    })),
    (a) => LM.withMetric(a.rule, a.metric, a.patch),
  );
  await add(
    'withConditions',
    times(N, () => ({
      rule: rule(),
      patch: obj(
        {
          logic: LOGIC,
          sense: SENSE,
          onSpare: SPARE,
          maxExtensions: MAX_EXT,
          clauses: () => R.some(clause, 3),
        },
        0.45,
      ),
    })),
    (a) => LM.withConditions(a.rule, a.patch),
  );
  await add(
    'withQuoteFilter',
    times(N, () => ({
      rule: rule(),
      patch: R.chance(0.15)
        ? null
        : obj({ match: MATCH, notFollowed: FLAGS, followersOver: FOLLOWERS }),
    })),
    (a) => LM.withQuoteFilter(a.rule, a.patch),
  );
  await add(
    'editorNotes',
    times(N * 2, () => ({
      rule: rule(),
      fit: obj({ editingExisting: FLAGS, reply: FLAGS, thread: FLAGS }, 0.4),
      publishAt: R.pick([
        undefined,
        null,
        '',
        isoAt(H),
        isoAt(D),
        isoAt(-H),
        isoAt(31 * D),
        'never',
      ]),
      limits: R.chance(0.5) ? undefined : limits(),
      holds: R.chance(0.7) ? undefined : rule(),
      countFrom: R.pick([undefined, 'goesUp', 'wentUp', 'now', 'bogus']),
      now: R.pick([NOW, NOW, NOW + 0.5]),
    })),
    (a) =>
      atClock(a.now, () =>
        LM.editorNotes(a.rule, {
          fit: a.fit,
          publishAt: a.publishAt,
          limits: a.limits,
          holds: a.holds,
          countFrom: a.countFrom,
          now: a.now,
        }),
      ),
  );
  await add(
    'curateLists',
    times(N / 4, () => ({
      lists: R.some(
        () =>
          R.chance(0.1)
            ? R.pick([null, 5, 'x'])
            : obj(
                {
                  purpose: [
                    'app.bsky.graph.defs#curatelist',
                    'app.bsky.graph.defs#curatelist',
                    'app.bsky.graph.defs#modlist',
                    null,
                  ],
                  uri: [LIST, LIST2, 5, null],
                  name: [
                    'Pals',
                    '',
                    null,
                    0,
                    7,
                    `${'é'.repeat(63)}😀`,
                    ['a', 'b'],
                  ],
                },
                0.8,
              ),
        5,
      ),
    })),
    (a) => LM.curateLists(a.lists),
  );
  await add(
    'firstActAt',
    times(N / 2, () => ({ rule: rule(), startedAt: moment(), now: moment() })),
    (a) => LM.firstActAt(a.rule, { startedAt: a.startedAt, now: a.now }),
  );
  await add(
    'timerStart',
    times(N, () => ({
      rule: rule(),
      start: R.pick(['posted', 'posted', 'now', 'bogus']),
      postedAt: R.pick([
        undefined,
        null,
        '',
        isoAt(-10 * MIN),
        isoAt(-56 * MIN),
        isoAt(-H),
        isoAt(-2 * D),
        isoAt(MIN),
        'never',
      ]),
      now: R.pick([NOW, NOW, NOW + 0.5]),
    })),
    (a) =>
      LM.timerStart(a.rule, {
        start: a.start,
        postedAt: a.postedAt,
        now: a.now,
      }),
  );

  // ---- the service's helpers --------------------------------------------------------

  const PIECES = [
    'a',
    'word',
    'Word',
    ' ',
    ' ',
    '  ',
    '\n',
    '\t',
    '\r\n',
    ' ',
    ' ',
    '　',
    '﻿',
    '\u0085',
    '᠎',
    '​',
    '😀',
    'é',
    'é',
  ];
  await add(
    'timerSnippet',
    times(N, () => ({
      text: R.chance(0.1)
        ? R.pick([null, 0, 5, true, [], ['a', ' b'], {}])
        : Array.from({ length: R.int(R.chance(0.5) ? 260 : 20) }, () =>
            R.pick(PIECES),
          ).join(''),
    })),
    (a) => TS.timerSnippet(a.text),
  );
  const MESSAGES = [
    'Timed out',
    'TIMEOUT!',
    'Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource.',
    'connection reset',
    'Connexion',
    'ok',
    '',
    'neTwork',
    'tıMeout',
    'netwoKk',
    'networK',
    'refused',
  ];
  const failure = () =>
    obj(
      {
        name: [
          'Error',
          'TimeoutError',
          'AbortError',
          'TypeError',
          'RangeError',
          '',
        ],
        message: MESSAGES,
        code: [
          'TIMEOUT',
          'NETWORK_ERROR',
          'NETWORK_ERROR',
          'UNAVAILABLE',
          'QUOTA_EXCEEDED',
          '',
        ],
        status: [
          0, -1, 400, 401, 403, 404, 405, 408, 409, 429, 500, 502, 503, 504,
        ],
      },
      0.5,
    );
  /** An Error from `{ name, message, code, status }`, as timers.timerService makes one. */
  const makeError = (desc) => {
    const err =
      desc.name === 'TypeError'
        ? new TypeError(desc.message ?? '')
        : new Error(desc.message ?? '');
    if (desc.name && desc.name !== 'TypeError') err.name = desc.name;
    for (const key of ['code', 'status'])
      if (desc[key] !== undefined) err[key] = desc[key];
    return err;
  };
  await add(
    'error classes',
    times(N * 2, () => ({ error: failure() })),
    (a) => {
      const err = makeError(a.error);
      return {
        unavailable: TS.isTimersUnavailableError(err),
        unsupported: TS.isTimersUnsupported(err),
        unknown: TS.isArmOutcomeUnknown(err),
        refusal: TS.isDefiniteArmRefusal(err),
      };
    },
  );
  await add(
    'timerDidForUri',
    times(N / 2, () => ({
      uri: R.pick([
        'at://did:plc:x/app.bsky.feed.post/1',
        'at://did:plc:x',
        'at://did:web:x.com/a/b',
        'at://alice.bsky.social/app.bsky.feed.post/1',
        'at://',
        'at:///x',
        ' at://did:plc:x/a',
        'AT://did:plc:x/a',
        'at://did:plc:é😀/a',
        'at://did:/x',
        5,
        null,
        ['at://did:plc:x/a'],
      ]),
    })),
    (a) => TS.timerDidForUri(a.uri),
  );
  await add(
    'timerPostUrl',
    times(N / 2, () => ({
      row: R.chance(0.1)
        ? R.pick([null, 'x'])
        : obj(
            {
              postUri: [
                'at://did:plc:x/app.bsky.feed.post/3k',
                'at://alice.bsky.social/app.bsky.feed.post/3k',
                LIST,
                'at://did:plc:x/app.bsky.feed.post',
                'not a uri',
                '',
                5,
              ],
              status: ['armed', 'deleted', 'Deleted', 'acted', null],
            },
            0.8,
          ),
    })),
    (a) => TS.timerPostUrl(a.row),
  );

  // ---- sorting more than V8 sorts by insertion -------------------------------------
  // V8 binary-inserts under 64 elements and merges runs above (galloping
  // when one run keeps winning). With a comparator that isn't a consistent
  // order, as compareTimers isn't once a time can't be read, the order it
  // leaves depends on every comparison made; these hold the port's sort to
  // it. Values are numbers or null; the comparator calls null equal to
  // everything ('unreadable'), or is no order at all ('arbitrary').

  const COMPARATORS = {
    unreadable: (x, y) => (x.v === null || y.v === null ? 0 : x.v - y.v),
    arbitrary: (x, y) =>
      x.v === null || y.v === null ? 0 : (x.v % 7) - (y.v % 5) + 0.5,
  };
  const SIZES = [2, 63, 64, 65, 100, 127, 128, 129, 200, 300, 513];
  const values = (size, shape) => {
    switch (shape) {
      case 'runs': {
        // Long ascending and descending runs, so merges gallop.
        const out = [];
        while (out.length < size) {
          const run = 1 + R.int(40);
          const start = R.int(1000);
          const up = R.chance(0.6);
          for (let i = 0; i < run && out.length < size; i += 1)
            out.push(R.chance(0.05) ? null : up ? start + i : start - i);
        }
        return out;
      }
      case 'few':
        return times(size, () => (R.chance(0.1) ? null : R.int(4)));
      case 'sorted':
        return times(size, (i) => (R.chance(0.03) ? null : i));
      default:
        return times(size, () => (R.chance(0.15) ? null : R.int(500)));
    }
  };
  const sortCases = [];
  for (const size of SIZES)
    for (const shape of ['random', 'runs', 'few', 'sorted'])
      for (const comparator of Object.keys(COMPARATORS))
        sortCases.push({
          $id: `${size} ${shape} ${comparator}`,
          comparator,
          values: values(size, shape),
        });
  out.push(
    ...(await each(
      'Array.prototype.sort',
      sortCases,
      ({ comparator, values: v }) =>
        v
          .map((x, i) => ({ i, v: x }))
          .sort(COMPARATORS[comparator])
          .map((x) => x.i),
    )),
  );

  const manyRows = (size, shape) => {
    const times_ = values(size, shape);
    return times_.map((t, i) => ({
      id: `r${i}`,
      status: R.pick([
        'armed',
        'armed',
        'checking',
        'deleted',
        'acted',
        'failed',
      ]),
      ...(t === null
        ? { checkAt: R.pick(['soon', 'never']) }
        : R.chance(0.3)
          ? { resolvedAt: isoAt(t * 60), checkAt: isoAt(t * 30) }
          : { checkAt: isoAt(t * 60) }),
    }));
  };
  await add(
    'groupTimers (many)',
    [64, 129, 250].flatMap((size) =>
      ['random', 'runs'].map((shape) => ({
        rows: manyRows(size, shape),
        history: R.chance(0.5),
      })),
    ),
    (a) => SD.groupTimers(a.rows, { history: a.history }),
  );
  await add(
    'waitingTimerRows (many)',
    [64, 150].map((size) => ({
      rows: values(size, 'runs').map((t, i) => ({
        id: `s${i}`,
        status: R.pick(['pending', 'publishing', 'done']),
        scheduledFor: t === null ? 'never' : isoAt(t * 60),
        payload: { selfDestruct: { lifespanSeconds: 3600 } },
      })),
    })),
    (a) => SD.waitingTimerRows(a.rows),
  );

  return out;
}
