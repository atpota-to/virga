// The command palette's brain: every command there is in each situation the
// app can be in (built from the app's own registries, word for word), which
// of them a few typed letters mean and in what order, how the palette groups
// them, the recent list, and the arrow keys. Swift:
// VirgaInsights/Shell/Commands.swift.

import {
  COMMAND_GROUPS,
  MAX_RECENT,
  RECENT_GROUP,
  buildCommands,
  fold,
  moveActive,
  paletteGroups,
  parseRecent,
  periodTitle,
  rankCommands,
  rememberRecent,
} from '../../../src/shell/commands.js';
import fs from 'node:fs';
import * as lucide from 'lucide-react';
import { REPORTS } from '../../../src/reports/registry.js';
import { TOOLS } from '../../../src/tools/registry.js';
import { POSTING_PAGES } from '../../../src/posting/routes.js';
import { DEFENSE_PAGES } from '../../../src/defense/routes.js';
import { SECTIONS } from '../../../src/settings/sections.js';
import { ANALYTICS_PERIODS } from '../../../src/lib/analytics.js';
import { each, grid, value } from './_helpers.js';
import { HARD_TEXT, iconName, seeded, withIconNames } from './_insights.js';

export const sources = [
  'src/shell/commands.js',
  'src/shell/CommandPalette.jsx',
];

// The icons the palette draws for a command without one of its own (its
// kind's, its sky's or its group's) are private to CommandPalette.jsx, so
// they are read from its lucide-react import and recorded by name, each
// as `{ name, icon }`: VirgaInsights' Icons.sfSymbol(lucide:) has to map
// every one (IconsTests reads each `icon` a fixture records).
function paletteIcons() {
  const source = fs.readFileSync(
    new URL('../../../src/shell/CommandPalette.jsx', import.meta.url),
    'utf8',
  );
  const list = /import\s*\{([^}]*)\}\s*from\s*'lucide-react'/.exec(source);
  if (!list)
    throw new Error('CommandPalette.jsx no longer imports lucide-react');
  return list[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      if (!lucide[name]) throw new Error(`lucide-react has no ${name}`);
      return { name, icon: iconName(lucide[name]) };
    });
}

const MIRA = {
  did: 'did:plc:mira',
  handle: 'mira.example.com',
  displayName: 'Mira Okafor',
  status: 'ready',
};
const LAB = {
  did: 'did:plc:lab',
  handle: 'lab.example.org',
  displayName: 'Field Lab',
  status: 'ready',
};

// The app's own context, as CommandPalette.jsx builds it (with the web
// test's two accounts and dashboards), icons by name.
const full = (overrides = {}) =>
  withIconNames({
    dashboards: [
      { id: 'd1', name: 'Overview' },
      { id: 'd2', name: 'Growth' },
    ],
    reports: REPORTS,
    tools: TOOLS,
    postingPages: POSTING_PAGES,
    defensePages: DEFENSE_PAGES,
    settingsSections: SECTIONS,
    accounts: [MIRA, LAB],
    activeDid: MIRA.did,
    periods: ANALYTICS_PERIODS,
    period: '30d',
    sky: 'clock',
    route: { section: 'dashboard', dashboard: 'd1' },
    archive: { built: true, complete: true, syncing: false },
    ...overrides,
  });

