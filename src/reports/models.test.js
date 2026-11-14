import { describe, expect, it } from 'vitest';
import { BEST_TIME_MIN_POSTS, bestTimeModel, contentModel, contentReady, contentStandout, formatOf, hourColumns, hourRange, median } from './models.js';

const DID = 'did:plc:me';
const NOW = new Date(2026, 10, 12, 12).getTime();

function archiveOf(posts) {
  return { did: DID, rev: Math.random(), nowMs: NOW, posts, meta: {} };
}

/** A post on the given local day offset and hour, with `likes` likes. */
function post(daysAgo, hour, likes, extra = {}) {
  const d = new Date(NOW - daysAgo * 86_400_000);
  d.setHours(hour, 15, 0, 0);
  return { uri: `at://${DID}/app.bsky.feed.post/${daysAgo}-${hour}-${likes}`, at: d.toISOString(), likes, reposts: 0, replies: 0, quotes: 0, ...extra };
}

describe('when posts land', () => {
  it('takes the middle value, so one outlier can’t carry a slot', () => {
    expect(median([1, 2, 1000])).toBe(2);
    expect(median([1, 3])).toBe(2);
    expect(median([])).toBe(null);
  });

  it('finds the best slot from the typical post, and leaves thin slots empty', () => {
    // Five weeks of Tuesday evening posts that earn steadily, and one
    // Monday-morning post that went round.
    const posts = [];
    for (let w = 1; w <= 5; w++) posts.push(post(w * 7 + ((new Date(NOW).getDay() + 5) % 7), 19, 40));
    posts.push(post(8, 9, 5000));
    const m = bestTimeModel(archiveOf(posts), { key: 'all', days: null }, NOW, { block: 2 });
    expect(m.posts).toBe(6);
    expect(m.best).toHaveLength(1);
    expect(m.best[0]).toMatchObject({ col: 9, avg: 40, posts: 5 });
    const thin = m.rows.flatMap((r) => r.cells).filter((c) => c.posts > 0 && c.posts < BEST_TIME_MIN_POSTS);
    expect(thin.every((c) => c.avg == null)).toBe(true);
  });

  it('leaves out replies to other people and posts still collecting', () => {
    const posts = [post(10, 9, 10), post(10, 9, 10), post(10, 9, 10, { replyTo: 'did:plc:someone' }), post(1, 9, 99)];
    const m = bestTimeModel(archiveOf(posts), { key: 'all', days: null }, NOW, { block: 2 });
    expect(m.posts).toBe(2);
  });

  it('names hours the way a person reads them', () => {
    expect(hourRange(9, 2)).toBe('6–8 pm');
    expect(hourRange(5, 2)).toBe('10 am–12 pm');
    expect(hourRange(11, 2)).toBe('10 pm–12 am');
    expect(hourRange(0, 1)).toBe('12–1 am');
    expect(hourColumns(2).map((c) => c.label)).toEqual(['12a', '6a', '12p', '6p']);
  });
});

