/*
 * The library's reads, against a fake AppView and fake agents: which calls
 * each makes and the shapes it hands back. The archive is read, never
 * written; the author-feed fallback splits posts from replies; link
 * thumbnails come from the view; media and post links are filtered; links
 * dedupe across pages; saved feeds keep feeds only; bookmarks and search go
 * to Bluesky's AppView; template quotes hydrate in batches and tell "gone"
 * from "couldn't read"; a pick is read again before it's attached.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  archiveShelf,
  fetchBookmarks,
  fetchOwnFeeds,
  fetchOwnLists,
  fetchOwnPosts,
  fetchRecentLinks,
  fetchSavedFeeds,
  getPosts,
  hydrateAttachment,
  hydrateEmbedViews,
  hydratePick,
  isMediaUrl,
  librarySources,
  publicXrpc,
  readArchivePosts,
  resolveExternalLink,
  quotesTurnedOff,
  resolvePastedLink,
  resolveRecordLink,
  savedFeedUris,
  searchPosts,
} from './sources.js';
import { itemFromArchiveRow } from './model.js';

const SELF = 'did:plc:self';
const OTHER = 'did:plc:other';
const postUri = (did, rkey) => `at://${did}/app.bsky.feed.post/${rkey}`;
const view = (uri, extra = {}) => ({
  $type: 'app.bsky.feed.defs#postView',
  uri,
  cid: `cid-${uri.split('/').pop()}`,
  author: { did: uri.split('/')[2], handle: 'h.example' },
  record: {
    text: `text of ${uri.split('/').pop()}`,
    createdAt: '2026-10-01T00:00:00Z',
  },
  ...extra,
});

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A fetch answering public XRPC reads from `routes[nsid](params)`. */
function fakeFetch(routes = {}) {
  const calls = [];
  const fetch = vi.fn(async (url) => {
    const u = new URL(url);
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
    calls.push({ nsid, params, host: u.origin });
    const route = routes[nsid];
    if (!route) return json({ error: 'MethodNotImplemented' }, 501);
    const out = await route(params);
    return out && typeof out.ok === 'boolean' ? out : json(out);
  });
  return { fetch, calls };
}

describe('publicXrpc', () => {
  it('asks the public AppView, repeating array params, and says why a read failed', async () => {
    const { fetch, calls } = fakeFetch({
      'app.bsky.feed.getPosts': ({ uris }) => ({
        posts: uris.map((u) => view(u)),
      }),
      'app.bsky.graph.getList': () =>
        json({ error: 'NotFound', message: 'List not found' }, 400),
    });
    const body = await publicXrpc(
      'app.bsky.feed.getPosts',
      {
        uris: ['at://a/app.bsky.feed.post/1', 'at://a/app.bsky.feed.post/2'],
        skip: undefined,
      },
      { fetch },
    );
    expect(body.posts).toHaveLength(2);
    expect(calls[0].host).toBe('https://public.api.bsky.app');
    const error = await publicXrpc(
      'app.bsky.graph.getList',
      { list: 'x' },
      { fetch },
    ).catch((e) => e);
    expect(error).toMatchObject({
      status: 400,
      error: 'NotFound',
      message: 'List not found',
    });
  });
});

describe('getPosts', () => {
  it('reads in chunks of 25 and counts the ones a failed chunk held', async () => {
    let n = 0;
    const { fetch } = fakeFetch({
      'app.bsky.feed.getPosts': ({ uris }) => {
        n += 1;
        if (n === 2) return json({ error: 'Upstream' }, 502);
        return { posts: uris.map((u) => view(u)) };
      },
    });
    const uris = Array.from({ length: 30 }, (_, i) => postUri(SELF, `p${i}`));
    const out = await getPosts([...uris, uris[0]], { fetch });
    expect(out.views).toHaveLength(25);
    expect(out.failed).toBe(5);
    expect(out.error.status).toBe(502);
  });
});