const CONTEXTS = {
  full: full(),
  // The web test's, with only three settings sections.
  test: full({
    settingsSections: [
      { key: 'account', label: 'Account' },
      { key: 'data', label: 'Data and sync' },
      { key: 'appearance', label: 'Appearance' },
    ],
  }),
  noDefense: full({ defensePages: [] }),
  unbuilt: full({ archive: { built: false } }),
  incomplete: full({ archive: { built: true, complete: false } }),
  syncing: full({ archive: { built: true, syncing: true } }),
  unknownComplete: full({ archive: { built: true } }),
  onReports: full({ route: { section: 'reports', page: 'followers' } }),
  goneDashboard: full({ route: { section: 'dashboard', dashboard: 'gone' } }),
  nullDashboard: full({ route: { section: 'dashboard', dashboard: null } }),
  onD2: full({ route: { section: 'dashboard', dashboard: 'd2' } }),
  customPeriod: full({ period: 'custom' }),
  nightSky: full({ sky: 'night', period: '1y' }),
  madeTools: full({
    tools: [
      { key: 'a', name: 'A' },
      { key: 'b', name: 'B', planned: true },
    ],
  }),
  plannedOnly: full({
    tools: [{ key: 'b', name: 'B', planned: true, desc: 'Later' }],
  }),
  more: full({
    reports: [
      ...withIconNames(REPORTS),
      { key: 'new-one', label: 'Something new' },
    ],
    settingsSections: [...SECTIONS, { key: 'labs', label: 'Labs' }],
  }),
  noReports: full({ reports: [] }),
  accounts: full({
    accounts: [
      MIRA,
      { ...LAB, displayName: '', status: 'needsSignIn' },
      { did: 'did:plc:nohandle' },
      { did: 'did:plc:handleonly', handle: 'only.example' },
      { did: 'did:plc:nameonly', displayName: 'Just A Name' },
      {
        did: 'did:plc:signedout',
        handle: 'out.example',
        displayName: 'Out',
        status: 'needsSignIn',
      },
    ],
  }),
  noActive: full({ activeDid: null }),
  otherActive: full({ activeDid: 'did:plc:someone-else' }),
  // Ids written two ways (é, and e with a combining accent): two strings to
  // JavaScript's ===, one to Swift's ==.
  accents: {
    dashboards: [
      { id: 'caf\u00e9', name: 'Composed' },
      { id: 'cafe\u0301', name: 'Decomposed' },
    ],
    accounts: [
      { did: 'caf\u00e9', handle: 'composed.example' },
      { did: 'cafe\u0301', handle: 'decomposed.example' },
    ],
    activeDid: 'cafe\u0301',
    periods: [{ key: 'caf\u00e9', days: 1, label: 'Day' }],
    period: 'cafe\u0301',
    route: { section: 'dashboard', dashboard: 'cafe\u0301' },
  },
  dashboardsOnly: {
    dashboards: [
      { id: 'café', name: 'Café numbers' },
      { id: 'x/y', name: '' },
    ],
    route: { section: 'dashboard', dashboard: 'café' },
  },
  empty: {},
};

const QUERIES = [
  '',
  '   ',
  'fol',
  'sync',
  'post',
  'time',
  'leanup',
  'settings data',
  'data settings',
  'dark',
  'appearance dark',
  'theme night',
  'compose',
  'lab',
  'followers zebra',
  'FOLLOWERS',
  'folowers',
  'youre',
  'you’re',
  'enggement',
  'xyz',
  'fts',
  'follow',
  'Follow-back',
  'unfollow',
  'n',
  'a',
  'new',
  '7',
  'last 7',
  'year',
  'sky',
  'reports',
  'all',
  'defense',
  'pile',
  'radar',
  'switch',
  'mira',
  'okafor',
  'legal',
  'terms',
  'privacy',
  'scheduled',
  'weekly',
  'queue',
  'draft',
  'archive',
  'json',
  'csv',
  'colours',
  'colors',
  'Ünfollow',
  'café',
  '—',
  '...',
  'post—timers',
  'tim',
  'tmr',
  'pst',
  'grwth',
  'ovr',
  'id',
  'dsh',
  'customize',
  'edit',
  'build',
  'period 30',
  '30d',
];

