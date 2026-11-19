// How close each account is to the owner: the bands, the trust key, the
// known-followers count, the canary, the scorer and the summary. Swift:
// VirgaDefense/Score.swift, Score+Scorer.swift and Score+Types.swift.
//
// The scorer's reads are scripted (_defense.js `scripted`): each case says
// what the AppView answers, which batches it leaves uncounted, and which
// asks fail, and the Swift test answers the same way. Besides score.test.js's
// cases, real crowds from the harness are scored as Mira and as Field Lab
// see them.

import { LAB, ME } from '../../../harness/world.js';
import {
  BANDS,
  DEFAULT_THRESHOLDS,
  PROFILE_BATCH,
  assignBand,
  findCanary,
  knownFollowersOf,
  summarise,
  trustScore,
  withoutSelves,
} from '../../../src/defense/score.js';
import { each, value } from './_helpers.js';
import {
  NOW,
  crowdScan,
  harvestOf,
  participant,
  postsBetween,
  scoreOf,
  scoreScripted,
  scripted,
  thrown,
} from './_defense.js';

export const sources = ['src/defense/score.js', 'src/defense/limit.js'];

const OWNER = 'did:plc:owner';
const CANARY = 'did:plc:canary';
const dids = (n, prefix = 'p') =>
  Array.from({ length: n }, (_, i) => `did:plc:${prefix}${i}`);

/** score.test.js's profile: counts, an age, and known followers when asked. */
function prof(did, { known = 0, followers = 10, viewer = {}, ...over } = {}) {
  return {
    did,
    handle: `${did.slice(8)}.test`,
    followersCount: followers,
    followsCount: 5,
    postsCount: 10,
    createdAt: '2024-01-01T00:00:00.000Z',
    viewer: {
      ...viewer,
      ...(known
        ? {
            knownFollowers: {
              count: known,
              followers: [{ did: 'did:plc:someone' }],
            },
          }
        : {}),
    },
    ...over,
  };
}

const table = (list) => Object.fromEntries(list.map((p) => [p.did, p]));

const TRUST = [
  {},
  { vouches: 500, followers: 1e7, ageDays: 9999, mutual: true },
  { ageDays: 'not a number' },
  { vouches: 1 },
  { vouches: 3, followers: 120, ageDays: 400 },
  { vouches: 12, followers: 99999, ageDays: 365 },
  { vouches: 0, followers: 0, ageDays: 0, followsYou: true },
  {
    vouches: 2,
    followers: 5000,
    ageDays: 182.5,
    mutual: true,
    followsYou: true,
  },
  { vouches: 0.5, followers: 1.5, ageDays: 1 },
  { vouches: null, followers: null, ageDays: null },
  { vouches: -0.5 },
  { vouches: -2 },
  { followers: -5 },
  { followers: -1 },
  { ageDays: -30 },
  { ageDays: '120' },
  { mutual: 1, followsYou: 0 },
  { mutual: '', followsYou: 'yes' },
  { vouches: 4, followers: 2300, ageDays: 90 },
  { vouches: 7, followers: 31, ageDays: 3000 },
];

const FEATURES = [
  { vouches: 3 },
  { vouches: 1, followers: 6000 },
  { vouches: 1 },
  { vouches: 0, followers: 20000 },
  { vouches: 0, followers: 3000, postsPerDay: 25 },
  { vouches: 0, followers: 50 },
  { vouches: 0, protectedReason: 'you follow them' },
  { vouches: 9, protectedReason: '' },
  { followsYou: true },
  { followsYou: true, followers: 50000 },
  {},
  { vouches: 2, followers: 4999 },
  { vouches: 1, followers: 5000 },
  { vouches: 0.5 },
  { vouches: 2.999 },
  { followers: 10000 },
  { followers: 9999.5 },
  { followers: 2000, postsPerDay: 20 },
  { followers: 1999, postsPerDay: 20 },
  { followers: 2000, postsPerDay: 19.99 },
  { vouches: null, followers: null, postsPerDay: null },
  { vouches: -1, followers: -1 },
  { mutual: true, youFollow: true },
];

const THRESHOLDS = [
  undefined,
  { followsYouConnects: true },
  { followsYouPeripheral: false },
  { connectedVouches: 1 },
  { connectedReach: 100, notableReach: 100 },
  { notableActivityPostsPerDay: 1, notableActivityReach: 0 },
];

