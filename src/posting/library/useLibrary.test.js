/*
 * The library hook's first render, through react-dom/server (the suite has
 * no DOM, so effects don't run here): what it shows from a store that has
 * already loaded, which is what reopening the dialog shows.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The session hook only works inside its provider, which starts signing in;
// the hook under test needs nothing from it but agentFor and the accounts.
vi.mock('../../session/useAtprotoSession.jsx', () => ({
  useAtprotoSession: () => ({
    agentFor: async () => null,
    accounts: [{ did: 'did:plc:self', handle: 'me.example' }],
  }),
}));

const { useLibrary } = await import('./useLibrary.js');
const { createLibraryStore } = await import('./store.js');
const { createTemplateService } =
  await import('../templates/templateService.js');

const SELF = 'did:plc:self';
const postUri = (rkey) => `at://${SELF}/app.bsky.feed.post/${rkey}`;
const flush = () => new Promise((r) => setTimeout(r, 0));

function render(props) {
  const seen = { current: null };
  function Probe() {
    seen.current = useLibrary(props);
    return null;
  }
  renderToString(createElement(Probe));
  return seen.current;
}

const rows = [
  {
    uri: postUri('a'),
    at: '2026-10-01T00:00:00Z',
    text: 'Clouds over the ridge',
    replyTo: null,
    likes: 9,
  },
  {
    uri: postUri('b'),
    at: '2026-10-03T00:00:00Z',
    text: 'A reply',
    replyTo: 'did:plc:other',
    likes: 1,
  },
];

function sources() {
  return {
    archive: vi.fn(async () => rows),
    posts: vi.fn(async () => ({ items: [], cursor: null })),
    replies: vi.fn(async () => ({ items: [], cursor: null })),
    saved: vi.fn(async () => ({ items: [], cursor: null })),
    links: vi.fn(async () => ({
      items: [{ url: 'https://docs.example/a', title: 'Docs' }],
      cursor: null,
    })),
    feeds: vi.fn(async () => ({ items: [], cursor: null })),
    savedFeeds: vi.fn(async () => []),
    lists: vi.fn(async () => ({ items: [], cursor: null })),
    search: vi.fn(async () => ({ items: [], cursor: null })),
    hydrateEmbeds: vi.fn(async () => new Map()),
    hydrate: vi.fn(async (item) => item),
    hydrateAttachment: vi.fn(async (attach) => ({
      ...attach,
      cid: 'fresh',
      view: { uri: attach.uri },
    })),
    resolveLink: vi.fn(async () => null),
  };
}

describe('useLibrary', () => {
  it('shows the shelves a store already holds, from the write account’s archive', async () => {
    const store = createLibraryStore();
    const src = sources();
    store.ensure({ did: SELF, shelfId: 'archive', sources: src, openId: 0 });
    store.ensure({ did: SELF, shelfId: 'links', sources: src, openId: 0 });
    await flush();

    const lib = render({ did: SELF, sources: src, store });
    expect(lib.shelves.map((s) => s.id)).toEqual([
      'templates',
      'posts',
      'replies',
      'saved',
      'links',
      'feeds',
      'lists',
      'search',
    ]);
    expect(lib.postsFrom).toBe('archive');
    expect(lib.items('posts').map((i) => i.uri)).toEqual([postUri('a')]);
    expect(lib.items('replies').map((i) => i.uri)).toEqual([postUri('b')]);
    expect(lib.items('links')[0]).toMatchObject({
      kind: 'link',
      url: 'https://docs.example/a',
    });
    expect(lib.shelves.find((s) => s.id === 'posts')).toMatchObject({
      status: 'ready',
      count: 1,
      total: 1,
    });
    expect(lib.shelves.find((s) => s.id === 'saved')).toMatchObject({
      status: 'idle',
      count: null,
    });
    expect(lib.hasMore('posts')).toBe(false);
    expect(lib.context.my.handle).toBe('me.example');
    expect(lib.suggested).toEqual({ status: 'ready', items: [] });
  });

  it('opens on "For this reply" while replying, and waits for its sources', () => {
    const lib = render({
      did: SELF,
      sources: sources(),
      store: createLibraryStore(),
      reply: {
        uri: 'at://did:plc:other/app.bsky.feed.post/p',
        cid: 'c',
        author: { handle: 'wren.example', displayName: 'Wren' },
        text: 'clouds?',
      },
    });
    expect(lib.shelves[0].id).toBe('suggested');
    expect(lib.suggested.status).toBe('loading');
    expect(lib.context.their.firstName).toBe('Wren');
  });

  it('makes a plan whose attachment is read again before it’s attached', async () => {
    const src = sources();
    const lib = render({
      did: SELF,
      sources: src,
      store: createLibraryStore(),
    });
    const plan = await lib.planFor({
      kind: 'post',
      uri: postUri('a'),
      cid: null,
      title: 'Clouds',
    });
    expect(src.hydrateAttachment).toHaveBeenCalledWith(
      { kind: 'post', uri: postUri('a'), cid: null },
      { signal: undefined },
    );
    expect(plan.attach).toEqual({
      kind: 'post',
      uri: postUri('a'),
      cid: 'fresh',
      view: { uri: postUri('a') },
    });
  });

  it('reads nothing without an account', () => {
    const lib = render({ did: null, store: createLibraryStore() });
    expect(lib.items('posts')).toEqual([]);
    expect(lib.shelves.find((s) => s.id === 'templates').status).toBe('idle');
    expect(
      createTemplateService({ store: null, target: null }).list(null),
    ).toEqual([]);
  });
});
