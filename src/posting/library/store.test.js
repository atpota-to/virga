/*
 * The library's shelf store: loads on demand, once per opening; serves a
 * stale shelf while it reads it again; keeps a failed refresh's copy;
 * pages with Load more and dedupes across pages; drops reads that land
 * after a reset; and the shelf items built from what it holds.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  STALE_MS,
  buildShelfItems,
  createLibraryStore,
  postsSource,
  remoteQueryFor,
  templateShelf,
} from './store.js';
import {
  buildTemplateContext,
  normalizeTemplateRecord,
} from '../templates/postTemplates.js';

const SELF = 'did:plc:self';
const OTHER = 'did:plc:other';
const postUri = (did, rkey) => `at://${did}/app.bsky.feed.post/${rkey}`;
const view = (uri, extra = {}) => ({
  uri,
  cid: `cid-${uri.split('/').pop()}`,
  author: { did: uri.split('/')[2], handle: 'h.example' },
  record: { text: 'x', createdAt: '2026-10-01T00:00:00Z' },
  ...extra,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeSources(overrides = {}) {
  return {
    archive: vi.fn(async () => []),
    posts: vi.fn(async () => ({
      items: [view(postUri(SELF, 'p1'))],
      cursor: null,
    })),
    replies: vi.fn(async () => ({ items: [], cursor: null })),
    saved: vi.fn(async () => ({
      items: [view(postUri(OTHER, 's1'))],
      cursor: 'next',
    })),
    links: vi.fn(async () => ({
      items: [{ url: 'https://a.example' }],
      cursor: null,
    })),
    feeds: vi.fn(async () => ({
      items: [{ uri: 'at://x/app.bsky.feed.generator/own' }],
      cursor: null,
    })),
    savedFeeds: vi.fn(async () => [
      { uri: 'at://x/app.bsky.feed.generator/own' },
      { uri: 'at://y/app.bsky.feed.generator/saved' },
    ]),
    lists: vi.fn(async () => ({ items: [], cursor: null })),
    hydrateEmbeds: vi.fn(
      async (uris) => new Map(uris.map((u) => [u, { uri: u }])),
    ),
    ...overrides,
  };
}

describe('createLibraryStore', () => {
  it('loads a shelf the first time it is asked for, and tells subscribers', async () => {
    const store = createLibraryStore();
    const sources = fakeSources();
    const heard = vi.fn();
    store.subscribe(heard);
    const open = store.nextOpen();
    store.ensure({ did: SELF, shelfId: 'saved', sources, openId: open });
    expect(store.entry(SELF, 'saved').status).toBe('loading');
    await flush();
    expect(store.entry(SELF, 'saved')).toMatchObject({
      status: 'ready',
      cursor: 'next',
    });
    expect(store.entry(SELF, 'saved').data.items).toHaveLength(1);
    expect(heard).toHaveBeenCalled();
    store.ensure({ did: SELF, shelfId: 'saved', sources, openId: open });
    await flush();
    expect(sources.saved).toHaveBeenCalledTimes(1);
  });

  it('keeps each account’s shelves apart', async () => {
    const store = createLibraryStore();
    const mine = fakeSources();
    const theirs = fakeSources({
      links: vi.fn(async () => ({
        items: [{ url: 'https://b.example' }],
        cursor: null,
      })),
    });
    store.ensure({ did: SELF, shelfId: 'links', sources: mine, openId: 1 });
    store.ensure({ did: OTHER, shelfId: 'links', sources: theirs, openId: 1 });
    await flush();
    expect(store.entry(SELF, 'links').data.items[0].url).toBe(
      'https://a.example',
    );
    expect(store.entry(OTHER, 'links').data.items[0].url).toBe(
      'https://b.example',
    );
  });

  it('reads a stale shelf again in the background on the next open, keeping what is shown', async () => {
    let t = 0;
    const store = createLibraryStore({ now: () => t });
    const gate = deferred();
    let calls = 0;
    const sources = fakeSources({
      links: vi.fn(async () => {
        calls += 1;
        if (calls === 2) await gate.promise;
        return { items: [{ url: `https://v${calls}.example` }], cursor: null };
      }),
    });
    store.ensure({ did: SELF, shelfId: 'links', sources, openId: 1 });
    await flush();
    // Fresh: a new open doesn't read it again.
    store.ensure({ did: SELF, shelfId: 'links', sources, openId: 2 });
    await flush();
    expect(sources.links).toHaveBeenCalledTimes(1);

    t = STALE_MS;
    store.ensure({ did: SELF, shelfId: 'links', sources, openId: 3 });
    expect(store.entry(SELF, 'links')).toMatchObject({
      status: 'ready',
      refreshing: true,
    });
    expect(store.entry(SELF, 'links').data.items[0].url).toBe(
      'https://v1.example',
    );
    gate.resolve();
    await flush();
    expect(store.entry(SELF, 'links')).toMatchObject({ refreshing: false });
    expect(store.entry(SELF, 'links').data.items[0].url).toBe(
      'https://v2.example',
    );
  });

  it('keeps an error until retried within an open, and tries again on the next', async () => {
    const store = createLibraryStore();
    const sources = fakeSources({
      lists: vi.fn(async () => Promise.reject(new Error('offline'))),
    });
    store.ensure({ did: SELF, shelfId: 'lists', sources, openId: 1 });
    await flush();
    expect(store.entry(SELF, 'lists')).toMatchObject({ status: 'error' });
    store.ensure({ did: SELF, shelfId: 'lists', sources, openId: 1 });
    await flush();
    expect(sources.lists).toHaveBeenCalledTimes(1);
    store.ensure({ did: SELF, shelfId: 'lists', sources, openId: 2 });
    await flush();
    expect(sources.lists).toHaveBeenCalledTimes(2);
    await store.retry({ did: SELF, shelfId: 'lists', sources });
    expect(sources.lists).toHaveBeenCalledTimes(3);
  });

  it('keeps the copy on screen when a background refresh fails', async () => {
    let t = 0;
    const store = createLibraryStore({ now: () => t });
    let fail = false;
    const sources = fakeSources({
      links: vi.fn(async () => {
        if (fail) throw new Error('offline');
        return { items: [{ url: 'https://kept.example' }], cursor: null };
      }),
    });
    store.ensure({ did: SELF, shelfId: 'links', sources, openId: 1 });
    await flush();
    fail = true;
    t = STALE_MS;
    store.ensure({ did: SELF, shelfId: 'links', sources, openId: 2 });
    await flush();
    expect(store.entry(SELF, 'links')).toMatchObject({
      status: 'ready',
      refreshing: false,
    });
    expect(store.entry(SELF, 'links').data.items[0].url).toBe(
      'https://kept.example',
    );
  });

  it('loads more, deduping, and keeps the cursor to try again after a failure', async () => {
    const store = createLibraryStore();
    let page = 0;
    const sources = fakeSources({
      saved: vi.fn(async ({ cursor } = {}) => {
        page += 1;
        if (cursor === 'c2') throw new Error('Rate limited');
        if (!cursor)
          return { items: [view(postUri(OTHER, 'a'))], cursor: 'c1' };
        return {
          items: [view(postUri(OTHER, 'a')), view(postUri(OTHER, 'b'))],
          cursor: 'c2',
        };
      }),
    });
    store.ensure({ did: SELF, shelfId: 'saved', sources, openId: 1 });
    await flush();
    await store.loadMore({ did: SELF, shelfId: 'saved', sources });
    expect(store.entry(SELF, 'saved').data.items.map((v) => v.uri)).toEqual([
      postUri(OTHER, 'a'),
      postUri(OTHER, 'b'),
    ]);
    expect(store.entry(SELF, 'saved').cursor).toBe('c2');
    await store.loadMore({ did: SELF, shelfId: 'saved', sources });
    expect(store.entry(SELF, 'saved')).toMatchObject({
      loadingMore: false,
      loadMoreError: 'Rate limited',
      cursor: 'c2',
    });
    expect(page).toBe(3);
    // The archive has no further pages.
    await store.loadMore({ did: SELF, shelfId: 'archive', sources });
    expect(sources.archive).not.toHaveBeenCalled();
  });

  it('reads feeds with the saved ones beside them', async () => {
    const store = createLibraryStore();
    const sources = fakeSources();
    store.ensure({ did: SELF, shelfId: 'feeds', sources, openId: 1 });
    await flush();
    expect(store.entry(SELF, 'feeds').data.saved).toHaveLength(2);
  });

  it('lets nothing land after a reset', async () => {
    const store = createLibraryStore();
    const gate = deferred();
    const sources = fakeSources({ links: vi.fn(() => gate.promise) });
    store.ensure({ did: SELF, shelfId: 'links', sources, openId: 1 });
    store.reset();
    gate.resolve({ items: [{ url: 'https://late.example' }], cursor: null });
    await flush();
    expect(store.entry(SELF, 'links').status).toBe('idle');
    expect(store.shelves(SELF)).toBeNull();
  });

  it('resets one account without stranding another’s reads in flight', async () => {
    const store = createLibraryStore();
    const mine = deferred();
    const theirs = deferred();
    const quoted = postUri(SELF, 'q');
    const embeds = deferred();
    const sources = fakeSources({
      links: vi.fn(() => mine.promise),
      hydrateEmbeds: vi.fn(() => embeds.promise),
    });
    const others = fakeSources({ links: vi.fn(() => theirs.promise) });
    store.ensure({ did: SELF, shelfId: 'links', sources, openId: 1 });
    const hydrating = store.hydrateTemplateEmbeds({
      did: SELF,
      sources,
      templates: [
        {
          embed: {
            $type: 'app.bsky.embed.record',
            record: { uri: quoted, cid: 'c' },
          },
        },
      ],
    });
    store.ensure({ did: OTHER, shelfId: 'links', sources: others, openId: 1 });

    store.reset(OTHER);
    mine.resolve({ items: [{ url: 'https://mine.example' }], cursor: null });
    theirs.resolve({
      items: [{ url: 'https://theirs.example' }],
      cursor: null,
    });
    embeds.resolve(new Map([[quoted, { uri: quoted }]]));
    await hydrating;
    await flush();

    expect(store.entry(SELF, 'links')).toMatchObject({
      status: 'ready',
      data: { items: [{ url: 'https://mine.example' }] },
    });
    expect(store.embeds(SELF).get(quoted)).toEqual({ uri: quoted });
    expect(store.entry(OTHER, 'links').status).toBe('idle');
    // The reset account loads again when next asked.
    store.ensure({
      did: OTHER,
      shelfId: 'links',
      sources: fakeSources(),
      openId: 2,
    });
    await flush();
    expect(store.entry(OTHER, 'links').status).toBe('ready');
  });

  it('reads what templates quote once per five minutes, keeping what a failed read had', async () => {
    let t = 0;
    const store = createLibraryStore({ now: () => t });
    const quoted = postUri(SELF, 'q');
    const templates = [
      {
        embed: {
          $type: 'app.bsky.embed.record',
          record: { uri: quoted, cid: 'c' },
        },
      },
      {
        embed: {
          $type: 'app.bsky.embed.external',
          external: { uri: 'https://a' },
        },
      },
    ];
    const sources = fakeSources();
    await store.hydrateTemplateEmbeds({ did: SELF, sources, templates });
    expect(sources.hydrateEmbeds).toHaveBeenCalledWith([quoted]);
    expect(store.embeds(SELF).get(quoted)).toEqual({ uri: quoted });
    await store.hydrateTemplateEmbeds({ did: SELF, sources, templates });
    expect(sources.hydrateEmbeds).toHaveBeenCalledTimes(1);
    t = STALE_MS;
    sources.hydrateEmbeds.mockResolvedValueOnce(new Map());
    await store.hydrateTemplateEmbeds({ did: SELF, sources, templates });
    expect(store.embeds(SELF).get(quoted)).toEqual({ uri: quoted });
  });
});

describe('buildShelfItems', () => {
  const rows = [
    {
      uri: postUri(SELF, 'a'),
      at: '2026-10-01T00:00:00Z',
      text: 'one',
      replyTo: null,
      likes: 5,
    },
    {
      uri: postUri(SELF, 'b'),
      at: '2026-10-02T00:00:00Z',
      text: 'two',
      replyTo: OTHER,
      likes: 1,
    },
  ];
  const ready = (data) => ({ status: 'ready', data });

  it('takes Your posts and Your replies from the archive, and the author feed only when it is empty', () => {
    expect(postsSource({ status: 'loading' })).toBeNull();
    expect(postsSource(ready({ items: rows }))).toBe('archive');
    expect(postsSource(ready({ items: [] }))).toBe('feed');
    expect(postsSource({ status: 'error' })).toBe('feed');

    const fromArchive = buildShelfItems(
      'posts',
      {
        archive: ready({ items: rows }),
        feed: ready({ items: [view(postUri(SELF, 'f'))] }),
      },
      { did: SELF },
    );
    expect(fromArchive.items.map((i) => i.uri)).toEqual([postUri(SELF, 'a')]);
    expect(fromArchive.total).toBe(1);
    expect(
      buildShelfItems(
        'replies',
        { archive: ready({ items: rows }) },
        { did: SELF },
      ).items.map((i) => i.uri),
    ).toEqual([postUri(SELF, 'b')]);

    const fromFeed = buildShelfItems(
      'posts',
      {
        archive: ready({ items: [] }),
        feed: ready({ items: [view(postUri(SELF, 'f'))] }),
      },
      { did: SELF },
    );
    expect(fromFeed.items.map((i) => [i.uri, i.shelf])).toEqual([
      [postUri(SELF, 'f'), 'posts'],
    ]);
    expect(fromFeed.total).toBeNull();
  });

  it('builds saved, link, feed and list items, own feeds before saved ones', () => {
    expect(
      buildShelfItems('saved', ready({ items: [view(postUri(OTHER, 's'))] }), {
        did: SELF,
      }).items[0],
    ).toMatchObject({ kind: 'post', shelf: 'saved' });
    expect(
      buildShelfItems('links', ready({ items: [{ url: 'https://a.example' }] }))
        .items[0],
    ).toMatchObject({ kind: 'link', url: 'https://a.example' });
    const feeds = buildShelfItems(
      'feeds',
      ready({
        items: [{ uri: 'at://x/app.bsky.feed.generator/own' }],
        saved: [
          { uri: 'at://x/app.bsky.feed.generator/own' },
          { uri: 'at://y/app.bsky.feed.generator/s' },
        ],
      }),
    );
    expect(feeds.items.map((i) => [i.uri, i.group])).toEqual([
      ['at://x/app.bsky.feed.generator/own', 'yours'],
      ['at://y/app.bsky.feed.generator/s', 'saved'],
    ]);
    expect(
      buildShelfItems('lists', { status: 'idle', data: null }).items,
    ).toEqual([]);
  });
});

describe('templateShelf', () => {
  const t = (rkey, value) =>
    normalizeTemplateRecord({
      uri: `at://${SELF}/net.anisota.feed.template/${rkey}`,
      cid: 'c',
      value: { text: 'x', ...value },
    });
  const context = buildTemplateContext({ self: { handle: 'me.example' } });

  it('groups what is offered here under headings, and sets the rest apart', () => {
    const shelf = templateShelf(
      [
        t('a', { name: 'Alpha', group: 'Help' }),
        t('b', { name: 'Beta' }),
        t('c', { name: 'Gamma', use: 'reply' }),
        t('d', { name: 'Delta', group: 'Help' }),
      ],
      {
        usage: { d: { count: 2 } },
        context,
        embeds: new Map(),
        replying: false,
      },
    );
    expect(
      shelf.sections.map((s) => [
        s.heading,
        s.muted,
        s.items.map((i) => i.title),
      ]),
    ).toEqual([
      ['Help', false, ['Delta', 'Alpha']],
      ['Other templates', false, ['Beta']],
      ['For replies', true, ['Gamma']],
    ]);
    expect(shelf.items.map((i) => i.title)).toEqual([
      'Delta',
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });

  it('gives each template the view of what it quotes', () => {
    const quoted = postUri(SELF, 'q');
    const embeds = new Map([
      [quoted, { uri: quoted, author: { handle: 'me.example' } }],
    ]);
    const shelf = templateShelf(
      [
        t('q', {
          name: 'Q',
          embed: {
            $type: 'app.bsky.embed.record',
            record: { uri: quoted, cid: 'c' },
          },
        }),
      ],
      { context, embeds },
    );
    expect(shelf.items[0].embedView).toEqual(embeds.get(quoted));
    expect(shelf.sections[0].heading).toBeNull();
  });
});

describe('remoteQueryFor', () => {
  it('runs for two characters or more, and never for a shortcut', () => {
    expect(remoteQueryFor(' a ')).toBe('');
    expect(remoteQueryFor(' ab ')).toBe('ab');
    expect(remoteQueryFor('/idea')).toBe('');
  });
});