const KNOWN = [
  prof('did:plc:a'),
  prof('did:plc:a', { known: 7 }),
  null,
  undefined,
  {},
  { viewer: null },
  { viewer: { knownFollowers: { followers: [{}, {}] } } },
  { viewer: { knownFollowers: { count: 0, followers: [{}, {}, {}] } } },
  { viewer: { knownFollowers: { count: 0, followers: [] } } },
  { viewer: { knownFollowers: { count: '4' } } },
  { viewer: { knownFollowers: { count: 'four', followers: [{}] } } },
  { viewer: { knownFollowers: { count: -3, followers: [{}] } } },
  { viewer: { knownFollowers: { count: 2.5 } } },
  { viewer: { knownFollowers: { count: true } } },
  { viewer: { knownFollowers: { count: [6] } } },
  { viewer: { knownFollowers: { count: null, followers: 'ab' } } },
  { viewer: { knownFollowers: {} } },
  { viewer: { knownFollowers: 5 } },
  { viewer: { knownFollowers: 0 } },
  { viewer: { knownFollowers: '' } },
  { viewer: { knownFollowers: [] } },
  'a string',
];

/** score.test.js's AppView: counts from `known`, the canary at `canaryKnown`. */
function appviewTable(list, { known = {}, canaryKnown = 4 } = {}) {
  return table(
    list.map((d) =>
      prof(d, { known: d === CANARY ? canaryKnown : known[d] || 0 }),
    ),
  );
}

