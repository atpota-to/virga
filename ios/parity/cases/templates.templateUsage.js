// src/posting/templates/templateUsage.js: each template's use count, kept
// in localStorage under virga:template-usage:<did>, and the shelf order it
// feeds. Scripts of reads and uses run against a fresh in-memory store; each
// records what every call returned and the store's text afterwards, byte
// for byte, so a value written by either app reads in the other. Swift:
// VirgaPosting/Templates/TemplateUsage.swift.
//
// Inputs from templateUsage.test.js (corrupt and odd stored values, five
// hundred entries and one more), plus array-index rkeys (which a JavaScript
// object lists first), ties among the entries dropped, times without an
// offset read in the local zone, and shelf sorts over unicode names and
// groups that differ only in case or accents.

import {
  TEMPLATE_USAGE_PREFIX,
  readTemplateUsage,
  recordTemplateUse,
  sortTemplatesForShelf,
  templateUsageKey,
} from '../../../src/posting/templates/templateUsage.js';
import { each, value } from './_helpers.js';
import { inZone } from './_zones.js';

export const sources = ['src/posting/templates/templateUsage.js'];

const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const key = templateUsageKey;
const iso = (s) => new Date(s).toISOString();

function many(n, { prefix = 'old', minute = (i) => i } = {}) {
  const out = {};
  for (let i = 0; i < n; i++) {
    out[`${prefix}${i}`] = {
      count: 1,
      lastUsedAt: new Date(Date.UTC(2026, 0, 1, 0, minute(i))).toISOString(),
    };
  }
  return out;
}