describe('the archive', () => {
  const rows = [
    {
      uri: postUri(SELF, 'a'),
      at: '2026-10-01T00:00:00Z',
      text: 'Clouds over the ridge',
      replyTo: null,
      likes: 9,
      reposts: 0,
      replies: 0,
      quotes: 0,
    },
    {
      uri: postUri(SELF, 'b'),
      at: '2026-10-03T00:00:00Z',
      text: 'More on clouds',
      replyTo: SELF,
      likes: 1,
      reposts: 0,
      replies: 0,
      quotes: 0,
    },
    {
      uri: postUri(SELF, 'c'),
      at: '2026-10-02T00:00:00Z',
      text: 'Agreed!',
      replyTo: OTHER,
      likes: 2,
      reposts: 0,
      replies: 0,
      quotes: 0,
    },
    // Rows of another repo never belong here.
    {
      uri: postUri(OTHER, 'x'),
      at: '2026-10-04T00:00:00Z',
      text: 'not mine',
      replyTo: null,
    },
  ];

  it('is read from the write account’s own store, and only read', async () => {
    const store = {
      all: vi.fn(async () => rows),
      putAll: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    };
    const openStore = vi.fn(async () => store);
    const out = await readArchivePosts(SELF, { openStore });
    expect(openStore).toHaveBeenCalledWith(SELF);
    expect(store.all).toHaveBeenCalledWith('posts');
    expect(out.map((r) => r.uri)).toEqual([
      postUri(SELF, 'a'),
      postUri(SELF, 'b'),
      postUri(SELF, 'c'),
    ]);
    expect(store.putAll).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(
      await readArchivePosts(SELF, {
        openStore: async () => {
          throw new Error('no idb');
        },
      }),
    ).toEqual([]);
  });

  it('makes Your posts and Your replies, sorted by date or engagement, and searchable', () => {
    const own = rows.slice(0, 3);
    const posts = archiveShelf(own, { did: SELF });
    expect(posts.items.map((i) => i.uri)).toEqual([
      postUri(SELF, 'b'),
      postUri(SELF, 'a'),
    ]);
    expect(posts.total).toBe(2);
    expect(
      archiveShelf(own, { did: SELF, sort: 'engagement' }).items.map(
        (i) => i.uri,
      ),
    ).toEqual([postUri(SELF, 'a'), postUri(SELF, 'b')]);
    expect(
      archiveShelf(own, { did: SELF, replies: true }).items.map((i) => i.uri),
    ).toEqual([postUri(SELF, 'c')]);
    expect(
      archiveShelf(own, { did: SELF, query: 'RIDGE' }).items.map((i) => i.uri),
    ).toEqual([postUri(SELF, 'a')]);
    const cut = archiveShelf(own, { did: SELF, limit: 1 });
    expect(cut.items).toHaveLength(1);
    expect(cut.total).toBe(2);
    expect(cut.items[0]).toMatchObject({
      kind: 'post',
      shelf: 'posts',
      cid: null,
    });
  });
});

