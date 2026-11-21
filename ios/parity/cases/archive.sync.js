// The archive's sweeps, as the web makes them: every request (through
// @atproto/api's Agent for the signed-in reads, plain fetch for the public
// AppView, constellation.js for the backlinks), every wait, every page and
// progress report handed back, and the result. Pagination, retries, errors,
// a call that is called off partway (`abortAt`: the request whose answer
// arrives after the abort), and resumption. Swift:
// VirgaArchive/Lib/AnalyticsSync.swift, replayed through MockTransport.

import { Agent } from '@atproto/api';
import {
  followFromRecord,
  hydrateActors,
  sweepBlocks,
  sweepFollowers,
  sweepFollowing,
  sweepInbound,
  sweepOutbound,
  sweepPosts,
} from '../../../src/lib/analyticsSync.js';
import { each } from './_helpers.js';
import { json, recordFetch } from './_fetch.js';
import { numbers } from './_archive.js';

export const sources = ['src/lib/analyticsSync.js'];

const PDS = 'https://pds.example';
const ME = 'did:plc:archiveowner234567abcd';
const CID = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const NOW = Date.UTC(2026, 10, 14, 12);
const DAY = 86_400_000;

// TIDs at known times (the archive dates follows and blocks by them).
const B32 = '234567abcdefghijklmnopqrstuvwxyz';
function tid(ms, clock = 0) {
  let n = (BigInt(ms) * 1000n) << 10n;
  n |= BigInt(clock);
  let s = '';
  for (let i = 0; i < 13; i++) {
    s = B32[Number(n & 31n)] + s;
    n >>= 5n;
  }
  return s;
}

const iso = (ms) => new Date(ms).toISOString();

/**
 * Runs a sweep with fetch faked: `answer(request, index)` answers each
 * request; at request `abortAt` the sweep is called off before the answer
 * is handed back. Pages and progress reports are kept with the result.
 */
async function run({ answer, abortAt = null }, sweep) {
  const controller = new AbortController();
  const pages = [];
  const progress = [];
  const recorded = await recordFetch(
    (request, index) => {
      if (index === abortAt) controller.abort();
      const out = answer(request, index);
      if (out === 'offline') throw new TypeError('fetch failed');
      return out;
    },
    () =>
      sweep({
        signal: controller.signal,
        onPage: async (rows, info) => {
          pages.push(info === undefined ? { rows } : { rows, info });
        },
        onProgress: (p) => progress.push(p),
      }),
    { now: NOW },
  );
  return { ...recorded, pages, progress };
}

/** Answers routed by path: `routes[name]` is an array of answers in turn. */
function byPath(routes) {
  const seen = {};
  return (request) => {
    const url = new URL(request.url);
    const name = url.pathname.split('/').pop().split('.').pop();
    const list = routes[name];
    if (!list) throw new Error(`no route for ${request.url}`);
    const n = seen[name] ?? 0;
    seen[name] = n + 1;
    const out = list[Math.min(n, list.length - 1)];
    return typeof out === 'function' ? out(request, url) : out;
  };
}

const profile = (handle, over = {}) => ({
  did: `did:plc:${handle.replace(/[^a-z0-9]/g, '')}`,
  handle: `${handle}.test`,
  ...over,
});

const followersPage = (followers, cursor) =>
  json({
    subject: { did: ME, handle: 'owner.test' },
    followers,
    ...(cursor ? { cursor } : {}),
  });

const recordsPage = (records, cursor) =>
  json({ records, ...(cursor ? { cursor } : {}) });

const followRecord = (rkey, subject, createdAt = iso(NOW - 3 * DAY)) => ({
  uri: `at://${ME}/app.bsky.graph.follow/${rkey}`,
  cid: CID,
  value: { $type: 'app.bsky.graph.follow', subject, createdAt },
});

const xrpcError = (status, error, message) => json({ error, message }, status);