/** The scorer's cases: score.test.js's, then edges of each rule. */
function scorerCases() {
  const base = { ownerDid: OWNER, now: NOW };
  const sixty = dids(60);
  return [
    {
      $id: 'counts-vouches-canary-in-every-batch',
      ...base,
      canary: CANARY,
      dids: sixty,
      profiles: appviewTable([...sixty, CANARY], {
        known: { 'did:plc:p0': 5, 'did:plc:p1': 1 },
      }),
    },
    {
      $id: 'asks-again-when-uncounted',
      ...base,
      canary: CANARY,
      dids: dids(3),
      profiles: appviewTable([...dids(3), CANARY], {
        known: { 'did:plc:p0': 5 },
      }),
      uncounted: { 'did:plc:p0': 1 },
    },
    {
      $id: 'scores-nothing-when-never-counted',
      ...base,
      canary: CANARY,
      dids: dids(3),
      profiles: appviewTable([...dids(3), CANARY], {
        known: { 'did:plc:p0': 5 },
      }),
      uncounted: { 'did:plc:p0': 99 },
    },
    {
      $id: 'counted-on-the-last-try',
      ...base,
      canary: CANARY,
      dids: dids(3),
      profiles: appviewTable([...dids(3), CANARY], {
        known: { 'did:plc:p0': 5 },
      }),
      uncounted: { 'did:plc:p0': 2 },
    },
    {
      $id: 'picks-the-canary-again',
      ...base,
      canary: CANARY,
      refind: 'did:plc:newcanary',
      recordAsks: false,
      dids: dids(2),
      profiles: table([
        ...dids(2).map((d) => prof(d, { known: d === 'did:plc:p0' ? 4 : 0 })),
        prof(CANARY),
        prof('did:plc:newcanary', { known: 2 }),
      ]),
    },
    {
      $id: 'picks-again-to-the-same-canary',
      ...base,
      canary: CANARY,
      refind: CANARY,
      dids: dids(2),
      profiles: table([...dids(2).map((d) => prof(d)), prof(CANARY)]),
    },
    {
      $id: 'pick-again-fails',
      ...base,
      canary: CANARY,
      refind: '$throws',
      dids: dids(2),
      profiles: table([...dids(2).map((d) => prof(d)), prof(CANARY)]),
    },
    {
      $id: 'pick-again-finds-none',
      ...base,
      canary: CANARY,
      refind: null,
      dids: dids(2),
      profiles: table([...dids(2).map((d) => prof(d)), prof(CANARY)]),
    },
    {
      $id: 'the-new-canary-fails-too',
      ...base,
      canary: CANARY,
      refind: 'did:plc:newcanary',
      recordAsks: false,
      dids: dids(2),
      profiles: table([
        ...dids(2).map((d) => prof(d)),
        prof(CANARY),
        prof('did:plc:newcanary'),
      ]),
    },
    {
      $id: 'canary-also-scored',
      ...base,
      canary: CANARY,
      dids: [CANARY, 'did:plc:p0'],
      profiles: appviewTable([CANARY, 'did:plc:p0'], { canaryKnown: 9 }),
    },
    {
      $id: 'without-a-canary',
      ...base,
      dids: dids(3),
      profiles: appviewTable(dids(3), { known: { 'did:plc:p1': 4 } }),
      relationships: { 'did:plc:p0': { followedBy: 'at://x' } },
    },
    {
      $id: 'without-a-canary-empty-string',
      ...base,
      canary: '',
      dids: dids(3),
      profiles: appviewTable(dids(3), { known: { 'did:plc:p1': 4 } }),
      relationships: { 'did:plc:p0': { followedBy: 'at://x' } },
    },
    {
      $id: 'protects-a-follow-whose-profile-is-missing',
      ...base,
      canary: CANARY,
      dids: dids(2),
      profiles: appviewTable(['did:plc:p1', CANARY]),
      relationships: { 'did:plc:p0': { following: 'at://x' } },
    },
    {
      $id: 'protects-owner-selves-and-the-protected-set',
      ...base,
      canary: CANARY,
      selves: ['did:plc:holder', ''],
      protectedSet: [
        ['did:plc:friend', 'on your list “Friends”'],
        ['did:plc:emptyreason', ''],
      ],
      dids: [OWNER, 'did:plc:holder', 'did:plc:friend', 'did:plc:emptyreason'],
      profiles: appviewTable([
        OWNER,
        'did:plc:holder',
        'did:plc:friend',
        'did:plc:emptyreason',
        CANARY,
      ]),
    },
    {
      $id: 'relationships-fail-with-502',
      ...base,
      canary: CANARY,
      dids: dids(2),
      profiles: appviewTable([...dids(2), CANARY]),
      relationshipErrors: { 'did:plc:p0': { status: 502, times: -1 } },
    },
    {
      $id: 'relationships-fail-once',
      ...base,
      canary: CANARY,
      dids: dids(2),
      profiles: appviewTable([...dids(2), CANARY]),
      relationshipErrors: { 'did:plc:p0': { status: 503, times: 1 } },
    },
    {
      $id: 'relationships-refused-400',
      ...base,
      canary: CANARY,
      concurrency: 1,
      dids: dids(240),
      recordAsks: false,
      profiles: appviewTable([...dids(240), CANARY]),
      relationshipErrors: { 'did:plc:p0': { status: 400, times: -1 } },
    },
    {
      $id: 'profiles-refused-403',
      ...base,
      canary: CANARY,
      dids: dids(2),
      profiles: appviewTable([...dids(2), CANARY]),
      profileErrors: { 'did:plc:p0': { status: 403, times: -1 } },
    },
    ...[408, 429, 500, 0, null].map((status) => ({
      $id: `profiles-retried-${status}`,
      ...base,
      canary: CANARY,
      dids: dids(2),
      profiles: appviewTable([...dids(2), CANARY]),
      profileErrors: { 'did:plc:p0': { status, times: 2 } },
    })),
    {
      $id: 'profiles-out-of-retries',
      ...base,
      canary: CANARY,
      dids: dids(2),
      profiles: appviewTable([...dids(2), CANARY]),
      profileErrors: { 'did:plc:p0': { status: 429, times: 3 } },
    },
    {
      $id: 'one-retry-delay',
      ...base,
      canary: CANARY,
      retryDelaysMs: [0],
      dids: dids(2),
      profiles: appviewTable([...dids(2), CANARY]),
      uncounted: { 'did:plc:p0': 1 },
    },
    {
      $id: 'no-retries',
      ...base,
      canary: CANARY,
      retryDelaysMs: [],
      dids: dids(2),
      profiles: appviewTable([...dids(2), CANARY]),
      uncounted: { 'did:plc:p0': 1 },
    },
    {
      $id: 'duplicates-and-empties',
      ...base,
      canary: CANARY,
      dids: ['did:plc:p0', '', 'did:plc:p0', 'did:plc:p1', 'did:plc:p1'],
      profiles: appviewTable(['did:plc:p0', 'did:plc:p1', CANARY]),
    },
    {
      $id: 'nobody',
      ...base,
      canary: CANARY,
      dids: [],
      profiles: {},
    },
    {
      $id: 'listed-blocking-and-blocked',
      ...base,
      canary: CANARY,
      alreadyListed: ['did:plc:p1'],
      blockers: ['did:plc:p2'],
      dids: dids(4),
      profiles: table([
        ...dids(4).map((d) =>
          prof(d, {
            viewer: d === 'did:plc:p3' ? { blockedBy: true } : {},
          }),
        ),
        prof(CANARY, { known: 3 }),
      ]),
    },
    {
      $id: 'thresholds',
      ...base,
      canary: CANARY,
      thresholds: { connectedVouches: 1, notableReach: 5 },
      dids: dids(3),
      profiles: appviewTable([...dids(3), CANARY], {
        known: { 'did:plc:p0': 1 },
      }),
    },
    {
      $id: 'ages-and-activity',
      ...base,
      canary: CANARY,
      dids: dids(9),
      profiles: table([
        prof('did:plc:p0', { createdAt: '2026-11-12T00:00:00.000Z' }),
        prof('did:plc:p1', {
          createdAt: '2026-11-10T12:00:00.000Z',
          postsCount: 300,
          followers: 2500,
        }),
        prof('did:plc:p2', { createdAt: '2027-01-01T00:00:00.000Z' }),
        prof('did:plc:p3', { createdAt: 'not a date' }),
        prof('did:plc:p4', { createdAt: '2026-11-01T00:00:00', postsCount: 0 }),
        prof('did:plc:p5', { createdAt: null, postsCount: 9 }),
        prof('did:plc:p6', {
          createdAt: 'Tue, 01 Sep 2026 10:00:00 GMT',
          postsCount: 1000,
          followers: 3000,
        }),
        prof('did:plc:p7', {
          createdAt: '2026-11-11T00:00:00.000Z',
          postsCount: 50,
        }),
        prof('did:plc:p8', {
          createdAt: '2020-02-29T00:00:00.000Z',
          postsCount: 7,
          followers: 1e6,
        }),
        prof(CANARY, { known: 2 }),
      ]),
    },
    {
      $id: 'loosely-typed-profiles',
      ...base,
      canary: CANARY,
      dids: dids(4),
      profiles: table([
        {
          did: 'did:plc:p0',
          handle: 'p0.test',
          viewer: {
            following: '',
            followedBy: 'at://y',
            knownFollowers: { count: '3' },
          },
        },
        {
          did: 'did:plc:p1',
          handle: 'p1.test',
          followersCount: null,
          viewer: { knownFollowers: { followers: [{}, {}, {}] } },
        },
        {
          did: 'did:plc:p2',
          handle: 'p2.test',
          displayName: 'Two',
          avatar: 'https://cdn.example/a.jpg',
          followersCount: 12000,
        },
        {
          did: 'did:plc:p3',
          handle: 'p3.test',
          viewer: { blockedBy: false, following: 'at://f' },
        },
        prof(CANARY, { known: 1 }),
      ]),
      relationships: {
        'did:plc:p1': { following: 'at://z', followedBy: 'at://w' },
      },
    },
  ];
}