describe('fetchOwnPosts', () => {
  it('reads the public author feed, keeping the account’s own posts, without reposts', async () => {
    const own = view(postUri(SELF, 'own'));
    const selfReply = view(postUri(SELF, 'cont'), {
      record: {
        text: 'more',
        reply: {
          root: { uri: postUri(SELF, 'own') },
          parent: { uri: postUri(SELF, 'own') },
        },
      },
    });
    const reply = view(postUri(SELF, 'r'), {
      record: {
        text: 'reply',
        reply: {
          root: { uri: postUri(OTHER, 'p') },
          parent: { uri: postUri(OTHER, 'p') },
        },
      },
    });
    const repost = {
      post: view(postUri(OTHER, 'rp')),
      reason: { $type: 'app.bsky.feed.defs#reasonRepost' },
    };
    const { fetch, calls } = fakeFetch({
      'app.bsky.feed.getAuthorFeed': () => ({
        feed: [{ post: own }, { post: selfReply }, { post: reply }, repost],
      }),
    });
    const posts = await fetchOwnPosts(SELF, { fetch });
    expect(calls[0].params).toEqual({
      actor: SELF,
      limit: '50',
      filter: 'posts_with_replies',
    });
    expect(posts.items.map((p) => p.uri)).toEqual([own.uri, selfReply.uri]);
    const replies = await fetchOwnPosts(SELF, { fetch, replies: true });
    expect(replies.items.map((p) => p.uri)).toEqual([reply.uri]);
  });

  it('reads on for a shelf a page holds none of, up to four pages, and stops on a repeated cursor', async () => {
    let page = 0;
    const { fetch, calls } = fakeFetch({
      'app.bsky.feed.getAuthorFeed': () => {
        page += 1;
        return {
          feed: [{ post: view(postUri(SELF, `p${page}`)) }],
          cursor: `c${page}`,
        };
      },
    });
    const out = await fetchOwnPosts(SELF, { fetch, replies: true });
    expect(calls).toHaveLength(4);
    expect(out).toEqual({ items: [], cursor: 'c4' });

    const { fetch: stuck, calls: stuckCalls } = fakeFetch({
      'app.bsky.feed.getAuthorFeed': () => ({ feed: [], cursor: 'same' }),
    });
    await fetchOwnPosts(SELF, { fetch: stuck, cursor: 'same' });
    expect(stuckCalls).toHaveLength(1);
  });
});

describe('fetchRecentLinks', () => {
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

  it('takes card links with the view’s thumbnail and bare facet links, newest first', async () => {
    const { fetch, calls } = fakeFetch({
      'app.bsky.feed.getAuthorFeed': () => ({
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
      }),
    });
    const out = await fetchRecentLinks(SELF, { fetch });
    expect(calls[0].params).toEqual({ actor: SELF, limit: '100' });
    expect(out.items).toEqual([
      {
        url: 'https://docs.example.org/start',
        title: 'Title c1',
        description: 'About it',
        image: 'https://images.example/c1.jpg',
        postUri: postUri(SELF, 'c1'),
        createdAt: '2026-10-01T00:00:00Z',
      },
      {
        url: 'https://notes.example/older',
        title: 'https://notes.example/older',
        description: '',
        image: null,
        postUri: postUri(SELF, 'f1'),
        createdAt: '2026-09-01T00:00:00Z',
      },
    ]);
    expect(out.cursor).toBe(null);
  });

  it('leaves out media, post links and reposts', async () => {
    const { fetch } = fakeFetch({
      'app.bsky.feed.getAuthorFeed': () => ({
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
              'https://i.imgur.com/z',
            ],
            '2026-10-01T00:00:00Z',
          ),
          cardPost(
            'repost',
            'https://elsewhere.example/',
            '2026-10-01T00:00:00Z',
            { author: { did: OTHER } },
          ),
        ],
      }),
    });
    expect((await fetchRecentLinks(SELF, { fetch })).items).toEqual([]);
    expect(isMediaUrl('https://example.com/photo.jpeg?w=1')).toBe(true);
    expect(isMediaUrl('https://giphy.com/gifs/x')).toBe(true);
    expect(isMediaUrl('https://example.com/article')).toBe(false);
  });

  it('dedupes within a call and against links already shown', async () => {
    const { fetch, calls } = fakeFetch({
      'app.bsky.feed.getAuthorFeed': () => ({
        feed: [
          cardPost('a', 'https://one.example/', '2026-10-02T00:00:00Z'),
          facetPost(
            'b',
            ['https://one.example/', 'https://two.example/'],
            '2026-10-01T00:00:00Z',
          ),
        ],
      }),
    });
    const out = await fetchRecentLinks(SELF, {
      fetch,
      cursor: 'page2',
      seen: new Set(['https://two.example/']),
    });
    expect(calls[0].params).toEqual({
      actor: SELF,
      limit: '100',
      cursor: 'page2',
    });
    expect(out.items.map((l) => l.url)).toEqual(['https://one.example/']);
  });

  it('scans at most 500 posts and stops once a page brings it to 50 links', async () => {
    let page = 0;
    const { fetch, calls } = fakeFetch({
      'app.bsky.feed.getAuthorFeed': () => {
        page += 1;
        const feed = Array.from({ length: 100 }, (_, i) => ({
          post: {
            uri: postUri(SELF, `p${page}-${i}`),
            author: { did: SELF },
            record: { text: 'no links' },
          },
        }));
        return { feed, cursor: `after-${page}` };
      },
    });
    const scanned = await fetchRecentLinks(SELF, { fetch });
    expect(calls).toHaveLength(5);
    expect(scanned.cursor).toBe('after-5');

    const { fetch: full, calls: fullCalls } = fakeFetch({
      'app.bsky.feed.getAuthorFeed': () => ({
        feed: Array.from({ length: 60 }, (_, i) =>
          facetPost(
            `l${i}`,
            [`https://site.example/${i}`],
            '2026-10-01T00:00:00Z',
          ),
        ),
        cursor: 'more',
      }),
    });
    const many = await fetchRecentLinks(SELF, { fetch: full });
    expect(fullCalls).toHaveLength(1);
    expect(many.items).toHaveLength(60);
    expect(many.cursor).toBe('more');
  });
});