// A script: the store's starting text, then reads and uses in order.
const SCRIPTS = {
  countsEachUse: {
    store: {},
    steps: [
      ['read', ALICE],
      ['record', '3la', ALICE, '2026-10-01T09:00:00.000Z'],
      ['record', '3la', ALICE, '2026-10-02T10:30:00.000Z'],
      ['record', '3lb', ALICE, '2026-10-01T09:00:00.000Z'],
      ['read', ALICE],
    ],
  },
  apart: {
    store: {},
    steps: [
      ['record', '3la', ALICE, '2026-10-01T00:00:00.000Z'],
      ['record', '3la', ALICE, '2026-10-01T00:00:01.000Z'],
      ['record', '3la', BOB, '2026-10-01T00:00:02.000Z'],
      ['read', ALICE],
      ['read', BOB],
    ],
  },
  nothingWithout: {
    store: {},
    steps: [
      ['record', '3la', null, '2026-10-01T00:00:00.000Z'],
      ['record', '', ALICE, '2026-10-01T00:00:00.000Z'],
      ['record', 5, ALICE, '2026-10-01T00:00:00.000Z'],
      ['record', null, ALICE, '2026-10-01T00:00:00.000Z'],
      ['record', '3la', '', '2026-10-01T00:00:00.000Z'],
      ['read', null],
      ['read', ''],
    ],
  },
  corrupt: {
    store: { [key(ALICE)]: '{broken' },
    steps: [
      ['read', ALICE],
      ['record', '3la', ALICE, '2026-10-01T00:00:00.000Z'],
    ],
  },
  odd: {
    store: {
      [key(ALICE)]: JSON.stringify({
        '3la': { count: 3.7, lastUsedAt: 'yesterday-ish' },
        '3lb': { count: -2 },
        '3lc': 'five',
        '3ld': { count: 2, lastUsedAt: '2026-10-01T00:00:00.000Z' },
        '': { count: 4 },
        '3le': { count: '4' },
        '3lf': { count: 0.5 },
        '3lg': { count: 1e21, lastUsedAt: 'Oct 1 2026' },
        '3lh': [1],
        '3li': null,
        '3lj': { count: 1, lastUsedAt: 12345 },
        '3lk': { count: 1, lastUsedAt: '' },
        '3ll': { count: 1.9999, lastUsedAt: '2026-10-01' },
      }),
    },
    steps: [
      ['read', ALICE],
      ['record', '3la', ALICE, '2026-10-05T00:00:00.000Z'],
      ['record', '3le', ALICE, '2026-10-06T00:00:00.000Z'],
    ],
  },
  notAnObject: {
    store: { [key(ALICE)]: '[1,2,3]', [key(BOB)]: '"text"' },
    steps: [
      ['read', ALICE],
      ['read', BOB],
      ['record', 'x', BOB, '2026-10-01T00:00:00.000Z'],
    ],
  },
  emptyText: {
    store: { [key(ALICE)]: '' },
    steps: [['read', ALICE]],
  },
  nullText: {
    store: { [key(ALICE)]: 'null' },
    steps: [
      ['read', ALICE],
      ['record', 'x', ALICE, '2026-10-01T00:00:00.000Z'],
    ],
  },
  indexKeys: {
    store: {
      [key(ALICE)]: JSON.stringify({
        zeta: { count: 1, lastUsedAt: null },
        10: { count: 2, lastUsedAt: null },
        2: { count: 3, lastUsedAt: null },
        '02': { count: 4, lastUsedAt: null },
        alpha: { count: 5, lastUsedAt: null },
      }),
    },
    steps: [
      ['read', ALICE],
      ['record', '7', ALICE, '2026-10-01T00:00:00.000Z'],
      ['record', 'beta', ALICE, '2026-10-01T00:00:00.000Z'],
      ['record', '4294967295', ALICE, '2026-10-01T00:00:00.000Z'],
      ['record', '4294967294', ALICE, '2026-10-01T00:00:00.000Z'],
    ],
  },
  unicodeKeys: {
    store: {},
    steps: [
      ['record', 'é', ALICE, '2026-10-01T00:00:00.000Z'],
      ['record', 'é', ALICE, '2026-10-02T00:00:00.000Z'],
      ['record', 'K', ALICE, '2026-10-03T00:00:00.000Z'],
      ['record', 'K', ALICE, '2026-10-04T00:00:00.000Z'],
      ['record', 'quote"back\\slash\n', ALICE, '2026-10-05T00:00:00.000Z'],
      ['record', '🌿', ALICE, '2026-10-06T00:00:00.000Z'],
      ['read', ALICE],
    ],
  },
  dropsLeastRecent: {
    store: { [key(ALICE)]: JSON.stringify(many(500)) },
    steps: [
      ['record', 'fresh', ALICE, '2026-10-14T00:00:00.000Z'],
      ['read', ALICE],
    ],
  },
  dropsWithTies: {
    store: {
      [key(ALICE)]: JSON.stringify({
        ...many(499, { minute: (i) => i % 3 }),
        5: { count: 9, lastUsedAt: null },
        3: { count: 9, lastUsedAt: '2026-01-01T00:00:00.000Z' },
      }),
    },
    steps: [
      ['record', 'fresh', ALICE, '2026-01-01T00:00:00.000Z'],
      ['read', ALICE],
      ['record', 'fresher', ALICE, '2026-01-01T00:01:00.000Z'],
      ['read', ALICE],
    ],
  },
  exactlyFiveHundred: {
    store: { [key(ALICE)]: JSON.stringify(many(499)) },
    steps: [['record', 'fivehundredth', ALICE, '2026-10-14T00:00:00.000Z']],
  },
  localTimes: {
    store: {
      [key(ALICE)]: JSON.stringify({
        ...many(499),
        zoned: { count: 1, lastUsedAt: '2026-01-01T03:00:00' },
        dated: { count: 1, lastUsedAt: '2026-01-01' },
      }),
    },
    steps: [['record', 'fresh', ALICE, '2026-10-14T00:00:00.000Z']],
    tz: 'Pacific/Kiritimati',
  },
  localTimesWest: {
    store: {
      [key(ALICE)]: JSON.stringify({
        ...many(499),
        zoned: { count: 1, lastUsedAt: '2026-01-01T03:00:00' },
        dated: { count: 1, lastUsedAt: '2026-01-01' },
      }),
    },
    steps: [['record', 'fresh', ALICE, '2026-10-14T00:00:00.000Z']],
    tz: 'America/Los_Angeles',
  },
};

function run({ store: initial, steps, tz = 'UTC' }) {
  const store = memoryStore(initial);
  return inZone(tz, () => {
    const results = steps.map(([op, ...args]) => {
      // As entries, so the order and keys that only look alike show.
      if (op === 'read')
        return Object.entries(readTemplateUsage(args[0], { store }));
      const [rkey, did, now] = args;
      return recordTemplateUse(rkey, did, new Date(now), { store });
    });
    return { results, store: Object.fromEntries(store.data) };
  });
}

const t = (rkey, name, group = '') => ({ rkey, name, group });