/** findCanary's cases: score.test.js's, then edges. */
function canaryCases() {
  const known = (map) => (list) =>
    table(list.map((d) => prof(d, { known: map[d] || 0 })));
  const ten = dids(10, 'f');
  return [
    {
      $id: 'most-known-followers',
      candidates: ten,
      profiles: known({ 'did:plc:f3': 2, 'did:plc:f7': 6 })(ten),
    },
    {
      $id: 'gives-up-after-a-few-batches',
      candidates: dids(500, 'f'),
      maxBatches: 3,
      // Only the first three batches are ever asked for.
      profiles: known({})(dids(75, 'f')),
    },
    {
      $id: 'never-the-owner',
      candidates: [OWNER, 'did:plc:f1'],
      profiles: known({ [OWNER]: 3, 'did:plc:f1': 3 })([OWNER, 'did:plc:f1']),
    },
    {
      $id: 'second-batch',
      candidates: dids(60, 'f'),
      profiles: known({ 'did:plc:f30': 1, 'did:plc:f55': 9 })(dids(60, 'f')),
    },
    {
      $id: 'ties-keep-the-first',
      candidates: ten,
      profiles: known({ 'did:plc:f2': 4, 'did:plc:f5': 4 })(ten),
    },
    {
      $id: 'duplicates-and-empties',
      candidates: ['did:plc:f1', '', 'did:plc:f1', OWNER, 'did:plc:f2'],
      profiles: known({ 'did:plc:f2': 1 })(['did:plc:f1', 'did:plc:f2']),
    },
    { $id: 'no-candidates', candidates: [], profiles: {} },
    { $id: 'null-candidates', candidates: null, profiles: {} },
    {
      $id: 'uncounted-first-batch',
      candidates: dids(30, 'f'),
      profiles: known({ 'did:plc:f1': 5, 'did:plc:f27': 2 })(dids(30, 'f')),
      uncounted: { 'did:plc:f0': 1 },
    },
    {
      $id: 'read-fails',
      candidates: ten,
      profiles: known({ 'did:plc:f3': 2 })(ten),
      profileErrors: { 'did:plc:f0': { status: 500, times: -1 } },
    },
    {
      $id: 'read-retried',
      candidates: ten,
      profiles: known({ 'did:plc:f3': 2 })(ten),
      profileErrors: { 'did:plc:f0': { status: null, times: 2 } },
    },
    {
      $id: 'read-refused',
      candidates: ten,
      profiles: known({ 'did:plc:f3': 2 })(ten),
      profileErrors: { 'did:plc:f0': { status: 401, times: 1 } },
    },
    {
      $id: 'zero-batches',
      candidates: ten,
      maxBatches: 0,
      profiles: known({ 'did:plc:f3': 2 })(ten),
    },
    {
      $id: 'negative-batches',
      candidates: dids(60, 'f'),
      maxBatches: -1,
      profiles: known({ 'did:plc:f55': 2, 'did:plc:f3': 1 })(dids(60, 'f')),
    },
    {
      $id: 'counted-by-followers-only',
      candidates: ['did:plc:f1', 'did:plc:f2'],
      profiles: table([
        prof('did:plc:f1', {
          viewer: { knownFollowers: { followers: [{}, {}] } },
        }),
        prof('did:plc:f2', { known: 1 }),
      ]),
    },
    {
      $id: 'profiles-without-a-did',
      candidates: ['did:plc:f1', 'did:plc:f2'],
      profiles: {
        'did:plc:f1': { handle: 'x', viewer: { knownFollowers: { count: 9 } } },
        'did:plc:f2': prof('did:plc:f2', { known: 1 }),
      },
    },
  ];
}

