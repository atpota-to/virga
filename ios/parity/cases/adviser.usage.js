// src/posting/adviser/usage.js: the month's AI allowance as this browser
// keeps it. The months and resets; reading, recording, clearing and marking
// the limit, played as scripts against one store (every call's answer and
// what the store holds after it); and the allowance line in every locale
// the app offers. Swift: VirgaPosting/Adviser/Usage.swift.
//
// Inputs from usage.test.js, plus unreadable and odd stored values, counts
// that aren't whole or aren't numbers, other months and other accounts.

import {
  ADVISER_USAGE_KEY_PREFIX,
  FREE_MONTHLY_LIMITS,
  USAGE_FEATURES,
  adviserUsageKey,
  adviserUsageLine,
  adviserUsesLeft,
  clearAdviserUsage,
  currentMonthKey,
  isAdviserAtLimit,
  markAdviserLimitReached,
  readAdviserUsage,
  recordAdviserUsage,
  usageResetsAt,
} from '../../../src/posting/adviser/usage.js';
import {
  DEFAULT_LOCALE,
  LOCALE_CHOICES,
  setActiveLocale,
} from '../../../src/lib/locale.js';
import { each, value } from './_helpers.js';

export const sources = ['src/posting/adviser/usage.js'];

const DID = 'did:plc:writer';
const OTHER = 'did:plc:other';
const NOW = Date.parse('2026-11-12T10:00:00Z');
const OCT = Date.parse('2026-10-31T23:00:00Z');
const KEY = `${ADVISER_USAGE_KEY_PREFIX}${DID}`;
// Past the end of time: `new Date(INVALID)` is an Invalid Date.
const INVALID = 9e15;

function memoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/** What the store holds, each value parsed where it is JSON. */
function snapshot(store) {
  const out = {};
  for (const [k, v] of store.map) {
    try {
      out[k] = { json: JSON.parse(v) };
    } catch {
      out[k] = { text: v };
    }
  }
  return out;
}

const OPS = {
  read: (s, op) =>
    readAdviserUsage(op.did, {
      feature: op.feature,
      now: new Date(op.now),
      store: s,
    }),
  record: (s, op) =>
    recordAdviserUsage(op.did, op.usage, {
      feature: op.feature,
      now: new Date(op.now),
      store: s,
    }),
  clear: (s, op) =>
    clearAdviserUsage(op.did, { feature: op.feature, store: s }),
  mark: (s, op) =>
    markAdviserLimitReached(op.did, op.limit, {
      feature: op.feature,
      now: new Date(op.now),
      store: s,
    }),
  atLimit: (s, op) =>
    isAdviserAtLimit(op.did, {
      feature: op.feature,
      now: new Date(op.now),
      store: s,
    }),
  left: (s, op) =>
    adviserUsesLeft(op.did, {
      feature: op.feature,
      now: new Date(op.now),
      store: s,
    }),
};

/** One script: each op's answer and the store after it. `store: null` is no store. */
function play({ initial = {}, noStore = false, ops }) {
  const store = memoryStore(initial);
  const steps = [];
  for (const op of ops) {
    let result;
    try {
      result = { value: OPS[op.op](noStore ? null : store, op) ?? null };
    } catch (error) {
      result = { $throws: String(error?.message || error) };
    }
    steps.push({ ...result, store: snapshot(store) });
  }
  return steps;
}

const op = (name, extra = {}) => ({
  op: name,
  did: DID,
  feature: 'adviser',
  now: NOW,
  ...extra,
});

