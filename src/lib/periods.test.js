import { describe, expect, it } from 'vitest';
import { customPeriod, dayKey, dayStartMs, periodBefore, periodEnd, periodLine, periodPhrase, periodStart, periodWindowWord, presetPeriod, rangeLabel, resolvePeriod } from './periods.js';
import { engagementModel, postsModel } from '../reports/models.js';

// Local-time constructors throughout, so the tests hold in any time zone.
const NOW = new Date(2026, 10, 14, 15, 0).getTime();
const DAY = 86_400_000;

describe('days', () => {
  it('reads a day as local midnight, and refuses what isn’t one', () => {
    expect(dayStartMs('2026-10-01')).toBe(new Date(2026, 9, 1).getTime());
    expect(Number.isNaN(dayStartMs('2026-02-31'))).toBe(true);
    expect(Number.isNaN(dayStartMs('1 Oct'))).toBe(true);
    expect(Number.isNaN(dayStartMs(null))).toBe(true);
    expect(dayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
  });

  it('names a range, with both years only when it crosses one', () => {
    expect(rangeLabel(dayStartMs('2026-10-01'), dayStartMs('2026-10-31'))).toBe('Oct 1 – Oct 31, 2026');
    expect(rangeLabel(dayStartMs('2025-12-20'), dayStartMs('2026-01-05'))).toBe('Dec 20, 2025 – Jan 5, 2026');
    expect(rangeLabel(dayStartMs('2026-10-01'), dayStartMs('2026-10-01'))).toBe('Oct 1, 2026');
  });
});

describe('customPeriod', () => {
  it('covers whole days, the last one included', () => {
    const p = customPeriod('2026-10-01', '2026-10-31', NOW);
    expect(p).toMatchObject({ key: 'custom:2026-10-01:2026-10-31', days: 31, custom: true, label: 'Oct 1 – Oct 31, 2026' });
    expect(p.end).toBe(new Date(2026, 10, 1).getTime() - 1);
    // The window the models draw starts where the first day does.
    expect(p.start).toBe(dayStartMs('2026-10-01'));
    expect(p.end + 1 - p.days * DAY).toBe(p.start);
  });

  it('ends now when it reaches today or past it', () => {
    expect(customPeriod('2026-11-01', '2026-11-14', NOW).end).toBe(NOW);
    expect(customPeriod('2026-11-01', '2026-12-25', NOW)).toMatchObject({ end: NOW, days: 55 });
  });

  it('is nothing for a range that can’t be', () => {
    expect(customPeriod('2026-10-31', '2026-10-01', NOW)).toBe(null);
    expect(customPeriod('2026-12-01', '2026-12-05', NOW)).toBe(null);
    expect(customPeriod('', '2026-10-01', NOW)).toBe(null);
    expect(customPeriod('2026-10-01', 'soon', NOW)).toBe(null);
  });

  it('counts a single day as one', () => {
    expect(customPeriod('2026-10-05', '2026-10-05', NOW)).toMatchObject({ days: 1, label: 'Oct 5, 2026' });
  });
});

describe('resolvePeriod', () => {
  it('reads a preset, a custom range, and falls back to 30 days', () => {
    expect(resolvePeriod({ period: '90d' }, NOW).key).toBe('90d');
    expect(resolvePeriod({ period: 'custom', periodFrom: '2026-10-01', periodTo: '2026-10-31' }, NOW).custom).toBe(true);
    expect(resolvePeriod({ period: 'custom', periodFrom: 'x', periodTo: 'y' }, NOW).key).toBe('30d');
    expect(resolvePeriod({ period: 'fortnight' }, NOW).key).toBe('30d');
    expect(resolvePeriod(undefined, NOW).key).toBe('30d');
  });
});

describe('the words for a period', () => {
  const custom = customPeriod('2026-10-01', '2026-10-31', NOW);

  it('reads in a sentence', () => {
    expect(periodPhrase(presetPeriod('30d'))).toBe('the last 30 days');
    expect(periodPhrase(presetPeriod('1y'))).toBe('the last year');
    expect(periodPhrase(presetPeriod('all'))).toBe('all time');
    expect(periodPhrase(custom)).toBe('Oct 1 to Oct 31, 2026');
  });

  it('captions a card', () => {
    expect(periodWindowWord(presetPeriod('7d'))).toBe('Last 7 days');
    expect(periodWindowWord(presetPeriod('all'))).toBe('All time');
    expect(periodWindowWord(custom)).toBe('Oct 1 – Oct 31, 2026');
  });

  it('names the window before it', () => {
    expect(periodBefore(presetPeriod('30d'))).toBe('the 30 days before');
    expect(periodBefore(presetPeriod('1y'), true)).toBe('The year before');
    expect(periodBefore(custom)).toBe('the 31 days before');
    expect(periodBefore(customPeriod('2026-10-05', '2026-10-05', NOW))).toBe('the 1 day before');
  });
});

describe('a custom range in the report models', () => {
  const did = 'did:plc:me';
  const post = (y, m, d, likes) => ({ uri: `at://${did}/app.bsky.feed.post/${y}${m}${d}`, rkey: `${y}${m}${d}`, at: new Date(y, m - 1, d, 12).toISOString(), likes, reposts: 0, replies: 0, quotes: 0 });
  const archive = { did, rev: 1, nowMs: NOW, meta: {}, posts: [post(2026, 9, 20, 100), post(2026, 10, 1, 1), post(2026, 10, 15, 2), post(2026, 10, 31, 4), post(2026, 11, 2, 50)] };
  const october = customPeriod('2026-10-01', '2026-10-31', NOW);

  it('ends where the range does, not now', () => {
    expect(periodEnd(october, NOW)).toBe(october.end);
    expect(periodEnd(presetPeriod('30d'), NOW)).toBe(NOW);
    expect(periodStart(october, NOW)).toBe(october.start);
    expect(periodStart(presetPeriod('7d'), NOW)).toBe(NOW - 7 * DAY);
    expect(periodStart(presetPeriod('all'), NOW)).toBe(null);
    const posts = postsModel(archive, october, NOW);
    expect(posts.count).toBe(3);
    const engagement = engagementModel(archive, october, NOW);
    expect(engagement.total).toBe(7);
    // Compared with the 31 days before it: September's one post.
    expect(engagement.compare.previous).toBe(100);
    expect(engagement.series[engagement.series.length - 1].t).toBeLessThanOrEqual(october.end);
    // One bar a day, from the first of the month: no stray bar for the day before.
    expect(engagement.series).toHaveLength(31);
    expect(new Date(engagement.series[0].t).getDate()).toBe(1);
  });
});

describe('periodLine', () => {
  const now = new Date(2026, 10, 15, 12, 0).getTime();

  it('names a preset and the days it covers, for the line under a page’s title', () => {
    expect(periodLine(presetPeriod('30d'), now)).toBe('The last 30 days, Oct 16 to Nov 15, 2026');
    expect(periodLine(presetPeriod('1y'), now)).toBe('The last year, Nov 15, 2025 to Nov 15, 2026');
  });

  it('is the range alone for one that was picked, and says all time for all time', () => {
    expect(periodLine(customPeriod('2026-10-01', '2026-10-31', now), now)).toBe('Oct 1 to Oct 31, 2026');
    expect(periodLine(presetPeriod('all'), now)).toBe('All time');
  });
});
