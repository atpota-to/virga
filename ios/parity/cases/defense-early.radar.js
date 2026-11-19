// The radar's layout: rings, slices, where each account goes, the strangers'
// texture, and a scan as the radar draws it. Swift: VirgaDefense/Radar.swift.
// Real crowds from the harness, made-up crowds of many sizes and mixes
// (seeded), and radar.test.js's cases.

import {
  EDGES,
  RINGS,
  SCAN_SECTORS,
  nearest,
  place,
  radarTable,
  ringAt,
  ringOf,
  scanRadar,
  sectorAngles,
  sectorAt,
  sectorKey,
  spots,
  texture,
  walkOrder,
} from '../../../src/defense/radar.js';
import { each, value } from './_helpers.js';
import {
  crowdScan,
  crowdSummary,
  harvestOf,
  madeUpSummary,
  participant,
  postsBetween,
  scoreOf,
  seeded,
} from './_defense.js';
import { summarise } from '../../../src/defense/score.js';

export const sources = ['src/defense/radar.js'];

const BANDS = ['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN'];

/** radar.test.js's summary: a row in each slice and band. */
function testSummary(extra = []) {
  const rows = [
    ['did:plc:q1', 'UNKNOWN', 'quote'],
    ['did:plc:q2', 'CONNECTED', 'quote'],
    ['did:plc:r1', 'UNKNOWN', 'threadReply'],
    ['did:plc:r2', 'PROTECTED', 'reply'],
    ['did:plc:l1', 'UNKNOWN', 'like'],
    ['did:plc:l2', 'NOTABLE', 'like'],
    ['did:plc:p1', 'PERIPHERAL', 'repost'],
    ...extra,
  ];
  const participants = rows.map(([did, , kind]) => participant(did, [kind]));
  const scores = new Map(
    rows.map(([did, band], i) => [
      did,
      scoreOf(did, band, band === 'PROTECTED' ? 100 : 10 + i),
    ]),
  );
  return summarise(
    harvestOf('at://did:plc:me/app.bsky.feed.post/1', participants),
    scores,
  );
}

/** Points to place: `n` of them, bands and sectors drawn from a seed. */
function points(n, sectors, seed) {
  const rand = seeded(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `did:plc:pt${seed}x${i}`,
    band: BANDS[Math.floor(rand() * BANDS.length)],
    sector: Math.floor(rand() * Math.max(1, sectors)),
  }));
}

const SPOT_TEXTS = [
  '',
  'did:plc:a',
  'did:plc:b',
  'far:0:0',
  'far:3:699',
  'did:plc:virgaharnesscrowd00007',
  '😀',
  'é',
  'é',
  'K',
  'a'.repeat(500),
  'did:web:example.com',
];

const ANGLES = [
  -Math.PI / 2,
  -Math.PI / 2 + 0.01,
  0,
  Math.PI / 2 - 0.01,
  Math.PI / 2,
  Math.PI - 0.01,
  Math.PI,
  (3 * Math.PI) / 2 - 1e-9,
  (3 * Math.PI) / 2,
  2 * Math.PI,
  -Math.PI,
  -3 * Math.PI,
  10 * Math.PI + 0.3,
  -0.000001,
  1e6,
];

/** A summary as the radar reads it: its rows (the review lists left empty). */
const slim = (summary) => ({
  ...summary,
  requiresReview: [],
  autoEligible: [],
});

