// src/defense/pageModel.js: the Defense page's words and lists. Swift:
// VirgaDefense/PageModel.swift. Pure, so every export is held here: the
// posts offered for a scan (in several zones), each account's phrases, the
// radar's callout and the list's facts (in several locales), a scan's stage
// line, label, count and bar, and the scan as CSV rows with its cells made
// inert. The inputs are pageModel.test.js's, rows made with _defense.js's
// participant and scoreOf, a real crowd from the harness, and their edges.

import {
  describeRow,
  didPhrase,
  inertCell,
  postsToScan,
  protectedPhrase,
  rowFacts,
  scanCsvRows,
  stageCount,
  stageFraction,
  stageLabel,
  stageLine,
  vouchPhrase,
} from '../../../src/defense/pageModel.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { ZONES, each, value } from './_helpers.js';
import {
  crowdScan,
  crowdSummary,
  madeUpSummary,
  participant,
  postsBetween,
  scoreOf,
  withZone,
} from './_defense.js';

export const sources = ['src/defense/pageModel.js'];

const LOCALES = ['en-US', 'en-GB', 'en-IN', 'en-DE', 'en-FR', 'en-CH'];

/** Runs `fn` in `locale`, and puts the default back. */
function inLocale(locale, fn) {
  try {
    if (locale) setActiveLocale(locale);
    return fn();
  } finally {
    setActiveLocale(DEFAULT_LOCALE);
  }
}

