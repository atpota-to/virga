import { describe, expect, it } from 'vitest';
import { BEST_TIME_MIN_POSTS, bestTimeModel, hourColumns, hourRange, median } from './models.js';

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