const CUSTOM = {
  tied: [
    { id: 'a', group: 'Tools', title: 'Alpha one' },
    { id: 'b', group: 'Tools', title: 'Alpha two' },
  ],
  cafe: [{ id: 'x', group: 'Dashboards', title: 'Café numbers' }],
  scripts: [
    { id: 'k1', group: 'Dashboards', title: '한국어 대시보드' },
    { id: 'g1', group: 'Dashboards', title: 'ΟΔΟΣ Σίσυφος' },
    { id: 't1', group: 'Dashboards', title: 'İstanbul ışık' },
    { id: 'j1', group: 'Dashboards', title: '日本語のレポート' },
    { id: 'e1', group: 'Dashboards', title: 'Emoji 👍🏽 board' },
    { id: 'z1', group: 'Dashboards', title: 'Ångström ﬁle Straße' },
    { id: 'a1', group: 'Dashboards', title: "O’Brien’s ‘quoted’ don't" },
    { id: 'n1', group: 'Dashboards', title: 'Ⅻ ½ ٣ numbers' },
    { id: 'c1', group: 'Dashboards', title: 'éé combining' },
  ],
  fields: [
    {
      id: 'h',
      group: 'Reports',
      title: 'Plain',
      hint: 'Mentions followers somewhere',
    },
    { id: 'k', group: 'Reports', title: 'Other', keywords: 'followers words' },
    { id: 'g', group: 'Followers', title: 'Grouped' },
    { id: 't', group: 'Reports', title: 'Unfollowers here' },
    { id: 's', group: 'Reports', title: 'Followers start' },
    { id: 'w', group: 'Reports', title: 'The followers word' },
  ],
  scattered: [
    { id: 's1', group: 'Tools', title: 'abcdefghij' },
    { id: 's2', group: 'Tools', title: 'a-b-c-d' },
    { id: 's3', group: 'Tools', title: 'axxxxxxbxxxxxxc' },
    { id: 's4', group: 'Tools', title: 'Ab Cd Ef' },
    { id: 's5', group: 'Tools', title: 'a👍b👍c' },
    // Gaps of exactly twice the word's length still count; one more doesn't.
    { id: 's6', group: 'Tools', title: 'axxxbxxxc' },
    { id: 's7', group: 'Tools', title: 'axxxbxxxxc' },
  ],
  missing: [
    { id: 'm1', group: 'Tools' },
    { id: 'm2', title: 'No group' },
    { id: 'm3', group: 'Tools', title: 'Has all', hint: '', keywords: '' },
  ],
  accents: [
    { id: 'caf\u00e9', group: 'Caf\u00e9', title: 'Alpha one' },
    { id: 'cafe\u0301', group: 'Cafe\u0301', title: 'Alpha two' },
    { id: 'b', group: 'Caf\u00e9', title: 'Alpha three' },
  ],
  dupes: [
    { id: 'd', group: 'Tools', title: 'Same id one' },
    { id: 'd', group: 'Reports', title: 'Same id two' },
    { id: 'e', group: 'Tools', title: 'Other' },
  ],
  // Pairs whose sums tie only at the scores' exact values, for "alpha
  // gamma": 80 + 45 = 100 + 25, 60 + 60 = 100 + 20 (letters in order with
  // no gap), 50 + 45 = 80 + 15 (letters with five gaps). Each pair is here
  // in both orders, so a score that moves either way reorders one of them.
  ties: [
    { id: 'a1', group: 'Tools', title: 'Zed alpha', keywords: 'gamma' },
    { id: 'b1', group: 'Tools', title: 'Gamma', hint: 'alpha one' },
    { id: 'a2', group: 'Tools', title: 'Xalpha xgamma' },
    { id: 'b2', group: 'Tools', title: 'Alpha g amma' },
    { id: 'a3', group: 'Alpha', title: 'Q', keywords: 'gamma' },
    { id: 'b3', group: 'Tools', title: 'Zed alpha gxxaxmxmxa' },
  ],
};

// The tied pairs, each the other way round.
CUSTOM.tiesReversed = CUSTOM.ties.map(
  (_, i, list) => list[i % 2 ? i - 1 : i + 1],
);

const CUSTOM_QUERIES = {
  tied: ['alpha', 'one', 'al'],
  cafe: ['cafe', 'CAFÉ', 'numbers cafe', 'cfe'],
  scripts: [
    '한국',
    '하',
    'ᄒ',
    'οδος',
    'οδοσ',
    'σισυφος',
    'istanbul',
    'işık',
    'isik',
    'i̇stanbul',
    '日本',
    'レポート',
    'emoji',
    '👍',
    'angstrom',
    'file',
    'strasse',
    'straße',
    'obriens',
    'quoted',
    'dont',
    'xii',
    'ⅻ',
    '½',
    '٣',
    'ee',
    'é',
  ],
  fields: ['followers', 'follow', 'start', 'word', 'grouped', 'mentions'],
  scattered: ['acf', 'abc', 'ace', 'aj', 'aceg', 'abd', 'bdf', 'ab'],
  missing: ['tools', 'no', 'has', 'group'],
  dupes: ['same', 'one', ''],
  accents: ['alpha', 'one', ''],
  ties: ['alpha gamma', 'gamma alpha', 'gamma', 'zed'],
  tiesReversed: ['alpha gamma', 'gamma alpha'],
};

const RECENTS = [
  [],
  ['sky:night', 'go:/reports/followers', 'gone:command'],
  ['go:/tools/follow-back', 'go:/tools/follow-cleanup'],
  ['sky:night', 'sky:night', 'sky:dawn'],
  [
    'do:new-post',
    'do:sync',
    'do:customize',
    'do:new-dashboard',
    'go:/dashboard/d1',
    'go:/dashboard/d2',
    'go:/reports/followers',
    'go:/reports/blocks',
  ],
  ['b'],
  ['d', 'e'],
];

const ids = (list) => list.map((c) => c.id);