const SORTS = {
  fromTest: [
    [
      t('u1', 'zebra'),
      t('u2', 'Apple'),
      t('s1', 'Beta', 'Support'),
      t('s2', 'alpha', 'Support'),
      t('s3', 'Gamma', 'Support'),
      t('f1', 'Notes', 'Field notes'),
    ],
    { s3: { count: 4 }, s1: { count: 4 }, u1: { count: 1 } },
  ],
  caseGroups: [
    [t('a', 'One', 'help'), t('b', 'Two', 'Help'), t('c', 'Three', 'help')],
    {},
  ],
  noUsage: [[t('b', 'B'), t('a', 'A')], undefined],
  nullList: [null, {}],
  accents: [
    [
      t('1', 'Éclair', 'Désserts'),
      t('2', 'eclair', 'Desserts'),
      t('3', 'ECLAIR', 'desserts'),
      t('4', 'Ecl', 'Désserts'),
      t('5', 'éclair', ' Desserts '),
    ],
    { 2: { count: 1 }, 5: { count: 1 } },
  ],
  unicode: [
    [
      t('a', '🌿 Plants', '🌿'),
      t('b', 'Ζήτα', 'Ελληνικά'),
      t('c', 'Ålborg', 'Nordic'),
      t('d', 'Zürich', 'Nordic'),
      t('e', '山田', 'CJK'),
      t('f', 'straße', 'German'),
      t('g', 'Strasse', 'German'),
      t('h', '', ''),
      t('i', '  ', '  '),
      t('j', 'a​b', 'Z'),
      t('k', 'ab', 'Z'),
    ],
    { c: { count: 2 } },
  ],
  tiesOnName: [
    [
      t('3lb', 'Same'),
      t('3la', 'same'),
      t('3LA', 'SAME'),
      t('3la.x', 'Same'),
      t('3l-a', 'same'),
    ],
    {},
  ],
  counts: [
    [t('a', 'A'), t('b', 'B'), t('c', 'C'), t('d', 'D'), t('e', 'E')],
    {
      a: { count: '3' },
      b: { count: 'lots' },
      c: { count: null },
      d: 'nope',
      e: { count: 2 },
    },
  ],
  missingRkeys: [
    [
      { name: 'No key', group: '' },
      { name: 'Also none', group: '' },
      { name: 'Null', rkey: null },
    ],
    { undefined: { count: 5 }, null: { count: 9 } },
  ],
  falsyTemplates: [[null, t('a', 'A'), 0, '', false, t('b', 'B')], {}],
  oddFields: [
    [
      { rkey: 'a', name: 5, group: 7 },
      { rkey: 'b', name: null, group: null },
      { rkey: 'c', name: ['x', 'y'], group: '7' },
    ],
    {},
  ],
  arrayUsage: [
    [t('0', 'Zero'), t('1', 'One'), t('x', 'Ex')],
    [{ count: 1 }, { count: 5 }],
  ],
  numberUsage: [[t('a', 'A'), t('b', 'B')], 5],
  many: [
    Array.from({ length: 70 }, (_, i) =>
      t(
        `r${(i * 37) % 70}`,
        `Name ${(i * 11) % 9}`,
        ['', 'G1', 'g1', 'G2'][i % 4],
      ),
    ),
    Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`r${i * 2}`, { count: i % 4 }]),
    ),
  ],
};

export default async function cases() {
  const out = [];
  out.push(value('TEMPLATE_USAGE_PREFIX', TEMPLATE_USAGE_PREFIX));
  out.push(
    ...(await each(
      'templateUsageKey',
      [ALICE, '', 'did:web:é.example'].map((did) => ({ did })),
      ({ did }) => templateUsageKey(did),
    )),
  );
  out.push(
    ...(await each(
      'script',
      Object.entries(SCRIPTS).map(([name, script]) => ({
        $id: name,
        ...script,
      })),
      run,
    )),
  );
  out.push(
    ...(await each(
      'sortTemplatesForShelf',
      Object.entries(SORTS).map(([name, [templates, usage]]) => ({
        $id: name,
        templates,
        usage,
      })),
      ({ templates, usage }) => sortTemplatesForShelf(templates, usage),
    )),
  );
  // The test's own dates, for the Swift side to stamp the same way.
  out.push(value('isoOf', iso('2026-10-01T09:00:00.000Z')));
  return out;
}