describe('feeds and lists', () => {
  it('reads the account’s own feeds and lists from the public AppView', async () => {
    const { fetch, calls } = fakeFetch({
      'app.bsky.feed.getActorFeeds': () => ({
        feeds: [{ uri: 'at://x/app.bsky.feed.generator/f' }],
        cursor: 'n',
      }),
      'app.bsky.graph.getLists': () => ({
        lists: [{ uri: 'at://x/app.bsky.graph.list/l' }],
      }),
    });
    expect(await fetchOwnFeeds(SELF, { fetch })).toEqual({
      items: [{ uri: 'at://x/app.bsky.feed.generator/f' }],
      cursor: 'n',
    });
    expect(await fetchOwnLists(SELF, { fetch, cursor: 'c' })).toEqual({
      items: [{ uri: 'at://x/app.bsky.graph.list/l' }],
      cursor: null,
    });
    expect(calls.map((c) => c.params)).toEqual([
      { actor: SELF, limit: '50' },
      { actor: SELF, limit: '50', cursor: 'c' },
    ]);
  });

  it('keeps saved feeds only, in saved order, drops ones that can’t be read, and throws when preferences can’t be', async () => {
    const a = 'at://x/app.bsky.feed.generator/a';
    const b = 'at://x/app.bsky.feed.generator/b';
    const gone = 'at://x/app.bsky.feed.generator/gone';
    const agent = {
      app: {
        bsky: {
          actor: {
            getPreferences: vi.fn(async () => ({
              data: {
                preferences: [
                  {
                    $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
                    items: [
                      { type: 'timeline', value: 'following' },
                      { type: 'feed', value: b },
                      { type: 'list', value: 'at://x/app.bsky.graph.list/l' },
                      { type: 'feed', value: gone },
                      { type: 'feed', value: a },
                    ],
                  },
                ],
              },
            })),
          },
        },
      },
    };
    const { fetch, calls } = fakeFetch({
      'app.bsky.feed.getFeedGenerators': ({ feeds }) => ({
        feeds: feeds.filter((f) => f !== gone).map((uri) => ({ uri })),
      }),
    });
    expect((await fetchSavedFeeds(agent, { fetch })).map((f) => f.uri)).toEqual(
      [b, a],
    );
    expect(calls[0].params.feeds).toEqual([b, gone, a]);

    agent.app.bsky.actor.getPreferences.mockRejectedValueOnce(
      new Error('offline'),
    );
    await expect(fetchSavedFeeds(agent, { fetch })).rejects.toThrow('offline');
    expect(
      savedFeedUris([
        {
          $type: 'app.bsky.actor.defs#savedFeedsPref',
          pinned: [a],
          saved: [a, 'at://x/app.bsky.graph.list/l', b],
        },
      ]),
    ).toEqual([a, b]);
  });
});

