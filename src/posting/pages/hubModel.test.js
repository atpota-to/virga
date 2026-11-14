import { describe, expect, it } from 'vitest';
import {
  countPhrase,
  draftRows,
  mergePostRows,
  rowFromPostView,
  scheduledOverview,
  scheduledSnippet,
  timersOverview,
  whenLabel,
} from './hubModel.js';

const DID = 'did:plc:mira';

describe('countPhrase', () => {
  it('says one and many', () => {
    expect(countPhrase(1, 'draft')).toBe('1 draft');
    expect(countPhrase(2, 'draft')).toBe('2 drafts');
    expect(countPhrase(1200, 'post')).toBe('1,200 posts');
    expect(countPhrase(undefined, 'reply', 'replies')).toBe('0 replies');
  });
});

describe('scheduledOverview', () => {
  const rows = [
    { id: 'a', status: 'pending', queued: true, scheduledFor: '2026-11-14T09:00:00.000Z' },
    { id: 'b', status: 'pending', queued: false, scheduledFor: '2026-11-13T09:00:00.000Z' },
    { id: 'c', status: 'failed', queued: false, scheduledFor: '2026-11-10T09:00:00.000Z' },
    { id: 'd', status: 'publishing', queued: false, scheduledFor: '2026-11-12T09:00:00.000Z' },
    { id: 'e', status: 'pending', queued: true, scheduledFor: '2026-11-20T09:00:00.000Z' },
  ];

  it('lists what is still to go out, soonest first', () => {
    const o = scheduledOverview(rows, { limit: 3 });
    expect(o.next.map((r) => r.id)).toEqual(['d', 'b', 'a']);
    expect(o.waiting).toBe(4);
    expect(o.queued).toBe(2);
    expect(o.atTime).toBe(2);
    expect(o.failed).toBe(1);
  });

  it('copes with nothing', () => {
    expect(scheduledOverview(null)).toEqual({ next: [], waiting: 0, queued: 0, atTime: 0, failed: 0 });
  });
});

describe('scheduledSnippet', () => {
  it('reads the first post', () => {
    expect(scheduledSnippet({ payload: { posts: [{ record: { text: '  hello\n world ' } }] } })).toBe('hello world');
  });
  it('cuts long text', () => {
    const s = scheduledSnippet({ payload: { posts: [{ record: { text: 'x'.repeat(200) } }] } }, 10);
    expect([...s]).toHaveLength(10);
    expect(s.endsWith('…')).toBe(true);
  });
  it('names what a post without words carries', () => {
    expect(scheduledSnippet({ payload: { posts: [{ record: { text: '' }, embed: { type: 'images' } }] } })).toBe(
      'A post with images',
    );
    expect(
      scheduledSnippet({ payload: { posts: [{ record: { text: '' } }, { record: { text: 'two' } }] } }),
    ).toBe('A post with no text (thread)');
  });
});

describe('draftRows', () => {
  const view = (id, updatedAt, text = 'hi') => ({
    id,
    createdAt: updatedAt,
    updatedAt,
    draft: { posts: [{ text }] },
  });
  it('sorts by the latest edit and cuts', () => {
    const rows = draftRows([view('a', '2026-11-01T00:00:00Z'), view('b', '2026-11-05T00:00:00Z'), view('c', '2026-11-03T00:00:00Z')], {
      limit: 2,
    });
    expect(rows.map((r) => r.id)).toEqual(['b', 'c']);
    expect(rows[0].text).toBe('hi');
  });
  it('skips drafts without an id', () => {
    expect(draftRows([{ draft: { posts: [] } }])).toEqual([]);
  });
});

describe('rowFromPostView and mergePostRows', () => {
  const view = {
    uri: `at://${DID}/app.bsky.feed.post/3new`,
    cid: 'bafy',
    record: { text: 'fresh', createdAt: '2026-11-12T10:00:00.000Z' },
    likeCount: 4,
    repostCount: 1,
    replyCount: 2,
    quoteCount: 0,
  };

  it('makes an archive-shaped row with counts', () => {
    const row = rowFromPostView(view, DID);
    expect(row).toMatchObject({ uri: view.uri, rkey: '3new', text: 'fresh', likes: 4, reposts: 1, replies: 2, quotes: 0 });
  });

  it('refuses somebody else’s post', () => {
    expect(rowFromPostView({ ...view, uri: 'at://did:plc:other/app.bsky.feed.post/1' }, DID)).toBeNull();
  });

  it('lays the feed over the archive, marking what it hasn’t synced', () => {
    const archive = [
      { uri: `at://${DID}/app.bsky.feed.post/old`, at: '2026-11-01T00:00:00.000Z', text: 'old', likes: 1 },
      { uri: `at://${DID}/app.bsky.feed.post/both`, at: '2026-11-10T00:00:00.000Z', text: 'both', likes: 1 },
      { uri: `at://${DID}/app.bsky.feed.post/gone`, at: '2026-11-11T00:00:00.000Z', text: 'gone' },
    ];
    const feed = [
      rowFromPostView(view, DID),
      { uri: `at://${DID}/app.bsky.feed.post/both`, at: '2026-11-10T00:00:00.000Z', likes: 9, reposts: 0, replies: 0, quotes: 0 },
    ];
    const merged = mergePostRows(archive, feed, { removed: [`at://${DID}/app.bsky.feed.post/gone`] });
    expect(merged.map((r) => r.rkey || r.uri.split('/').pop())).toEqual(['3new', 'both', 'old']);
    expect(merged[0].fresh).toBe(true);
    expect(merged[1].fresh).toBeUndefined();
    expect(merged[1].likes).toBe(9);
    expect(merged[1].text).toBe('both');
  });
});

describe('timersOverview', () => {
  it('counts live timers and finds the next check', () => {
    expect(
      timersOverview([
        { status: 'armed', checkAt: '2026-11-15T00:00:00Z' },
        { status: 'checking', checkAt: '2026-11-13T00:00:00Z' },
        { status: 'deleted', checkAt: '2026-11-01T00:00:00Z' },
      ]),
    ).toEqual({ live: 2, nextCheck: '2026-11-13T00:00:00Z' });
    expect(timersOverview(undefined)).toEqual({ live: 0, nextCheck: null });
  });
});

describe('whenLabel', () => {
  const now = new Date(2026, 10, 12, 8, 0);
  it('says today and tomorrow', () => {
    expect(whenLabel(new Date(2026, 10, 12, 9, 0).toISOString(), now)).toBe('Today, 9:00 AM');
    expect(whenLabel(new Date(2026, 10, 13, 17, 30).toISOString(), now)).toBe('Tomorrow, 5:30 PM');
  });
  it('names the day further out', () => {
    expect(whenLabel(new Date(2026, 10, 20, 9, 0).toISOString(), now)).toBe('Fri, Nov 20, 9:00 AM');
    expect(whenLabel(new Date(2027, 0, 2, 9, 0).toISOString(), now)).toMatch(/2027/);
  });
  it('is empty for nothing', () => {
    expect(whenLabel(null, now)).toBe('');
  });
});
