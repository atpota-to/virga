// src/posting/library/sources.js: the library's reads and lookups, as
// recorded exchanges (_fetch.js), and its pure helpers. publicXrpc, getPosts
// and resolveHandle are VirgaNetwork's (network.publicAppView). Swift:
// VirgaPosting/Library/LibrarySources.swift.
//
// Inputs from sources.test.js: the author-feed fallback, links (cards,
// facets, media, post links, reposts, dedupe, the 500-post scan), feeds and
// saved feeds, bookmarks and search through Bluesky's AppView, template
// quotes hydrated in batches, picks read again (gone, quotes off, other
// failures), pasted links of every kind, and the bound sources.

import { Agent } from '@atproto/api';
import * as S from '../../../src/posting/library/sources.js';
import { each } from './_helpers.js';
import { json, recordFetch } from './_fetch.js';
import * as M from '../../../src/posting/library/model.js';
import {
  NOW,
  OTHER,
  ROWS,
  SELF,
  linkTemplate,
  newPostContext,
  onClock,
  onClockAsync,
} from './_library.js';

export const sources = ['src/posting/library/sources.js'];

const postUri = (did, rkey) => `at://${did}/app.bsky.feed.post/${rkey}`;
// Post views the SDK's output checks accept (the signed-in reads go
// through a real Agent): a CID in its format, an indexedAt.
const CID = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const view = (uri, extra = {}) => ({
  $type: 'app.bsky.feed.defs#postView',
  uri,
  cid: CID,
  author: { did: uri.split('/')[2], handle: 'h.example' },
  record: {
    text: `text of ${uri.split('/').pop()}`,
    createdAt: '2026-10-01T00:00:00Z',
  },
  indexedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
});
const bookmark = (item) => ({
  subject: { uri: item.uri, cid: CID },
  createdAt: '2026-10-02T00:00:00.000Z',
  item,
});

/** Answers each request from `routes[nsid](params)` (cardyb by `url`). */
function route(routes) {
  return (request) => {
    const u = new URL(request.url);
    if (u.hostname === 'cardyb.bsky.app')
      return routes.cardyb
        ? routes.cardyb(u.searchParams.get('url'))
        : json({ error: 'nope' });
    const nsid = u.pathname.replace('/xrpc/', '');
    const params = {};
    for (const key of new Set(u.searchParams.keys())) {
      const all = u.searchParams.getAll(key);
      params[key] =
        all.length > 1 || key === 'uris' || key === 'feeds' ? all : all[0];
    }
    const handler = routes[nsid];
    if (!handler) return json({ error: 'MethodNotImplemented' }, 501);
    if (handler === 'offline') throw new TypeError('fetch failed');
    const out = handler(params);
    return out && typeof out.status === 'number' && 'json' in out
      ? out
      : json(out);
  };
}

/** A recorded call, with an error recorded as `{ error: { message, code, status } }`. */
const recorded = (routes, fn) =>
  recordFetch(route(routes), async () => {
    try {
      return { value: await onClockAsync(fn) };
    } catch (e) {
      return {
        error: {
          message: e.message,
          code: e.code ?? null,
          status: e.status ?? null,
        },
      };
    }
  });

const SERVICE = 'https://pds.example';
const agent = () => new Agent(SERVICE);

const cardPost = (rkey, url, createdAt, extra = {}) => ({
  post: {
    uri: postUri(SELF, rkey),
    author: { did: SELF },
    record: {
      createdAt,
      embed: {
        $type: 'app.bsky.embed.external',
        external: {
          uri: url,
          title: `Title ${rkey}`,
          description: 'About it',
          thumb: { $type: 'blob', ref: 'blobref' },
        },
      },
    },
    embed: {
      $type: 'app.bsky.embed.external#view',
      external: { uri: url, thumb: `https://images.example/${rkey}.jpg` },
    },
    ...extra,
  },
});
const facetPost = (rkey, urls, createdAt) => ({
  post: {
    uri: postUri(SELF, rkey),
    author: { did: SELF },
    record: {
      createdAt,
      facets: urls.map((uri) => ({
        features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
      })),
    },
  },
});

const gated = postUri(OTHER, 'gated');
const gate = (rules) => ({
  'app.bsky.feed.getPosts': ({ uris }) => ({
    posts: uris.map((u) => view(u)),
  }),
  'com.atproto.repo.getRecord': ({ collection, rkey }) =>
    collection === 'app.bsky.feed.postgate' && rkey === 'gated'
      ? { uri: gated, value: { embeddingRules: rules } }
      : json({ error: 'RecordNotFound' }, 400),
});
const DISABLE = [{ $type: 'app.bsky.feed.postgate#disableRule' }];