// Generated text, the same on every run: titles, hints, keywords and
// queries made of HARD_TEXT, so folding, word splitting, the scores and
// the UTF-16 positions the scattered match counts are held to the web's
// over far more text than a hand-written list reaches. Queries are partly
// cut from the titles (a word, its start, a word with a letter dropped),
// so most of them match something.
const fuzz = seeded(20261119);
const FUZZ_TEXT = Array.from({ length: 160 }, () => fuzz.string(HARD_TEXT, 14));
const FUZZ_COMMANDS = Array.from({ length: 40 }, (_, i) => {
  const command = {
    id: `f${i}`,
    group: fuzz.pick(['Tools', 'Reports', 'Ünïcödé', 'Σύνολο', 'İşler']),
    title: fuzz.string(HARD_TEXT, 16),
  };
  if (fuzz.int(2)) command.hint = fuzz.string(HARD_TEXT, 20);
  if (fuzz.int(2)) command.keywords = fuzz.string(HARD_TEXT, 20);
  return command;
});
const FUZZ_QUERIES = Array.from({ length: 120 }, () => {
  const source = fuzz.pick(FUZZ_COMMANDS);
  const text =
    fuzz.pick([
      source.title,
      source.hint,
      source.keywords,
      source.group,
      source.title,
    ]) ?? '';
  const words = text.split(/\s+/u).filter(Boolean);
  const word = fuzz.pick(words.length ? words : [fuzz.string(HARD_TEXT, 4)]);
  const points = [...word];
  switch (fuzz.int(5)) {
    case 0:
      return word;
    case 1:
      return points.slice(0, 1 + fuzz.int(Math.max(1, points.length))).join('');
    case 2:
      points.splice(fuzz.int(Math.max(1, points.length)), 1);
      return points.join('');
    case 3:
      return `${word} ${fuzz.string(HARD_TEXT, 3)}`;
    default:
      return fuzz.string(HARD_TEXT, 5);
  }
});