describe('signed-in reads', () => {
  function agentWith(handlers) {
    const proxied = { app: { bsky: handlers } };
    return { proxied, agent: { did: SELF, withProxy: vi.fn(() => proxied) } };
  }

  it('reads bookmarks from Bluesky’s AppView, keeping posts it can show', async () => {
    const getBookmarks = vi.fn(async () => ({
      data: {
        bookmarks: [
          {
            subject: { uri: postUri(OTHER, '1') },
            item: view(postUri(OTHER, '1')),
          },
          {
            subject: { uri: postUri(OTHER, '2') },
            item: {
              $type: 'app.bsky.feed.defs#notFoundPost',
              uri: postUri(OTHER, '2'),
              notFound: true,
            },
          },
          {
            subject: { uri: postUri(OTHER, '3') },
            item: {
              $type: 'app.bsky.feed.defs#blockedPost',
              uri: postUri(OTHER, '3'),
              blocked: true,
            },
          },
        ],
        cursor: 'next',
      },
    }));
    const { agent } = agentWith({ bookmark: { getBookmarks } });
    const out = await fetchBookmarks(agent, { cursor: 'c' });
    expect(agent.withProxy).toHaveBeenCalledWith(
      'bsky_appview',
      'did:web:api.bsky.app',
    );
    expect(getBookmarks.mock.calls[0][0]).toEqual({ limit: 50, cursor: 'c' });
    expect(out.items.map((p) => p.uri)).toEqual([postUri(OTHER, '1')]);
    expect(out.cursor).toBe('next');
  });

  it('searches posts, all of Bluesky or only the account’s', async () => {
    const searchPostsCall = vi.fn(async () => ({
      data: { posts: [view(postUri(OTHER, 's'))], cursor: 'n' },
    }));
    const { agent } = agentWith({ feed: { searchPosts: searchPostsCall } });
    expect((await searchPosts(agent, ' clouds ')).items).toHaveLength(1);
    expect(searchPostsCall.mock.calls[0][0]).toEqual({
      q: 'clouds',
      limit: 25,
    });
    await searchPosts(agent, 'clouds', {
      mine: true,
      handle: 'me.example',
      cursor: 'x',
    });
    expect(searchPostsCall.mock.calls[1][0]).toEqual({
      q: 'from:me.example clouds',
      limit: 25,
      cursor: 'x',
    });
    await searchPosts(agent, 'clouds', { mine: true });
    expect(searchPostsCall.mock.calls[2][0].q).toBe('from:me clouds');
  });
});