export default async function cases() {
  // Real crowds, scored for real: a small post and a mid-sized one.
  const posts = postsBetween(20, 400);
  const crowds = [];
  for (const rkey of [
    posts[0].rkey,
    posts[Math.floor(posts.length / 2)].rkey,
  ]) {
    crowds.push((await crowdSummary(await crowdScan(rkey))).summary);
  }
  const summaries = [
    { $id: 'radar-test', summary: testSummary() },
    {
      $id: 'radar-test-with-other',
      summary: testSummary([['did:plc:o', 'UNKNOWN', 'other']]),
    },
    {
      $id: 'other-and-gate',
      summary: testSummary([
        ['did:plc:o1', 'NOTABLE', 'other'],
        ['did:plc:g1', 'CONNECTED', 'gate'],
      ]),
    },
    { $id: 'empty', summary: madeUpSummary(0, { seed: 2 }) },
    { $id: 'one', summary: madeUpSummary(1, { seed: 3 }) },
    { $id: 'crowd-small', summary: crowds[0] },
    { $id: 'crowd-mid', summary: crowds[1] },
    ...[5, 12, 40].map((n, i) => ({
      $id: `made-up-${n}`,
      summary: madeUpSummary(n, { seed: 10 + i }),
    })),
    {
      $id: 'all-strangers',
      summary: madeUpSummary(60, { seed: 20, mix: { UNKNOWN: 1 } }),
    },
    {
      $id: 'nobody-strange',
      summary: madeUpSummary(30, {
        seed: 21,
        mix: { PROTECTED: 1, CONNECTED: 1, PERIPHERAL: 1, NOTABLE: 1 },
      }),
    },
    {
      $id: 'likes-only',
      summary: madeUpSummary(25, { seed: 22, kinds: ['like'] }),
    },
    {
      $id: 'replies-and-other-apps',
      summary: madeUpSummary(25, {
        seed: 23,
        kinds: ['threadReply', 'other', 'gate'],
      }),
    },
    {
      $id: 'unchecked-vouches',
      summary: madeUpSummary(20, { seed: 24, vouchCheck: 'unavailable' }),
    },
  ];

  const placements = [
    {
      $id: 'radar-test',
      points: points(5, 4, 1).map((p, i) => ({ ...p, sector: i % 4 })),
      sectorCount: 4,
    },
    ...[
      [1, 1],
      [8, 2],
      [12, 3],
      [40, 4],
      [80, 5],
      [100, 6],
      [15, 7],
    ].map(([n, sectors], i) => ({
      $id: `seeded-${n}-in-${sectors}`,
      points: points(n, sectors, 30 + i),
      sectorCount: sectors,
    })),
    { $id: 'no-sectors', points: points(6, 1, 40), sectorCount: 0 },
    {
      $id: 'sector-out-of-range',
      points: [
        { id: 'did:plc:hi', band: 'CONNECTED', sector: 9 },
        { id: 'did:plc:lo', band: 'PERIPHERAL', sector: -2 },
        { id: 'did:plc:zero', band: 'NOTABLE', sector: 0 },
      ],
      sectorCount: 4,
    },
    { $id: 'none', points: [], sectorCount: 4 },
    {
      $id: 'same-spot',
      points: [
        { id: 'did:plc:same', band: 'CONNECTED', sector: 1 },
        { id: 'did:plc:same', band: 'CONNECTED', sector: 1 },
      ],
      sectorCount: 3,
    },
  ];

  const textures = [
    { $id: 'radar-test', counts: [5000, 0, 1, 300], max: 200 },
    { $id: 'nothing', counts: [0, 0] },
    { $id: 'empty', counts: [] },
    { $id: 'under-the-cap', counts: [3, 1, 0, 2] },
    { $id: 'at-the-cap', counts: [35, 35], max: 70 },
    { $id: 'default-cap', counts: [900, 20, 1, 0, 60] },
    { $id: 'under-the-default-cap', counts: [40, 2, 0, 9] },
    { $id: 'one-sector', counts: [42], max: 10 },
    { $id: 'rounding-halves', counts: [1, 3, 5, 7], max: 8 },
    { $id: 'zero-cap', counts: [10, 0, 5], max: 0 },
    { $id: 'tiny-cap', counts: [1000, 1000, 1000, 1000], max: 3 },
    { $id: 'a-negative-count', counts: [-5, 10, 0] },
    { $id: 'counts-cancelling-out', counts: [-5, 5] },
    { $id: 'just-over-the-cap-in-one', counts: [71], max: 70 },
  ];

  const placedForQueries = [
    place(points(40, 5, 50), 5),
    place(testSummaryPoints(), 4),
    tiedMarks(),
  ];

  return [
    value('constants', { RINGS, EDGES, SCAN_SECTORS }),
    ...(await each(
      'ringOf',
      [...BANDS, 'OUTER', 'protected', '', null].map((band) => ({ band })),
      ({ band }) => ringOf(band),
    )),
    ...(await each(
      'ringAt',
      [
        0, 0.04, 0.1, 0.17, 0.1700001, 0.2, 0.34, 0.45, 0.535, 0.5350001, 0.9,
        1, 1.0000001, 1.01, -1, 5,
      ].map((r) => ({ r })),
      ({ r }) => ringAt(r),
    )),
    ...(await each(
      'spots',
      SPOT_TEXTS.map((text) => ({ text })),
      ({ text }) => spots(text),
    )),
    ...(await each(
      'sectorAngles',
      [0, 1, 2, 3, 4, 5, 7, -3].map((n) => ({ n })),
      ({ n }) => sectorAngles(n),
    )),
    ...(await each(
      'sectorAt',
      ANGLES.flatMap((angle) => [1, 2, 4, 5, 0, -3].map((n) => ({ angle, n }))),
      ({ angle, n }) => sectorAt(angle, n),
    )),
    ...(await each('place', placements, ({ points: pts, sectorCount }) =>
      place(pts, sectorCount),
    )),
    ...(await each('texture', textures, ({ counts, max }) =>
      max === undefined ? texture(counts) : texture(counts, { max }),
    )),
    // Each case: one set of placed marks and many points to look near; the
    // answer is the index of the mark found, or -1.
    ...(await each(
      'nearest',
      placedForQueries.map((placed, k) => {
        const rand = seeded(60 + k);
        const queries = [
          // Two marks the same distance away: the later is found.
          { x: 0, y: 0, within: 0.25 },
          { x: 0, y: 0.5, within: 0.1 },
          { x: 0, y: 0, within: 0.2499 },
          { x: placed[0].x, y: placed[0].y, within: 0.01 },
          { x: 5, y: 5, within: 0.01 },
          { x: 0, y: 0, within: 2 },
          { x: 0, y: 0, within: 0 },
          ...Array.from({ length: 30 }, () => ({
            x: rand() * 2 - 1,
            y: rand() * 2 - 1,
            within: rand() * 0.3,
          })),
        ];
        return { placed, queries };
      }),
      ({ placed, queries }) =>
        queries.map(({ x, y, within }) =>
          placed.indexOf(nearest(placed, x, y, within)),
        ),
    )),
    ...(await each(
      'walkOrder',
      [...placedForQueries, place(points(60, 4, 70), 4), []].map((placed) => ({
        placed,
      })),
      ({ placed }) => walkOrder(placed).map((p) => placed.indexOf(p)),
    )),
    ...(await each(
      'sectorKey',
      [
        'quote',
        'reply',
        'threadReply',
        'repost',
        'like',
        'gate',
        'other',
        '',
        null,
        'Quote',
        'likes',
      ].map((kind) => ({
        kind,
      })),
      ({ kind }) => sectorKey(kind),
    )),
    // The radar and its table of each summary. A mark's row is the row it
    // came from, so it is written as that row's DID.
    ...(await each(
      'scanRadar',
      summaries.map(({ $id, summary }) => ({ $id, summary: slim(summary) })),
      ({ summary }) => {
        const radar = scanRadar(summary);
        return {
          radar: {
            ...radar,
            points: radar.points.map((p) => ({ ...p, row: p.row.did })),
          },
          table: radarTable(summary),
        };
      },
    )),
  ];
}

