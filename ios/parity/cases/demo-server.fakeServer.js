// Virga's server in the harness (harness/fakeServer.js), recorded:
// scenarios of requests on one server, with the workers run between them
// (_demoServer.js says how). Every scheduling, timer, limits and AI route
// is asked with good input and bad, the limits and caps are reached, the
// workers publish, retry with backoff, repeat, spare, extend, narrow gates,
// turn quotes off and delete threads, and the seeded rows are read in
// three zones. Swift: VirgaDemo/Harness/FakeServer*.swift; tests in
// ios/VirgaKit/Tests/VirgaDemoTests/DemoServerParityTests.swift.

import { LAB } from '../../../harness/world.js';
import { NOW } from './_demoWorld.js';
import {
  DAY,
  GATE,
  HOUR,
  MINUTE,
  MIRA,
  POST,
  arm,
  composed,
  create,
  get,
  iso,
  later,
  post,
  postUri,
  rootsOf,
  scenarioCases,
} from './_demoServer.js';

export const sources = ['harness/fakeServer.js'];

const SCENARIOS = [
  {
    name: 'seeded',
    steps: [
      { mint: MIRA },
      { mint: LAB.did },
      get('/api/schedule/list', { as: 'list' }),
      get('/api/schedule/list', { token: 1 }),
      get('/api/limits/status'),
      get('/api/self-destruct/list'),
      get('/api/self-destruct/list?history=1', { as: 'timers' }),
      get('/api/self-destruct/list?history=true', { token: 1 }),
      get('/api/schedule/get'),
      get('/api/schedule/get?id=nope'),
      (ctx) =>
        get(`/api/schedule/get?id=${ctx.named.list.data[0].id}`, { token: 1 }),
      (ctx) => get(`/api/schedule/media?id=${ctx.named.list.data[0].id}`),
      get('/api/schedule/media'),
      (ctx) =>
        post(
          '/api/schedule/cancel',
          { id: ctx.named.list.data[0].id },
          { token: 1 },
        ),
      // The seed swap, the second of six monthly posts: skip it, then stop the next.
      (ctx) =>
        post(
          '/api/schedule/update',
          { id: ctx.named.list.data.find((r) => r.seriesId).id, skip: true },
          { as: 'skipped' },
        ),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.list.data.find((r) => r.seriesId).id,
          skip: true,
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.skipped.data.id,
          stopRepeat: true,
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.skipped.data.id,
          stopRepeat: true,
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.skipped.data.id,
          skip: 1,
        }),
      // The failed thread, retried; the timer note cleared, then cleared again.
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.list.data.find((r) => r.status === 'failed').id,
          retry: true,
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.list.data.find((r) => r.status === 'failed').id,
          retry: true,
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.list.data.find((r) => r.status === 'published').id,
          acknowledgeTimer: true,
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.list.data.find((r) => r.status === 'published').id,
          acknowledgeTimer: true,
        }),
      // The queued one moved, then reordered, then moved too far and into the past.
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.list.data.find((r) => r.queued).id,
          scheduledFor: later(40 * HOUR),
        }),
      (ctx) =>
        post('/api/schedule/reorder', {
          moves: [
            {
              id: ctx.named.list.data.find((r) => r.queued).id,
              scheduledFor: later(41 * HOUR),
            },
          ],
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.list.data.find((r) => r.queued).id,
          scheduledFor: later(91 * DAY),
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.list.data.find((r) => r.queued).id,
          scheduledFor: later(-HOUR),
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.list.data.find((r) => r.queued).id,
          scheduledFor: 'whenever',
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.list.data.find((r) => r.queued).id,
        }),
      () => post('/api/schedule/update', { scheduledFor: later(HOUR) }),
      () =>
        post('/api/schedule/update', { id: 'nope', scheduledFor: later(HOUR) }),
      (ctx) =>
        post('/api/schedule/cancel', {
          id: ctx.named.list.data.find((r) => r.queued).id,
        }),
      (ctx) =>
        post('/api/schedule/cancel', {
          id: ctx.named.list.data.find((r) => r.queued).id,
        }),
      (ctx) => post(`/api/schedule/cancel?id=${ctx.named.skipped.data.id}`, {}),
      post('/api/schedule/cancel', {}),
      // The seeded live timer, called off; Field Lab can't.
      (ctx) =>
        post(
          '/api/self-destruct/cancel',
          { id: ctx.named.timers.data.find((t) => t.status === 'armed').id },
          { token: 1 },
        ),
      (ctx) =>
        post('/api/self-destruct/cancel', {
          id: ctx.named.timers.data.find((t) => t.status === 'armed').id,
        }),
      (ctx) =>
        post('/api/self-destruct/cancel', {
          id: ctx.named.timers.data.find((t) => t.status === 'armed').id,
        }),
      post('/api/self-destruct/cancel', {}),
      get('/api/self-destruct/list?history=1'),
      get('/api/schedule/list'),
      get('/api/limits/status'),
      { advance: 2 * DAY },
      { cron: true },
      get('/api/schedule/list'),
      { advance: 40 * DAY },
      { cron: true },
      get('/api/schedule/list'),
      get('/api/self-destruct/list'),
    ],
  },
  {
    name: 'create-refusals',
    options: { seed: false },
    steps: [
      { mint: MIRA },
      post('/api/schedule/create', undefined),
      post('/api/schedule/create', null),
      post('/api/schedule/create', 'text'),
      post('/api/schedule/create', [1, 2]),
      { method: 'POST', path: '/api/schedule/create', text: '{nope' },
      () => post('/api/schedule/create', create(['hi'], { at: 'not a date' })),
      () => post('/api/schedule/create', create(['hi'], { at: -MINUTE })),
      () => post('/api/schedule/create', create(['hi'], { at: 0 })),
      () => post('/api/schedule/create', create(['hi'], { at: 91 * DAY })),
      () => post('/api/schedule/create', create(['hi'], { at: 90 * DAY })),
      () =>
        post(
          '/api/schedule/create',
          create(['hi'], {}, { target: 'elsewhere' }),
        ),
      () => post('/api/schedule/create', create(['hi'], {}, { target: null })),
      () => post('/api/schedule/create', { scheduledFor: later(HOUR) }),
      () =>
        post('/api/schedule/create', {
          scheduledFor: later(HOUR),
          payload: [1],
        }),
      () =>
        post('/api/schedule/create', {
          scheduledFor: later(HOUR),
          payload: { posts: [] },
        }),
      () =>
        post('/api/schedule/create', {
          scheduledFor: later(HOUR),
          payload: { posts: 'hi' },
        }),
      () =>
        post(
          '/api/schedule/create',
          create(Array.from({ length: 26 }, (_, i) => `post ${i}`)),
        ),
      () => post('/api/schedule/create', create([{ text: 'no record' }])),
      () => post('/api/schedule/create', create([null])),
      () => post('/api/schedule/create', create([{ record: null }])),
      () => post('/api/schedule/create', create([{ record: [] }])),
      () =>
        post(
          '/api/schedule/create',
          create([{ record: { text: 'x'.repeat(3001) } }]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([{ record: { text: '😀'.repeat(1500) } }]),
        ),
      () =>
        post('/api/schedule/create', create([{ record: { text: '  \n ' } }])),
      () =>
        post(
          '/api/schedule/create',
          create([
            {
              record: { text: 5 },
              embed: { type: 'external', uri: 'https://x.example' },
            },
          ]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([{ record: { text: 'v' }, embed: { type: 'video' } }]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([
            { record: { text: 'e' }, embed: { type: 'images', images: [] } },
          ]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([
            {
              record: { text: 'e' },
              embed: {
                type: 'images',
                images: Array.from({ length: 11 }, (_, i) => ({
                  mediaId: `m${i}`,
                })),
              },
            },
          ]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([
            {
              record: { text: 'e' },
              embed: { type: 'images', images: [{ mediaId: 'a' }, {}] },
            },
          ]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([
            {
              record: { text: 'e' },
              embed: { type: 'images', images: [{ mediaId: 'a' }, 5, null] },
            },
          ]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([
            {
              record: { text: 'e' },
              embed: { type: 'images', images: [null] },
            },
          ]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([{ record: { text: 'e' }, embed: { type: 'external' } }]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([
            { record: { text: 'e' }, embed: { type: 'record', uri: 'at://x' } },
          ]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([
            {
              record: { text: 'e' },
              embed: { type: 'recordWithMedia', uri: 'at://x', cid: 'c' },
            },
          ]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([
            {
              record: { text: 'e' },
              embed: { type: 'recordWithMedia', cid: 'c' },
            },
          ]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([
            {
              record: { text: 'e' },
              embed: {
                type: 'recordWithMedia',
                uri: 'u',
                cid: 'c',
                media: { type: 'recordWithMedia', uri: 'u', cid: 'c' },
              },
            },
          ]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([{ record: { text: 'e' }, embed: { type: 'poll' } }]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([{ record: { text: 'e' }, embed: { type: ['a', 'b'] } }]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([{ record: { text: 'e' }, embed: 'external' }]),
        ),
      () =>
        post(
          '/api/schedule/create',
          create([
            {
              record: { text: 'e' },
              embed: { type: 'images', images: [{ mediaId: 'a b/ü😀' }] },
            },
          ]),
        ),
      () =>
        post('/api/schedule/create', {
          ...create([
            {
              record: { text: 'e' },
              embed: { type: 'images', images: [{ mediaId: 'a' }] },
            },
          ]),
          payload: {
            ...create(['x']).payload,
            posts: [
              {
                record: { text: 'e' },
                embed: { type: 'images', images: [{ mediaId: 'a' }] },
              },
            ],
            mediaBytes: { a: { encoding: 'image/png' } },
          },
        }),
      // Replies.
      () => post('/api/schedule/create', create(['r'], { reply: 'parent' })),
      () => post('/api/schedule/create', create(['r'], { reply: [] })),
      () =>
        post(
          '/api/schedule/create',
          create(['r'], {
            reply: { root: { uri: postUri(LAB.did, '3abc'), cid: 'c' } },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['r'], { reply: { root: [], parent: [] } }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['r'], {
            reply: {
              root: { uri: `at://${LAB.did}/app.bsky.feed.like/x`, cid: 'c' },
              parent: { uri: postUri(LAB.did, 'x'), cid: 'c' },
            },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['r'], {
            reply: {
              root: { uri: 'at://plc:x/app.bsky.feed.post/x', cid: 'c' },
              parent: { uri: postUri(LAB.did, 'x'), cid: 'c' },
            },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['r'], {
            reply: {
              root: { uri: postUri(LAB.did, 'x'), cid: '' },
              parent: { uri: postUri(LAB.did, 'x'), cid: 'c' },
            },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['r'], {
            reply: {
              root: { uri: postUri(LAB.did, 'x'), cid: 'c' },
              parent: { uri: postUri(LAB.did, 'y'), cid: 5 },
            },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(
            ['r'],
            {
              reply: {
                root: { uri: postUri(LAB.did, 'x'), cid: 'c' },
                parent: { uri: postUri(LAB.did, 'y'), cid: 'd' },
              },
            },
            { queued: true },
          ),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['r'], {
            reply: {
              root: { uri: postUri(LAB.did, 'x'), cid: 'c' },
              parent: { uri: postUri(LAB.did, 'y'), cid: 'd' },
            },
            repeat: { every: 'day', tz: 'UTC' },
          }),
        ),
      // Repeats.
      () => post('/api/schedule/create', create(['x'], { repeat: 'daily' })),
      () => post('/api/schedule/create', create(['x'], { repeat: [] })),
      () => post('/api/schedule/create', create(['x'], { repeat: false })),
      () => post('/api/schedule/create', create(['x'], { repeat: 0 })),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], { repeat: { every: 'hour', tz: 'UTC' } }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], {
            repeat: { every: 'day', tz: 'Mars/Olympus' },
            tz: undefined,
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], { repeat: { every: 'day' }, tz: 5 }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], {
            repeat: { every: 'day', tz: 'Mars/Olympus' },
            tz: 'europe/london',
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], { repeat: { every: 'day', tz: ['Asia/Kolkata'] } }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], { repeat: { every: 'day', tz: '+05:30' } }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], { repeat: { every: 'day', tz: 'UTC', count: 1 } }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], {
            repeat: {
              every: 'day',
              tz: 'UTC',
              count: '3',
              until: '2027-01-01',
            },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], {
            repeat: { every: 'day', tz: 'UTC', until: '2026-01-01' },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], {
            repeat: { every: 'day', tz: 'UTC', until: '2026-1-1' },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], {
            repeat: { every: 'day', tz: 'UTC', until: 20270101 },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], { repeat: { every: 'day', tz: 'UTC', count: 401 } }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], { repeat: { every: 'day', tz: 'UTC', count: 2.5 } }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(
            ['x'],
            { repeat: { every: 'day', tz: 'UTC', count: 4 } },
            { occurrence: 7 },
          ),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(
            ['x'],
            { repeat: { every: 'day', tz: 'UTC', count: '', until: null } },
            { queued: true },
          ),
        ),
      // Lifespans.
      () =>
        post('/api/schedule/create', create(['x'], { selfDestruct: 'soon' })),
      () => post('/api/schedule/create', create(['x'], { selfDestruct: {} })),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], { selfDestruct: { lifespanSeconds: 299 } }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], { selfDestruct: { lifespanSeconds: 2592001 } }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], {
            selfDestruct: { lifespanSeconds: '600', deleteAt: 'later' },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], {
            selfDestruct: {
              lifespanSeconds: 600,
              deleteAt: later(HOUR + 4 * MINUTE),
            },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], {
            selfDestruct: { lifespanSeconds: 600, effects: 'delete' },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['x'], {
            selfDestruct: {
              lifespanSeconds: 600,
              conditions: { clauses: [{ metric: 'views', value: 1 }] },
            },
          }),
        ),
      get('/api/schedule/list'),
    ],
  },
  {
    name: 'publish',
    steps: [
      { mint: MIRA },
      {
        ...post('/api/schedule/create', async () =>
          composed(['Out at noon', 'with a reply'], {
            at: Date.now() + HOUR,
            extra: {
              gates: { custom: true, reply: [], quotes: true },
              lifespan: {
                enabled: true,
                lifespanSeconds: 3 * 3600,
                conditions: {},
                effects: [{ action: 'delete' }],
              },
            },
          }),
        ),
        as: 'row',
      },
      (ctx) => get(`/api/schedule/get?id=${ctx.named.row.data.id}`),
      (ctx) => get(`/api/schedule/media?id=${ctx.named.row.data.id}`),
      () =>
        post(
          '/api/schedule/create',
          {
            ...create(
              [
                {
                  record: {
                    text: 'With pictures',
                    langs: ['en'],
                    facets: [],
                    tags: ['seeds'],
                  },
                  embed: {
                    type: 'images',
                    images: [
                      {
                        mediaId: 'p0-img0',
                        alt: 'jars',
                        aspectRatio: { width: 4, height: 3 },
                      },
                      { mediaId: 'p0-img1' },
                    ],
                  },
                },
                {
                  record: { text: '' },
                  embed: {
                    type: 'external',
                    uri: 'https://example.com/a',
                    title: 'A',
                    thumbMediaId: 'p1-thumb',
                    associatedRefs: [{ uri: 'at://x' }],
                  },
                },
                {
                  record: { text: 'quoting' },
                  embed: {
                    type: 'recordWithMedia',
                    uri: postUri(LAB.did, '3lab'),
                    cid: 'bafyq',
                    media: {
                      type: 'images',
                      images: [{ mediaId: 'p2-img0', alt: '' }],
                    },
                  },
                },
                {
                  record: { text: 'just a quote' },
                  embed: {
                    type: 'record',
                    uri: postUri(LAB.did, '3lab'),
                    cid: 'bafyq',
                  },
                },
              ],
              {
                at: 2 * HOUR,
                gates: {
                  threadgate: [{ $type: `${GATE}#mentionRule` }],
                  postgate: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
                },
              },
            ),
            payload: {
              ...create(['x']).payload,
              posts: [
                {
                  record: {
                    text: 'With pictures',
                    langs: ['en'],
                    facets: [],
                    tags: ['seeds'],
                  },
                  embed: {
                    type: 'images',
                    images: [
                      {
                        mediaId: 'p0-img0',
                        alt: 'jars',
                        aspectRatio: { width: 4, height: 3 },
                      },
                      { mediaId: 'p0-img1' },
                    ],
                  },
                },
                {
                  record: { text: '' },
                  embed: {
                    type: 'external',
                    uri: 'https://example.com/a',
                    title: 'A',
                    thumbMediaId: 'p1-thumb',
                    associatedRefs: [{ uri: 'at://x' }],
                  },
                },
                {
                  record: { text: 'quoting' },
                  embed: {
                    type: 'recordWithMedia',
                    uri: postUri(LAB.did, '3lab'),
                    cid: 'bafyq',
                    media: {
                      type: 'images',
                      images: [{ mediaId: 'p2-img0', alt: '' }],
                    },
                  },
                },
                {
                  record: { text: 'just a quote' },
                  embed: {
                    type: 'record',
                    uri: postUri(LAB.did, '3lab'),
                    cid: 'bafyq',
                  },
                },
              ],
              gates: {
                threadgate: [{ $type: `${GATE}#mentionRule` }],
                postgate: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
              },
              mediaBytes: {
                'p0-img0': { base64: 'AQID', encoding: 'image/png' },
                'p0-img1': { base64: 'BAUG', encoding: 'image/jpeg' },
                'p1-thumb': { base64: 'Bwg=', encoding: 'image/webp' },
                'p2-img0': { base64: 'CQ==' },
              },
            },
          },
          { as: 'pictures' },
        ),
      (ctx) => get(`/api/schedule/media?id=${ctx.named.pictures.data.id}`),
      // Five pictures make a gallery; bytes that aren't base64 fail it until it gives up.
      () =>
        post('/api/schedule/create', {
          ...create(
            [
              {
                record: { text: 'gallery' },
                embed: {
                  type: 'images',
                  images: ['a', 'b', 'c', 'd', 'e'].map((m) => ({
                    mediaId: m,
                  })),
                },
              },
            ],
            { at: 3 * HOUR },
          ),
          payload: {
            ...create(['x']).payload,
            posts: [
              {
                record: { text: 'gallery' },
                embed: {
                  type: 'images',
                  images: ['a', 'b', 'c', 'd', 'e'].map((m) => ({
                    mediaId: m,
                  })),
                },
              },
            ],
            mediaBytes: Object.fromEntries(
              ['a', 'b', 'c', 'd', 'e'].map((m) => [
                m,
                { base64: 'AA==', encoding: 'image/png' },
              ]),
            ),
          },
        }),
      () =>
        post('/api/schedule/create', {
          ...create([
            {
              record: { text: 'broken bytes' },
              embed: { type: 'images', images: [{ mediaId: 'z' }] },
            },
          ]),
          payload: {
            ...create(['x']).payload,
            posts: [
              {
                record: { text: 'broken bytes' },
                embed: { type: 'images', images: [{ mediaId: 'z' }] },
              },
            ],
            mediaBytes: { z: { base64: '@@@', encoding: 'image/png' } },
          },
        }),
      () =>
        post('/api/schedule/create', {
          ...create([
            {
              record: { text: 'odd length' },
              embed: { type: 'images', images: [{ mediaId: 'q' }] },
            },
          ]),
          payload: {
            ...create(['x']).payload,
            posts: [
              {
                record: { text: 'odd length' },
                embed: { type: 'images', images: [{ mediaId: 'q' }] },
              },
            ],
            mediaBytes: { q: { base64: 'AAAAA', encoding: 'image/png' } },
          },
        }),
      () =>
        post(
          '/api/schedule/create',
          create(['pinned delete'], {
            at: 30 * MINUTE,
            selfDestruct: {
              lifespanSeconds: 600,
              deleteAt: later(30 * MINUTE + 6 * MINUTE),
            },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['conditional'], {
            at: 30 * MINUTE,
            selfDestruct: {
              lifespanSeconds: 600,
              effects: [{ action: 'limitReplies', allow: ['following'] }],
              conditions: { clauses: [{ metric: 'likes', value: 100 }] },
            },
          }),
        ),
      get('/api/limits/status'),
      { advance: HOUR + 1000 },
      { cron: true },
      get('/api/schedule/list'),
      get('/api/self-destruct/list'),
      { advance: 2 * HOUR },
      { cron: true },
      { advance: 2 * MINUTE },
      { cron: true },
      { advance: 4 * MINUTE },
      { cron: true },
      { advance: 8 * MINUTE },
      { cron: true },
      { advance: 16 * MINUTE },
      { cron: true },
      get('/api/schedule/list'),
      { advance: 3 * HOUR },
      { cron: true },
      get('/api/self-destruct/list?history=1'),
      get('/api/schedule/list'),
    ],
  },
  {
    name: 'replies',
    steps: [
      { mint: MIRA },
      (ctx) => {
        const p = ctx.lab.posts[0];
        const found = ctx.repo.readRecord(ctx.lab, POST, p.rkey);
        const ref = { uri: found.uri, cid: found.cid };
        return {
          ...post('/api/schedule/create', async () =>
            composed(['Count me in', 'and I’ll bring the ladder'], {
              at: Date.now() + HOUR,
              extra: {
                reply: {
                  ...ref,
                  root: ref,
                  author: {
                    did: LAB.did,
                    handle: LAB.handle,
                    displayName: 'Field Lab',
                  },
                  text: found.value.text,
                },
              },
            }),
          ),
          as: 'reply',
        };
      },
      (ctx) => {
        const p = ctx.lab.posts[1];
        const found = ctx.repo.readRecord(ctx.lab, POST, p.rkey);
        const ref = { uri: found.uri, cid: found.cid };
        return post(
          '/api/schedule/create',
          create(['Too late'], {
            at: HOUR,
            reply: { root: ref, parent: ref },
            replyTo: {
              handle: `  ${LAB.handle}  `,
              displayName: 7,
              text: 'x'.repeat(400),
            },
            gates: { threadgate: [], postgate: [] },
          }),
        );
      },
      (ctx) =>
        post(
          '/api/schedule/create',
          create(['No hint'], {
            at: HOUR,
            reply: {
              root: { uri: postUri(LAB.did, ctx.lab.posts[2].rkey), cid: 'c' },
              parent: {
                uri: postUri(LAB.did, ctx.lab.posts[2].rkey),
                cid: 'c',
              },
            },
            replyTo: { handle: '  ' },
          }),
        ),
      get('/api/schedule/list'),
      (ctx) => ({
        remove: { did: LAB.did, collection: POST, rkey: ctx.lab.posts[1].rkey },
      }),
      { advance: HOUR + 1000 },
      { cron: true },
      get('/api/schedule/list'),
    ],
  },
  {
    name: 'repeating',
    steps: [
      { mint: MIRA },
      () =>
        post(
          '/api/schedule/create',
          create(['Every day at one'], {
            repeat: { every: 'day', tz: 'UTC', count: 3 },
          }),
          { as: 'daily' },
        ),
      get('/api/limits/status'),
      { advance: HOUR + 1000 },
      { cron: true },
      get('/api/schedule/list'),
      { advance: DAY },
      { cron: true },
      { advance: DAY },
      { cron: true },
      { advance: DAY },
      { cron: true },
      () =>
        post(
          '/api/schedule/create',
          create(['Weekly'], {
            at: 2 * HOUR,
            repeat: { every: 'week', tz: 'Europe/Paris' },
          }),
          { as: 'weekly' },
        ),
      (ctx) =>
        post(
          '/api/schedule/update',
          { id: ctx.named.weekly.data.id, skip: true },
          { as: 'next' },
        ),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.weekly.data.id,
          skip: true,
        }),
      // Edited, the waiting one changes this and later occurrences; saved without a rule, it stops.
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.next.data.id,
          ...create(['New words'], {
            at: 2 * DAY,
            repeat: { every: 'week', tz: 'UTC', count: 5 },
          }),
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.next.data.id,
          ...create(['New words'], {
            at: 2 * DAY,
            repeat: { every: 'week', tz: 'UTC', count: 1 },
          }),
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.next.data.id,
          scheduledFor: later(3 * DAY),
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.next.data.id,
          ...create(['Plain now'], { at: 2 * DAY }),
        }),
      () =>
        post(
          '/api/schedule/create',
          create(['Twice'], {
            at: 3 * HOUR,
            repeat: { every: 'day', tz: 'UTC', count: 2 },
          }),
          { as: 'twice' },
        ),
      (ctx) =>
        post(
          '/api/schedule/update',
          { id: ctx.named.twice.data.id, skip: true },
          { as: 'twiceNext' },
        ),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.twiceNext.data.id,
          skip: true,
        }),
      // A month end, and a post that starts a series when edited.
      () =>
        post('/api/schedule/create', create(['Plain'], { at: 4 * HOUR }), {
          as: 'plain',
        }),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.plain.data.id,
          ...create(['Monthly now'], {
            at: '2026-11-30T09:00:00.000Z',
            repeat: {
              every: 'month',
              tz: 'America/New_York',
              until: '2027-03-31',
            },
          }),
        }),
      // With a picture, kept for the next occurrence.
      () =>
        post(
          '/api/schedule/create',
          {
            ...create(
              [
                {
                  record: { text: 'With a picture' },
                  embed: {
                    type: 'images',
                    images: [{ mediaId: 'p0-img0', alt: 'four bytes' }],
                  },
                },
              ],
              { at: 5 * HOUR, repeat: { every: 'day', tz: 'UTC', count: 2 } },
            ),
            payload: {
              ...create(['x'], {
                repeat: { every: 'day', tz: 'UTC', count: 2 },
              }).payload,
              posts: [
                {
                  record: { text: 'With a picture' },
                  embed: {
                    type: 'images',
                    images: [{ mediaId: 'p0-img0', alt: 'four bytes' }],
                  },
                },
              ],
              mediaBytes: {
                'p0-img0': { base64: 'AQIDBA==', encoding: 'image/png' },
              },
            },
          },
          { as: 'picture' },
        ),
      { advance: 5 * HOUR },
      { cron: true },
      get('/api/schedule/list', { as: 'afterPicture' }),
      (ctx) =>
        get(
          `/api/schedule/media?id=${ctx.named.afterPicture.data.find((r) => r.seriesId === ctx.named.picture.data.seriesId).id}`,
        ),
      { advance: DAY },
      { cron: true },
      (ctx) =>
        get(
          `/api/schedule/media?id=${ctx.named.afterPicture.data.find((r) => r.seriesId === ctx.named.picture.data.seriesId).id}`,
        ),
      // A refused grant: five attempts with backoff use the occurrence up, the series goes on.
      () =>
        post(
          '/api/schedule/create',
          create(['Daily'], { at: HOUR, repeat: { every: 'day', tz: 'UTC' } }),
          { as: 'refusedSeries' },
        ),
      { refuse: MIRA },
      { advance: HOUR + 1000 },
      { cron: true },
      { advance: 61 * MINUTE },
      { cron: true },
      { advance: 61 * MINUTE },
      { cron: true },
      { advance: 61 * MINUTE },
      { cron: true },
      { advance: 61 * MINUTE },
      { cron: true },
      { advance: 61 * MINUTE },
      { cron: true },
      get('/api/schedule/list'),
      (ctx) =>
        post('/api/schedule/update', {
          id: ctx.named.refusedSeries.data.id,
          stopRepeat: true,
        }),
      { mint: MIRA },
      { advance: DAY },
      { cron: true },
      get('/api/schedule/list', { token: 1 }),
    ],
  },
  {
    name: 'limits',
    options: {
      seed: false,
      limits: { scheduledPosts: 3, postTimers: 1, conditionalTimers: 1 },
    },
    steps: [
      { mint: MIRA },
      get('/api/limits/status'),
      () =>
        post(
          '/api/schedule/create',
          create(['one'], { selfDestruct: { lifespanSeconds: 600 } }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['two'], { selfDestruct: { lifespanSeconds: 600 } }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['two'], {
            selfDestruct: {
              lifespanSeconds: 600,
              effects: [{ action: 'disableQuotes' }],
            },
          }),
        ),
      () =>
        post(
          '/api/schedule/create',
          create(['three'], {
            selfDestruct: {
              lifespanSeconds: 600,
              conditions: { clauses: [{ metric: 'likes', value: 3 }] },
            },
          }),
        ),
      () => post('/api/schedule/create', create(['four'])),
      () => post('/api/schedule/create', create(['four'])),
      get('/api/limits/status', { as: 'full' }),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[5].rkey)),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[6].rkey), {
            effects: [{ action: 'disableQuotes' }],
          }),
        ),
      get('/api/schedule/list', { as: 'rows' }),
      (ctx) => post('/api/schedule/cancel', { id: ctx.named.rows.data[0].id }),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[7].rkey)),
        ),
      get('/api/limits/status'),
    ],
  },
  {
    name: 'flat-caps',
    options: { seed: false },
    steps: [
      { mint: MIRA },
      ...Array.from({ length: 51 }, (_, i) => () => ({
        ...post(
          '/api/schedule/create',
          create([`post ${i}`], { at: (i + 1) * HOUR }),
        ),
        quiet: true,
      })),
      get('/api/limits/status'),
    ],
  },
  {
    name: 'timers',
    search: '?defense=lists',
    steps: [
      { mint: MIRA },
      { mint: LAB.did },
      (ctx) => ({
        ...post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[5].rkey)),
        ),
        as: 'first',
      }),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[5].rkey), {
            lifespanSeconds: 7200,
            effects: [{ action: 'limitReplies', allow: ['following'] }],
            snippet: 'x'.repeat(250),
            postCid: 'bafyx',
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(LAB.did, ctx.lab.posts[0].rkey)),
        ),
      () =>
        post(
          '/api/self-destruct/create',
          arm('https://bsky.app/profile/x/post/y'),
        ),
      () =>
        post(
          '/api/self-destruct/create',
          arm(`at://${MIRA}/app.bsky.feed.like/x`),
        ),
      () =>
        post(
          '/api/self-destruct/create',
          arm('at://mira/app.bsky.feed.post/x'),
        ),
      () => post('/api/self-destruct/create', arm([postUri(MIRA, '3zz')])),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[8].rkey), { lifespanSeconds: 60 }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[8].rkey), {
            lifespanSeconds: 'forever',
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[8].rkey), {
            effects: [{ action: 'explode' }],
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[8].rkey), {
            conditions: { clauses: [{ metric: 'likes', value: 0 }] },
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[8].rkey), {
            extraUris: Array.from({ length: 101 }, () => postUri(MIRA, 'x')),
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[8].rkey), {
            extraUris: [postUri(LAB.did, 'x')],
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[8].rkey), { extraUris: [null] }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[8].rkey), { deleteAt: 'tomorrow' }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[8].rkey), {
            deleteAt: later(31 * DAY),
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[8].rkey), {
            deleteAt: later(-2 * MINUTE),
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[8].rkey), {
            deleteAt: later(-30 * 1000),
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[9].rkey), {
            deleteAt: later(2 * HOUR),
            postedAt: later(-10 * MINUTE),
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[10].rkey), {
            postedAt: later(-50 * MINUTE),
            extraUris: [{ uri: postUri(MIRA, ctx.mira.posts[11].rkey) }],
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[12].rkey), {
            postedAt: later(-2 * HOUR),
          }),
        ),
      post('/api/self-destruct/create', null),
      post('/api/self-destruct/create', undefined),
      // Rules to meet: spared, extended, gates narrowed, quotes off, a reply left alone.
      (ctx) => {
        const kept = ctx.mira.posts.filter(
          (p) => p.likes >= 3 && !p.replyTo,
        )[0];
        return post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, kept.rkey), {
            conditions: {
              clauses: [{ metric: 'likes', op: 'gte', value: 1 }],
              sense: 'unless',
            },
          }),
        );
      },
      (ctx) => {
        const kept = ctx.mira.posts.filter(
          (p) => p.likes >= 3 && !p.replyTo,
        )[1];
        return post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, kept.rkey), {
            conditions: {
              clauses: [{ metric: 'likes', value: 1 }],
              onSpare: 'extend',
              maxExtensions: 1,
            },
          }),
        );
      },
      (ctx) => {
        const p = ctx.mira.posts.filter((x) => x.likes >= 3 && !x.replyTo)[2];
        return post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, p.rkey), {
            conditions: {
              clauses: [{ metric: 'likes', value: 1000 }],
              sense: 'onlyIf',
            },
            effects: [{ action: 'disableQuotes' }],
          }),
        );
      },
      (ctx) => {
        const r = rootsOf(ctx)[3].rkey;
        return {
          write: {
            did: MIRA,
            collection: GATE,
            rkey: r,
            record: {
              $type: GATE,
              post: postUri(MIRA, r),
              createdAt: iso(NOW),
              allow: [{ $type: `${GATE}#mentionRule` }],
            },
          },
        };
      },
      (ctx) => {
        const r = rootsOf(ctx)[3].rkey;
        return {
          write: {
            did: MIRA,
            collection: GATE,
            rkey: r,
            record: {
              $type: GATE,
              post: postUri(MIRA, r),
              createdAt: iso(NOW),
              allow: [
                { $type: `${GATE}#followerRule` },
                { $type: `${GATE}#mentionRule` },
              ],
              hiddenReplies: ['at://x'],
            },
          },
        };
      },
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, rootsOf(ctx)[3].rkey), {
            effects: [
              { action: 'limitReplies', allow: ['follower'] },
              { action: 'disableQuotes' },
            ],
          }),
        ),
      (ctx) => {
        const r = rootsOf(ctx)[4].rkey;
        return {
          write: {
            did: MIRA,
            collection: GATE,
            rkey: r,
            record: {
              $type: GATE,
              post: postUri(MIRA, r),
              createdAt: iso(NOW),
              allow: [{ $type: `${GATE}#mentionRule` }],
            },
          },
        };
      },
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, rootsOf(ctx)[4].rkey), {
            effects: [{ action: 'limitReplies', allow: ['follower'] }],
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, rootsOf(ctx)[5].rkey), {
            effects: [{ action: 'limitReplies', allow: [] }],
          }),
        ),
      (ctx) => {
        const reply = ctx.mira.posts.find((p) => p.replyTo === MIRA);
        return post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, reply.rkey), {
            effects: [{ action: 'limitReplies', allow: ['follower'] }],
          }),
        );
      },
      (ctx) => {
        const root = rootsOf(ctx)[6];
        return post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, root.rkey), {
            effects: [
              {
                action: 'limitReplies',
                allow: ['toString', { list: 'at://x/app.bsky.graph.list/l' }],
              },
              { action: 'disableQuotes' },
            ],
          }),
        );
      },
      // A thread of self-replies, written as the composer writes it, under a post on a timer.
      {
        write: {
          did: MIRA,
          collection: POST,
          rkey: '3mselfroot2222',
          record: { $type: POST, text: 'root', createdAt: iso(NOW) },
        },
      },
      {
        write: {
          did: MIRA,
          collection: POST,
          rkey: '3mselfone22222',
          record: {
            $type: POST,
            text: 'one',
            createdAt: iso(NOW),
            reply: {
              root: { uri: postUri(MIRA, '3mselfroot2222'), cid: 'c' },
              parent: { uri: postUri(MIRA, '3mselfroot2222'), cid: 'c' },
            },
          },
        },
      },
      {
        write: {
          did: MIRA,
          collection: POST,
          rkey: '3mselftwo22222',
          record: {
            $type: POST,
            text: 'two',
            createdAt: iso(NOW),
            reply: {
              root: { uri: postUri(MIRA, '3mselfroot2222'), cid: 'c' },
              parent: { uri: postUri(MIRA, '3mselfone22222'), cid: 'c' },
            },
          },
        },
      },
      {
        write: {
          did: MIRA,
          collection: GATE,
          rkey: '3mselfone22222',
          record: {
            $type: GATE,
            post: postUri(MIRA, '3mselfone22222'),
            createdAt: iso(NOW),
            allow: [],
          },
        },
      },
      () =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, '3mselfroot2222'), {
            extraUris: [postUri(MIRA, '3mselftwo22222')],
            effects: [{ action: 'delete' }, { action: 'disableQuotes' }],
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(LAB.did, ctx.lab.posts[2].rkey)),
          { token: 1, as: 'labTimer' },
        ),
      get('/api/self-destruct/list'),
      get('/api/self-destruct/list', { token: 1 }),
      (ctx) =>
        post('/api/self-destruct/cancel', { id: ctx.named.labTimer.data.id }),
      get('/api/limits/status'),
      { advance: 2 * HOUR },
      { cron: true },
      get('/api/self-destruct/list?history=1'),
      { advance: 2 * HOUR },
      { cron: true },
      get('/api/self-destruct/list?history=1'),
      // A timer whose post is gone by then, and one whose grant is refused.
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, ctx.mira.posts[20].rkey)),
        ),
      (ctx) => ({
        remove: { did: MIRA, collection: POST, rkey: ctx.mira.posts[20].rkey },
      }),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(postUri(LAB.did, ctx.lab.posts[3].rkey)),
          { token: 1 },
        ),
      { refuse: LAB.did },
      { advance: 2 * HOUR },
      { cron: true },
      { advance: 3 * MINUTE },
      { cron: true },
      { advance: 3 * MINUTE },
      { cron: true },
      { advance: 3 * MINUTE },
      { cron: true },
      { advance: 3 * MINUTE },
      { cron: true },
      get('/api/self-destruct/list?history=1', { token: 1 }),
      get('/api/self-destruct/list'),
    ],
  },
  {
    name: 'timer-caps',
    steps: [
      { mint: MIRA },
      get('/api/self-destruct/list', { as: 'live' }),
      (ctx) => ({
        timerStatus: {
          id: ctx.named.live.data.find((t) => t.status === 'armed').id,
          status: 'checking',
        },
      }),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(ctx.named.live.data.find((t) => t.status === 'armed').postUri, {
            lifespanSeconds: 7200,
          }),
        ),
      (ctx) => ({
        timerStatus: {
          id: ctx.named.live.data.find((t) => t.status === 'armed').id,
          status: 'armed',
        },
      }),
      { fillTimers: 200 },
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(ctx.named.live.data.find((t) => t.status === 'armed').postUri, {
            lifespanSeconds: 7200,
          }),
        ),
      (ctx) =>
        post(
          '/api/self-destruct/create',
          arm(
            postUri(
              MIRA,
              ctx.mira.posts.find(
                (p) =>
                  !p.replyTo &&
                  p.rkey !== ctx.named.live.data[0].postUri.split('/').pop(),
              ).rkey,
            ),
          ),
        ),
      { ...get('/api/self-destruct/list'), quiet: true },
      get('/api/limits/status'),
    ],
  },
  {
    name: 'ai',
    steps: [
      { mint: MIRA },
      post('/api/ai/analyze-post', {
        text: 'This is the the worst bus timetable',
        goals: { presets: { reduceNegativity: true } },
        writingChecks: { typos: true },
      }),
      post('/api/ai/analyze-post', { text: 'hello', goals: {} }),
      post('/api/ai/analyze-post', { text: '   ' }),
      post('/api/ai/analyze-post', { text: 5 }),
      post('/api/ai/analyze-post', {}),
      post('/api/ai/analyze-post', null),
      post('/api/ai/analyze-post', { text: 'x'.repeat(8001) }),
      post('/api/ai/analyze-post', {
        text: Array.from({ length: 11 }, (_, i) =>
          `Post ${i} `.padEnd(290, 'x'),
        ).join('\n\n'),
        writingChecks: { typos: true },
      }),
      post('/api/ai/synthesize-style', { posts: ['a', 'b', 'c', 'd'] }),
      post('/api/ai/synthesize-style', {
        posts: ['a', { text: 'b' }, null, 5, '  ', { text: 'c' }, 'd'],
      }),
      post('/api/ai/synthesize-style', {
        posts: [
          'seed swap!',
          'repair café — saturday',
          { text: 'lamps, zips, bikes' },
          'the long ladder',
          'good secateurs',
        ],
        guidance: `  ${'calm '.repeat(70)}  `,
      }),
      post('/api/ai/synthesize-style', {
        posts: Array.from({ length: 6 }, (_, i) =>
          `A Longer Post That Runs On ${i}. `.repeat(4),
        ),
      }),
      post('/api/ai/synthesize-style', {
        posts: ['a', 'b', 'c', 'd', 'e'],
        guidance: 7,
      }),
      post('/api/ai/synthesize-style', { posts: ['a', 'b', 'c', 'd', 'e'] }),
      post('/api/ai/synthesize-style', { posts: 'abcde' }),
      post('/api/ai/alt-text', {
        imageBase64: 'iVBORw0KGgo=',
        mimeType: 'image/png',
      }),
      post('/api/ai/alt-text', {
        imageBase64: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        followUp: '  Mention the rain.  ',
        previousAltText: 'A heron by the canal.',
      }),
      post('/api/ai/alt-text', {
        imageBase64: 'abc',
        mimeType: 'image/gif',
        kind: 'chart',
      }),
      post('/api/ai/alt-text', {
        imageBase64: 'abc',
        mimeType: ['image/webp'],
        kind: 'interface',
      }),
      post('/api/ai/alt-text', {
        imageBase64: 'abc',
        mimeType: 'image/jpeg',
        kind: 'text',
      }),
      post('/api/ai/alt-text', {
        imageBase64: 'abd',
        mimeType: 'image/jpeg',
        context:
          'the seed swap and the repair café on the same Saturday morning',
      }),
      post('/api/ai/alt-text', { imageBase64: 'abe', mimeType: 'image/jpeg' }),
      post('/api/ai/alt-text', { imageBase64: 12345, mimeType: 'image/jpeg' }),
      post('/api/ai/alt-text', { imageBase64: '', mimeType: 'image/png' }),
      post('/api/ai/alt-text', { imageBase64: 'abc', mimeType: 'image/heic' }),
      post('/api/ai/alt-text', { imageBase64: 'abc', mimeType: 'image/png ' }),
      post('/api/ai/alt-text', { imageBase64: 'abc' }),
      post('/api/ai/alt-text', {
        imageBase64: { length: 5_000_000 },
        mimeType: 'image/png',
      }),
      post('/api/ai/alt-text', { imageBase64: ['abc'], mimeType: 'image/png' }),
      post('/api/ai/alt-text', {
        imageBase64: 'abc',
        mimeType: 'image/png',
        followUp: 'more',
        previousAltText: 7,
      }),
      post('/api/ai/alt-text', {
        imageBase64: 'abc',
        mimeType: 'image/png',
        followUp: ['more'],
        previousAltText: 'Before.',
      }),
      ...Array.from({ length: 10 }, () =>
        post('/api/ai/alt-text', { imageBase64: 'abc', mimeType: 'image/png' }),
      ),
      { advance: 20 * DAY },
      post('/api/ai/alt-text', { imageBase64: 'abc', mimeType: 'image/png' }),
      post('/api/ai/synthesize-style', { posts: ['a', 'b', 'c', 'd', 'e'] }),
    ],
  },
  {
    name: 'ai-limits',
    options: {
      seed: false,
      aiLimits: { adviser: null, altText: 0, style: 1.5 },
    },
    steps: [
      { mint: MIRA },
      post('/api/ai/analyze-post', {
        text: 'I hate this',
        goals: { presets: { reduceNegativity: true } },
      }),
      post('/api/ai/alt-text', {
        imageBase64: 'iVBORw0KGgo=',
        mimeType: 'image/png',
      }),
      post('/api/ai/synthesize-style', { posts: ['a', 'b', 'c', 'd', 'e'] }),
      post('/api/ai/synthesize-style', { posts: ['a', 'b', 'c', 'd', 'e'] }),
      post('/api/ai/synthesize-style', { posts: ['a', 'b', 'c', 'd', 'e'] }),
      post('/api/ai/synthesize-style', { posts: ['a', 'b', 'c', 'd', 'e'] }),
    ],
  },
  {
    name: 'ai-down',
    options: { seed: false, ai: 'down' },
    steps: [
      { mint: MIRA },
      post('/api/ai/analyze-post', {
        text: 'I hate this',
        goals: { presets: { reduceNegativity: true } },
      }),
      post('/api/ai/analyze-post', { text: 'nothing to check' }),
      post('/api/ai/alt-text', { imageBase64: 'abc', mimeType: 'image/png' }),
      post('/api/ai/synthesize-style', { posts: ['a', 'b', 'c', 'd', 'e'] }),
      post('/api/ai/alt-text', { imageBase64: 'abc', mimeType: 'image/png' }),
    ],
  },
  {
    name: 'signed-out',
    steps: [
      { mint: MIRA },
      { mint: MIRA },
      () =>
        post('/api/schedule/create', create(['nobody home']), { as: 'row' }),
      { signOut: 0 },
      { signOut: 1 },
      { signOut: 1 },
      { advance: HOUR + 1000 },
      { cron: true },
      { mint: MIRA },
      get('/api/schedule/list', { token: 2 }),
      { advance: 2 * MINUTE },
      { cron: true },
      get('/api/schedule/list', { token: 2 }),
      get('/api/schedule/list', { token: 0 }),
      get('/api/schedule/list', { token: null }),
      get('/api/schedule/list', {
        token: null,
        headers: { authorization: 'Basic x' },
      }),
      { method: 'PUT', path: '/api/schedule/list', token: 2 },
      { method: 'DELETE', path: '/api/defense/lists', token: 2 },
      get('/api/defense/nothing', { token: 2 }),
      get('/api/schedule/list/', { token: 2 }),
      { method: 'OPTIONS', path: '/api/ai/alt-text', token: null },
    ],
  },
];

/** The seeded rows and a time written without an offset, in other zones. */
for (const zone of ['America/New_York', 'Pacific/Chatham']) {
  SCENARIOS.push({
    name: `zoned-${zone}`,
    zone,
    steps: [
      { mint: MIRA },
      get('/api/schedule/list'),
      get('/api/self-destruct/list?history=1'),
      () =>
        post('/api/schedule/create', {
          ...create(['local time']),
          scheduledFor: iso(Date.now() + 3 * HOUR).replace('Z', ''),
        }),
      () =>
        post('/api/schedule/create', {
          ...create(['a date alone'], {
            selfDestruct: {
              lifespanSeconds: 600,
              deleteAt: iso(Date.now() + 3 * DAY).slice(0, 10),
            },
          }),
          scheduledFor: iso(Date.now() + 2 * DAY).slice(0, 10),
        }),
      () =>
        post(
          '/api/self-destruct/create',
          arm(postUri(MIRA, '3mzoned222222'), {
            postedAt: iso(Date.now() - 10 * MINUTE).replace('Z', ''),
          }),
        ),
      { advance: 3 * DAY },
      { cron: true },
      get('/api/schedule/list'),
    ],
  });
}

export default async function cases() {
  return scenarioCases(SCENARIOS);
}
