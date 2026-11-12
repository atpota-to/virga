import { describe, expect, it, vi } from 'vitest';
import { STYLE_SAMPLE_SIZES, normalizeStyleSampleSize } from './setup.js';
import {
  MIN_STYLE_POSTS,
  extractStyleTexts,
  fetchStylePostTexts,
  forgetStyleProfile,
  learnWritingStyle,
  styleProfileFrom,
  synthesizeStyleFromTexts,
} from './style.js';

// A repost slipping through would teach the style reading someone else's
// voice, invisibly (the reading still sounds plausible), so the filter rules
// are pinned here.

const ME = 'did:plc:me';

const entry = ({ did = ME, text = 'hello', reason = null } = {}) => ({
  ...(reason ? { reason } : {}),
  post: { author: { did }, record: { text } },
});

describe('extractStyleTexts', () => {
  it('keeps the author’s own posts, trimmed, in feed order', () => {
    const feed = [entry({ text: ' newest ' }), entry({ text: 'older' })];
    expect(extractStyleTexts(feed, ME)).toEqual(['newest', 'older']);
  });

  it('drops reposts: someone else’s words are someone else’s style', () => {
    const feed = [
      entry({ text: 'mine' }),
      entry({
        text: 'not mine',
        reason: { $type: 'app.bsky.feed.defs#reasonRepost' },
      }),
    ];
    expect(extractStyleTexts(feed, ME)).toEqual(['mine']);
  });

  it('drops posts by other authors and entries with no usable text', () => {
    const feed = [
      entry({ did: 'did:plc:other', text: 'their post' }),
      entry({ text: '   ' }),
      { post: { author: { did: ME }, record: {} } },
      null,
      entry({ text: 'kept' }),
    ];
    expect(extractStyleTexts(feed, ME)).toEqual(['kept']);
  });

  it('survives a missing feed', () => {
    expect(extractStyleTexts(undefined, ME)).toEqual([]);
  });
});

describe('normalizeStyleSampleSize', () => {
  it('passes known sizes through and defaults everything else to the smallest', () => {
    for (const n of STYLE_SAMPLE_SIZES)
      expect(normalizeStyleSampleSize(n)).toBe(n);
    expect(normalizeStyleSampleSize(undefined)).toBe(STYLE_SAMPLE_SIZES[0]);
    expect(normalizeStyleSampleSize(9999)).toBe(STYLE_SAMPLE_SIZES[0]);
  });
});

/** A public AppView that serves `pages` in order, keyed by cursor. */
function appview(pages, { failAt = -1 } = {}) {
  const calls = [];
  const fetch = vi.fn(async (url) => {
    const u = new URL(url);
    calls.push(Object.fromEntries(u.searchParams));
    const index = calls.length - 1;
    if (index === failAt) {
      return { ok: false, status: 502, json: async () => ({}) };
    }
    const page = pages[index] || { feed: [] };
    return { ok: true, status: 200, json: async () => page };
  });
  return { fetch, calls };
}

const page = (n, { start = 0, cursor = 'next', did = ME } = {}) => ({
  feed: Array.from({ length: n }, (_, i) =>
    entry({ did, text: `post ${start + i}` }),
  ),
  ...(cursor ? { cursor: `${cursor}-${start}` } : {}),
});

describe('fetchStylePostTexts', () => {
  it('reads the account’s posts and replies from the public AppView', async () => {
    const { fetch, calls } = appview([page(40, { cursor: null })]);
    const texts = await fetchStylePostTexts(ME, { fetch });
    expect(texts).toHaveLength(40);
    expect(fetch.mock.calls[0][0]).toMatch(
      /^https:\/\/public\.api\.bsky\.app\/xrpc\/app\.bsky\.feed\.getAuthorFeed\?/,
    );
    expect(calls[0]).toEqual({
      actor: ME,
      filter: 'posts_with_replies',
      limit: '100',
    });
  });

  it('pages on with the cursor until it has the sample', async () => {
    const onPage = vi.fn();
    const { fetch, calls } = appview([
      page(100, { start: 0 }),
      page(100, { start: 100 }),
      page(100, { start: 200 }),
    ]);
    const texts = await fetchStylePostTexts(ME, {
      fetch,
      sampleSize: 250,
      onPage,
    });
    expect(texts).toHaveLength(250);
    expect(texts[0]).toBe('post 0');
    expect(calls).toHaveLength(3);
    expect(calls[1].cursor).toBe('next-0');
    expect(onPage.mock.calls.map((c) => c[0].posts)).toEqual([100, 200, 250]);
  });

  it('gives up after a page budget when reposts thin the feed', async () => {
    const reposts = {
      feed: Array.from({ length: 100 }, () =>
        entry({ reason: { $type: 'app.bsky.feed.defs#reasonRepost' } }),
      ),
      cursor: 'more',
    };
    const { fetch, calls } = appview([
      page(10),
      reposts,
      reposts,
      reposts,
      reposts,
    ]);
    const texts = await fetchStylePostTexts(ME, { fetch, sampleSize: 100 });
    expect(calls).toHaveLength(3);
    expect(texts).toHaveLength(10);
  });

  it(`refuses fewer than ${MIN_STYLE_POSTS} posts before anything is sent`, async () => {
    const { fetch } = appview([page(4, { cursor: null })]);
    await expect(fetchStylePostTexts(ME, { fetch })).rejects.toMatchObject({
      code: 'not_enough_posts',
      found: 4,
      minimum: 5,
    });
  });

  it('says plainly when the AppView can’t be read', async () => {
    const { fetch } = appview([], { failAt: 0 });
    await expect(fetchStylePostTexts(ME, { fetch })).rejects.toMatchObject({
      code: 'STYLE_FETCH_FAILED',
    });
  });

  it('needs an account', async () => {
    await expect(fetchStylePostTexts('', {})).rejects.toMatchObject({
      code: 'NO_ACCOUNT',
    });
  });
});