const SCRIPTS = [
  {
    $id: 'stores-adviser-reads',
    ops: [op('record', { usage: { used: 4, limit: 30 } }), op('read')],
  },
  {
    $id: 'keeps-the-others-beside-it',
    ops: [
      op('record', { usage: { used: 4, limit: 30 } }),
      op('record', { feature: 'altText', usage: { used: 2, limit: 15 } }),
      op('record', { feature: 'style', usage: { used: 1, limit: 3 } }),
      op('read', { feature: 'style' }),
      op('read', { feature: 'altText' }),
      op('read'),
    ],
  },
  {
    $id: 'forgets-last-month',
    ops: [
      op('record', { now: OCT, usage: { used: 30, limit: 30 } }),
      op('read'),
      op('atLimit'),
      op('left'),
    ],
  },
  {
    $id: 'answers-without-usage',
    ops: [
      op('record', { usage: undefined }),
      op('record', { usage: { used: 'x', limit: 30 } }),
      op('record', { usage: { used: 3, limit: 0 } }),
      op('record', { usage: { used: -1, limit: 30 } }),
      op('record', { usage: { used: 1, limit: -3 } }),
      op('record', { usage: { used: 1 } }),
      op('record', { usage: 'used' }),
      op('record', { usage: [4, 30] }),
      op('record', { usage: { used: 1, limit: '30' } }),
    ],
  },
  {
    $id: 'fractional-counts',
    ops: [
      op('record', { usage: { used: 4.9, limit: 30.7 } }),
      op('read'),
      op('left'),
      op('record', { usage: { used: 0, limit: 0.5 } }),
      op('record', { usage: { used: 0.2, limit: 1.5 } }),
      op('read'),
      op('atLimit'),
    ],
  },
  {
    $id: 'clears-one-leaves-others',
    ops: [
      op('mark', { limit: 30 }),
      op('record', { feature: 'altText', usage: { used: 2, limit: 15 } }),
      op('clear'),
      op('atLimit'),
      op('read'),
      op('read', { feature: 'altText' }),
      op('clear', { feature: 'altText' }),
      op('clear', { feature: 'style' }),
    ],
  },
  {
    $id: 'clear-keeps-unknown-members',
    initial: {
      [KEY]: JSON.stringify({
        month: '2026-11',
        used: 3,
        limit: 30,
        note: 'x',
      }),
    },
    ops: [op('clear'), op('read'), op('clear', { feature: 'style' })],
  },
  {
    $id: 'keeps-accounts-apart',
    ops: [
      op('record', { usage: { used: 30, limit: 30 } }),
      op('atLimit', { did: OTHER }),
      op('atLimit'),
      op('left', { did: 'did:plc:none' }),
    ],
  },
  {
    $id: 'unreadable-storage',
    initial: { [KEY]: '{not json' },
    ops: [
      op('read'),
      op('record', { usage: { used: 1, limit: 30 } }),
      op('read'),
    ],
  },
  {
    $id: 'stored-not-an-object',
    initial: { [KEY]: '[1,2,3]' },
    ops: [
      op('read'),
      op('record', { feature: 'style', usage: { used: 1, limit: 3 } }),
    ],
  },
  {
    $id: 'stored-empty',
    initial: { [KEY]: '' },
    ops: [op('read'), op('clear')],
  },
  {
    $id: 'stored-odd-entries',
    initial: {
      [KEY]: JSON.stringify({
        month: '2026-11',
        used: '3',
        limit: 30,
        altText: 5,
        style: { month: 202611, used: 1, limit: 3 },
      }),
    },
    ops: [
      op('read'),
      op('read', { feature: 'altText' }),
      op('read', { feature: 'style' }),
      op('atLimit', { feature: 'style' }),
      op('left', { feature: 'altText' }),
    ],
  },
  {
    $id: 'stored-null-entry',
    initial: {
      [KEY]: JSON.stringify({ altText: null, style: false, month: null }),
    },
    ops: [
      op('read', { feature: 'altText' }),
      op('read', { feature: 'style' }),
      op('read'),
    ],
  },
  {
    $id: 'no-store',
    noStore: true,
    ops: [
      op('read'),
      op('record', { usage: { used: 1, limit: 3 } }),
      op('mark', { limit: 3 }),
      op('atLimit'),
      op('left'),
      op('clear'),
    ],
  },
  {
    $id: 'no-account',
    ops: [
      op('record', { did: '', usage: { used: 1, limit: 3 } }),
      op('record', { did: null, usage: { used: 1, limit: 3 } }),
      op('read', { did: '' }),
      op('mark', { did: null, limit: 3 }),
      op('clear', { did: '' }),
    ],
  },
  {
    $id: 'the-limit-when-the-server-says-so',
    ops: [op('mark', { limit: 30 }), op('atLimit'), op('left')],
  },
  {
    $id: 'falls-back-to-the-last-limit',
    ops: [
      op('record', { usage: { used: 3, limit: 50 } }),
      op('mark', { limit: undefined }),
      op('read'),
    ],
  },
  {
    $id: 'falls-back-to-the-free-one',
    ops: [
      op('mark', { feature: 'altText', limit: null }),
      op('mark', { feature: 'style', limit: 0 }),
      op('mark', { limit: 'forty' }),
      op('mark', { feature: 'style', limit: 7.8 }),
    ],
  },
  {
    $id: 'last-month-limit-is-not-seen',
    ops: [
      op('record', { now: OCT, usage: { used: 3, limit: 50 } }),
      op('mark', { limit: undefined }),
    ],
  },
  {
    $id: 'counts-what-is-left',
    ops: [
      op('record', { usage: { used: 12, limit: 30 } }),
      op('left'),
      op('record', { usage: { used: 40, limit: 30 } }),
      op('left'),
      op('atLimit'),
    ],
  },
  {
    $id: 'unknown-allowance',
    ops: [
      op('read', { feature: 'harvest' }),
      op('record', { feature: 'harvest', usage: { used: 1, limit: 2 } }),
      op('clear', { feature: 'Adviser' }),
      op('mark', { feature: '', limit: 1 }),
    ],
  },
  {
    $id: 'unicode-did',
    ops: [
      op('record', { did: 'did:plc:é', usage: { used: 1, limit: 3 } }),
      op('read', { did: 'did:plc:é' }),
      op('read', { did: 'did:plc:é' }),
    ],
  },
  {
    $id: 'invalid-time',
    ops: [
      op('record', { now: INVALID, usage: { used: 1, limit: 3 } }),
      op('read', { now: INVALID }),
      op('read'),
    ],
  },
];

