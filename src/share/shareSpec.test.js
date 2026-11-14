import { describe, expect, it } from 'vitest';
import { ALT_TEXT_MAX, canShare, shareAltText, sharePostText, shareSpec } from './shareSpec.js';

const DID = 'did:plc:me';
const NOW = new Date(2026, 10, 14, 15, 0).getTime();
const DAY = 86_400_000;
const WEEK = { key: '7d', days: 7, label: '7 days' };

function archiveOf({ posts = [], followers = [] } = {}) {
  return { did: DID, handle: 'mira.example.com', rev: Math.random(), nowMs: NOW, posts, followers, blocks: [], outbound: [], inbound: [], atmosphere: [], meta: { posts: { shape: 2 } } };
}
const post = (daysAgo, likes, extra = {}) => ({
  uri: `at://${DID}/app.bsky.feed.post/p${daysAgo}-${likes}`,
  rkey: `p${daysAgo}-${likes}`,
  at: new Date(NOW - daysAgo * DAY).toISOString(),
  likes,
  reposts: 0,
  replies: 0,
  quotes: 0,
  len: 40,
  media: null,
  tags: [],
  links: [],
  ...extra,
});
const follower = (daysAgo, i) => ({ did: `did:plc:f${i}`, followedAt: new Date(NOW - daysAgo * DAY).toISOString() });

describe('which cards can be made into a picture', () => {
  it('covers the charts, and the figures that head them', () => {
    expect(canShare('follower-growth')).toBe(true);
    expect(canShare('stat-followers')).toBe(true);
    expect(canShare('content-formats')).toBe(true);
    expect(canShare('top-engagers')).toBe(false);
    expect(canShare('posting-next')).toBe(false);
    expect(shareSpec('top-engagers', archiveOf(), WEEK, NOW)).toBe(null);
  });
});

describe('a series card', () => {
  const archive = archiveOf({ posts: [post(1, 10), post(1, 5), post(3, 40), post(20, 99)] });

  it('carries the title, whose it is, the headline and the buckets', () => {
    const spec = shareSpec('engagement-over-time', archive, WEEK, NOW);
    expect(spec).toMatchObject({ kind: 'series', title: 'Engagement', subtitle: '@mira.example.com, the last 7 days', mode: 'bars', unit: 'day', noun: 'interactions' });
    expect(spec.figure).toEqual({ value: '55', label: 'likes, reposts, replies and quotes on 3 posts' });
    expect(spec.series.reduce((n, p) => n + p.v, 0)).toBe(55);
  });

  it('takes the card’s own title and kind', () => {
    const spec = shareSpec('engagement-over-time', archive, WEEK, NOW, { title: 'My week', kind: 'like' });
    expect(spec.title).toBe('My week');
    expect(spec.figure.label).toBe('likes on 3 posts');
    expect(spec.noun).toBe('likes');
  });

  it('is described from its own numbers, value by value while it is short', () => {
    const text = shareAltText(shareSpec('engagement-over-time', archive, WEEK, NOW));
    expect(text).toMatch(/^Engagement, @mira\.example\.com, the last 7 days\. 55 likes, reposts, replies and quotes on 3 posts\. Bar chart of interactions per day, /);
    expect(text).toContain('The highest is Nov 11 with 40');
    expect(text).toContain('Values: ');
    expect(text).toContain('Nov 13: 15');
    expect(text.length).toBeLessThanOrEqual(ALT_TEXT_MAX);
  });

  it('describes a long chart without listing it', () => {
    const many = Array.from({ length: 300 }, (_, i) => post(i, i % 7));
    const text = shareAltText(shareSpec('posting-cadence', archiveOf({ posts: many }), { key: '1y', days: 365, label: 'Year' }, NOW));
    expect(text).not.toContain('Values:');
    expect(text.length).toBeLessThanOrEqual(ALT_TEXT_MAX);
  });

  it('says where a line starts and ends, and what is marked on it', () => {
    const followers = Array.from({ length: 120 }, (_, i) => follower(i < 100 ? 30 : 2, i));
    const spec = shareSpec('follower-growth', archiveOf({ followers }), WEEK, NOW, { notes: [{ id: 'n', day: '2026-11-10', label: 'Zine went out' }] });
    expect(spec.mode).toBe('line');
    const text = shareAltText(spec);
    expect(text).toContain('Line chart of followers per day');
    expect(text).toContain('It starts at 100 and ends at 120.');
    expect(text).toContain('Marked: Nov 10, Zine went out');
  });

  it('names a week as one, and says what the profile counter reads when it differs', () => {
    const followers = Array.from({ length: 120 }, (_, i) => follower(i, i));
    const archive = { ...archiveOf({ followers }), meta: { posts: { shape: 2 }, followers: { profileCount: 150 } } };
    const spec = shareSpec('follower-growth', archive, { key: '90d', days: 90, label: '90 days' }, NOW);
    expect(spec.unit).toBe('week');
    expect(spec.ghost).toEqual({ v: 150 });
    const text = shareAltText(spec);
    expect(text).toMatch(/per week, from the week of \w+ \d+ to the week of \w+ \d+\./);
    expect(text).toContain('Bluesky’s profile counter says 150, which still counts accounts that can’t be listed.');
    expect(text).toMatch(/Values: week of /);
    expect(text).not.toContain('wk of');
  });

  it('is nothing when there is nothing to draw', () => {
    expect(shareSpec('follower-growth', archiveOf(), WEEK, NOW)).toBe(null);
    expect(shareSpec('repo-activity', archiveOf(), WEEK, NOW)).toBe(null);
    expect(shareAltText(null)).toBe('');
  });
});

describe('a bar card', () => {
  const posts = [post(5, 2), post(6, 4), post(7, 6), post(5, 50, { media: 'image' }), post(6, 60, { media: 'image' }), post(7, 70, { media: 'image' }), post(8, 9, { tags: ['bees'] })];
  const archive = archiveOf({ posts });
  const MONTH = { key: '30d', days: 30, label: '30 days' };

  it('lists its rows in the description', () => {
    const spec = shareSpec('content-formats', archive, MONTH, NOW);
    expect(spec.kind).toBe('bars');
    // Four text-only posts (the tagged one too): 2, 4, 6 and 9, so the middle is 5.
    expect(spec.rows.map((r) => [r.label, r.display])).toEqual([['Text only', '5'], ['Images', '60']]);
    expect(shareAltText(spec)).toContain('Bar chart, for a typical post. Text only: 5; Images: 60.');
  });

  it('counts tags by the posts that use them', () => {
    const spec = shareSpec('top-tags', archive, MONTH, NOW);
    expect(spec.rows).toEqual([{ label: '#bees', value: 1, display: '1' }]);
  });

  it('waits for rows that hold what it reads', () => {
    expect(shareSpec('content-formats', { ...archive, rev: Math.random(), meta: { posts: {} } }, MONTH, NOW)).toBe(null);
  });
});

describe('the post beside it', () => {
  it('starts with what the picture is', () => {
    const spec = shareSpec('posting-cadence', archiveOf({ posts: [post(1, 1)] }), WEEK, NOW);
    expect(sharePostText(spec, WEEK)).toBe('Posts, the last 7 days.');
    expect(sharePostText(null, WEEK)).toBe('');
  });
});