describe('hydrateEmbedViews', () => {
  const record = (uri) => ({
    $type: 'app.bsky.embed.record',
    record: { uri, cid: 'c' },
  });

  it('batches posts, reads feeds and lists, and marks what is gone', async () => {
    const kept = postUri(SELF, 'kept');
    const deleted = postUri(SELF, 'deleted');
    const feed = 'at://x/app.bsky.feed.generator/f';
    const goneFeed = 'at://x/app.bsky.feed.generator/gone';
    const list = 'at://x/app.bsky.graph.list/l';
    const { fetch, calls } = fakeFetch({
      'app.bsky.feed.getPosts': ({ uris }) => ({
        posts: uris.filter((u) => u === kept).map((u) => view(u)),
      }),
      'app.bsky.feed.getFeedGenerator': ({ feed: f }) =>
        f.endsWith('gone')
          ? json(
              { error: 'InvalidRequest', message: 'could not find feed' },
              400,
            )
          : { view: { uri: f } },
      'app.bsky.graph.getList': ({ list: l }) => ({ list: { uri: l } }),
    });
    const out = await hydrateEmbedViews(
      [
        record(kept),
        { embed: record(deleted) },
        record(kept),
        feed,
        record(goneFeed),
        record(list),
        {
          $type: 'app.bsky.embed.external',
          external: { uri: 'https://a.example' },
        },
      ],
      { fetch },
    );
    expect(
      calls.filter((c) => c.nsid === 'app.bsky.feed.getPosts'),
    ).toHaveLength(1);
    expect(
      calls.find((c) => c.nsid === 'app.bsky.feed.getPosts').params.uris,
    ).toEqual([kept, deleted]);
    expect(
      calls.find((c) => c.nsid === 'app.bsky.graph.getList').params,
    ).toEqual({ list, limit: '1' });
    expect(out.get(kept).uri).toBe(kept);
    expect(out.get(deleted)).toBe('missing');
    expect(out.get(feed)).toEqual({ uri: feed });
    expect(out.get(goneFeed)).toBe('missing');
    expect(out.get(list)).toEqual({ uri: list });
    expect(out.size).toBe(5);
  });

  it('leaves out what couldn’t be read, so a blip never reads as gone', async () => {
    const { fetch } = fakeFetch({
      'app.bsky.feed.getPosts': () => json({ error: 'Upstream' }, 502),
      'app.bsky.graph.getList': () => json({ error: 'Upstream' }, 502),
    });
    const out = await hydrateEmbedViews(
      [record(postUri(SELF, 'p')), record('at://x/app.bsky.graph.list/l')],
      { fetch },
    );
    expect(out.size).toBe(0);
  });

  it('splits more than 25 posts into chunks', async () => {
    const { fetch, calls } = fakeFetch({
      'app.bsky.feed.getPosts': ({ uris }) => ({
        posts: uris.map((u) => view(u)),
      }),
    });
    const out = await hydrateEmbedViews(
      Array.from({ length: 30 }, (_, i) => postUri(SELF, `p${i}`)),
      { fetch },
    );
    expect(calls).toHaveLength(2);
    expect(out.size).toBe(30);
  });
});