function followerCases() {
  const ana = profile('ana', {
    displayName: 'Ana',
    avatar: 'https://cdn.example/ana.jpg',
    viewer: {
      followedBy: `at://did:plc:ana/app.bsky.graph.follow/${tid(NOW - 30 * DAY)}`,
    },
  });
  const bo = profile('bo', {
    viewer: { followedBy: 'at://did:plc:bo/app.bsky.graph.follow/notatid' },
  });
  const cy = profile('cy', {
    displayName: '',
    viewer: {
      followedBy: `at://did:plc:cy/app.bsky.graph.follow/${tid(NOW - DAY)}`,
    },
  });
  return [
    {
      $id: 'two-pages',
      answers: [followersPage([ana, bo], 'c1'), followersPage([cy])],
    },
    { $id: 'empty', answers: [followersPage([])] },
    { $id: 'empty-page-with-cursor', answers: [followersPage([], 'more')] },
    { $id: 'retry-then-ok', answers: ['offline', followersPage([ana])] },
    { $id: 'fails-twice', answers: ['offline', 'offline'] },
    {
      $id: 'server-error',
      answers: [
        followersPage([ana], 'c1'),
        xrpcError(500, 'InternalServerError', 'boom'),
        xrpcError(500, 'InternalServerError', 'boom again'),
      ],
    },
    {
      $id: 'called-off',
      answers: [
        followersPage([ana], 'c1'),
        followersPage([bo], 'c2'),
        followersPage([cy]),
      ],
      abortAt: 1,
    },
  ];
}

function followingCases() {
  return [
    {
      $id: 'two-pages',
      answers: [
        recordsPage(
          [
            followRecord(tid(NOW - 9 * DAY), 'did:plc:ana'),
            followRecord('self', 'did:plc:bo', iso(NOW - 2 * DAY)),
          ],
          'c1',
        ),
        recordsPage([
          followRecord(tid(NOW - 8 * DAY), 'did:plc:ana'),
          followRecord(tid(NOW - DAY), 'not-a-did'),
          followRecord('nodate', 'did:plc:cy', ''),
        ]),
      ],
    },
    {
      $id: 'never-followed',
      answers: [
        xrpcError(400, 'InvalidRequest', 'Could not locate record: at://x'),
      ],
    },
    {
      $id: 'not-found',
      answers: [xrpcError(404, 'NotFound', 'Collection Not Found')],
    },
    {
      $id: 'fails',
      answers: [
        xrpcError(500, 'InternalServerError', 'boom'),
        xrpcError(502, 'UpstreamFailure', 'still down'),
      ],
    },
    {
      $id: 'retry-then-ok',
      answers: [
        'offline',
        recordsPage([followRecord(tid(NOW - 9 * DAY), 'did:plc:ana')]),
      ],
    },
    {
      $id: 'called-off',
      answers: [
        recordsPage([followRecord(tid(NOW - 9 * DAY), 'did:plc:ana')], 'c1'),
        recordsPage([]),
      ],
      abortAt: 0,
    },
  ];
}

const backlinks = (records, cursor) =>
  json({ total: records.length, records, ...(cursor ? { cursor } : {}) });
const link = (did, rkey, collection) => ({
  did,
  rkey,
  ...(collection ? { collection } : {}),
});
const many = (items, cursor) => json({ items, ...(cursor ? { cursor } : {}) });
const member = (listOwner, listKey, rkey) => ({
  linkRecord: { did: listOwner, collection: 'app.bsky.graph.listitem', rkey },
  otherSubject: `at://${listOwner}/app.bsky.graph.list/${listKey}`,
});
const listRecord = (purpose, name) =>
  json({
    uri: 'at://x/app.bsky.graph.list/1',
    cid: CID,
    value: { $type: 'app.bsky.graph.list', purpose, name, createdAt: iso(NOW) },
  });

