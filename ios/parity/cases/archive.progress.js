// The sync bar's arithmetic (syncProgress.js), the follower log
// (followerLog.js) and what a post made or deleted does to the archive
// (postChanges.js). Swift: VirgaArchive/Lib/SyncProgress.swift,
// Lib/FollowerLog.swift, Archive/PostChanges.swift.

import {
  BLOCK_STAGES,
  REPO_READ_STAGES,
  REPO_SPANS,
  SYNC_PLAN,
  SYNC_STEPS,
  blocksFraction,
  countAtOrAfter,
  partsFraction,
  repoDownloadFraction,
  repoReadFraction,
  repoSaveFraction,
  share,
  timeFraction,
  walkFraction,
} from '../../../src/lib/syncProgress.js';
import {
  FOLLOWER_LOG_LIMIT,
  followerChanges,
  mergeFollowerLog,
} from '../../../src/lib/followerLog.js';
import {
  applyPostChanges,
  isOwnPostUri,
  postRowsFor,
} from '../../../src/archive/postChanges.js';
import { each, value } from './_helpers.js';
import { eachN } from './_archive.js';

export const sources = [
  'src/lib/syncProgress.js',
  'src/lib/followerLog.js',
  'src/archive/postChanges.js',
];

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-01T12:00:00Z');

