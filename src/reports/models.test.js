import { describe, expect, it } from 'vitest';
import { BEST_TIME_MIN_POSTS, RATE_MIN_VIEWS, bestTimeModel, contentModel, contentReady, contentStandout, formatOf, hourColumns, hourRange, median, viewsModel } from './models.js';

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
    const m = contentModel(made([p(1, { len: 0 }), p(1, { len: 80 }), p(1, { len: 81 }), p(1, { len: 240 }), p(1, { len: 300 })]), ALL, NOW);
    expect(m.lengths.map((b) => b.posts)).toEqual([2, 1, 1, 1]);
  });

  it('leaves out rows that hold nothing to read, and says how many', () => {
    // Archived before rows kept this, and gone from the repo since.
    const old = { ...post(12, 9, 300), uri: `at://${DID}/app.bsky.feed.post/old`, rkey: 'old' };
    const m = contentModel(made([p(2), p(4), p(6), old]), ALL, NOW);
    expect(m.posts).toBe(3);
    expect(m.unread).toBe(1);
    expect(m.typical).toBe(4);
    expect(m.formats[0].total).toBe(12);
    expect(contentModel(made([p(1)]), ALL, NOW).unread).toBe(0);
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


describe('views', () => {
  const ALL = { key: 'all', days: null };
  const DAY = 86_400_000;
  /** A post `daysAgo` days back with `views` (null: no count), and its view row. */
  const seen = (daysAgo, views, extra = {}) => {
    const p = post(daysAgo, 12, extra.likes ?? 0, extra);
    const row = { uri: p.uri, at: p.at, count: views, countedAt: views == null ? null : NOW - 3600_000, checkedAt: NOW - 3600_000, points: views == null ? [] : [[NOW - 3600_000, views]] };
    return { p, row };
  };
  const archiveFrom = (items, meta = { views: { status: 'ok', since: NOW - 40 * DAY, syncedAt: NOW - 3600_000 } }) => ({
    ...archiveOf(items.map((i) => i.p)),
    views: items.map((i) => i.row),
    meta,
  });

  it('counts only the posts Bluesky counts: from the oldest one with a count', () => {
    const a = archiveFrom([seen(5, 400), seen(10, null), seen(20, 1000), seen(300, null)]);
    const m = viewsModel(a, ALL, NOW);
    expect(m.epoch).toBe(Date.parse(a.posts[2].at));
    expect(m.total).toBe(1400);
    expect(m.countable).toBe(3);
    expect(m.withCount).toBe(2);
    // All time starts at the oldest count, not the account's first post.
    expect(m.posts).toBe(3);
    expect(m.series.reduce((s, b) => s + b.v, 0)).toBe(1400);
  });

  it('has nothing to count before any post has a count', () => {
    const m = viewsModel(archiveFrom([seen(5, null), seen(6, null)]), ALL, NOW);
    expect(m.epoch).toBeNull();
    expect(m.total).toBe(0);
    expect(m.countable).toBe(0);
    expect(m.typical).toEqual({ value: null, under: false, posts: 0 });
  });

  it('calls the typical post under 100 when the middle one has no count', () => {
    const m = viewsModel(archiveFrom([seen(30, 5000), seen(10, null), seen(9, null), seen(8, 200)]), ALL, NOW);
    expect(m.typical.under).toBe(true);
    const m2 = viewsModel(archiveFrom([seen(30, 5000), seen(10, 300), seen(9, 500)]), ALL, NOW);
    expect(m2.typical).toMatchObject({ value: 500, under: false });
  });

  it('leaves posts still collecting out of the typical post, and counts them in the total', () => {
    const m = viewsModel(archiveFrom([seen(30, 300), seen(20, 300), seen(10, 300), seen(1, 9000)]), ALL, NOW);
    expect(m.typical.value).toBe(300);
    expect(m.total).toBe(9900);
  });

  it('works out engagement per 100 views over own posts with a count', () => {
    const items = [
      seen(10, 1000, { likes: 30 }),
      seen(11, 1000, { likes: 10 }),
      seen(12, null, { likes: 5 }),
      seen(13, 500, { likes: 400, replyTo: 'did:plc:someone' }),
    ];
    const m = viewsModel(archiveFrom(items), ALL, NOW);
    expect(m.rate).toBeCloseTo(2, 6);
    expect(m.rateSeries.filter((b) => b.v != null).length).toBeGreaterThan(0);
  });

  it('ranks the most seen, and the most engaging for their reach above a floor', () => {
    const items = [seen(10, 5000, { likes: 50 }), seen(11, RATE_MIN_VIEWS, { likes: 60 }), seen(12, RATE_MIN_VIEWS - 1, { likes: 200 })];
    const m = viewsModel(archiveFrom(items), ALL, NOW);
    expect(m.top.map((p) => p.views)).toEqual([5000, RATE_MIN_VIEWS, RATE_MIN_VIEWS - 1]);
    expect(m.engaging.map((p) => p.views)).toEqual([RATE_MIN_VIEWS, 5000]);
    expect(m.engaging[0].rate).toBeCloseTo(20, 6);
  });

  it('compares with the window before only when Bluesky was counting through it', () => {
    const d30 = { key: '30d', days: 30 };
    const young = archiveFrom([seen(5, 400), seen(40, 1000)]);
    expect(viewsModel(young, d30, NOW).compare).toBeNull();
    const old = archiveFrom([seen(5, 400), seen(40, 1000), seen(70, 100)]);
    expect(viewsModel(old, d30, NOW).compare).toMatchObject({ current: 400, previous: 1000 });
  });

  it('adds up views gained between readings', () => {
    const one = seen(10, 1000);
    one.row.points = [
      [NOW - 3 * DAY, 400],
      [NOW - DAY, 1000],
    ];
    // Posted before Virga was reading counts: its first reading is a start.
    const before = archiveFrom([one], { views: { status: 'ok', since: NOW - 5 * DAY } });
    expect(Math.round(viewsModel(before, { key: '7d', days: 7 }, NOW).gainedTotal)).toBe(600);
    // Posted after: the rise from nothing to its first reading is counted too,
    // spread from when it was posted (so only the part inside the window).
    const after = archiveFrom([one], { views: { status: 'ok', since: NOW - 40 * DAY } });
    const m = viewsModel(after, { key: 'all', days: null }, NOW);
    expect(Math.round(m.gainedTotal)).toBe(1000);
    expect(m.gainedReady).toBe(true);
  });

  it('has nothing gained to show after one reading of older posts, rather than none gained', () => {
    const one = seen(10, 1000);
    const m = viewsModel(archiveFrom([one], { views: { status: 'ok', since: NOW - 3600_000 } }), { key: '7d', days: 7 }, NOW);
    expect(m.gainedReady).toBe(false);
    expect(viewsModel(archiveFrom([one], { views: { status: 'ok' } }), { key: '7d', days: 7 }, NOW).gainedReady).toBe(false);
  });

  it('gives each format its typical post once it has enough of them', () => {
    const items = [seen(10, 800, { media: 'image' }), seen(11, 600, { media: 'image' }), seen(12, 700, { media: 'image' }), seen(13, 100)];
    const m = viewsModel(archiveFrom(items), ALL, NOW);
    const image = m.formats.find((f) => f.key === 'image');
    expect(image).toMatchObject({ posts: 3, typical: 700, under: false });
    expect(m.formats.find((f) => f.key === 'text')).toMatchObject({ posts: 1, typical: null });
  });
});