function blockCases() {
  const happy = {
    getBacklinks: [
      backlinks(
        [
          link('did:plc:b1', tid(NOW - 5 * DAY)),
          link('did:plc:b2', tid(NOW - 4 * DAY), 'app.bsky.graph.block'),
        ],
        'd1',
      ),
      backlinks([
        link('did:plc:b1', tid(NOW - 5 * DAY)),
        link('did:plc:b3', 'notatid'),
        link('', 'x'),
        link('did:plc:b4', ''),
      ]),
      // The moderation list's subscribers.
      backlinks([
        link('did:plc:s1', tid(NOW - 20 * DAY)),
        link('did:plc:s2', tid(NOW - 2 * DAY), 'app.bsky.graph.listblock'),
        link('did:plc:b1', tid(NOW - DAY)),
      ]),
    ],
    getManyToMany: [
      many(
        [
          member('did:plc:mod', 'mod1', tid(NOW - 10 * DAY)),
          member('did:plc:cur', 'cur1', tid(NOW - 9 * DAY)),
        ],
        'm1',
      ),
      many([
        member('did:plc:mod', 'mod1', tid(NOW - 12 * DAY)),
        member('did:plc:ref', 'ref1', tid(NOW - 8 * DAY)),
        member('did:plc:gone', 'gone1', tid(NOW - 7 * DAY)),
        {
          linkRecord: { did: 'did:plc:x', rkey: '' },
          otherSubject: 'at://did:plc:x/app.bsky.graph.list/x',
        },
        {
          linkRecord: { did: 'did:plc:x', rkey: 'k' },
          otherSubject: 'not-a-uri',
        },
      ]),
    ],
    getRecord: [
      (request, url) => {
        const key = url.searchParams.get('rkey');
        if (key === 'mod1')
          return listRecord(
            'app.bsky.graph.defs#modlist',
            `Block list ${'é'.repeat(130)}`,
          );
        if (key === 'cur1')
          return listRecord('app.bsky.graph.defs#curatelist', 'Friends');
        if (key === 'ref1')
          return listRecord('app.bsky.graph.defs#referencelist', 7);
        return xrpcError(400, 'RecordNotFound', 'Could not locate record');
      },
    ],
  };
  return [
    { $id: 'direct-lists-and-subscribers', routes: happy },
    {
      $id: 'nothing',
      routes: {
        getBacklinks: [backlinks([])],
        getManyToMany: [many([])],
        getRecord: [listRecord('x', 'x')],
      },
    },
    {
      $id: 'repeated-cursor',
      routes: {
        getBacklinks: [
          backlinks([link('did:plc:b1', tid(NOW))], 'same'),
          backlinks([link('did:plc:b2', tid(NOW))], 'same'),
        ],
      },
    },
    {
      $id: 'constellation-down',
      routes: { getBacklinks: [json({ error: 'down' }, 503)] },
    },
    {
      $id: 'memberships-down',
      routes: { getBacklinks: [backlinks([])], getManyToMany: [json({}, 500)] },
    },
    {
      $id: 'list-record-fails',
      routes: {
        getBacklinks: [backlinks([])],
        getManyToMany: [
          many([member('did:plc:mod', 'mod1', tid(NOW - 10 * DAY))]),
        ],
        getRecord: [json({ error: 'InternalServerError' }, 500)],
      },
    },
    {
      $id: 'list-record-offline-then-ok',
      routes: {
        getBacklinks: [
          backlinks([]),
          backlinks([link('did:plc:s1', tid(NOW - 20 * DAY))]),
        ],
        getManyToMany: [
          many([member('did:plc:mod', 'mod1', tid(NOW - 10 * DAY))]),
        ],
        getRecord: [
          'offline',
          listRecord('app.bsky.graph.defs#modlist', 'Mods'),
        ],
      },
    },
    {
      $id: 'subscribers-down',
      routes: {
        getBacklinks: [backlinks([]), json({}, 404)],
        getManyToMany: [
          many([member('did:plc:mod', 'mod1', tid(NOW - 10 * DAY))]),
        ],
        getRecord: [listRecord('app.bsky.graph.defs#modlist', 'Mods')],
      },
    },
    { $id: 'called-off-in-direct', routes: happy, abortAt: 0 },
    { $id: 'called-off-in-lists', routes: happy, abortAt: 3 },
    { $id: 'called-off-in-subscribers', routes: happy, abortAt: 8 },
  ];
}

const feedPost = (rkey, at, over = {}) => ({
  post: {
    uri: `at://${ME}/app.bsky.feed.post/${rkey}`,
    cid: CID,
    author: { did: ME, handle: 'owner.test' },
    record: {
      $type: 'app.bsky.feed.post',
      text: `post ${rkey}`,
      createdAt: iso(at),
    },
    likeCount: 2,
    repostCount: 1,
    replyCount: 0,
    quoteCount: 0,
    indexedAt: iso(at),
    ...over,
  },
});
const reposted = (at) => ({
  post: {
    uri: 'at://did:plc:other/app.bsky.feed.post/old',
    cid: CID,
    author: { did: 'did:plc:other', handle: 'other.test' },
    record: {
      $type: 'app.bsky.feed.post',
      text: 'theirs',
      createdAt: iso(at - 900 * DAY),
    },
    indexedAt: iso(at),
  },
  reason: {
    $type: 'app.bsky.feed.defs#reasonRepost',
    by: { did: ME, handle: 'owner.test' },
    indexedAt: iso(at),
  },
});
const feed = (items, cursor) =>
  json({ feed: items, ...(cursor ? { cursor } : {}) });

