// The public AppView reads of src/posting/library/sources.js that other
// modules import (publicXrpc, getPosts, resolveHandle, chunk), which
// VirgaNetwork ports as PublicAppView; the rest of sources.js is the
// library's. Network cases are recorded exchanges (_fetch.js).

import {
  GET_POSTS_MAX,
  chunk,
  getPosts,
  publicXrpc,
  resolveHandle,
} from '../../../src/posting/library/sources.js';
import { each, value } from './_helpers.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = ['src/posting/library/sources.js'];

const uri = (n) =>
  `at://did:plc:author/app.bsky.feed.post/${String(n).padStart(3, '0')}`;
const view = (u) => ({
  uri: u,
  cid: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
});

export default async function cases() {
  return [
    value('GET_POSTS_MAX', GET_POSTS_MAX),

    ...(await each(
      'chunk',
      [
        { list: [], size: 25 },
        { list: [1, 2, 3, 4, 5], size: 2 },
        { list: [1, 2, 3], size: 3 },
        { list: [1, 2, 3], size: 5 },
        { list: Array.from({ length: 51 }, (_, i) => i) },
      ],
      ({ list, size }) =>
        size === undefined ? chunk(list) : chunk(list, size),
    )),

    ...(await each(
      'publicXrpc',
      [
        {
          $id: 'params',
          nsid: 'app.bsky.feed.getAuthorFeed',
          params: {
            actor: 'did:plc:a',
            limit: 50,
            cursor: undefined,
            filter: 'posts_with_replies',
            includePins: false,
            skip: null,
          },
          answers: [json({ feed: [] })],
        },
        {
          $id: 'array',
          nsid: 'app.bsky.feed.getPosts',
          params: { uris: ['at://a/b/c', 'at://d/e/f?x&y'] },
          answers: [json({ posts: [] })],
        },
        {
          $id: 'no-params',
          nsid: 'app.bsky.unspecced.getConfig',
          answers: [json({ ok: true })],
        },
        {
          $id: 'unicode',
          nsid: 'app.bsky.feed.searchPosts',
          params: {
            q: 'é 😀 a+b&c=d',
            n: 2.5,
            flag: true,
            nested: [[1, 2], 'x'],
          },
          answers: [json({ posts: [] })],
        },
        {
          $id: 'appview',
          nsid: 'app.bsky.actor.getProfile',
          params: { actor: 'x' },
          appview: 'https://api.example',
          answers: [json({ did: 'did:plc:x' })],
        },
        {
          $id: 'not-found',
          nsid: 'app.bsky.feed.getPostThread',
          params: { uri: 'at://x' },
          answers: [
            json({ error: 'NotFound', message: 'Post not found: at://x' }, 400),
          ],
        },
        {
          $id: 'no-message',
          nsid: 'app.bsky.feed.getPostThread',
          params: { uri: 'at://x' },
          answers: [json({ error: 'InternalError' }, 500)],
        },
        {
          $id: 'not-json',
          nsid: 'app.bsky.feed.getPostThread',
          params: { uri: 'at://x' },
          answers: [{ status: 502, text: 'Bad Gateway' }],
        },
        {
          $id: 'odd-error-fields',
          nsid: 'x.y.z',
          answers: [json({ error: 0, message: 5 }, 400)],
        },
        { $id: 'offline', nsid: 'x.y.z', answers: ['offline'] },
      ].map((c) => ({ ...c, keys: Object.keys(c.params || {}) })),
      ({ nsid, params, appview, answers }) =>
        recordFetch(inTurn(...answers), async () => {
          try {
            return {
              body: await publicXrpc(
                nsid,
                params,
                appview ? { appview } : undefined,
              ),
            };
          } catch (e) {
            return {
              error: {
                message: e.message,
                status: e.status ?? null,
                error: e.error ?? null,
              },
            };
          }
        }),
    )),

    ...(await each(
      'getPosts',
      [
        {
          $id: 'one-chunk',
          uris: [uri(1), uri(2), uri(1), '', null, 5, uri(3)],
        },
        { $id: 'chunks', uris: Array.from({ length: 60 }, (_, i) => uri(i)) },
        {
          $id: 'chunk-fails',
          uris: Array.from({ length: 30 }, (_, i) => uri(i)),
          failFirst: true,
        },
        { $id: 'odd-posts', uris: [uri(1)], odd: true },
        { $id: 'none', uris: [] },
        { $id: 'missing', uris: null },
      ],
      ({ uris, failFirst, odd }) =>
        recordFetch(
          (req) => {
            const asked = new URL(req.url).searchParams.getAll('uris');
            if (failFirst && asked.includes(uri(0)))
              return json({ error: 'InternalError' }, 500);
            if (odd) return json({ posts: 'odd' });
            return json({
              posts: asked.filter((u) => !u.endsWith('2')).map(view),
            });
          },
          async () => {
            const { views, failed, error } = await getPosts(uris);
            return { views, failed, error: error ? error.message : null };
          },
        ),
    )),

    ...(await each(
      'resolveHandle',
      [
        {
          $id: 'handle',
          handle: 'mira.example.com',
          answers: [json({ did: 'did:plc:mira' })],
        },
        {
          $id: 'at-and-case',
          handle: '  @Mira.Example.COM ',
          answers: [json({ did: 'did:plc:mira' })],
        },
        {
          $id: 'only-one-at',
          handle: '@@mira',
          answers: [json({ did: 'did:plc:mira' })],
        },
        {
          $id: 'trim-after-at',
          handle: '@ mira ',
          answers: [json({ did: 'did:plc:mira' })],
        },
        {
          $id: 'final-sigma',
          handle: 'ΟΔΟΣ.example',
          answers: [json({ did: 'did:plc:greek' })],
        },
        { $id: 'empty', handle: '', answers: [] },
        { $id: 'just-at', handle: '@', answers: [] },
        { $id: 'not-string', handle: 5, answers: [] },
        { $id: 'no-did', handle: 'x.example', answers: [json({})] },
        {
          $id: 'did-not-string',
          handle: 'x.example',
          answers: [json({ did: 5 })],
        },
        {
          $id: 'not-found',
          handle: 'gone.example',
          answers: [
            json(
              { error: 'InvalidRequest', message: 'Unable to resolve handle' },
              400,
            ),
          ],
        },
        { $id: 'offline', handle: 'x.example', answers: ['offline'] },
      ],
      ({ handle, answers }) =>
        recordFetch(inTurn(...answers), () => resolveHandle(handle)),
    )),
  ];
}