function requester(answer) {
  const calls = [];
  return {
    did: ME,
    calls,
    async request(path, options) {
      calls.push({ path, ...options });
      if (answer instanceof Error) throw answer;
      return typeof answer === 'function' ? answer(options) : answer;
    },
  };
}

const memoryStore = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
};

describe('synthesizeStyleFromTexts', () => {
  const texts = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('sends the posts, the note and the last reading, and dates the result', async () => {
    const req = requester({
      success: true,
      summary: ' Writes in lowercase. ',
      analyzedCount: 6,
      usage: { used: 1, limit: 3 },
    });
    const result = await synthesizeStyleFromTexts(req, {
      texts,
      guidance: '  i capitalize names  ',
      previousSummary: 'Old reading.',
      now: new Date('2026-11-12T10:00:00Z'),
    });
    expect(req.calls[0].path).toBe('/api/ai/synthesize-style');
    expect(req.calls[0].body).toEqual({
      posts: texts,
      guidance: 'i capitalize names',
      previousSummary: 'Old reading.',
    });
    expect(result).toEqual({
      summary: 'Writes in lowercase.',
      analyzedCount: 6,
      updatedAt: '2026-11-12T10:00:00.000Z',
      usage: { used: 1, limit: 3 },
    });
  });

  it('leaves out an empty note and reading', async () => {
    const req = requester({ summary: 'x', analyzedCount: 6 });
    await synthesizeStyleFromTexts(req, { texts, guidance: '  ' });
    expect(req.calls[0].body).toEqual({ posts: texts });
  });

  it('refuses too few posts without asking cocoon', async () => {
    const req = requester({ summary: 'x' });
    await expect(
      synthesizeStyleFromTexts(req, { texts: ['a', 'b'] }),
    ).rejects.toMatchObject({ code: 'not_enough_posts' });
    expect(req.calls).toHaveLength(0);
  });

  it('treats an empty reading as a failure', async () => {
    const req = requester({ summary: '  ', analyzedCount: 6 });
    await expect(
      synthesizeStyleFromTexts(req, { texts }),
    ).rejects.toMatchObject({ code: 'EMPTY_STYLE' });
  });
});

describe('learnWritingStyle', () => {
  it('reads the posting account’s posts and sends them as that account', async () => {
    const { fetch, calls } = appview([page(20, { cursor: null })]);
    const req = requester({ summary: 'Short posts.', analyzedCount: 20 });
    const result = await learnWritingStyle(req, {
      fetch,
      store: memoryStore(),
    });
    expect(calls[0].actor).toBe(ME);
    expect(req.calls[0].body.posts).toHaveLength(20);
    expect(result.summary).toBe('Short posts.');
  });
});

describe('style profiles', () => {
  it('keeps a reading with the writer’s note', () => {
    expect(
      styleProfileFrom(
        {
          summary: 'S',
          analyzedCount: 12.7,
          updatedAt: '2026-11-12T00:00:00Z',
        },
        'my note',
      ),
    ).toEqual({
      summary: 'S',
      analyzedCount: 12,
      updatedAt: '2026-11-12T00:00:00Z',
      guidance: 'my note',
    });
  });

  it('forgets the reading but keeps the note', () => {
    expect(
      forgetStyleProfile({
        summary: 'S',
        analyzedCount: 3,
        updatedAt: 'x',
        guidance: 'keep me',
      }),
    ).toEqual({
      summary: '',
      analyzedCount: 0,
      updatedAt: '',
      guidance: 'keep me',
    });
  });
});