const pasteRoutes = {
  'com.atproto.identity.resolveHandle': ({ handle }) =>
    handle === 'wren.example'
      ? { did: OTHER }
      : json({ error: 'InvalidRequest' }, 400),
  'app.bsky.feed.getPosts': ({ uris }) => ({
    posts: uris.map((u) => view(u)),
  }),
  'app.bsky.feed.getFeedGenerator': ({ feed }) => ({
    view: {
      uri: feed,
      cid: 'cf',
      displayName: 'Night sky',
      creator: { handle: 'wren.example' },
    },
  }),
  'app.bsky.graph.getList': ({ list }) => ({
    list: {
      uri: list,
      cid: 'cl',
      name: 'Watchers',
      creator: { handle: 'wren.example' },
    },
  }),
  'com.atproto.repo.getRecord': () => json({ error: 'RecordNotFound' }, 400),
  cardyb: (url) =>
    url.includes('nocard')
      ? json({ error: 'Unable to generate link preview' })
      : json({
          url,
          title: url.includes('untitled') ? '' : 'A page',
          description: 'About it',
          image: 'https://img.example/x.jpg',
        }),
};

export default async function cases() {
  const rows = Object.values(ROWS).concat([
    {
      uri: postUri(SELF, 'str'),
      at: '2026-10-04T00:00:00.000Z',
      text: 'String counts',
      likes: '2',
      reposts: 1,
    },
    {
      uri: postUri(SELF, 'tie'),
      at: '2026-10-02T00:00:00.000Z',
      text: 'Tie with a1, CAFÉ',
      likes: 4,
    },
  ]);
  return [
    ...(await each(
      'readArchivePosts',
      [
        { $id: 'rows', did: SELF, rows },
        { $id: 'no-did', rows },
        { $id: 'store-fails', did: SELF, fails: true },
        { $id: 'prefix-only', did: 'did:plc:sel', rows },
      ],
      async ({ did, rows: r, fails }) => {
        const read = [];
        const out = await S.readArchivePosts(did, {
          openStore: async (d) => {
            read.push(d);
            if (fails) throw new Error('blocked');
            return { all: async (store) => (store === 'posts' ? r : []) };
          },
        });
        return { out, read };
      },
    )),

    ...(await each(
      'archiveShelf',
      [
        { $id: 'posts', rows, did: SELF },
        { $id: 'replies', rows, did: SELF, replies: true },
        { $id: 'engagement', rows, did: SELF, sort: 'engagement' },
        {
          $id: 'replies-engagement',
          rows,
          did: SELF,
          replies: true,
          sort: 'engagement',
        },
        { $id: 'query', rows, did: SELF, query: '  LINE ' },
        { $id: 'query-unicode', rows, did: SELF, query: 'café' },
        { $id: 'limit', rows, did: SELF, limit: 2 },
        { $id: 'limit-fraction', rows, did: SELF, limit: 2.7 },
        { $id: 'limit-negative', rows, did: SELF, limit: -1 },
        { $id: 'no-did', rows },
        { $id: 'none', rows: null },
        { $id: 'kolkata', rows, did: SELF, zone: 'Asia/Kolkata' },
      ],
      ({ rows: r, zone = 'UTC', ...opts }) =>
        onClock(() => S.archiveShelf(r, opts), { zone }),
    )),

    ...(await each(
      'fetchOwnPosts',
      [
        {
          $id: 'own',
          did: SELF,
          feed: [
            { post: view(postUri(SELF, 'a')) },
            { post: view(postUri(OTHER, 'x')) },
            { post: view(postUri(SELF, 'r')), reason: { $type: 'repost' } },
            {
              post: view(postUri(SELF, 'reply'), {
                record: {
                  text: 'replying',
                  reply: {
                    root: { uri: postUri(OTHER, 'root') },
                    parent: { uri: postUri(OTHER, 'root') },
                  },
                },
              }),
            },
            {
              post: view(postUri(SELF, 'self'), {
                record: {
                  text: 'thread',
                  reply: {
                    root: { uri: postUri(SELF, 'a') },
                    parent: { uri: postUri(SELF, 'a') },
                  },
                },
              }),
            },
            { post: { cid: 'no-uri' } },
            null,
          ],
        },
        { $id: 'own-replies', did: SELF, replies: true },
        { $id: 'cursor', did: SELF, cursor: 'c0', pages: 1 },
        { $id: 'reads-on', did: SELF, replies: true, pages: 6 },
        { $id: 'repeated-cursor', did: SELF, repeat: true },
        { $id: 'fails', did: SELF, fail: true },
        { $id: 'odd-feed', did: SELF, odd: true },
      ],
      ({ did, cursor, replies, feed, pages, repeat, fail, odd }) => {
        let page = 0;
        return recorded(
          {
            'app.bsky.feed.getAuthorFeed': (params) => {
              page += 1;
              if (fail)
                return json(
                  { error: 'InternalServerError', message: 'Upstream' },
                  500,
                );
              if (odd) return { feed: 'odd', cursor: 5 };
              if (feed) return { feed };
              const rest = pages ?? 4;
              return {
                feed: [
                  { post: view(postUri(SELF, `p${page}`)) },
                  { post: view(postUri(SELF, `q${page}`)) },
                ],
                cursor: repeat
                  ? params.cursor || 'same'
                  : page < rest
                    ? `after-${page}`
                    : undefined,
              };
            },
          },
          () => S.fetchOwnPosts(did, { cursor, replies }),
        );
      },
    )),

    ...(await each(
      'fetchBookmarks',
      [
        { $id: 'posts', limit: undefined },
        { $id: 'cursor', cursor: 'c1', limit: 10 },
        { $id: 'not-signed-in', noAgent: true },
        { $id: 'fails', fail: true },
      ],
      ({ cursor, limit, noAgent, fail }) =>
        recorded(
          {
            'app.bsky.bookmark.getBookmarks': () =>
              fail
                ? json({ error: 'AuthRequired', message: 'Login needed' }, 401)
                : {
                    bookmarks: [
                      bookmark(view(postUri(OTHER, 'a'))),
                      bookmark({
                        $type: 'app.bsky.feed.defs#blockedPost',
                        uri: postUri(OTHER, 'b'),
                        blocked: true,
                        author: { did: OTHER },
                      }),
                      bookmark({
                        $type: 'app.bsky.feed.defs#notFoundPost',
                        uri: postUri(OTHER, 'e'),
                        notFound: true,
                      }),
                      bookmark(view(postUri(SELF, 'own'))),
                    ],
                    cursor: cursor ? undefined : 'next',
                  },
          },
          () =>
            S.fetchBookmarks(noAgent ? null : agent(), {
              cursor,
              ...(limit === undefined ? {} : { limit }),
            }),
        ),
    )),

    ...(await each(
      'searchPosts',
      [
        { $id: 'all', query: '  moths ' },
        { $id: 'mine', query: 'moths', mine: true, handle: 'you.example' },
        { $id: 'mine-no-handle', query: 'moths', mine: true },
        { $id: 'cursor', query: 'é 😀', cursor: 'c2' },
        { $id: 'not-signed-in', query: 'x', noAgent: true },
        { $id: 'undefined-query' },
      ],
      ({ query, mine, handle, cursor, noAgent }) =>
        recorded(
          {
            'app.bsky.feed.searchPosts': ({ q }) => ({
              posts: [view(postUri(OTHER, q.length > 10 ? 'long' : 'short'))],
              cursor: 'after',
            }),
          },
          () =>
            S.searchPosts(noAgent ? undefined : agent(), query, {
              mine,
              handle,
              cursor,
            }),
        ),
    )),

    ...(await each(
      'isMediaUrl',
      [
        'https://example.com/photo.jpeg?w=1',
        'https://giphy.com/gifs/x',
        'https://example.com/article',
        'https://media.tenor.com/abc',
        'https://x.media.tenor.com/abc',
        'https://notmedia.tenor.com/abc',
        'https://pics.example/cat.PNG',
        'https://i.imgur.com/z',
        'not a url .gif',
        'not a url',
        'https://example.com/a.svg#frag',
        'https://example.com/a.webp?x',
        'HTTPS://CDN.DISCORDAPP.COM/attachments/1',
        'https://example.com/x.gif/',
        '',
        null,
        5,
        'https://İ.example/a.GİF',
      ].map((url) => ({ url })),
      ({ url }) => S.isMediaUrl(url),
    )),

    ...(await each(
      'fetchRecentLinks',
      [
        {
          $id: 'cards-and-facets',
          feed: [
            facetPost(
              'f1',
              ['https://notes.example/older'],
              '2026-09-01T00:00:00Z',
            ),
            cardPost(
              'c1',
              'https://docs.example.org/start',
              '2026-10-01T00:00:00Z',
            ),
          ],
        },
        {
          $id: 'media-posts-reposts',
          feed: [
            cardPost(
              'gif',
              'https://media.tenor.com/abc',
              '2026-10-01T00:00:00Z',
            ),
            facetPost(
              'f',
              [
                'https://pics.example/cat.PNG',
                'https://bsky.app/profile/x/post/y',
                'https://BSKY.APP/Profile/x',
                'https://notbsky.app/profile/x',
                'https://i.imgur.com/z',
              ],
              '2026-10-01T00:00:00Z',
            ),
            cardPost(
              'repost',
              'https://elsewhere.example/',
              '2026-10-01T00:00:00Z',
              {
                author: { did: OTHER },
              },
            ),
            {
              ...cardPost(
                'rp',
                'https://reposted.example/',
                '2026-10-01T00:00:00Z',
              ),
              reason: { $type: 'r' },
            },
          ],
        },
        {
          $id: 'dedupe-seen',
          cursor: 'page2',
          seen: ['https://two.example/'],
          feed: [
            cardPost('a', 'https://one.example/', '2026-10-02T00:00:00Z'),
            facetPost(
              'b',
              ['https://one.example/', 'https://two.example/'],
              '2026-10-01T00:00:00Z',
            ),
          ],
        },
        {
          $id: 'odd-shapes',
          feed: [
            {
              post: {
                uri: postUri(SELF, 'o1'),
                record: {
                  facets: [
                    {
                      features: [
                        { $type: 'app.bsky.richtext.facet#link', uri: 5 },
                      ],
                    },
                    {
                      features: [
                        {
                          $type: 'app.bsky.richtext.facet#mention',
                          did: OTHER,
                        },
                      ],
                    },
                    null,
                    {},
                  ],
                  embed: {
                    $type: 'app.bsky.embed.external',
                    external: { uri: '' },
                  },
                },
                indexedAt: '2026-08-01T00:00:00Z',
              },
            },
            {
              post: {
                uri: postUri(SELF, 'o2'),
                record: {
                  embed: {
                    $type: 'app.bsky.embed.external',
                    external: { uri: 'https://nodate.example/', title: 5 },
                  },
                },
                embed: { external: { thumb: { ref: 'x' } } },
              },
            },
            null,
          ],
        },
        {
          // A post with no uri still gives its links, without a postUri.
          $id: 'no-post-uri',
          feed: [
            {
              post: {
                record: {
                  embed: {
                    $type: 'app.bsky.embed.external',
                    external: { uri: 'https://card.example/' },
                  },
                  facets: [
                    {
                      features: [
                        {
                          $type: 'app.bsky.richtext.facet#link',
                          uri: 'https://facet.example/',
                        },
                      ],
                    },
                  ],
                  createdAt: '2026-09-01T00:00:00Z',
                },
              },
            },
          ],
        },
        { $id: 'scan-limit', pages: 'empty' },
        { $id: 'enough', pages: 'full' },
        { $id: 'empty-page', emptyWithCursor: true },
        { $id: 'fails', fail: true },
      ],
      ({ cursor, seen, feed, pages, emptyWithCursor, fail }) => {
        let page = 0;
        return recorded(
          {
            'app.bsky.feed.getAuthorFeed': () => {
              page += 1;
              if (fail) return json({ error: 'InternalServerError' }, 500);
              if (emptyWithCursor) return { feed: [], cursor: 'still' };
              if (pages === 'empty')
                return {
                  feed: Array.from({ length: 100 }, (_, i) => ({
                    post: { uri: postUri(SELF, `p${page}-${i}`) },
                  })),
                  cursor: `after-${page}`,
                };
              if (pages === 'full')
                return {
                  feed: Array.from({ length: 60 }, (_, i) =>
                    facetPost(
                      `l${i}`,
                      [`https://site.example/${i}`],
                      `2026-10-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
                    ),
                  ),
                  cursor: 'more',
                };
              return { feed };
            },
          },
          () =>
            S.fetchRecentLinks(SELF, {
              cursor,
              seen: seen ? new Set(seen) : undefined,
            }),
        );
      },
    )),

    ...(await each(
      'fetchOwnFeeds',
      [
        { $id: 'first' },
        { $id: 'cursor', cursor: 'c' },
        { $id: 'fails', fail: true },
      ],
      ({ cursor, fail }) =>
        recorded(
          {
            'app.bsky.feed.getActorFeeds': () =>
              fail
                ? json(
                    { error: 'InvalidRequest', message: 'Profile not found' },
                    400,
                  )
                : {
                    feeds: [{ uri: 'at://x/app.bsky.feed.generator/f' }],
                    cursor: 'n',
                  },
          },
          () => S.fetchOwnFeeds(SELF, { cursor }),
        ),
    )),
    ...(await each(
      'fetchOwnLists',
      [
        { $id: 'first' },
        { $id: 'cursor', cursor: 'c' },
        { $id: 'empty', empty: true },
      ],
      ({ cursor, empty }) =>
        recorded(
          {
            'app.bsky.graph.getLists': () =>
              empty ? {} : { lists: [{ uri: 'at://x/app.bsky.graph.list/l' }] },
          },
          () => S.fetchOwnLists(SELF, { cursor }),
        ),
    )),

    ...(await each(
      'savedFeedUris',
      [
        {
          preferences: [
            {
              $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
              items: [
                { type: 'feed', value: 'at://a/app.bsky.feed.generator/1' },
                { type: 'list', value: 'at://a/app.bsky.graph.list/l' },
                { type: 'timeline', value: 'following' },
                { type: 'feed', value: 5 },
                null,
                { type: 'feed', value: 'at://a/app.bsky.feed.generator/1' },
              ],
            },
            {
              $type: 'app.bsky.actor.defs#savedFeedsPref',
              pinned: [
                'at://b/app.bsky.feed.generator/2',
                'at://b/app.bsky.graph.list/x',
              ],
              saved: [
                'at://b/app.bsky.feed.generator/3',
                'at://b/app.bsky.feed.generator/2?x',
                7,
              ],
            },
            { $type: 'app.bsky.actor.defs#adultContentPref', enabled: true },
          ],
        },
        { preferences: null },
        { preferences: 'nope' },
        {
          preferences: [
            {
              $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
              items: [
                { type: 'feed', value: 'at://c/app.bsky.feed.generator/café' },
                { type: 'feed', value: 'at://c/app.bsky.feed.generator/café' },
              ],
            },
          ],
        },
      ],
      ({ preferences }) => S.savedFeedUris(preferences),
    )),

    ...(await each(
      'fetchSavedFeeds',
      [
        { $id: 'saved' },
        { $id: 'many', many: true },
        { $id: 'prefs-fail', prefsFail: true },
        { $id: 'generators-fail', genFail: true },
        { $id: 'not-signed-in', noAgent: true },
      ],
      ({ many, prefsFail, genFail, noAgent }) =>
        recorded(
          {
            'app.bsky.actor.getPreferences': () =>
              prefsFail
                ? json({ error: 'InternalServerError', message: 'Down' }, 500)
                : {
                    preferences: [
                      {
                        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
                        items: [
                          {
                            id: 'a',
                            pinned: true,
                            type: 'feed',
                            value: 'at://a/app.bsky.feed.generator/1',
                          },
                          {
                            id: 'b',
                            pinned: false,
                            type: 'list',
                            value: 'at://a/app.bsky.graph.list/l',
                          },
                          {
                            id: 'c',
                            pinned: false,
                            type: 'feed',
                            value: 'at://a/app.bsky.feed.generator/gone',
                          },
                          ...(many
                            ? Array.from({ length: 30 }, (_, i) => ({
                                id: `m${i}`,
                                pinned: false,
                                type: 'feed',
                                value: `at://m/app.bsky.feed.generator/${i}`,
                              }))
                            : []),
                        ],
                      },
                      {
                        $type: 'app.bsky.actor.defs#savedFeedsPref',
                        pinned: ['at://did:plc:pp/app.bsky.feed.generator/old'],
                        saved: [
                          'at://did:plc:pp/app.bsky.graph.list/l',
                          'at://did:plc:pp/app.bsky.feed.generator/old',
                        ],
                      },
                    ],
                  },
            'app.bsky.feed.getFeedGenerators': ({ feeds }) =>
              genFail && feeds.length < 25
                ? json({ error: 'Down' }, 502)
                : {
                    feeds: feeds
                      .filter((f) => !f.endsWith('/gone'))
                      .map((uri) => ({
                        uri,
                        displayName: uri.split('/').pop(),
                      })),
                  },
          },
          () => S.fetchSavedFeeds(noAgent ? null : agent()),
        ),
    )),

    ...(await each(
      'quotesTurnedOff',
      [
        { $id: 'disabled', uri: gated, rules: DISABLE },
        { $id: 'own', uri: gated, rules: DISABLE, selfDid: OTHER },
        { $id: 'open', uri: gated, rules: [] },
        { $id: 'other-rule', uri: gated, rules: [{ $type: 'x' }, null] },
        {
          $id: 'not-array',
          uri: gated,
          rules: { $type: 'app.bsky.feed.postgate#disableRule' },
        },
        { $id: 'no-gate', uri: postUri(OTHER, 'open'), rules: DISABLE },
        { $id: 'offline', uri: gated, offline: true },
        { $id: 'not-a-post', uri: 'at://x/app.bsky.feed.generator/f' },
        { $id: 'query', uri: `${gated}?x` },
        { $id: 'none' },
      ],
      ({ uri, rules, selfDid, offline }) =>
        recorded(
          offline ? { 'com.atproto.repo.getRecord': 'offline' } : gate(rules),
          () => S.quotesTurnedOff(uri, { selfDid }),
        ),
    )),

    ...(await each(
      'hydratePick',
      [
        {
          $id: 'archive-row',
          item: onClock(() => ({
            ...S.archiveShelf(
              [
                {
                  uri: postUri(SELF, 'a'),
                  at: '2026-10-01T00:00:00Z',
                  text: 'The whole post',
                  replyTo: OTHER,
                },
              ],
              { did: SELF, replies: true },
            ).items[0],
            reason: 'Shares “clouds”',
          })),
          selfDid: SELF,
          routes: 'full',
        },
        {
          $id: 'gone',
          item: { kind: 'post', uri: postUri(SELF, 'gone') },
          routes: 'empty',
        },
        {
          $id: 'down',
          item: { kind: 'post', uri: postUri(SELF, 'gone') },
          routes: 'down',
        },
        // What comes back as it went in is a whole item, as the shelves make them.
        { $id: 'link', item: M.itemFromLink({ url: 'https://a.example' }) },
        {
          $id: 'template',
          item: M.itemFromTemplate(linkTemplate, newPostContext),
        },
        {
          $id: 'no-uri',
          item: onClock(() => M.itemFromPost({ record: { text: 'x' } })),
        },
        {
          $id: 'gated',
          item: { kind: 'post', uri: gated, shelf: 'saved' },
          selfDid: SELF,
          routes: 'gate',
        },
        {
          $id: 'gated-own',
          item: { kind: 'post', uri: gated },
          selfDid: OTHER,
          routes: 'gate',
        },
        {
          $id: 'known-quotes-off',
          item: {
            kind: 'post',
            uri: postUri(OTHER, 'k'),
            quotesOff: true,
            reason: 'r',
          },
          selfDid: SELF,
          routes: 'gate',
        },
        {
          $id: 'feed',
          item: {
            kind: 'feed',
            uri: 'at://x/app.bsky.feed.generator/f',
            group: 'saved',
          },
          routes: 'paste',
        },
        {
          $id: 'feed-no-group',
          item: { kind: 'feed', uri: 'at://x/app.bsky.feed.generator/f' },
          routes: 'paste',
        },
        {
          $id: 'list',
          item: {
            kind: 'list',
            uri: 'at://x/app.bsky.graph.list/l',
            shelf: 'search',
          },
          routes: 'paste',
        },
        {
          $id: 'feed-gone',
          item: { kind: 'feed', uri: 'at://x/app.bsky.feed.generator/f' },
          routes: 'feedGone',
        },
        {
          $id: 'feed-down',
          item: { kind: 'feed', uri: 'at://x/app.bsky.feed.generator/f' },
          routes: 'feedDown',
        },
        {
          $id: 'list-not-found-message',
          item: { kind: 'list', uri: 'at://x/app.bsky.graph.list/l' },
          routes: 'listMessage',
        },
      ],
      ({ item, selfDid, routes }) =>
        recorded(pickRoutes(routes), () => S.hydratePick(item, { selfDid })),
    )),

    ...(await each(
      'hydrateAttachment',
      [
        {
          $id: 'list',
          attach: {
            kind: 'list',
            uri: 'at://x/app.bsky.graph.list/l',
            cid: 'old',
          },
          routes: 'paste',
        },
        {
          $id: 'whole',
          attach: { kind: 'post', uri: postUri(SELF, 'a'), cid: 'c', view: {} },
          selfDid: SELF,
          routes: 'paste',
        },
        {
          $id: 'whole-theirs',
          attach: {
            kind: 'post',
            uri: postUri(OTHER, 'open'),
            cid: 'c',
            view: { author: { did: OTHER } },
          },
          selfDid: SELF,
          routes: 'gate',
        },
        { $id: 'link', attach: { kind: 'link', url: 'https://a.example' } },
        { $id: 'no-uri', attach: { kind: 'post' } },
        {
          $id: 'gated',
          attach: { kind: 'post', uri: gated },
          selfDid: SELF,
          routes: 'gate',
        },
        {
          $id: 'viewer-says',
          attach: {
            kind: 'post',
            uri: gated,
            cid: 'c',
            view: view(gated, { viewer: { embeddingDisabled: true } }),
          },
          selfDid: SELF,
        },
        {
          $id: 'gone',
          attach: { kind: 'post', uri: postUri(SELF, 'gone'), cid: 'c' },
          routes: 'empty',
        },
        {
          $id: 'feed-gone',
          attach: { kind: 'feed', uri: 'at://x/app.bsky.feed.generator/f' },
          routes: 'feedGone',
        },
        {
          $id: 'other-kind',
          attach: {
            kind: 'starterpack',
            uri: 'at://x/app.bsky.graph.starterpack/s',
          },
        },
        // goneError's noun table is a plain object (a web bug, see
        // notes/library.md).
        ...['constructor', '__proto__', 'toString'].map((kind) => ({
          $id: `prototype-kind-${kind}`,
          attach: { kind, uri: 'at://x/y/z' },
        })),
        {
          $id: 'no-cid-view',
          attach: {
            kind: 'feed',
            uri: 'at://x/app.bsky.feed.generator/f',
            extra: 1,
          },
          routes: 'noCid',
        },
      ],
      ({ attach, selfDid, routes }) =>
        recorded(pickRoutes(routes), () =>
          S.hydrateAttachment(attach, { selfDid }),
        ),
    )),

    ...(await each(
      'hydrateEmbedViews',
      [
        {
          $id: 'batch',
          entries: [
            {
              $type: 'app.bsky.embed.record',
              record: { uri: postUri(SELF, 'a') },
            },
            {
              embed: {
                $type: 'app.bsky.embed.record',
                record: { uri: postUri(SELF, 'gone') },
              },
            },
            postUri(SELF, 'a'),
            'at://x/app.bsky.feed.generator/f',
            'at://x/app.bsky.feed.generator/gone',
            'at://x/app.bsky.graph.list/l',
            'at://x/app.bsky.graph.list/down',
            {
              $type: 'app.bsky.embed.external',
              external: { uri: 'https://a.example' },
            },
            'at://x/app.bsky.graph.starterpack/s',
            'not a uri',
            null,
            5,
          ],
        },
        {
          $id: 'chunks',
          entries: Array.from({ length: 30 }, (_, i) => postUri(SELF, `p${i}`)),
        },
        {
          $id: 'posts-fail',
          entries: [postUri(SELF, 'a'), 'at://x/app.bsky.feed.generator/f'],
          postsFail: true,
        },
        {
          $id: 'odd-posts',
          entries: [postUri(SELF, 'a'), postUri(SELF, 'b')],
          odd: true,
        },
        { $id: 'null-post', entries: [postUri(SELF, 'a')], nullPost: true },
        { $id: 'empty' },
      ],
      ({ entries, postsFail, odd, nullPost }) =>
        recorded(
          {
            'app.bsky.feed.getPosts': ({ uris }) => {
              if (postsFail) return json({ error: 'Down' }, 503);
              if (odd) return { posts: { uri: uris[0] } };
              if (nullPost) return { posts: [null] };
              return {
                posts: uris
                  .filter((u) => !u.endsWith('gone'))
                  .map((u) => view(u)),
              };
            },
            'app.bsky.feed.getFeedGenerator': ({ feed }) =>
              feed.endsWith('gone')
                ? json(
                    { error: 'InvalidRequest', message: 'could not find feed' },
                    400,
                  )
                : { view: { uri: feed, cid: 'cf' } },
            'app.bsky.graph.getList': ({ list }) =>
              list.endsWith('down')
                ? json({ error: 'Upstream' }, 502)
                : { list: { uri: list, cid: 'cl' } },
          },
          async () => S.hydrateEmbedViews(entries),
        ),
    )),

    ...(await each(
      'resolveRecordLink',
      [
        { url: `https://bsky.app/profile/${OTHER}/lists/w` },
        { url: 'https://bsky.app/profile/wren.example/post/3kq' },
        { url: `https://bsky.app/profile/${OTHER}/feed/sky` },
        { url: 'https://bsky.app/profile/nobody.example/post/3kq' },
        { url: 'https://example.com/a' },
        { url: `  at://${OTHER}/app.bsky.feed.post/p  ` },
        { url: `at://${OTHER}/app.bsky.graph.starterpack/s` },
      ],
      ({ url }) => recorded(pasteRoutes, () => S.resolveRecordLink(url)),
    )),
    ...(await each(
      'resolveExternalLink',
      [
        { url: 'https://www.docs.example/a' },
        { url: '  http://docs.example/untitled ' },
        { url: 'https://docs.example/nocard' },
        { url: 'mailto:a@b.example' },
        { url: 'not a link' },
      ],
      ({ url }) => recorded(pasteRoutes, () => S.resolveExternalLink(url)),
    )),
    ...(await each(
      'resolvePastedLink',
      [
        {
          input: 'https://bsky.app/profile/wren.example/post/3kq',
          selfDid: SELF,
        },
        { input: `https://bsky.app/profile/${OTHER}/feed/sky` },
        { input: `at://${OTHER}/app.bsky.graph.list/w` },
        { input: 'https://docs.example/a' },
        { input: 'https://docs.example/untitled' },
        { input: 'https://docs.example/nocard' },
        { input: 'https://bsky.app/profile/nobody.example/post/3kq' },
        { input: 'not a link' },
        { input: 'ftp://x.example/a' },
        { input: '   ' },
        {
          input: `https://bsky.app/profile/${OTHER}/post/gated`,
          selfDid: SELF,
          gated: true,
        },
      ],
      ({ input, selfDid, gated: g }) =>
        recorded(g ? gate(DISABLE) : pasteRoutes, () =>
          S.resolvePastedLink(input, { selfDid }),
        ),
    )),

    ...(await each(
      'librarySources',
      [
        { $id: 'search', call: 'search', handle: 'you.example' },
        { $id: 'search-no-agent', call: 'search', noAgent: true },
        { $id: 'saved', call: 'saved' },
        { $id: 'posts', call: 'posts' },
        { $id: 'replies', call: 'replies' },
        { $id: 'links', call: 'links' },
        { $id: 'feeds', call: 'feeds' },
        { $id: 'lists', call: 'lists' },
        { $id: 'savedFeeds', call: 'savedFeeds' },
        { $id: 'hydrate', call: 'hydrate' },
        { $id: 'resolveLink', call: 'resolveLink' },
      ],
      ({ call, handle, noAgent }) => {
        const asked = [];
        return recorded(
          {
            ...pasteRoutes,
            'app.bsky.feed.searchPosts': ({ q }) => ({
              posts: [view(postUri(OTHER, q.replace(/\W/g, '')))],
            }),
            'app.bsky.bookmark.getBookmarks': () => ({
              bookmarks: [bookmark(view(postUri(OTHER, 'b')))],
            }),
            'app.bsky.feed.getAuthorFeed': () => ({
              feed: [cardPost('c', 'https://c.example/', NOW)],
            }),
            'app.bsky.feed.getActorFeeds': () => ({
              feeds: [{ uri: 'at://x/app.bsky.feed.generator/f' }],
            }),
            'app.bsky.graph.getLists': () => ({
              lists: [{ uri: 'at://x/app.bsky.graph.list/l' }],
            }),
            'app.bsky.actor.getPreferences': () => ({ preferences: [] }),
          },
          async () => {
            const bound = S.librarySources({
              did: SELF,
              handle,
              agent: async (d) => {
                asked.push(d);
                return noAgent ? null : agent();
              },
            });
            const run = {
              search: () => bound.search('moths', { mine: true }),
              saved: () => bound.saved({}),
              posts: () => bound.posts({}),
              replies: () => bound.replies({}),
              links: () => bound.links({}),
              feeds: () => bound.feeds({}),
              lists: () => bound.lists({}),
              savedFeeds: () => bound.savedFeeds({}),
              hydrate: () =>
                bound.hydrate({ kind: 'post', uri: postUri(OTHER, 'h') }),
              resolveLink: () => bound.resolveLink('https://docs.example/a'),
            }[call];
            try {
              return { out: await run(), asked };
            } catch (e) {
              return { error: e.message, asked };
            }
          },
        );
      },
    )),
  ];
}

