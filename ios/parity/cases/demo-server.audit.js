// Virga's server in the harness (harness/fakeServer.js), recorded as
// demo-server.fakeServer.js records it (_demoServer.js's runner), for the
// flows that span many ticks of the workers: a repeating post with a
// picture and a timer whose account can't be reached, retried with backoff
// until it gives up, the series going on past it and an older failure
// making way; timers whose rules meet gates and postgates the author set,
// delete a thread with its replies, extend and then spare, and fail when
// the grant is refused; and a row edited, moved and reordered around a
// pinned delete time, at the limits. Kept apart from demo-server.fakeServer
// for size. Swift: DemoServerParityTests.swift.

import { NOW } from './_demoWorld.js';
import {
  DAY,
  GATE,
  HOUR,
  MINUTE,
  MIRA,
  arm,
  create,
  get,
  iso,
  later,
  post,
  postUri,
  rootsOf,
  scenarioCases,
  text,
} from './_demoServer.js';

export const sources = ['harness/fakeServer.js'];

const POSTGATE = 'app.bsky.feed.postgate';
const LIST = `at://${MIRA}/app.bsky.graph.list/3moots`;
const LIST2 = `at://${MIRA}/app.bsky.graph.list/3close`;
const rule = (name, extra = {}) => ({ $type: `${GATE}#${name}`, ...extra });
const image = (mediaId, alt = '') => ({ mediaId, alt });

/** The gate an author set on a root before its timer came due. */
const gate =
  (i, allow, extra = {}) =>
  (ctx) => {
    const r = rootsOf(ctx)[i].rkey;
    return {
      write: {
        did: MIRA,
        collection: GATE,
        rkey: r,
        record: {
          $type: GATE,
          post: postUri(MIRA, r),
          createdAt: iso(NOW),
          allow,
          ...extra,
        },
      },
    };
  };

/** A timer on one of the account's roots. */
const armRoot = (i, extra) => (ctx) =>
  post(
    '/api/self-destruct/create',
    arm(postUri(MIRA, rootsOf(ctx)[i].rkey), extra),
  );

/** Ticks of the workers, each after `ms`. */
const ticks = (n, ms) =>
  Array.from({ length: n }, () => [{ advance: ms }, { cron: true }]).flat();