const MONTH_NOWS = [
  NOW,
  Date.parse('2026-12-01T03:00:00Z'),
  Date.parse('2026-12-20T00:00:00Z'),
  Date.parse('2026-12-31T23:59:59.999Z'),
  Date.parse('2027-01-01T00:00:00Z'),
  Date.parse('2024-02-29T12:00:00Z'),
  0,
  -1,
  Date.parse('0050-06-01T00:00:00Z'),
  Date.parse('-000001-03-01T00:00:00Z'),
  Date.parse('+275760-09-13T00:00:00Z'),
  8.64e15,
  INVALID,
];

const LINES = [
  { usage: { used: 12, limit: 30 } },
  { usage: { used: 1, limit: 15 }, feature: 'altText' },
  { usage: { used: 3, limit: 3 }, feature: 'style' },
  { usage: { used: 0, limit: 1 } },
  { usage: { used: 0, limit: 1 }, feature: 'style' },
  { usage: { used: 0, limit: 1 }, feature: 'altText' },
  { usage: { used: 45, limit: 30 } },
  { usage: { used: 30, limit: 30 }, now: Date.parse('2026-12-20T00:00:00Z') },
  {
    usage: { used: 15, limit: 15 },
    feature: 'altText',
    now: Date.parse('2026-06-30T23:00:00Z'),
  },
  { usage: { used: 1.5, limit: 30 } },
  { usage: { used: 2, limit: 2.5 } },
  { usage: { used: 1, limit: 1.2 } },
  { usage: { used: 1234, limit: 100000 } },
  { usage: { used: 1, limit: 1e21 } },
  { usage: null },
  { usage: { used: 1 } },
  { usage: { limit: 30 } },
  { usage: { used: -1, limit: 30 } },
  { usage: { used: 1, limit: 0 } },
  { usage: { used: '1', limit: 30 } },
  { usage: 'used' },
  { usage: { used: 1, limit: 3 }, feature: 'harvest' },
  { usage: { used: 3, limit: 3 }, now: INVALID },
];

export default async function cases() {
  const all = [
    value('usageConstants', {
      ADVISER_USAGE_KEY_PREFIX,
      USAGE_FEATURES,
      FREE_MONTHLY_LIMITS,
      key: adviserUsageKey(DID),
    }),
  ];
  all.push(
    ...(await each(
      'currentMonthKey',
      MONTH_NOWS.map((now) => ({ now })),
      ({ now }) => currentMonthKey(new Date(now)),
    )),
  );
  all.push(
    ...(await each(
      'usageResetsAt',
      MONTH_NOWS.map((now) => ({ now })),
      ({ now }) => {
        const at = usageResetsAt(new Date(now));
        return { ms: Number.isNaN(at.getTime()) ? 'NaN' : at.getTime() };
      },
    )),
  );
  all.push(...(await each('usageScript', SCRIPTS, (s) => play(s))));
  const lineInputs = [];
  for (const locale of LOCALE_CHOICES)
    for (const line of LINES) lineInputs.push({ locale, now: NOW, ...line });
  all.push(
    ...(await each(
      'adviserUsageLine',
      lineInputs,
      ({ locale, usage, feature, now }) => {
        setActiveLocale(locale);
        try {
          return adviserUsageLine(usage, {
            ...(feature ? { feature } : {}),
            now: new Date(now),
          });
        } finally {
          setActiveLocale(DEFAULT_LOCALE);
        }
      },
    )),
  );
  return all;
}
