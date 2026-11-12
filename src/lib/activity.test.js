import { describe, expect, it } from 'vitest';
import { feedItemTime } from './activity.js';

describe('when an account was last active', () => {
  it('dates a repost by when it was reposted, a post by when it was written', () => {
    const post = { post: { record: { createdAt: '2026-03-01T10:00:00.000Z' }, indexedAt: '2026-03-01T10:00:05.000Z' } };
    expect(feedItemTime(post)).toBe('2026-03-01T10:00:00.000Z');
    const repost = { ...post, reason: { indexedAt: '2026-06-02T08:00:00.000Z' } };
    expect(feedItemTime(repost)).toBe('2026-06-02T08:00:00.000Z');
  });

  it('falls back to when the post was indexed, and to nothing', () => {
    expect(feedItemTime({ post: { indexedAt: '2026-01-01T00:00:00.000Z' } })).toBe('2026-01-01T00:00:00.000Z');
    expect(feedItemTime({ post: { record: { createdAt: 'not a date' } } })).toBe(null);
    expect(feedItemTime(undefined)).toBe(null);
  });
});