function postCases() {
  const page1 = feed(
    [
      feedPost('p5', NOW - DAY),
      reposted(NOW - 2 * DAY),
      feedPost('p4', NOW - 3 * DAY),
    ],
    'f1',
  );
  const page2 = feed(
    [feedPost('p3', NOW - 40 * DAY), feedPost('p2', NOW - 41 * DAY)],
    'f2',
  );
  const page3 = feed([
    feedPost('p1', NOW - 90 * DAY, { record: { text: 'undated' } }),
  ]);
  const known = ['p5', 'p4', 'p3', 'p2', 'p1'].map(
    (k) => `at://${ME}/app.bsky.feed.post/${k}`,
  );
  return [
    {
      $id: 'build',
      answers: [page1, page2, page3],
      opts: { rehydrateSinceMs: '$-Infinity' },
    },
    { $id: 'build-default', answers: [page1, page2, page3], opts: {} },
    {
      $id: 'resume',
      answers: [page2, page3],
      opts: { resumeCursor: 'f1', rehydrateSinceMs: '$-Infinity' },
    },
    {
      $id: 'top-up-stops',
      answers: [page1, page2, page3],
      opts: { knownUris: known, rehydrateSinceMs: NOW - 30 * DAY },
    },
    {
      $id: 'top-up-new-post',
      answers: [page1, page2, page3],
      opts: { knownUris: known.slice(1), rehydrateSinceMs: NOW - 30 * DAY },
    },
    {
      $id: 'top-up-recent',
      answers: [page1, page2, page3],
      opts: { knownUris: known, rehydrateSinceMs: NOW - 60 * DAY },
    },
    {
      $id: 'only-reposts',
      answers: [feed([reposted(NOW)], 'r1'), feed([])],
      opts: { knownUris: known, rehydrateSinceMs: NOW - 30 * DAY },
    },
    { $id: 'empty-feed', answers: [feed([], 'still')], opts: {} },
    {
      $id: 'server-error',
      answers: [page1, json({ error: 'x' }, 502), json({ error: 'x' }, 502)],
      opts: {},
    },
    {
      $id: 'not-json',
      answers: [
        { status: 200, text: '<html>busy</html>' },
        { status: 200, text: '<html>busy</html>' },
      ],
      opts: {},
    },
    { $id: 'offline-then-ok', answers: ['offline', page3], opts: {} },
    { $id: 'called-off', answers: [page1, page2, page3], opts: {}, abortAt: 1 },
  ];
}

const notification = (n, reason, at, over = {}) => ({
  uri: `at://did:plc:fan${n}/app.bsky.feed.${reason === 'repost' ? 'repost' : 'like'}/${n}`,
  cid: CID,
  author: { did: `did:plc:fan${n}`, handle: `fan${n}.test` },
  reason,
  record: { $type: 'app.bsky.feed.like', createdAt: iso(at) },
  isRead: false,
  indexedAt: iso(at),
  ...over,
});
const notes = (items, cursor) =>
  json({ notifications: items, ...(cursor ? { cursor } : {}) });

function inboundCases() {
  const cutoffMs = NOW - 365 * DAY;
  const page1 = notes(
    [
      notification(1, 'like', NOW - DAY, {
        reasonSubject: `at://${ME}/app.bsky.feed.post/p5`,
      }),
      notification(2, 'follow', NOW - 2 * DAY),
      notification(3, 'reply', NOW - 3 * DAY, {
        record: {
          $type: 'app.bsky.feed.post',
          text: 'hi',
          createdAt: iso(NOW - 400 * DAY),
        },
      }),
    ],
    'n1',
  );
  const page2 = notes(
    [
      notification(4, 'repost', NOW - 100 * DAY),
      notification(5, 'mention', NOW - 200 * DAY),
    ],
    'n2',
  );
  const page3 = notes(
    [
      notification(6, 'like', NOW - 300 * DAY),
      notification(7, 'quote', NOW - 370 * DAY),
    ],
    'n3',
  );
  const knownAll = [1, 3, 4, 5, 6, 7].map(
    (n) => notification(n, n === 4 ? 'repost' : 'like', 0).uri,
  );
  return [
    {
      $id: 'to-the-cutoff',
      answers: [page1, page2, page3, notes([])],
      opts: { cutoffMs },
    },
    {
      $id: 'end-of-feed',
      answers: [page1, notes([notification(4, 'repost', NOW - 100 * DAY)])],
      opts: { cutoffMs },
    },
    {
      $id: 'covered-stops',
      answers: [page1, page2, page3],
      opts: { cutoffMs, knownUris: knownAll, coveredToMs: cutoffMs },
    },
    {
      $id: 'not-covered-digs',
      answers: [page1, page2, page3],
      opts: { cutoffMs, knownUris: knownAll, coveredToMs: NOW - 30 * DAY },
    },
    {
      $id: 'server-error',
      answers: [
        page1,
        xrpcError(500, 'InternalServerError', 'boom'),
        xrpcError(500, 'InternalServerError', 'boom'),
      ],
      opts: { cutoffMs },
    },
    {
      $id: 'called-off',
      answers: [page1, page2, page3],
      opts: { cutoffMs },
      abortAt: 1,
    },
  ];
}