async function canaryOf(spec) {
  const fake = scripted(spec);
  try {
    const did = await findCanary({
      ownerDid: spec.ownerDid,
      candidates: spec.candidates,
      getProfiles: fake.getProfiles,
      maxBatches: spec.maxBatches,
      retryDelaysMs: [0, 0],
    });
    return { did, asked: fake.asked };
  } catch (err) {
    return { ...thrown(err), asked: fake.asked };
  }
}

/** Real crowds, scored as Mira and as Field Lab see them. */
async function crowdCases() {
  const posts = postsBetween(20, 400);
  const mid = posts[Math.floor(posts.length / 2)].rkey;
  const picks = [
    [posts[0].rkey, ME.did],
    [mid, ME.did],
    [mid, LAB.did],
  ];
  const out = [];
  for (const [rkey, viewer] of picks) {
    const scan = await crowdScan(rkey, viewer);
    out.push({
      $id: `crowd-${rkey}-as-${viewer === ME.did ? 'mira' : 'lab'}`,
      ownerDid: scan.ownerDid,
      canary: scan.canary,
      selves: [scan.ownerDid, ME.did],
      dids: scan.dids,
      profiles: scan.profiles,
      relationships: scan.relationships,
      now: NOW,
      // Batches run side by side; which asks a crowd makes is held by the
      // made-up cases above.
      recordAsks: false,
      people: scan.people,
    });
  }
  return out;
}

