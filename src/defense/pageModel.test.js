import { describe, expect, it } from 'vitest';
import { describeRow, didPhrase, postsToScan, rowFacts, scanCsvRows, stageFraction, stageLine, vouchPhrase } from './pageModel.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();

describe('the posts offered for a scan', () => {
  const posts = [
    { uri: 'at://a/p/1', at: daysAgo(2), replies: 40, quotes: 9, reposts: 3 },
    { uri: 'at://a/p/2', at: daysAgo(3), replies: 2, quotes: 0, reposts: 50 },
    { uri: 'at://a/p/3', at: daysAgo(40), replies: 300, quotes: 80 },
    { uri: 'at://a/p/4', at: daysAgo(1), replies: 0, quotes: 0, reposts: 900, likes: 4000 },
    { uri: 'at://a/p/5', at: daysAgo(5), replies: 2, quotes: 0, reposts: 70 },
    { uri: 'at://a/p/6', at: daysAgo(6), replies: 1, quotes: 1, reposts: 1 },
    { uri: 'at://a/p/7', at: daysAgo(7), replies: 1, quotes: 0 },
  ];

  it('are the recent ones with the most replies and quotes, reposts breaking a tie', () => {
    expect(postsToScan(posts, { now: NOW }).map((p) => p.uri)).toEqual(['at://a/p/1', 'at://a/p/5', 'at://a/p/2', 'at://a/p/6']);
  });

  it('leave out the old, the unanswered and anything past the limit', () => {
    const uris = postsToScan(posts, { now: NOW, limit: 10 }).map((p) => p.uri);
    expect(uris).not.toContain('at://a/p/3');
    expect(uris).not.toContain('at://a/p/4');
    expect(uris).toHaveLength(5);
    expect(postsToScan(null)).toEqual([]);
  });
});

describe('an account’s line', () => {
  const row = { did: 'did:plc:x', handle: 'x.example.com', band: 'CONNECTED', vouches: 4, followers: 1200, engagements: { threadReply: 1, like: 1 }, followsYou: true };

  it('says who you know in common, and when that couldn’t be checked', () => {
    expect(vouchPhrase(row)).toBe('4 people you follow follow them');
    expect(vouchPhrase({ vouches: 1 })).toBe('1 person you follow follows them');
    expect(vouchPhrase({ vouches: 0 })).toBe('Nobody you follow follows them');
    expect(vouchPhrase(row, 'unavailable')).toBe('Who you know in common couldn’t be checked');
    expect(vouchPhrase({ youFollow: true })).toBe('You follow them');
  });

  it('says what they did, loudest first', () => {
    expect(didPhrase(row)).toBe('Replied in the thread and liked');
    expect(didPhrase({ engagements: { quote: 2 } })).toBe('Quoted');
    expect(didPhrase({ engagements: { like: 1, repost: 1, quote: 1 } })).toBe('Quoted, reposted and liked');
    expect(didPhrase({})).toBe('Engaged');
  });

  it('gives the radar a title and its lines', () => {
    expect(describeRow(row)).toEqual({
      title: '@x.example.com',
      lines: ['Connected. 4 people you follow follow them', 'Replied in the thread and liked', 'Follows you'],
    });
    expect(describeRow({ did: 'did:plc:y', band: 'UNKNOWN', blocksYou: true }).title).toBe('did:plc:y');
    expect(describeRow({ did: 'did:plc:y', band: 'UNKNOWN', blocksYou: true }).lines).toContain('Blocks you');
  });

  it('says how you know them first, and why someone protected is instead of counting', () => {
    expect(rowFacts({ ...row, band: 'PROTECTED', protectedReason: 'your own account' })[0]).toBe('Your own account');
    expect(rowFacts({ ...row, band: 'PROTECTED', protectedReason: 'you follow them', youFollow: true })[0]).toBe('You follow them');
    expect(rowFacts(row)).toEqual(['4 people you follow follow them', 'Replied in the thread and liked', '1,200 followers']);
  });
});

describe('a scan under way', () => {
  it('says which stage it is at, and how far through', () => {
    expect(stageLine(null)).toBe('Starting…');
    expect(stageLine({ stage: 'post' })).toBe('Finding the post…');
    expect(stageLine({ stage: 'harvest', progress: { done: 2, total: 4 } })).toBe('Reading who engaged: 2 of 4 kinds of engagement');
    expect(stageLine({ stage: 'score', progress: { done: 300, total: 1250 } })).toBe('Sorting by who you know: 300 of 1,250 accounts');
    expect(stageLine({ stage: 'canary' })).toBe('Checking the AppView counts…');
  });

  it('moves a bar forward stage by stage', () => {
    expect(stageFraction(null)).toBe(0);
    expect(stageFraction({ stage: 'post' })).toBe(0);
    expect(stageFraction({ stage: 'harvest', progress: { done: 2, total: 4 } })).toBeCloseTo(0.375);
    expect(stageFraction({ stage: 'score', progress: { done: 10, total: 10 } })).toBe(1);
  });
});

describe('a scan as a CSV', () => {
  it('has a header and a row per account, leaving vouches blank when they weren’t checked', () => {
    const summary = { vouchCheck: 'canary', rows: [{ did: 'did:plc:x', handle: 'x.test', band: 'PERIPHERAL', trust: 40, vouches: 2, followers: 9, engagements: { like: 1 }, total: 1 }] };
    const [head, first] = scanCsvRows(summary);
    expect(head[0]).toBe('did');
    expect(first).toEqual(['did:plc:x', 'x.test', '', 'PERIPHERAL', 40, 2, 'no', 'no', 9, 'like', 1]);
    expect(scanCsvRows({ ...summary, vouchCheck: 'unavailable' })[1][5]).toBe('');
    expect(scanCsvRows(null)).toHaveLength(1);
  });
});