function pickRoutes(name) {
  switch (name) {
    case 'full':
      return {
        'app.bsky.feed.getPosts': ({ uris }) => ({
          posts: uris.map((u) =>
            view(u, {
              likeCount: 3,
              record: {
                text: 'The whole post, longer than the archive keeps',
                createdAt: '2026-10-01T00:00:00Z',
              },
            }),
          ),
        }),
      };
    case 'empty':
      return { 'app.bsky.feed.getPosts': () => ({ posts: [] }) };
    case 'down':
      return {
        'app.bsky.feed.getPosts': () => json({ error: 'Upstream' }, 502),
      };
    case 'gate':
      return gate(DISABLE);
    case 'paste':
      return pasteRoutes;
    case 'feedGone':
      return {
        'app.bsky.feed.getFeedGenerator': () =>
          json({ error: 'NotFound', message: 'Feed gone' }, 404),
      };
    case 'feedDown':
      return {
        'app.bsky.feed.getFeedGenerator': () =>
          json({ error: 'InternalServerError', message: 'Down' }, 500),
      };
    case 'listMessage':
      return {
        'app.bsky.graph.getList': () =>
          json({ error: 'Weird', message: 'List not  found anywhere' }, 500),
      };
    case 'noCid':
      return {
        'app.bsky.feed.getFeedGenerator': ({ feed }) => ({
          view: { uri: feed },
        }),
      };
    default:
      return {};
  }
}