export default async function cases() {
  return [
    value('constants', { COMMAND_GROUPS, RECENT_GROUP, MAX_RECENT }),
    value('contexts', CONTEXTS),
    value('fuzzCommands', FUZZ_COMMANDS),
    value('paletteIcons', paletteIcons()),
    ...(await each(
      'periodTitle',
      [
        ...ANALYTICS_PERIODS,
        { key: '1y', days: 365, label: 'Year' },
        { key: '14d', days: 14, label: 'TWO WEEKS' },
        { key: 'x', days: 3, label: '' },
        { key: 'x', days: 3 },
        { key: 'x', days: 0, label: 'None' },
        { key: '1y', days: null, label: 'Year' },
        { key: 'g', days: 5, label: 'ΟΔΟΣ ΣΣ' },
        { key: 't', days: 5, label: 'İstanbul' },
        {},
        null,
      ].map((period) => ({ period })),
      ({ period }) => periodTitle(period),
    )),
    ...(await each(
      'buildCommands',
      Object.keys(CONTEXTS).map((name) => ({ $id: name, context: name })),
      ({ context }) =>
        context === 'empty'
          ? buildCommands()
          : buildCommands(CONTEXTS[context]),
    )),
    ...(await each(
      'fold',
      [
        'Café d’Été',
        'FOLLOWERS',
        '',
        null,
        'Lists you’re on',
        "don't ‘quote’",
        'ΟΔΟΣ',
        'İstanbul',
        'Straße',
        'ﬁle',
        'Ångström',
        '한국어',
        'é́⃝',
        'Emoji 👍🏽 👨‍👩‍👧',
        'Ⅻ',
        'ǅ',
        'ᾈ',
        'ͅ',
        'ẍ̲y',
        ' spaced ',
        ...FUZZ_TEXT,
      ].map((text) => ({ text })),
      ({ text }) => fold(text),
    )),
    ...(await each(
      'rankCommands',
      [
        ...QUERIES.map((query) => ({ context: 'full', query })),
        ...grid({
          context: ['full'],
          query: ['', 'follow', 'post', 'sky', 'alpha', 'a'],
          recent: RECENTS,
        }),
        ...['test', 'accounts', 'dashboardsOnly', 'empty'].flatMap((context) =>
          ['fol', 'switch', 'cafe', 'n', ''].map((query) => ({
            context,
            query,
          })),
        ),
        ...Object.entries(CUSTOM_QUERIES).flatMap(([list, queries]) =>
          queries.flatMap((query) => [
            { commands: CUSTOM[list], query },
            { commands: CUSTOM[list], query, recent: ['b', 'd', 'e', 's3'] },
          ]),
        ),
        { commands: null, query: 'a' },
        { commands: null, query: '' },
        { commands: CUSTOM.accents, query: 'alpha', recent: ['cafe\u0301'] },
        { commands: CUSTOM.accents, query: 'alpha', recent: ['caf\u00e9'] },
        // The generated list is written once (`fuzzCommands`), and named.
        ...FUZZ_QUERIES.map((query, i) => ({
          $id: `fuzz#${i + 1}`,
          named: 'fuzzCommands',
          query,
          ...(i % 3 ? {} : { recent: ['f3', 'f1', 'f20', 'f0'] }),
        })),
        ...FUZZ_QUERIES.slice(0, 40).map((query, i) => ({
          $id: `fuzz-full#${i + 1}`,
          context: 'full',
          query,
        })),
      ],
      ({ context, named, commands, query, recent }) => {
        const list = context
          ? context === 'empty'
            ? buildCommands()
            : buildCommands(CONTEXTS[context])
          : named
            ? FUZZ_COMMANDS
            : commands;
        return ids(rankCommands(list, query, recent ? { recent } : undefined));
      },
    )),
    ...(await each(
      'paletteGroups',
      [
        ...grid({
          context: ['full', 'test', 'accounts', 'syncing'],
          query: ['', 'follow', 'sky', 'zzzz', 'settings', 's'],
          recent: RECENTS.slice(0, 2),
        }),
        ...grid({
          context: ['full'],
          query: ['', 'a'],
          recent: RECENTS.slice(2),
        }),
        {
          commands: CUSTOM.accents,
          query: '',
          recent: ['cafe\u0301', 'b'],
        },
        { commands: CUSTOM.accents, query: 'alpha', recent: [] },
        // (Not `missing`: a group the web leaves undefined is a group named
        // nothing, which JSON can't carry.)
        ...Object.keys(CUSTOM)
          .filter((list) => list !== 'missing')
          .flatMap((list) =>
            ['', 'a', 'one'].map((query) => ({
              commands: CUSTOM[list],
              query,
              recent: ['b', 'd', 'd', 'e', 's3', 'zzz'],
            })),
          ),
      ],
      ({ context, commands, query, recent }) => {
        const list = context ? buildCommands(CONTEXTS[context]) : commands;
        return paletteGroups(list, query, { recent }).map((g) => ({
          group: g.group,
          items: ids(g.items),
        }));
      },
    )),
    ...(await each(
      'rememberRecent',
      [
        { recent: ['a', 'b'], id: 'b' },
        { recent: ['a', 'b'], id: 'c' },
        { recent: null, id: 'a' },
        { recent: 'not a list', id: 'a' },
        { recent: { 0: 'a' }, id: 'b' },
        { recent: Array.from({ length: 20 }, (_, i) => `c${i}`), id: 'new' },
        { recent: Array.from({ length: 20 }, (_, i) => `c${i}`), id: 'c3' },
        { recent: Array.from({ length: 20 }, (_, i) => `c${i}`), id: '' },
        { recent: ['a', 3, null, 'b', ['c'], 'a'], id: 'z' },
        { recent: ['a', 'a', 'b'], id: null },
        { recent: ['a', 'b'], id: '' },
        { recent: ['x', 'caf\u00e9', 'y'], id: 'cafe\u0301' },
        { recent: [], id: 'only' },
        { recent: ['x', 'y', 'z', 'w', 'v', 'u', 't', 's'], id: 'x' },
        { recent: ['x', 'y', 'z', 'w', 'v', 'u', 't', 's'], id: 'r' },
      ],
      ({ recent, id }) => rememberRecent(recent, id),
    )),
    ...(await each(
      'parseRecent',
      [
        JSON.stringify(['a', 'b']),
        'not json',
        JSON.stringify({ a: 1 }),
        JSON.stringify(['a', 3, null]),
        null,
        '',
        '[]',
        'null',
        '"a"',
        '5',
        JSON.stringify(Array.from({ length: 20 }, (_, i) => `c${i}`)),
        JSON.stringify(['a', 'a', 'b']),
        '[1, "a", {"b": 2}, ["c"], "d"]',
        ' ["spaced"] ',
        '["a",]',
        '["\\u00e9", "\\ud83d\\udc4d"]',
      ].map((raw) => ({ raw })),
      ({ raw }) => parseRecent(raw),
    )),
    ...(await each(
      'moveActive',
      grid({
        key: [
          'ArrowDown',
          'ArrowUp',
          'Home',
          'End',
          'a',
          'Enter',
          'Tab',
          'arrowdown',
        ],
        index: [-1, 0, 1, 2, 3, 7],
        count: [-1, 0, 1, 3],
      }),
      ({ key, index, count }) => moveActive(key, index, count),
    )),
  ];
}