const SCENARIOS = [
  {
    name: 'series-through-failures',
    options: { seed: false },
    steps: [
      { mint: MIRA },
      () =>
        post(
          '/api/schedule/create',
          {
            ...create(
              [
                {
                  record: { text: 'Daily picture', langs: ['en'] },
                  embed: {
                    type: 'images',
                    images: [image('p0-img0', 'a heron')],
                  },
                },
              ],
              {
                repeat: { every: 'day', tz: 'Europe/London', count: 4 },
                selfDestruct: { lifespanSeconds: 3600 },
              },
            ),
            payload: {
              ...create(
                [
                  {
                    record: { text: 'Daily picture', langs: ['en'] },
                    embed: {
                      type: 'images',
                      images: [image('p0-img0', 'a heron')],
                    },
                  },
                ],
                {
                  repeat: { every: 'day', tz: 'Europe/London', count: 4 },
                  selfDestruct: { lifespanSeconds: 3600 },
                },
              ).payload,
              mediaBytes: {
                'p0-img0': { base64: 'AQIDBA==', encoding: 'image/png' },
              },
            },
          },
          { as: 'first' },
        ),
      { refuse: MIRA },
      { advance: HOUR + MINUTE },
      { cron: true },
      get('/api/schedule/list'),
      // Backoff: 2, 4, 8, then 16 minutes, and the fifth try gives up.
      ...ticks(1, 2 * MINUTE),
      ...ticks(1, 4 * MINUTE),
      ...ticks(1, 7 * MINUTE),
      ...ticks(1, MINUTE),
      ...ticks(1, 16 * MINUTE),
      get('/api/schedule/list', { as: 'afterFirst' }),
      (ctx) =>
        get(`/api/schedule/media?id=${ctx.named.afterFirst.data.at(-1).id}`),
      // The next occurrence fails the same way, and the first makes way for it.
      { advance: DAY },
      { cron: true },
      ...ticks(1, 2 * MINUTE),
      ...ticks(1, 4 * MINUTE),
      ...ticks(1, 8 * MINUTE),
      ...ticks(1, 16 * MINUTE),
      get('/api/schedule/list', { as: 'afterSecond' }),
      (ctx) => get(`/api/schedule/media?id=${ctx.named.first.data.id}`),
      // Signed in again: the failed one is retried and goes out late.
      { mint: MIRA },
      (ctx) =>
        post(
          '/api/schedule/update',
          {
            id: ctx.named.afterSecond.data.find((r) => r.status === 'failed')
              .id,
            retry: true,
          },
          { token: 1 },
        ),
      { cron: true },
      get('/api/self-destruct/list', { token: 1 }),
      { advance: DAY },
      { cron: true },
      get('/api/schedule/list', { token: 1, as: 'last' }),
      (ctx) =>
        post(
          '/api/schedule/update',
          {
            id: ctx.named.last.data.find((r) => r.status === 'pending').id,
            skip: true,
          },
          { token: 1 },
        ),
      { advance: 2 * HOUR },
      { cron: true },
      get('/api/self-destruct/list?history=1', { token: 1 }),
      get('/api/limits/status', { token: 1 }),
    ],
  },
  {
    name: 'timer-effects',
    search: '?defense=lists',
    steps: [
      { mint: MIRA },
      // Already limited this way, closed to everyone, narrowed to a list.
      gate(0, [rule('followerRule'), rule('mentionRule')]),
      armRoot(0, {
        effects: [{ action: 'limitReplies', allow: ['mention', 'follower'] }],
      }),
      gate(1, []),
      armRoot(1, {
        effects: [{ action: 'limitReplies', allow: ['follower'] }],
      }),
      gate(2, [rule('followingRule'), rule('listRule', { list: LIST })], {
        hiddenReplies: ['at://did:plc:x/app.bsky.feed.post/3hidden'],
      }),
      armRoot(2, {
        effects: [
          { action: 'limitReplies', allow: [{ list: LIST }, { list: LIST2 }] },
        ],
      }),
      armRoot(3, {
        effects: [
          {
            action: 'limitReplies',
            allow: ['following', { list: LIST }, { list: LIST2 }, 'mention'],
          },
          { action: 'delete' },
          { action: 'disableQuotes' },
        ],
      }),
      // Quoting already off, and a postgate whose detached quotes stay.
      (ctx) => {
        const r = rootsOf(ctx)[4].rkey;
        return {
          write: {
            did: MIRA,
            collection: POSTGATE,
            rkey: r,
            record: {
              $type: POSTGATE,
              post: postUri(MIRA, r),
              createdAt: iso(NOW),
              embeddingRules: [{ $type: `${POSTGATE}#disableRule` }],
            },
          },
        };
      },
      armRoot(4, { effects: [{ action: 'disableQuotes' }] }),
      (ctx) => {
        const r = rootsOf(ctx)[5].rkey;
        return {
          write: {
            did: MIRA,
            collection: POSTGATE,
            rkey: r,
            record: {
              $type: POSTGATE,
              post: postUri(MIRA, r),
              createdAt: iso(NOW),
              detachedEmbeddingUris: ['at://did:plc:x/app.bsky.feed.post/3q'],
              embeddingRules: [],
            },
          },
        };
      },
      armRoot(5, { effects: [{ action: 'disableQuotes' }] }),
      // A thread with a later post gone, one named twice, and its own
      // replies under it (written, so they carry their records).
      (ctx) => ({
        write: {
          did: MIRA,
          collection: 'app.bsky.feed.post',
          rkey: '3selfreplyaa2',
          record: {
            $type: 'app.bsky.feed.post',
            text: 'and another thing',
            createdAt: iso(NOW + 1000),
            reply: {
              root: { uri: postUri(MIRA, rootsOf(ctx)[6].rkey), cid: 'bafyx' },
              parent: {
                uri: postUri(MIRA, rootsOf(ctx)[6].rkey),
                cid: 'bafyx',
              },
            },
          },
        },
      }),
      (ctx) => ({
        write: {
          did: MIRA,
          collection: 'app.bsky.feed.post',
          rkey: '3selfreplyaa3',
          record: {
            $type: 'app.bsky.feed.post',
            text: 'and one more',
            createdAt: iso(NOW + 2000),
            reply: {
              root: { uri: postUri(MIRA, rootsOf(ctx)[6].rkey), cid: 'bafyx' },
              parent: { uri: postUri(MIRA, '3selfreplyaa2'), cid: 'bafyx' },
            },
          },
        },
      }),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, rootsOf(ctx)[6].rkey), {
            extraUris: [
              postUri(MIRA, rootsOf(ctx)[7].rkey),
              { uri: postUri(MIRA, rootsOf(ctx)[7].rkey) },
              postUri(MIRA, '3selfreplyaa3'),
              postUri(MIRA, '3gonegonegone'),
            ],
          }),
        ),
      // All of two parts, spared only if met; extended twice, then spared.
      armRoot(8, {
        conditions: {
          logic: 'all',
          clauses: [
            { metric: 'likes', op: 'gte', value: 1 },
            { metric: 'replies', op: 'gt', value: 100000 },
          ],
          sense: 'onlyIf',
        },
      }),
      armRoot(9, {
        lifespanSeconds: 600,
        conditions: {
          clauses: [{ metric: 'likes', op: 'gte', value: 1 }],
          onSpare: 'extend',
          maxExtensions: 2,
        },
      }),
      get('/api/self-destruct/list'),
      get('/api/limits/status'),
      ...ticks(1, HOUR + MINUTE),
      get('/api/self-destruct/list?history=1'),
      ...ticks(3, 11 * MINUTE),
      get('/api/self-destruct/list?history=1'),
      // A grant refused: tried every two minutes until it gives up.
      armRoot(10),
      armRoot(11, { lifespanSeconds: 900 }),
      { refuse: MIRA },
      ...ticks(1, HOUR + MINUTE),
      ...ticks(4, 2 * MINUTE),
      ...ticks(1, 2 * MINUTE),
      get('/api/self-destruct/list', { as: 'afterRefuse' }),
      get('/api/self-destruct/list?history=true'),
      (ctx) =>
        post('/api/self-destruct/cancel', {
          id:
            ctx.named.afterRefuse.data.find((t) => t.status === 'failed')?.id ??
            'x',
        }),
      get('/api/self-destruct/list?history=1'),
    ],
  },
  {
    name: 'edits-and-moves',
    options: { seed: false, limits: { scheduledPosts: 2 } },
    steps: [
      { mint: MIRA },
      () =>
        post(
          '/api/schedule/create',
          {
            ...create(['two pictures'], { at: 2 * HOUR }),
            payload: {
              ...create(['x']).payload,
              posts: [
                {
                  record: { text: 'two pictures' },
                  embed: {
                    type: 'images',
                    images: [image('a'), image('b', 'the second')],
                  },
                },
              ],
              mediaBytes: {
                a: { base64: 'AQID', encoding: 'image/png' },
                b: { base64: 'BAUG' },
              },
            },
          },
          { as: 'pics' },
        ),
      (ctx) => get(`/api/schedule/media?id=${ctx.named.pics.data.id}`),
      // Edited with one new picture: the old ones go, the new folder stays.
      { advance: 1234 },
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.pics.data.id,
          ...create(['one picture now'], { at: 3 * HOUR }),
          payload: {
            ...create(['x']).payload,
            posts: [
              {
                record: { text: 'one picture now' },
                embed: { type: 'images', images: [image('c')] },
              },
            ],
            mediaBytes: { c: { base64: 'BwgJ', encoding: 'image/webp' } },
          },
        }),
      (ctx) => get(`/api/schedule/media?id=${ctx.named.pics.data.id}`),
      // Starts a series, then moves: its rule is anchored again.
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.pics.data.id,
          ...create(['weekly now'], {
            at: 3 * HOUR,
            repeat: { every: 'week', tz: 'America/New_York' },
            selfDestruct: {
              lifespanSeconds: 3600,
              deleteAt: later(5 * HOUR),
            },
          }),
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.pics.data.id,
          scheduledFor: later(4 * HOUR + 56 * MINUTE),
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.pics.data.id,
          scheduledFor: later(4 * HOUR + 54 * MINUTE),
        }),
      (ctx) => get(`/api/schedule/get?id=${ctx.named.pics.data.id}`),
      () =>
        post('/api/schedule/create', create(['second'], { at: 6 * HOUR }), {
          as: 'second',
        }),
      () => post('/api/schedule/create', create(['third'], { at: 7 * HOUR })),
      // A reorder that would strand the pinned delete time, then one that doesn't.
      (ctx) =>
        post('/api/schedule/reorder', {
          moves: [
            { id: ctx.named.second.data.id, scheduledFor: later(2 * HOUR) },
            { id: ctx.named.pics.data.id, scheduledFor: later(6 * HOUR) },
          ],
        }),
      (ctx) =>
        post('/api/schedule/reorder', {
          moves: [
            { id: ctx.named.second.data.id, scheduledFor: later(4 * HOUR) },
            { id: ctx.named.pics.data.id, scheduledFor: later(2 * HOUR) },
          ],
        }),
      get('/api/schedule/list'),
      // Failed at the limit: an edit counts it again, a retry too.
      { refuse: MIRA },
      ...ticks(1, 2 * HOUR + MINUTE),
      ...ticks(4, 20 * MINUTE),
      () =>
        post('/api/schedule/create', create(['fills it'], { at: 9 * HOUR })),
      get('/api/schedule/list', { as: 'full' }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.pics.data.id,
          ...create(['edited after failing'], { at: 10 * HOUR }),
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.pics.data.id,
          retry: true,
        }),
      (ctx) =>
        post(`/api/schedule/cancel?id=${ctx.named.second.data.id}`, undefined),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.pics.data.id,
          ...create(['edited after failing'], { at: 10 * HOUR }),
        }),
      get('/api/schedule/list'),
      get('/api/limits/status'),
      { mint: MIRA },
      ...ticks(1, 10 * HOUR),
      get('/api/schedule/list', { token: 1 }),
      get('/api/self-destruct/list?history=1', { token: 1 }),
      () => post('/api/schedule/create', create([text('x')]), { token: 1 }),
    ],
  },
];

// Seventy rows to list, most of them at one of three times: the list is
// sorted by a comparator that never says two are equal, so the order of
// equal times is V8's TimSort's own (past 64 rows, with merges).
const LIST_ORDER = {
  name: 'list-order',
  options: { seed: false },
  steps: [
    { mint: MIRA },
    ...Array.from(
      { length: 20 },
      (_, i) => () =>
        post('/api/schedule/create', create([`due ${i}`], { at: HOUR })),
    ),
    { refuse: MIRA },
    ...ticks(1, HOUR + MINUTE),
    ...ticks(4, 20 * MINUTE),
    { mint: MIRA },
    ...Array.from(
      { length: 50 },
      (_, i) => () =>
        post(
          '/api/schedule/create',
          create([`waiting ${i}`], { at: [3, 1, 2, 1, 3, 2, 2][i % 7] * HOUR }),
          { token: 1, quiet: true },
        ),
    ),
    get('/api/schedule/list', { token: 1 }),
    get('/api/limits/status', { token: 1 }),
  ],
};

export default async function cases() {
  return scenarioCases([...SCENARIOS, LIST_ORDER]);
}