describe('reading a pick again', () => {
  it('fills in an archive post’s cid, full text and counts, keeping its shelf and reason', async () => {
    const uri = postUri(SELF, 'a');
    const full = view(uri, {
      likeCount: 3,
      record: {
        text: 'The whole post, longer than the archive keeps',
        createdAt: '2026-10-01T00:00:00Z',
      },
    });
    const { fetch } = fakeFetch({
      'app.bsky.feed.getPosts': () => ({ posts: [full] }),
    });
    const row = itemFromArchiveRow(
      {
        uri,
        at: '2026-10-01T00:00:00Z',
        text: 'The whole post',
        replyTo: OTHER,
      },
      { selfDid: SELF },
    );
    const out = await hydratePick(
      { ...row, reason: 'Shares “clouds”' },
      { selfDid: SELF, fetch },
    );
    expect(out).toMatchObject({
      uri,
      cid: full.cid,
      view: full,
      shelf: 'replies',
      reason: 'Shares “clouds”',
      title: 'The whole post, longer than the archive keeps',
      score: 3,
    });
  });

  it('says a pick that is gone is gone, and passes other failures on', async () => {
    const uri = postUri(SELF, 'gone');
    const { fetch } = fakeFetch({
      'app.bsky.feed.getPosts': () => ({ posts: [] }),
    });
    await expect(
      hydratePick({ kind: 'post', uri }, { fetch }),
    ).rejects.toMatchObject({ code: 'GONE' });
    const { fetch: down } = fakeFetch({
      'app.bsky.feed.getPosts': () => json({ error: 'Upstream' }, 502),
    });
    await expect(
      hydratePick({ kind: 'post', uri }, { fetch: down }),
    ).rejects.toMatchObject({ status: 502 });
    expect(
      await hydratePick({ kind: 'link', url: 'https://a.example' }),
    ).toEqual({ kind: 'link', url: 'https://a.example' });
  });

  it('fills a plan’s attachment, and leaves one that is whole', async () => {
    const list = 'at://x/app.bsky.graph.list/l';
    const { fetch, calls } = fakeFetch({
      'app.bsky.graph.getList': () => ({
        list: { uri: list, cid: 'cl', name: 'L' },
      }),
    });
    expect(
      await hydrateAttachment(
        { kind: 'list', uri: list, cid: 'old' },
        { fetch },
      ),
    ).toEqual({
      kind: 'list',
      uri: list,
      cid: 'cl',
      view: { uri: list, cid: 'cl', name: 'L' },
    });
    const whole = { kind: 'post', uri: postUri(SELF, 'a'), cid: 'c', view: {} };
    expect(await hydrateAttachment(whole, { selfDid: SELF, fetch })).toBe(whole);
    expect(
      await hydrateAttachment(
        { kind: 'link', url: 'https://a.example' },
        { fetch },
      ),
    ).toEqual({ kind: 'link', url: 'https://a.example' });
    expect(calls).toHaveLength(1);
  });

  describe('a post its author doesn’t allow quotes of', () => {
    const uri = postUri(OTHER, 'gated');
    const gate = (rules) => ({
      'app.bsky.feed.getPosts': ({ uris }) => ({ posts: uris.map((u) => view(u)) }),
      'com.atproto.repo.getRecord': ({ collection, rkey }) =>
        collection === 'app.bsky.feed.postgate' && rkey === 'gated'
          ? { uri, value: { embeddingRules: rules } }
          : json({ error: 'RecordNotFound' }, 400),
    });

    it('reads the postgate, since the public read has no viewer state', async () => {
      const { fetch } = fakeFetch(gate([{ $type: 'app.bsky.feed.postgate#disableRule' }]));
      expect(await quotesTurnedOff(uri, { fetch })).toBe(true);
      expect(await quotesTurnedOff(uri, { selfDid: OTHER, fetch })).toBe(false);
      const { fetch: open } = fakeFetch(gate([]));
      expect(await quotesTurnedOff(uri, { fetch: open })).toBe(false);
      const { fetch: none } = fakeFetch({});
      expect(await quotesTurnedOff(uri, { fetch: none })).toBe(false);
    });

    it('is shown marked, and refused when it would be attached', async () => {
      const { fetch } = fakeFetch(gate([{ $type: 'app.bsky.feed.postgate#disableRule' }]));
      const shown = await hydratePick({ kind: 'post', uri, shelf: 'saved' }, { selfDid: SELF, fetch });
      expect(shown).toMatchObject({ quotesOff: true, view: { uri } });
      expect(shown.label).toMatch(/quotes off$/);
      await expect(
        hydrateAttachment({ kind: 'post', uri }, { selfDid: SELF, fetch }),
      ).rejects.toMatchObject({ code: 'QUOTES_OFF', message: 'That post’s author doesn’t allow quotes.' });
      // A signed-in view that already says so is refused without asking.
      const { fetch: quiet, calls } = fakeFetch({});
      await expect(
        hydrateAttachment(
          { kind: 'post', uri, cid: 'c', view: view(uri, { viewer: { embeddingDisabled: true } }) },
          { selfDid: SELF, fetch: quiet },
        ),
      ).rejects.toMatchObject({ code: 'QUOTES_OFF' });
      expect(calls).toHaveLength(0);
    });

    it('is marked when pasted as a link', async () => {
      const { fetch } = fakeFetch(gate([{ $type: 'app.bsky.feed.postgate#disableRule' }]));
      const item = await resolvePastedLink(`https://bsky.app/profile/${OTHER}/post/gated`, { selfDid: SELF, fetch });
      expect(item).toMatchObject({ kind: 'post', quotesOff: true });
    });
  });
});