export default async function cases() {
  const crowds = await crowdCases();
  const harvests = [
    harvestOf('at://did:plc:a/app.bsky.feed.post/1', [
      participant('did:plc:a', ['reply']),
      participant('did:plc:b', ['like']),
      participant(OWNER, ['reply', 'reply']),
    ]),
    harvestOf(
      'at://did:plc:a/app.bsky.feed.post/2',
      [
        participant('did:plc:x', ['quote', 'like', 'other']),
        participant('did:plc:y', ['threadReply']),
        participant('did:plc:author', ['reply']),
        participant('did:plc:z', ['repost', 'repost']),
      ],
      { truncated: true, unread: [{ kind: 'like', count: 40 }] },
    ),
    harvestOf('at://did:plc:a/app.bsky.feed.post/3', []),
    crowds[0].people,
  ];

  // Scores for the made-up harvests: score.test.js's, with every field.
  const madeUpScores = [
    {
      'did:plc:a': scoreOf('did:plc:a', 'PERIPHERAL', 40, { followers: 100 }),
      'did:plc:b': scoreOf('did:plc:b', 'UNKNOWN', 5),
    },
    {
      'did:plc:x': scoreOf('did:plc:x', 'CONNECTED', 70, {
        followers: 6000,
        alreadyListed: true,
      }),
      'did:plc:y': scoreOf('did:plc:y', 'NOTABLE', 30, {
        followers: 20000,
        blocksYou: true,
      }),
      'did:plc:z': scoreOf('did:plc:z', 'CONNECTED', 70, { followers: 10 }),
    },
    {},
  ];
  const summaryInputs = [
    {
      $id: 'score-test',
      harvest: withoutSelves(harvests[0], [OWNER]),
      scores: madeUpScores[0],
      vouchCheck: 'canary',
    },
    {
      $id: 'ties-and-unscored',
      harvest: withoutSelves(harvests[1], ['did:plc:author']),
      scores: madeUpScores[1],
      vouchCheck: 'canary',
    },
    {
      $id: 'unavailable',
      harvest: harvests[1],
      scores: madeUpScores[1],
      vouchCheck: 'unavailable',
    },
    {
      $id: 'default-vouch-check',
      harvest: harvests[0],
      scores: madeUpScores[0],
    },
    { $id: 'empty', harvest: harvests[2], scores: {}, vouchCheck: 'canary' },
  ];
  // A real crowd, summarised from its real scores.
  for (const crowd of crowds.slice(0, 1)) {
    const scored = await scoreScripted({ ...crowd, recordAsks: false });
    summaryInputs.push({
      $id: `${crowd.$id}-summary`,
      harvest: crowd.people,
      scores: Object.fromEntries(scored.scores),
      vouchCheck: scored.vouchCheck,
    });
  }

  return [
    value('constants', { BANDS, DEFAULT_THRESHOLDS, PROFILE_BATCH }),
    ...(await each(
      'trustScore',
      TRUST.map((f) => ({ f })),
      ({ f }) => trustScore(f),
    )),
    ...(await each(
      'assignBand',
      FEATURES.flatMap((f) =>
        THRESHOLDS.map((thresholds) => ({ f, thresholds })),
      ),
      ({ f, thresholds }) =>
        thresholds ? assignBand(f, thresholds) : assignBand(f),
    )),
    ...(await each(
      'knownFollowersOf',
      KNOWN.map((profile) => ({ profile })),
      ({ profile }) => knownFollowersOf(profile),
    )),
    ...(await each(
      'findCanary',
      canaryCases().map((c) => ({ ownerDid: OWNER, ...c })),
      canaryOf,
    )),
    ...(await each(
      'score',
      [
        ...scorerCases(),
        ...crowds.map((c) => {
          const spec = { ...c };
          delete spec.people;
          return spec;
        }),
      ],
      scoreScripted,
    )),
    ...(await each(
      'withoutSelves',
      harvests
        .flatMap((harvest, i) => [
          {
            $id: `harvest-${i}-owner`,
            harvest,
            dids: [OWNER, ME.did, LAB.did],
          },
          {
            $id: `harvest-${i}-several`,
            harvest,
            dids: ['did:plc:a', 'did:plc:x', null, '', 'did:plc:missing'],
          },
          { $id: `harvest-${i}-none`, harvest, dids: [] },
        ])
        .filter((c, i) => i < 9 || c.$id.endsWith('-owner')),
      ({ harvest, dids: skip }) => withoutSelves(harvest, skip),
    )),
    ...(await each(
      'summarise',
      summaryInputs,
      ({ harvest, scores, vouchCheck }) =>
        summarise(
          harvest,
          new Map(Object.entries(scores)),
          vouchCheck ? { vouchCheck } : undefined,
        ),
    )),
  ];
}