const likeRecord = (rkeyMs, subjectDid, createdAt) => ({
  uri: `at://${ME}/app.bsky.feed.like/${tid(rkeyMs)}`,
  cid: CID,
  value: {
    $type: 'app.bsky.feed.like',
    subject: { uri: `at://${subjectDid}/app.bsky.feed.post/1`, cid: CID },
    createdAt: iso(createdAt),
  },
});
const repostRecord = (rkeyMs, subjectDid) => ({
  uri: `at://${ME}/app.bsky.feed.repost/${tid(rkeyMs)}`,
  cid: CID,
  value: {
    $type: 'app.bsky.feed.repost',
    subject: { uri: `at://${subjectDid}/app.bsky.feed.post/1`, cid: CID },
    createdAt: iso(rkeyMs),
  },
});

function outboundCases() {
  const cutoffMs = NOW - 365 * DAY;
  const likes1 = recordsPage(
    [
      likeRecord(NOW - DAY, 'did:plc:a', NOW - DAY),
      likeRecord(NOW - 2 * DAY, 'did:plc:b', NOW - 500 * DAY),
    ],
    'l1',
  );
  const likes2 = recordsPage(
    [likeRecord(NOW - 400 * DAY, 'did:plc:c', NOW - 400 * DAY)],
    'l2',
  );
  const reposts1 = recordsPage([
    repostRecord(NOW - 3 * DAY, 'did:plc:d'),
    { uri: `at://${ME}/app.bsky.feed.repost/x`, cid: CID, value: {} },
  ]);
  const routed = (likes, reposts) =>
    byPath({
      listRecords: [
        (request, url) => {
          const list =
            url.searchParams.get('collection') === 'app.bsky.feed.like'
              ? likes
              : reposts;
          const n = (list.seen = (list.seen ?? -1) + 1);
          const out = list[Math.min(n, list.length - 1)];
          if (out === 'offline') throw new TypeError('fetch failed');
          return out;
        },
      ],
    });
  return [
    {
      $id: 'both-collections',
      answer: () => routed([likes1, likes2], [reposts1]),
      opts: { cutoffMs },
    },
    {
      $id: 'never-reposted',
      answer: () =>
        routed(
          [likes1, likes2],
          [xrpcError(400, 'InvalidRequest', 'Could not locate record')],
        ),
      opts: { cutoffMs },
    },
    {
      $id: 'likes-fail',
      answer: () =>
        routed(
          [
            xrpcError(500, 'InternalServerError', 'boom'),
            xrpcError(500, 'InternalServerError', 'boom'),
          ],
          [reposts1],
        ),
      opts: { cutoffMs },
    },
    {
      $id: 'covered',
      answer: () => routed([likes1, likes2], [reposts1]),
      opts: {
        cutoffMs,
        knownUris: [
          likeRecord(NOW - DAY, 'x', 0).uri,
          likeRecord(NOW - 400 * DAY, 'x', 0).uri,
        ],
        coveredToMs: cutoffMs - 1,
      },
    },
    {
      $id: 'called-off',
      answer: () => routed([likes1, likes2], [reposts1]),
      opts: { cutoffMs },
      abortAt: 1,
    },
  ];
}