const NOW = Date.parse('2026-11-17T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();

/** A scored row: the participant joined to its score, as summarise joins them. */
const row = (did, kinds, band, trust, over = {}) => ({
  ...participant(did, kinds),
  ...scoreOf(did, band, trust, over),
});
/** A row nobody scored: only the band. */
const unscored = (did, kinds) => ({
  ...participant(did, kinds),
  band: 'UNKNOWN',
});

// pageModel.test.js's row, and the rows its cases imply, made whole.
const ROWS = {
  test: row('did:plc:x', ['threadReply', 'like'], 'CONNECTED', 60, {
    handle: 'x.example.com',
    vouches: 4,
    followers: 1200,
    followsYou: true,
  }),
  one: row('did:plc:one', ['like'], 'PERIPHERAL', 30, { vouches: 1 }),
  none: row('did:plc:none', ['like'], 'UNKNOWN', 2, { vouches: 0 }),
  youFollow: row('did:plc:yf', ['repost'], 'PROTECTED', 100, {
    youFollow: true,
    vouches: 9,
  }),
  many: row('did:plc:many', ['quote', 'reply', 'like'], 'CONNECTED', 88, {
    vouches: 1_234_567,
    followers: 2_500_000,
  }),
  fraction: row('did:plc:frac', ['like'], 'PERIPHERAL', 31, {
    vouches: 1.5,
    followers: 1.5,
  }),
  oneFollower: row('did:plc:f1', ['like'], 'UNKNOWN', 1, { followers: 1 }),
  ownAccount: row('did:plc:own', ['reply'], 'PROTECTED', 100, {
    protectedReason: 'your own account',
  }),
  followed: row('did:plc:fol', ['reply'], 'PROTECTED', 100, {
    protectedReason: 'you follow them',
    youFollow: true,
  }),
  listed: row('did:plc:lst', ['like', 'quote'], 'PROTECTED', 100, {
    protectedReason: 'on your list “Neighbours”',
  }),
  emojiReason: row('did:plc:emo', ['like'], 'PROTECTED', 100, {
    protectedReason: '😀 kept by hand',
  }),
  sharpS: row('did:plc:ss', ['like'], 'PROTECTED', 100, {
    protectedReason: 'ßtraße',
  }),
  digraph: row('did:plc:dz', ['like'], 'PROTECTED', 100, {
    protectedReason: 'ǳ',
  }),
  accented: row('did:plc:acc', ['like'], 'PROTECTED', 100, {
    protectedReason: 'élan',
  }),
  protectedNoReason: row('did:plc:pnr', ['like'], 'PROTECTED', 100, {
    protectedReason: null,
    vouches: 2,
  }),
  protectedEmptyReason: row('did:plc:per', ['like'], 'PROTECTED', 100, {
    protectedReason: '',
    vouches: 3,
  }),
  reasonNotProtected: row('did:plc:rnp', ['like'], 'CONNECTED', 70, {
    protectedReason: 'stale',
    vouches: 5,
  }),
  nameOnly: row('did:plc:name', ['like'], 'NOTABLE', 40, {
    handle: null,
    displayName: 'Mira Okafor',
    followers: 12_000,
  }),
  didOnly: row('did:plc:bare', ['like'], 'UNKNOWN', 5, {
    handle: null,
    displayName: null,
  }),
  emptyHandle: row('did:plc:eh', ['like'], 'UNKNOWN', 5, {
    handle: '',
    displayName: '',
  }),
  blocks: row('did:plc:blk', ['quote'], 'UNKNOWN', 0, {
    blocksYou: true,
    followsYou: true,
  }),
  everyKind: row(
    'did:plc:all',
    ['like', 'repost', 'quote', 'threadReply', 'reply', 'gate', 'other'],
    'NOTABLE',
    50,
    { followers: 999 },
  ),
  quoteRepostLike: row(
    'did:plc:qrl',
    ['like', 'repost', 'quote'],
    'UNKNOWN',
    3,
  ),
  gateOnly: row('did:plc:gate', ['gate'], 'UNKNOWN', 3),
  mystery: row('did:plc:mys', ['mystery'], 'UNKNOWN', 3),
  engagedNothing: row('did:plc:nil', [], 'UNKNOWN', 3),
  formulaName: row('did:plc:fx', ['like'], 'UNKNOWN', 3, {
    handle: '+1.test',
    displayName: '=cmd|calc',
  }),
  formulaHandle: row('did:plc:fy', ['like'], 'UNKNOWN', 3, {
    handle: '@SUM(A1)',
    displayName: '-2+3',
  }),
  tabName: row('did:plc:tab', ['like'], 'UNKNOWN', 3, {
    handle: '\tx',
    displayName: '\rx',
  }),
  newlineName: row('did:plc:nl', ['like'], 'UNKNOWN', 3, {
    handle: '\nx',
    displayName: ' =x',
  }),
  negative: row('did:plc:neg', ['like'], 'UNKNOWN', 3, {
    vouches: -1,
    followers: -5,
  }),
  unscored: unscored('did:plc:un', ['like', 'reply']),
  unscoredNothing: unscored('did:plc:un2', []),
};

const POSTS = [
  { uri: 'at://a/p/1', at: daysAgo(2), replies: 40, quotes: 9, reposts: 3 },
  { uri: 'at://a/p/2', at: daysAgo(3), replies: 2, quotes: 0, reposts: 50 },
  { uri: 'at://a/p/3', at: daysAgo(40), replies: 300, quotes: 80 },
  {
    uri: 'at://a/p/4',
    at: daysAgo(1),
    replies: 0,
    quotes: 0,
    reposts: 900,
    likes: 4000,
  },
  { uri: 'at://a/p/5', at: daysAgo(5), replies: 2, quotes: 0, reposts: 70 },
  { uri: 'at://a/p/6', at: daysAgo(6), replies: 1, quotes: 1, reposts: 1 },
  { uri: 'at://a/p/7', at: daysAgo(7), replies: 1, quotes: 0 },
];

const EDGE_POSTS = [
  null,
  {},
  { at: daysAgo(1), replies: 5 },
  { uri: '', at: daysAgo(1), replies: 5 },
  { uri: 'at://a/p/bad-date', at: 'not a date', replies: 5 },
  { uri: 'at://a/p/no-date', replies: 5 },
  { uri: 'at://a/p/null-date', at: null, replies: 5 },
  { uri: 'at://a/p/edge', at: daysAgo(30), replies: 1 },
  {
    uri: 'at://a/p/past-edge',
    at: new Date(NOW - 30 * 86_400_000 - 1).toISOString(),
    replies: 1,
  },
  { uri: 'at://a/p/future', at: daysAgo(-2), quotes: 3 },
  { uri: 'at://a/p/tie-a', at: daysAgo(4), replies: 3, reposts: 2 },
  { uri: 'at://a/p/tie-b', at: daysAgo(3), replies: 3, reposts: 2 },
  { uri: 'at://a/p/tie-c', at: daysAgo(3), replies: 2, quotes: 1, reposts: 2 },
  { uri: 'at://a/p/nan', at: daysAgo(2), replies: null, quotes: 2 },
  { uri: 'at://a/p/negative', at: daysAgo(2), replies: -3, quotes: 1 },
];

// Times without an offset are local.
const LOCAL_POSTS = [
  { uri: 'at://a/p/local', at: '2026-10-18T06:00:00', replies: 1 },
  { uri: 'at://a/p/utc', at: '2026-10-18T06:00:00Z', replies: 1 },
  { uri: 'at://a/p/date', at: '2026-10-18', replies: 1 },
];

const STATES = [
  null,
  {},
  { stage: 'post' },
  { stage: 'harvest', progress: { done: 0, total: 0 } },
  { stage: 'harvest', progress: { done: 2, total: 4 } },
  { stage: 'harvest', progress: { done: 1, total: 1 } },
  { stage: 'canary' },
  { stage: 'canary', progress: { done: 3, total: 7 } },
  { stage: 'score', progress: { done: 300, total: 1250 } },
  { stage: 'score', progress: { done: 0, total: 1 } },
  { stage: 'score', progress: { done: 10, total: 10 } },
  { stage: 'score', progress: { done: 12, total: 10 } },
  { stage: 'score', progress: { done: 3, total: 9 } },
  { stage: 'score', progress: { done: 999_999, total: 1_000_000 } },
  { stage: 'scoring' },
  { stage: 'Score' },
  { stage: '' },
];

const vouchChecks = ['canary', 'unavailable'];

/**
 * Every row function's inputs over `names`, in `locales`, with both vouch
 * checks. The rows themselves are in the `rows` case, once, by name.
 */
function rowCases(names, locales) {
  return names.flatMap((name) =>
    locales.flatMap((locale) =>
      vouchChecks.map((vouchCheck) => ({
        $id: `${name}-${vouchCheck}-${locale}`,
        row: name,
        vouchCheck,
        locale,
      })),
    ),
  );
}

export default async function cases() {
  const scan = await crowdScan(postsBetween(20, 60)[0].rkey);
  const crowd = (await crowdSummary(scan)).summary;
  const table = { ...ROWS };
  crowd.rows.forEach((r, i) => {
    table[`crowd-${i}`] = r;
  });
  const numbered = [
    'test',
    'many',
    'fraction',
    'nameOnly',
    'everyKind',
    'negative',
  ];
  const rowInputs = [
    ...rowCases(Object.keys(ROWS), ['en-US']),
    ...rowCases(numbered, LOCALES.slice(1)),
    ...crowd.rows.map((_, i) => ({
      $id: `crowd-${i}`,
      row: `crowd-${i}`,
      vouchCheck: crowd.vouchCheck,
      locale: 'en-US',
    })),
  ];
  const withRow =
    (fn) =>
    ({ row: name, vouchCheck, locale }) =>
      inLocale(locale, () => fn(table[name], vouchCheck));

  return [
    value('rows', table),
    ...(await each(
      'postsToScan',
      [
        { $id: 'test-default', posts: POSTS, now: NOW },
        { $id: 'test-limit-10', posts: POSTS, now: NOW, limit: 10 },
        { $id: 'none', posts: null, now: NOW },
        { $id: 'edges', posts: [...POSTS, ...EDGE_POSTS], now: NOW, limit: 30 },
        {
          $id: 'week',
          posts: [...POSTS, ...EDGE_POSTS],
          now: NOW,
          days: 7,
          limit: 30,
        },
        {
          $id: 'half-day',
          posts: [...POSTS, ...EDGE_POSTS],
          now: NOW,
          days: 0.5,
          limit: 30,
        },
        {
          $id: 'no-days',
          posts: [...POSTS, ...EDGE_POSTS],
          now: NOW,
          days: 0,
          limit: 30,
        },
        { $id: 'limit-zero', posts: POSTS, now: NOW, limit: 0 },
        { $id: 'limit-negative', posts: POSTS, now: NOW, limit: -1 },
        ...ZONES.map((zone) => ({
          $id: `local-${zone}`,
          zone,
          posts: LOCAL_POSTS,
          now: Date.parse('2026-11-17T06:00:00Z'),
        })),
      ],
      ({ posts, now, days, limit, zone }) =>
        withZone(zone, () =>
          postsToScan(posts, {
            now,
            ...(days !== undefined ? { days } : {}),
            ...(limit !== undefined ? { limit } : {}),
          }),
        ),
    )),
    ...(await each('vouchPhrase', rowInputs, withRow(vouchPhrase))),
    ...(await each(
      'didPhrase',
      rowInputs.filter(
        (c) => c.vouchCheck === 'canary' && c.locale === 'en-US',
      ),
      withRow(didPhrase),
    )),
    ...(await each(
      'protectedPhrase',
      rowInputs.filter(
        (c) => c.vouchCheck === 'canary' && c.locale === 'en-US',
      ),
      withRow(protectedPhrase),
    )),
    ...(await each('describeRow', rowInputs, withRow(describeRow))),
    ...(await each('rowFacts', rowInputs, withRow(rowFacts))),
    ...(await each(
      'stage',
      STATES.flatMap((state) =>
        ['en-US', 'en-DE', 'en-IN', 'en-CH'].map((locale) => ({
          state,
          locale,
        })),
      ),
      ({ state, locale }) =>
        inLocale(locale, () => ({
          line: stageLine(state),
          label: stageLabel(state),
          count: stageCount(state),
          fraction: stageFraction(state),
        })),
    )),
    ...(await each(
      'inertCell',
      [
        '=HYPERLINK("x")',
        '+1',
        '-2+3',
        '@SUM(A1)',
        '\tx',
        '\rx',
        '\nx',
        ' =x',
        'Mira',
        '',
        '＝full width',
        "'quoted",
        42,
        null,
        true,
        ['=a'],
      ].map((value) => ({ value })),
      ({ value }) => inertCell(value),
    )),
    ...(await each(
      'scanCsvRows',
      // scanCsvRows reads a summary's rows and vouchCheck, and nothing
      // else: the inputs keep only those.
      [
        {
          $id: 'test',
          summary: {
            vouchCheck: 'canary',
            rows: [
              row('did:plc:x', ['like'], 'PERIPHERAL', 40, {
                handle: 'x.test',
                vouches: 2,
                followers: 9,
              }),
            ],
          },
        },
        {
          $id: 'test-unavailable',
          summary: {
            vouchCheck: 'unavailable',
            rows: [
              row('did:plc:x', ['like'], 'PERIPHERAL', 40, {
                handle: 'x.test',
                vouches: 2,
                followers: 9,
              }),
            ],
          },
        },
        { $id: 'none', summary: null },
        {
          $id: 'every-row',
          summary: { vouchCheck: 'canary', rows: Object.values(ROWS) },
        },
        {
          $id: 'every-row-unavailable',
          summary: { vouchCheck: 'unavailable', rows: Object.values(ROWS) },
        },
        { $id: 'crowd', summary: crowd },
        { $id: 'made-up', summary: madeUpSummary(40, { seed: 7 }) },
        {
          $id: 'made-up-unavailable',
          summary: madeUpSummary(25, { seed: 9, vouchCheck: 'unavailable' }),
        },
      ].map(({ summary, ...c }) => ({
        ...c,
        summary: summary && {
          vouchCheck: summary.vouchCheck,
          rows: summary.rows,
        },
      })),
      ({ summary }) => scanCsvRows(summary),
    )),
  ];
}
