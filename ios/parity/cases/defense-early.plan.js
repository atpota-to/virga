// From a scan to a plan: the rows a plan takes, each band's count, and how
// long writing them takes, in words. Swift: VirgaDefense/Plan.swift.
// plan.test.js's cases, real crowds, and the estimate's every branch in
// several locales.

import {
  APPROVABLE_BANDS,
  BATCH,
  BATCH_GAP_MS,
  DEFAULT_BANDS,
  NOTE_MAX,
  PLAN_MAX,
  bandCounts,
  cleanNote,
  estimateWords,
  estimateWrites,
  planRows,
} from '../../../src/defense/plan.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { summarise } from '../../../src/defense/score.js';
import { each, value } from './_helpers.js';
import {
  crowdScan,
  crowdSummary,
  harvestOf,
  madeUpSummary,
  participant,
  postsBetween,
  scoreOf,
} from './_defense.js';

export const sources = ['src/defense/plan.js', 'src/defense/pace.js'];

/** Runs `fn` in `locale`, and puts the default back. */
function inLocale(locale, fn) {
  try {
    if (locale) setActiveLocale(locale);
    return fn();
  } finally {
    setActiveLocale(DEFAULT_LOCALE);
  }
}

/** plan.test.js's summary, with every field a scan gives a row. */
function testSummary() {
  const rows = [
    ['did:plc:p', 'PROTECTED', 100, true],
    ['did:plc:c', 'CONNECTED', 70],
    ['did:plc:r', 'PERIPHERAL', 40],
    ['did:plc:n', 'NOTABLE', 30],
    ['did:plc:u1', 'UNKNOWN', 3],
    ['did:plc:u2', 'UNKNOWN', 2],
    // A follow made after the bands were drawn still counts.
    ['did:plc:u3', 'UNKNOWN', 1, true],
  ];
  const participants = [
    ...rows.map(([did]) => participant(did, ['reply'])),
    // Nobody scored this one: band UNKNOWN, no trust key.
    participant('did:plc:unscored', ['like']),
  ];
  const scores = new Map(
    rows.map(([did, band, trust, youFollow]) => [
      did,
      scoreOf(did, band, trust, { youFollow: Boolean(youFollow) }),
    ]),
  );
  return summarise(
    harvestOf('at://did:plc:me/app.bsky.feed.post/1', participants),
    scores,
  );
}

const TICKS = [
  ['UNKNOWN'],
  ['PROTECTED', 'CONNECTED'],
  ['UNKNOWN', 'NOTABLE', 'PERIPHERAL', 'CONNECTED'],
  ['nonsense'],
  [],
  null,
  ['unknown'],
  ['UNKNOWN', 'UNKNOWN', 'PROTECTED'],
  ['NOTABLE', 'PERIPHERAL'],
];

const LOCALES = ['en-US', 'en-GB', 'en-IN', 'en-DE', 'en-FR', 'en-CH', 'en-ZA'];

const COUNTS = [
  0,
  1,
  10,
  49,
  50,
  51,
  99,
  100,
  101,
  150,
  151,
  600,
  1000,
  1499,
  1500,
  1501,
  1667,
  2000,
  2250,
  2251,
  2500,
  5000,
  9999,
  10000,
  12345,
  0.5,
  1.9,
  50.99,
  -1,
  -0.5,
  null,
  Number.NaN,
  // far past PLAN_MAX: the arithmetic still holds
  123456,
  1e6,
  123456789.7,
  1e12,
];

export default async function cases() {
  const posts = postsBetween(20, 400);
  const crowd = (
    await crowdSummary(
      await crowdScan(posts[Math.floor(posts.length / 2)].rkey),
    )
  ).summary;
  // planRows and bandCounts read only the rows; the review lists are left
  // empty so each summary is written once per case.
  const slim = (summary) =>
    summary && { ...summary, requiresReview: [], autoEligible: [] };
  const summaries = [
    { $id: 'plan-test', summary: slim(testSummary()) },
    { $id: 'crowd', summary: slim(crowd) },
    { $id: 'made-up', summary: slim(madeUpSummary(40, { seed: 5 })) },
    { $id: 'none', summary: null },
  ];
  const listedSets = [
    [],
    ['did:plc:u1'],
    ['did:plc:u1', 'did:plc:c', 'did:plc:p', 'did:plc:unscored'],
  ];
  return [
    value('constants', {
      APPROVABLE_BANDS,
      DEFAULT_BANDS,
      PLAN_MAX,
      NOTE_MAX,
      BATCH,
      BATCH_GAP_MS,
    }),
    // Each case: one summary and list, every set of ticks.
    ...(await each(
      'planRows',
      summaries.flatMap(({ $id, summary }) =>
        listedSets
          .filter((_, l) => $id === 'plan-test' || l < 2)
          .map((listed, l) => ({
            $id: `${$id}-${l}`,
            summary,
            ticks: TICKS,
            listed,
          })),
      ),
      ({ summary, ticks, listed }) =>
        ticks.map((bands) =>
          planRows(summary, bands, { listed: new Set(listed) }),
        ),
    )),
    ...(await each(
      'bandCounts',
      summaries.map(({ $id, summary }) => ({ $id, summary, listedSets })),
      ({ summary, listedSets: sets }) =>
        sets.map((listed) => bandCounts(summary, { listed: new Set(listed) })),
    )),
    ...(await each(
      'estimateWrites',
      COUNTS.map((n) => ({ n })),
      ({ n }) => estimateWrites(n),
    )),
    ...(await each(
      'estimateWords',
      COUNTS.flatMap((n) => LOCALES.map((locale) => ({ n, locale }))),
      ({ n, locale }) => inLocale(locale, () => estimateWords(n)),
    )),
    ...(await each(
      'cleanNote',
      [
        '  pile-on \n\n from the quote  ',
        '',
        null,
        undefined,
        42,
        'x'.repeat(NOTE_MAX + 50),
        `a${'😀'.repeat(300)}`,
        '\u00a0\u2003\ufeff',
        'tabs\tand\u2028lines\u2029and\u0085next',
        'one',
        ' é  é ',
      ].map((text) => ({ text })),
      ({ text }) => cleanNote(text),
    )),
  ];
}