export default async function cases() {
  const out = [];
  const agent = () => new Agent(PDS);

  out.push(
    ...(await each(
      'followFromRecord',
      [
        { record: followRecord(tid(NOW - DAY), 'did:plc:ana') },
        {
          record: followRecord(
            'self',
            'did:plc:ana',
            '2026-01-01T00:00:00.000Z',
          ),
        },
        { record: followRecord('self', 'did:plc:ana', '') },
        { record: followRecord('self', 'alice.test') },
        { record: { uri: '', value: { subject: 'did:plc:x' } } },
        {
          record: {
            uri: 'at://x/app.bsky.graph.follow/1',
            value: { subject: 5 },
          },
        },
        { record: null },
      ],
      ({ record }) => followFromRecord(record),
    )),
  );

  out.push(
    ...(await each('sweepFollowers', followerCases(), ({ answers, abortAt }) =>
      run(
        {
          answer: (request, i) => answers[Math.min(i, answers.length - 1)],
          abortAt,
        },
        ({ signal, onProgress }) =>
          sweepFollowers(agent(), ME, { signal, onProgress }),
      ),
    )),
  );

  out.push(
    ...(await each('sweepFollowing', followingCases(), ({ answers, abortAt }) =>
      run(
        {
          answer: (request, i) => answers[Math.min(i, answers.length - 1)],
          abortAt,
        },
        ({ signal, onProgress }) =>
          sweepFollowing(agent(), ME, { signal, onProgress }),
      ),
    )),
  );

  // `each` hands the case's own objects over, answers (functions) included;
  // the fixture keeps only what JSON can carry.
  out.push(
    ...(await each('sweepBlocks', blockCases(), ({ routes, abortAt }) =>
      run({ answer: byPath(routes), abortAt }, ({ signal, onProgress }) =>
        sweepBlocks(ME, { signal, onProgress }),
      ),
    )),
  );

  out.push(
    ...(await each('sweepPosts', postCases(), ({ answers, opts, abortAt }) =>
      run(
        {
          answer: (request, i) => answers[Math.min(i, answers.length - 1)],
          abortAt,
        },
        ({ signal, onPage, onProgress }) =>
          sweepPosts({
            did: ME,
            ...numbers(opts),
            knownUris: opts.knownUris ? new Set(opts.knownUris) : undefined,
            signal,
            onPage,
            onProgress,
          }),
      ),
    )),
  );

  out.push(
    ...(await each(
      'sweepInbound',
      inboundCases(),
      ({ answers, opts, abortAt }) =>
        run(
          {
            answer: (request, i) => answers[Math.min(i, answers.length - 1)],
            abortAt,
          },
          ({ signal, onPage, onProgress }) =>
            sweepInbound(agent(), {
              ...opts,
              knownUris: opts.knownUris ? new Set(opts.knownUris) : undefined,
              signal,
              onPage,
              onProgress,
            }),
        ),
    )),
  );

  out.push(
    ...(await each(
      'sweepOutbound',
      outboundCases(),
      ({ answer: make, opts, abortAt }) => {
        const answer = make();
        return run({ answer, abortAt }, ({ signal, onPage, onProgress }) =>
          sweepOutbound(agent(), ME, {
            ...opts,
            knownUris: opts.knownUris ? new Set(opts.knownUris) : undefined,
            signal,
            onPage,
            onProgress,
          }),
        );
      },
    )),
  );

  const profiles = (dids) =>
    json({
      profiles: dids
        .filter((d) => d !== 'did:plc:gone')
        .map((did) => ({
          did,
          handle: `${did.slice(8)}.test`,
          displayName: did.slice(8).toUpperCase(),
          avatar: '',
        })),
    });
  out.push(
    ...(await each(
      'hydrateActors',
      [
        {
          $id: 'some-missing',
          dids: [
            'did:plc:a',
            'did:plc:b',
            'did:plc:a',
            'did:plc:c',
            'did:plc:d',
            'did:plc:gone',
            null,
          ],
          cache: [
            { did: 'did:plc:b', handle: 'b.test', at: NOW - DAY },
            { did: 'did:plc:c', handle: '', at: NOW },
            { did: 'did:plc:d', handle: 'd.test', at: NOW - 8 * DAY },
          ],
        },
        {
          $id: 'all-fresh',
          dids: ['did:plc:b'],
          cache: [{ did: 'did:plc:b', handle: 'b.test', at: NOW }],
        },
        { $id: 'none', dids: null, cache: [] },
      ],
      ({ dids, cache }) =>
        run(
          {
            answer: (request) => {
              const url = new URL(request.url);
              return profiles(url.searchParams.getAll('actors'));
            },
          },
          () => hydrateActors(dids, new Map(cache.map((c) => [c.did, c]))),
        ),
    )),
  );

  return out;
}