describe('what posts are made of', () => {
  const ALL = { key: 'all', days: null };
  const made = (posts, meta = { posts: { shape: 2 } }) => ({ ...archiveOf(posts), meta });
  let n = 0;
  /** A settled post (ten days old) with `likes` likes and whatever else. */
  const p = (likes, extra = {}) => {
    const rkey = `k${n++}`;
    return { ...post(10, 9, likes), uri: `at://${DID}/app.bsky.feed.post/${rkey}`, rkey, len: 40, media: null, mediaCount: 0, altCount: 0, tags: [], links: [], langs: ['en'], ...extra };
  };

  it('names a post by what it carries', () => {
    expect(formatOf({})).toBe('text');
    expect(formatOf({ quoteOf: 'did:plc:x' })).toBe('quote');
    expect(formatOf({ quoteOf: 'did:plc:x', media: 'image' })).toBe('image');
    expect(formatOf({ media: 'gif' })).toBe('gif');
  });

  it('knows whether the rows hold what it reads', () => {
    expect(contentReady(made([]))).toBe(true);
    expect(contentReady(made([], { posts: {} }))).toBe(false);
    expect(contentReady(made([], {}))).toBe(false);
    expect(contentModel(made([], { posts: {} }), ALL, NOW).ready).toBe(false);
  });

  it('counts by format and reads each one’s typical post', () => {
    const posts = [p(2), p(4), p(6), p(50, { media: 'image', mediaCount: 1, altCount: 1 }), p(60, { media: 'image', mediaCount: 2, altCount: 1 }), p(70, { media: 'image', mediaCount: 1 }), p(9, { media: 'link', links: ['example.com'] })];
    const m = contentModel(made(posts), ALL, NOW);
    expect(m.posts).toBe(7);
    const by = Object.fromEntries(m.formats.map((f) => [f.key, f]));
    expect(by.text).toMatchObject({ posts: 3, typical: 4, total: 12 });
    expect(by.image).toMatchObject({ posts: 3, typical: 60 });
    // One link post is too few to call anything typical.
    expect(by.link).toMatchObject({ posts: 1, typical: null });
    expect(by.video.posts).toBe(0);
    expect(by.text.share).toBeCloseTo(3 / 7);
    expect(m.typical).toBe(9);
  });

  it('measures how much media is described, by item and by post', () => {
    const posts = [p(1, { media: 'image', mediaCount: 4, altCount: 4 }), p(1, { media: 'image', mediaCount: 2, altCount: 1 }), p(1, { media: 'video', mediaCount: 1, altCount: 0 }), p(1, { media: 'link' })];
    const { alt } = contentModel(made(posts), ALL, NOW);
    expect(alt).toMatchObject({ posts: 3, described: 1, items: 7, itemsDescribed: 5 });
    expect(alt.pct).toBeCloseTo((5 / 7) * 100);
    expect(contentModel(made([p(1)]), ALL, NOW).alt.pct).toBe(null);
  });

  it('bands posts by length', () => {
    const m = contentModel(made([p(1, { len: 0 }), p(1, { len: 80 }), p(1, { len: 81 }), p(1, { len: 240 }), p(1, { len: 300 }), p(1, { len: undefined })]), ALL, NOW);
    expect(m.lengths.map((b) => b.posts)).toEqual([3, 1, 1, 1]);
  });

  it('groups tags whatever their case, and ranks tags and sites by use', () => {
    const posts = [p(10, { tags: ['Gardens', 'bees'] }), p(20, { tags: ['gardens'] }), p(30, { tags: ['GARDENS'], links: ['example.com'] }), p(5, { links: ['example.com', 'other.org'] })];
    const m = contentModel(made(posts), ALL, NOW);
    expect(m.tags[0]).toMatchObject({ tag: 'Gardens', posts: 3, typical: 20, total: 60 });
    expect(m.tags[1]).toMatchObject({ tag: 'bees', posts: 1, typical: null });
    expect(m.links.map((l) => [l.host, l.posts])).toEqual([['example.com', 2], ['other.org', 1]]);
    expect(m.withTags).toBe(3);
    expect(m.withLinks).toBe(2);
  });

  it('tells a thread’s first post from the ones after it', () => {
    const opener = p(40);
    const later = [p(3, { replyTo: DID, threadOf: DID, threadKey: opener.rkey }), p(2, { replyTo: DID, threadOf: DID, threadKey: opener.rkey })];
    // A reply to yourself inside someone else's thread starts nothing.
    const elsewhere = p(1, { replyTo: DID, threadOf: 'did:plc:someone', threadKey: 'zzz' });
    const m = contentModel(made([opener, ...later, elsewhere, p(7), p(8)]), ALL, NOW);
    expect(Object.fromEntries(m.places.map((t) => [t.key, t.posts]))).toEqual({ single: 2, opener: 1, later: 3 });
  });

  it('leaves replies to other people out, and the newest posts out of what is typical', () => {
    const fresh = { ...p(900), at: new Date(NOW - 3_600_000).toISOString() };
    const m = contentModel(made([p(1), p(2), p(3), p(500, { replyTo: 'did:plc:someone' }), fresh]), ALL, NOW);
    expect(m.posts).toBe(4);
    expect(m.typical).toBe(2);
    expect(m.formats[0].total).toBe(906);
  });

  it('keeps to the window', () => {
    const old = { ...p(99), at: new Date(NOW - 40 * 86_400_000).toISOString() };
    expect(contentModel(made([p(1), old]), { key: '30d', days: 30 }, NOW).posts).toBe(1);
  });

  it('picks the group that stands out, and what to hold it against', () => {
    const groups = [
      { key: 'text', label: 'Text only', typical: 4 },
      { key: 'image', label: 'Images', typical: 60 },
      { key: 'link', label: 'Link card', typical: null },
    ];
    expect(contentStandout(groups, 9, 'text')).toMatchObject({ best: { key: 'image' }, base: { key: 'text' }, baseline: 4 });
    // With no named group to hold it against, the overall typical post.
    expect(contentStandout(groups, 9)).toMatchObject({ best: { key: 'image' }, base: null, baseline: 9 });
    // The best group being the baseline itself says nothing.
    expect(contentStandout([{ key: 'text', typical: 9 }, { key: 'image', typical: 4 }], 5, 'text')).toMatchObject({ best: { key: 'text' }, base: null, baseline: 5 });
    expect(contentStandout([{ key: 'text', typical: 9 }], 5)).toBe(null);
    expect(contentStandout([{ key: 'text', typical: 4 }, { key: 'image', typical: 5 }], 6)).toBe(null);
  });
});