/**
 * Marks placed by hand, for ties: two the same distance from the centre,
 * two on the same spot, and several on the same ring at the same turn
 * (straight up, written three ways), which the walk keeps in order.
 */
function tiedMarks() {
  const mark = (id, band, ring, angle, r) => ({
    id,
    band,
    sector: 0,
    ring,
    x: r * Math.cos(angle),
    y: r * Math.sin(angle),
    r,
    angle,
  });
  return [
    { ...mark('did:plc:t0', 'CONNECTED', 'CONNECTED', 0, 0.25), x: 0.25, y: 0 },
    {
      ...mark('did:plc:t1', 'CONNECTED', 'CONNECTED', Math.PI, 0.25),
      x: -0.25,
      y: 0,
    },
    { ...mark('did:plc:t2', 'PERIPHERAL', 'PERIPHERAL', 0, 0.5), x: 0, y: 0.5 },
    { ...mark('did:plc:t3', 'PERIPHERAL', 'PERIPHERAL', 0, 0.5), x: 0, y: 0.5 },
    mark('did:plc:t4', 'UNKNOWN', 'OUTER', -Math.PI / 2, 0.8),
    mark('did:plc:t5', 'NOTABLE', 'OUTER', (3 * Math.PI) / 2, 0.8),
    mark('did:plc:t6', 'UNKNOWN', 'OUTER', (-5 * Math.PI) / 2, 0.8),
    mark('did:plc:t7', 'PROTECTED', 'PROTECTED', 1, 0.1),
    mark('did:plc:t8', 'PROTECTED', 'PROTECTED', 1, 0.1),
  ];
}

/** radar.test.js's points, a band in each ring. */
function testSummaryPoints() {
  return [
    { id: 'did:plc:a', band: 'PROTECTED', sector: 0 },
    { id: 'did:plc:b', band: 'CONNECTED', sector: 1 },
    { id: 'did:plc:c', band: 'PERIPHERAL', sector: 2 },
    { id: 'did:plc:d', band: 'NOTABLE', sector: 3 },
    { id: 'did:plc:e', band: 'UNKNOWN', sector: 0 },
  ];
}