describe('pasted links', () => {
  const routes = {
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
    cardyb: (url) =>
      json({
        url,
        title: 'A page',
        description: 'About it',
        image: 'https://img.example/x.jpg',
      }),
  };

  it('turns a post, feed or list link into an item to pick, resolving a handle', async () => {
    const { fetch } = fakeFetch(routes);
    const post = await resolvePastedLink(
      'https://bsky.app/profile/wren.example/post/3kq',
      { selfDid: SELF, fetch },
    );
    expect(post).toMatchObject({
      kind: 'post',
      uri: postUri(OTHER, '3kq'),
      cid: 'cid-3kq',
      label: expect.stringMatching(/^Post by @h\.example · /),
    });
    const feed = await resolvePastedLink(
      `https://bsky.app/profile/${OTHER}/feed/sky`,
      { fetch },
    );
    expect(feed).toMatchObject({
      kind: 'feed',
      uri: `at://${OTHER}/app.bsky.feed.generator/sky`,
      cid: 'cf',
    });
    const list = await resolvePastedLink(
      `at://${OTHER}/app.bsky.graph.list/w`,
      { fetch },
    );
    expect(list).toMatchObject({ kind: 'list', cid: 'cl', title: 'Watchers' });
  });

  it('turns any other web link into a link card, and gives up on what can’t be read', async () => {
    const { fetch } = fakeFetch(routes);
    expect(
      await resolvePastedLink('https://docs.example/a', { fetch }),
    ).toMatchObject({
      kind: 'link',
      url: 'https://docs.example/a',
      title: 'A page',
    });
    expect(
      await resolvePastedLink(
        'https://bsky.app/profile/nobody.example/post/3kq',
        { fetch },
      ),
    ).toBeNull();
    expect(await resolvePastedLink('not a link', { fetch })).toBeNull();
    expect(await resolvePastedLink('ftp://x.example/a', { fetch })).toBeNull();
  });

  it('makes template embeds of a record link and of a page', async () => {
    const { fetch } = fakeFetch(routes);
    expect(
      await resolveRecordLink(`https://bsky.app/profile/${OTHER}/lists/w`, {
        fetch,
      }),
    ).toMatchObject({
      embed: {
        $type: 'app.bsky.embed.record',
        record: { uri: `at://${OTHER}/app.bsky.graph.list/w`, cid: 'cl' },
      },
      title: 'Watchers',
      by: 'List by @wren.example',
    });
    expect(
      await resolveExternalLink('https://www.docs.example/a', { fetch }),
    ).toEqual({
      embed: {
        $type: 'app.bsky.embed.external',
        external: {
          uri: 'https://www.docs.example/a',
          title: 'A page',
          description: 'About it',
        },
      },
      title: 'A page',
      by: 'docs.example',
    });
    expect(
      await resolveExternalLink('mailto:a@b.example', { fetch }),
    ).toBeNull();
  });
});

describe('librarySources', () => {
  it('binds the reads to the account it writes as, signing in only for what needs it', async () => {
    const { fetch, calls } = fakeFetch({
      'app.bsky.feed.getActorFeeds': () => ({ feeds: [] }),
    });
    const agentFor = vi.fn(async () => ({
      withProxy: () => ({
        app: {
          bsky: {
            bookmark: {
              getBookmarks: async () => ({ data: { bookmarks: [] } }),
            },
          },
        },
      }),
    }));
    const sources = librarySources({
      did: SELF,
      agent: agentFor,
      fetch,
      openStore: async () => ({ all: async () => [] }),
    });
    await sources.feeds();
    expect(calls[0].params.actor).toBe(SELF);
    expect(agentFor).not.toHaveBeenCalled();
    await sources.saved();
    expect(agentFor).toHaveBeenCalledWith(SELF);
    expect(await sources.archive()).toEqual([]);
  });
});