export default async function cases() {
  const out = [];
  out.push(
    value('constants', {
      SYNC_STEPS,
      SYNC_PLAN,
      BLOCK_STAGES,
      REPO_SPANS,
      REPO_READ_STAGES,
      FOLLOWER_LOG_LIMIT,
    }),
  );

  out.push(
    ...(await eachN(
      'share',
      [
        [50, 200],
        [200, 200],
        [260, 200],
        [10, null],
        [10, 0],
        [null, 10],
        [10, -5],
        [-10, 5],
        ['$NaN', 5],
        [5, '$Infinity'],
        ['5', 10],
        [0, 1],
        [1, 3],
      ].map(([done, total]) => ({ done, total })),
      ({ done, total }) => share(done, total),
    )),
  );

  const blockReports = [
    { stage: 'direct', done: 0 },
    { stage: 'direct', done: 3000 },
    { stage: 'direct', done: 6000 },
    { stage: 'direct', done: 9000 },
    { stage: 'lists', done: 400 },
    { stage: 'check', done: 0, total: 600 },
    { stage: 'check', done: 300, total: 600 },
    { stage: 'check', done: 600, total: 600 },
    { stage: 'check', done: 0, total: 0 },
    { stage: 'check', done: 3 },
    { stage: 'subscribers', done: 0, total: 280 },
    { stage: 'subscribers', done: 140, total: 280 },
    { stage: 'subscribers', done: 280, total: 280 },
    { stage: 'subscribers', done: 0, total: 0 },
    { stage: 'other', done: 1, total: 2 },
    {},
  ];
  out.push(
    ...(await eachN(
      'blocksFraction',
      blockReports
        .flatMap((p) =>
          [6000, null, 0].map((directEstimate) => ({ p, directEstimate })),
        )
        .concat([{ p: null }]),
      ({ p, directEstimate }) =>
        blocksFraction(
          p,
          directEstimate === undefined ? undefined : { directEstimate },
        ),
    )),
  );

  out.push(
    ...(await eachN(
      'repoDownloadFraction',
      [
        [33, 66],
        [66, 66],
        [5, null],
        [0, 1000],
        [2000, 1000],
      ].map(([bytes, total]) => ({ bytes, total })),
      ({ bytes, total }) => repoDownloadFraction(bytes, total),
    )),
  );

  out.push(
    ...(await eachN(
      'repoReadFraction',
      [
        { p: { stage: 'index', done: 0, total: 100 } },
        { p: { stage: 'index', done: 50, total: 100 } },
        { p: { stage: 'walk', done: 50 }, expectedRecords: 100 },
        { p: { stage: 'walk', done: 50 } },
        { p: { stage: 'walk', done: 500 }, expectedRecords: 100 },
        { p: { stage: 'decode', done: 100, total: 100 } },
        { p: { stage: 'decode', done: 10, total: 0 } },
        { p: { stage: 'other', done: 1, total: 2 } },
        { p: null },
      ],
      ({ p, expectedRecords }) =>
        repoReadFraction(
          p,
          expectedRecords === undefined ? undefined : { expectedRecords },
        ),
    )),
  );

  out.push(
    ...(await eachN(
      'repoSaveFraction',
      [
        [0, 1000],
        [500, 1000],
        [1000, 1000],
        [0, 0],
        [5, 0],
      ].map(([written, total]) => ({ written, total })),
      ({ written, total }) => repoSaveFraction(written, total),
    )),
  );

  const times = [
    ...Array.from({ length: 10 }, (_, i) => NOW - (20 + i * 8) * DAY),
    ...Array.from({ length: 90 }, (_, i) => NOW - (i / 9) * DAY),
  ].sort((a, b) => a - b);
  out.push(
    ...(await eachN(
      'countAtOrAfter',
      [
        { times, ms: NOW - 10 * DAY },
        { times, ms: '$-Infinity' },
        { times, ms: '$Infinity' },
        { times, ms: times[17] },
        { times: [], ms: 0 },
        { times: [1, 1, 1, 2], ms: 1 },
      ],
      ({ times: t, ms }) => countAtOrAfter(t, ms),
    )),
  );

  out.push(
    ...(await eachN(
      'walkFraction',
      [
        { times, reached: NOW - 10 * DAY, target: times[0] },
        { times, reached: null, target: times[0] },
        { times: [], reached: NOW, target: NOW - DAY },
        { times, reached: NOW + DAY, target: times[0] },
        { times, reached: times[0], target: times[0] },
        { times, reached: NOW - 2 * DAY, target: NOW - 5 * DAY },
      ],
      ({ times: t, reached, target }) => walkFraction(t, reached, target),
    )),
  );

  out.push(
    ...(await eachN(
      'timeFraction',
      [
        [NOW, NOW - 30 * DAY, NOW - 120 * DAY],
        [NOW, null, NOW - DAY],
        [NOW, NOW - DAY, NOW],
        [NOW, NOW - DAY, NOW + DAY],
        [NOW, NOW - 200 * DAY, NOW - 120 * DAY],
        [null, NOW, NOW - DAY],
        ['$NaN', NOW, NOW - DAY],
        [NOW, NOW, '$-Infinity'],
      ].map(([start, reached, target]) => ({ start, reached, target })),
      ({ start, reached, target }) => timeFraction(start, reached, target),
    )),
  );

  out.push(
    ...(await eachN(
      'partsFraction',
      [
        [0, 2, 0.5],
        [1, 2, 0.5],
        [1, 2, null],
        [1, 2, 1],
        [0, 0, 0.5],
        [null, 2, 0.5],
        [2, 2, 0],
        [0, 2, '$NaN'],
      ].map(([part, parts, inner]) => ({ part, parts, inner })),
      ({ part, parts, inner }) => partsFraction(part, parts, inner),
    )),
  );

  // The follower log.
  const f = (did, over = {}) => ({
    did,
    handle: `${did.slice(8)}.test`,
    displayName: did.slice(8),
    avatar: '',
    followedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
  out.push(
    ...(await eachN(
      'followerChanges',
      [
        {
          $id: 'both-ways',
          before: [f('did:plc:ana'), f('did:plc:bo'), f('did:plc:cy')],
          after: [
            f('did:plc:bo'),
            f('did:plc:dee', { handle: '', avatar: null, followedAt: null }),
            f('did:plc:ana'),
          ],
          at: 2000,
          since: 1000,
        },
        { $id: 'no-since', before: [f('did:plc:ana')], after: [], at: 2000 },
        { $id: 'none', before: null, after: null, at: 5 },
        { $id: 'no-at', before: [], after: [f('did:plc:ana')] },
        {
          $id: 'unchanged',
          before: [f('did:plc:ana')],
          after: [f('did:plc:ana', { handle: 'renamed.test' })],
          at: 3,
        },
        {
          $id: 'didless',
          before: [{ handle: 'x' }, f('did:plc:ana')],
          after: [{ handle: 'y' }],
          at: 3,
        },
        {
          $id: 'code-units',
          before: [f('did:plc:é')],
          after: [f('did:plc:é')],
          at: 3,
        },
      ],
      ({ before, after, at, since }) =>
        followerChanges(
          before,
          after,
          since === undefined ? { at } : { at, since },
        ),
    )),
  );

  out.push(
    ...(await eachN(
      'mergeFollowerLog',
      [
        {
          $id: 'first',
          held: null,
          changes: [{ did: 'did:plc:a', kind: 'gained', at: 5, since: null }],
          at: 5,
        },
        {
          $id: 'second',
          held: {
            entries: [{ did: 'did:plc:a', kind: 'gained', at: 5, since: null }],
            lastSyncAt: 5,
            firstSyncAt: 5,
          },
          changes: [{ did: 'did:plc:b', kind: 'lost', at: 9, since: 5 }],
          at: 9,
        },
        {
          $id: 'nothing-new',
          held: { entries: [], lastSyncAt: 5, firstSyncAt: 3 },
          changes: [],
          at: 12,
        },
        { $id: 'empty-held', held: {}, changes: null, at: 12 },
        {
          $id: 'zero-first',
          held: { entries: [], firstSyncAt: 0 },
          changes: [],
          at: 12,
        },
      ],
      ({ held, changes, at }) => mergeFollowerLog(held, changes, at),
    )),
  );
  out.push(
    ...(await eachN(
      'mergeFollowerLog',
      [
        {
          $id: 'over-the-limit',
          heldCount: FOLLOWER_LOG_LIMIT - 1,
          changes: [
            { did: 'did:plc:x', kind: 'gained', at: 2, since: 1 },
            { did: 'did:plc:y', kind: 'gained', at: 2, since: 1 },
          ],
          at: 2,
        },
      ],
      ({ heldCount, changes, at }) => {
        // The held log is made here, not stored: `heldCount` entries, as the Swift test makes them.
        const many = Array.from({ length: heldCount }, (_, i) => ({
          did: `did:plc:${i}`,
          kind: 'lost',
          at: 1,
          since: null,
        }));
        const log = mergeFollowerLog(
          { entries: many, lastSyncAt: 1, firstSyncAt: 1 },
          changes,
          at,
        );
        return {
          count: log.entries.length,
          first: log.entries.slice(0, 3),
          last: log.entries.at(-1),
          lastSyncAt: log.lastSyncAt,
          firstSyncAt: log.firstSyncAt,
        };
      },
    )),
  );

  // What a post made or deleted does to the archive.
  const DID = 'did:plc:owner';
  const uri = (rkey, did = DID, collection = 'app.bsky.feed.post') =>
    `at://${did}/${collection}/${rkey}`;
  const record = (text, extra = {}) => ({
    $type: 'app.bsky.feed.post',
    text,
    createdAt: '2026-11-12T10:00:00.000Z',
    ...extra,
  });
  out.push(
    ...(await eachN(
      'isOwnPostUri',
      [
        [DID, uri('3k')],
        [DID, uri('3k', 'did:plc:other')],
        [DID, uri('3k', DID, 'app.bsky.feed.like')],
        [DID, 'https://bsky.app/profile/x/post/3k'],
        [null, uri('3k')],
        ['', uri('3k')],
        [DID, `${uri('3k')}/extra`],
        [DID, `at://${DID}/app.bsky.feed.post/`],
        [DID, `at://${DID}//3k`],
        [DID, `${uri('3k')}?x`],
        [DID, `${uri('3k')}\n`],
        [DID, null],
        [DID, 5],
        ['did:plc:é', 'at://did:plc:é/app.bsky.feed.post/3k'],
      ].map(([did, u]) => ({ did, uri: u })),
      ({ did, uri: u }) => isOwnPostUri(did, u),
    )),
  );

  out.push(
    ...(await eachN(
      'postRowsFor',
      [
        {
          $id: 'two',
          added: [
            { uri: uri('3a'), cid: 'bafy1', record: record('hello') },
            {
              uri: uri('3b'),
              cid: 'bafy2',
              record: record('a reply', {
                reply: {
                  root: { uri: uri('3a') },
                  parent: { uri: 'at://did:plc:friend/app.bsky.feed.post/9' },
                },
              }),
            },
          ],
        },
        {
          $id: 'left-out',
          added: [
            { uri: uri('3a', 'did:plc:other'), record: record('theirs') },
            { uri: uri('3b'), record: null },
            { uri: uri('3c'), record: { text: 'no date' } },
            {
              uri: uri('3d', DID, 'app.bsky.feed.like'),
              record: record('a like'),
            },
            null,
          ],
        },
        { $id: 'none', added: null },
      ],
      ({ added }) => postRowsFor(DID, added ?? undefined),
    )),
  );

  const held = [
    {
      uri: uri('1'),
      rkey: '1',
      at: '2026-01-01T00:00:00.000Z',
      text: 'old',
      likes: 4,
      reposts: 1,
      replies: 2,
      quotes: 0,
    },
    {
      uri: uri('2'),
      rkey: '2',
      at: '2026-02-01T00:00:00.000Z',
      text: 'older',
      likes: 0,
      reposts: 0,
      replies: 0,
      quotes: 0,
    },
  ];
  const [fresh3] = postRowsFor(DID, [{ uri: uri('3'), record: record('new') }]);
  const [edited1] = postRowsFor(DID, [
    { uri: uri('1'), record: record('old, edited') },
  ]);
  const [same] = postRowsFor(DID, [
    {
      uri: uri('2'),
      record: { ...record('older'), createdAt: '2026-02-01T00:00:00.000Z' },
    },
  ]);
  const [brief] = postRowsFor(DID, [
    { uri: uri('5'), record: record('brief') },
  ]);
  const changeCases = [
    { $id: 'add-and-remove', posts: held, rows: [fresh3], removed: [uri('2')] },
    { $id: 'noted-again', posts: held, rows: [edited1] },
    { $id: 'nothing', posts: held },
    { $id: 'remove-unknown', posts: held, removed: [uri('9')] },
    { $id: 'same-row', posts: [held[0], same], rows: [same] },
    {
      $id: 'added-and-removed',
      posts: held,
      rows: [brief],
      removed: [uri('5')],
    },
    {
      $id: 'twice',
      posts: held,
      rows: [fresh3, { ...fresh3, text: 'second' }],
    },
    { $id: 'not-an-array', posts: null, rows: [fresh3] },
    { $id: 'counts-differ', posts: [{ ...same, likes: 3 }], rows: [same] },
  ];
  out.push(
    // Plain `each`: it hands the case's own objects over, so a row held and
    // noted again can be the same object, as it can on the web.
    ...(await each(
      'applyPostChanges',
      changeCases,
      ({ posts, rows, removed }) => {
        const list = posts;
        const next = applyPostChanges(list, {
          ...(rows ? { rows } : {}),
          ...(removed ? { removed } : {}),
        });
        return { rows: next, same: next === list };
      },
    )),
  );

  return out;
}
