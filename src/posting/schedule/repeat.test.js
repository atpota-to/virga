import { describe, it, expect } from 'vitest';
import {
  MAX_REPEAT_COUNT,
  REPEAT_EVERY,
  REPEAT_OPTIONS,
  anchoredRepeat,
  nextOccurrence,
  normalizeRepeat,
  occurrenceTime,
  repeatClause,
  repeatEnds,
  repeatForServer,
  repeatLabel,
  repeatProblem,
  repeatProgress,
  repeatSummary,
  rowRepeat,
} from './repeat.js';

const iso = (ms) => new Date(ms).toISOString();
const stored = (every, date, time, tz, extra = {}) => ({
  every,
  tz,
  until: null,
  count: null,
  anchor: { date, time, occurrence: 1 },
  ...extra,
});

describe('normalizeRepeat', () => {
  it('keeps the interval and one way of ending', () => {
    expect(normalizeRepeat({ every: 'week' })).toEqual({ every: 'week' });
    expect(normalizeRepeat({ every: 'day', count: 5 })).toEqual({ every: 'day', count: 5 });
    expect(normalizeRepeat({ every: 'day', until: '2026-12-01' })).toEqual({
      every: 'day',
      until: '2026-12-01',
    });
    // A count wins over a date when a stale one is left behind.
    expect(normalizeRepeat({ every: 'day', count: 3, until: '2026-12-01' })).toEqual({
      every: 'day',
      count: 3,
    });
  });

  it('reads the server’s stored rule too', () => {
    expect(
      normalizeRepeat(stored('month', '2026-01-31', '09:00', 'UTC', { count: 12 })),
    ).toEqual({ every: 'month', count: 12 });
    expect(normalizeRepeat(stored('week', '2026-01-05', '09:00', 'UTC'))).toEqual({
      every: 'week',
    });
  });

  it('is null for no rule, or one it can’t read', () => {
    for (const raw of [null, undefined, '', 'week', {}, { every: 'year' }])
      expect(normalizeRepeat(raw)).toBeNull();
    expect(normalizeRepeat({ every: 'day', until: '2026-02-30' })).toEqual({ every: 'day' });
  });

  it('names how a rule ends', () => {
    expect(repeatEnds(null)).toBe('never');
    expect(repeatEnds({ every: 'day' })).toBe('never');
    expect(repeatEnds({ every: 'day', until: '2026-12-01' })).toBe('on');
    expect(repeatEnds({ every: 'day', count: 4 })).toBe('after');
  });
});

describe('repeatProblem', () => {
  const at = '2026-11-16T09:00:00.000Z';
  it('is empty for no rule and for a good one', () => {
    expect(repeatProblem(null, at, 'UTC')).toBe('');
    expect(repeatProblem({ every: 'week' }, at, 'UTC')).toBe('');
    expect(repeatProblem({ every: 'week', count: 2 }, at, 'UTC')).toBe('');
    expect(repeatProblem({ every: 'week', until: '2026-11-16' }, at, 'UTC')).toBe('');
  });

  it('says what is wrong with a count', () => {
    expect(repeatProblem({ every: 'day', count: 1 }, at, 'UTC')).toMatch(/at least twice/);
    expect(repeatProblem({ every: 'day', count: 'x' }, at, 'UTC')).toMatch(/at least twice/);
    expect(repeatProblem({ every: 'day', count: MAX_REPEAT_COUNT + 1 }, at, 'UTC')).toMatch(
      /up to 400 times/,
    );
    expect(repeatProblem({ every: 'day', count: 3 }, at, 'UTC', { occurrence: 5 })).toBe(
      'This post has already gone out 4 times, so it can’t end after 3.',
    );
  });

  it('asks for an end that is only half filled in, rather than reading it as never', () => {
    expect(repeatProblem({ every: 'day', ends: 'on', until: '' }, at, 'UTC')).toBe(
      'Choose the date it ends on.',
    );
    expect(repeatProblem({ every: 'day', ends: 'after', count: '' }, at, 'UTC')).toBe(
      'Say how many times it goes out.',
    );
    expect(repeatEnds({ every: 'day', ends: 'on', until: '' })).toBe('on');
    expect(repeatEnds({ every: 'day', ends: 'after' })).toBe('after');
    // The end the picker means wins over one left behind.
    expect(normalizeRepeat({ every: 'day', ends: 'on', until: '2026-12-01', count: 4 })).toEqual({
      every: 'day',
      until: '2026-12-01',
    });
    expect(normalizeRepeat({ every: 'day', ends: 'after', until: '2026-12-01', count: 4 })).toEqual({
      every: 'day',
      count: 4,
    });
  });

  it('reads the end date on the zone’s calendar', () => {
    expect(repeatProblem({ every: 'day', until: '2026-11-15' }, at, 'UTC')).toMatch(
      /before it first goes out/,
    );
    // 09:00 UTC on the 16th is still the 15th in Honolulu.
    expect(
      repeatProblem({ every: 'day', until: '2026-11-15' }, at, 'Pacific/Honolulu'),
    ).toBe('');
    expect(repeatProblem({ every: 'day', until: 'soon' }, at, 'UTC')).toMatch(/Choose the date/);
  });
});

describe('repeatForServer', () => {
  it('names the zone and one end', () => {
    expect(repeatForServer({ every: 'week', count: 6 }, 'Europe/Paris')).toEqual({
      every: 'week',
      tz: 'Europe/Paris',
      count: 6,
    });
    expect(repeatForServer({ every: 'day', until: '2026-12-01' }, 'UTC')).toEqual({
      every: 'day',
      tz: 'UTC',
      until: '2026-12-01',
    });
    expect(repeatForServer(null, 'UTC')).toBeNull();
  });
});

describe('occurrenceTime and nextOccurrence', () => {
  it('keeps the wall clock across a clock change', () => {
    const daily = stored('day', '2026-10-24', '09:00', 'Europe/Paris');
    expect([1, 2, 3].map((k) => iso(occurrenceTime(daily, k).at))).toEqual([
      '2026-10-24T07:00:00.000Z',
      '2026-10-25T08:00:00.000Z',
      '2026-10-26T08:00:00.000Z',
    ]);
  });

  it('puts the 31st on the last day of a shorter month', () => {
    const monthly = stored('month', '2026-01-31', '09:00', 'UTC');
    expect([1, 2, 3, 4].map((k) => occurrenceTime(monthly, k).date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('names the first slot still ahead, and stops at the end', () => {
    const weekly = stored('week', '2026-11-02', '09:00', 'UTC', { count: 3 });
    expect(nextOccurrence(weekly, 1, Date.parse('2026-11-02T09:01:00Z'))).toEqual({
      occurrence: 2,
      scheduledFor: '2026-11-09T09:00:00.000Z',
    });
    expect(nextOccurrence(weekly, 1, Date.parse('2026-11-10T00:00:00Z')).occurrence).toBe(3);
    expect(nextOccurrence(weekly, 3, 0)).toBeNull();
    expect(
      nextOccurrence({ ...weekly, count: null, until: '2026-11-08' }, 1, 0),
    ).toBeNull();
    expect(nextOccurrence(null, 1)).toBeNull();
  });

  it('anchors the composer’s rule as the server stores it', () => {
    expect(
      anchoredRepeat({ every: 'week', count: 4 }, '2026-11-16T09:00:00.000Z', 'America/New_York', 2),
    ).toEqual({
      every: 'week',
      tz: 'America/New_York',
      until: null,
      count: 4,
      anchor: { date: '2026-11-16', time: '04:00', occurrence: 2 },
    });
    expect(anchoredRepeat(null, '2026-11-16T09:00:00.000Z', 'UTC')).toBeNull();
  });
});

describe('words', () => {
  it('has a label for every interval, and an option for none', () => {
    for (const every of REPEAT_EVERY) expect(repeatLabel(every)).toMatch(/^Every /);
    expect(repeatLabel({ every: '2weeks' })).toBe('Every two weeks');
    expect(repeatLabel('')).toBe('');
    expect(repeatLabel(null)).toBe('');
    expect(REPEAT_OPTIONS[0]).toEqual({ value: '', label: 'Doesn’t repeat' });
  });

  it('says where a row stands in its series', () => {
    expect(repeatProgress({ every: 'day', count: 10 }, 3)).toBe('3 of 10');
    expect(repeatProgress({ every: 'day', until: '2026-12-05' })).toMatch(/^until /);
    expect(repeatProgress({ every: 'day' }, 3)).toBe('');
    expect(repeatProgress(null)).toBe('');
  });

  it('sums the rule up for the picker, with what a month end means', () => {
    expect(repeatSummary({ every: 'week' }, '2026-11-16T09:00:00Z', 'UTC')).toBe(
      'Every week at this time.',
    );
    expect(repeatSummary({ every: 'day', count: 5 }, '2026-11-16T09:00:00Z', 'UTC')).toBe(
      'Every day at this time, 5 times in all.',
    );
    expect(repeatSummary({ every: 'month' }, '2027-01-31T09:00:00Z', 'UTC')).toBe(
      'Every month at this time. In a month with no 31st, it goes out on the last day.',
    );
    expect(repeatSummary({ every: 'month' }, '2027-01-30T09:00:00Z', 'UTC')).toMatch(
      /no 30th/,
    );
    expect(repeatSummary({ every: 'month' }, '2027-01-12T09:00:00Z', 'UTC')).toBe(
      'Every month at this time.',
    );
    expect(repeatSummary(null, '2027-01-12T09:00:00Z', 'UTC')).toBe('');
  });

  it('says a post repeats in a toast', () => {
    expect(repeatClause({ every: 'week' })).toBe(', repeating every week');
    expect(repeatClause(null)).toBe('');
  });
});

describe('rowRepeat', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  const row = (extra = {}) => ({
    scheduledFor: '2026-11-16T09:00:00.000Z',
    seriesId: 's',
    occurrence: 3,
    payload: {
      repeat: stored('week', '2026-11-16', '09:00', 'UTC', {
        count: 10,
        anchor: { date: '2026-11-16', time: '09:00', occurrence: 3 },
      }),
    },
    ...extra,
  });

  it('describes the row that carries a series', () => {
    expect(rowRepeat(row(), now)).toEqual({
      repeats: true,
      label: 'Every week',
      progress: '3 of 10',
      last: false,
      former: false,
    });
  });

  it('knows the last occurrence', () => {
    const last = row({ occurrence: 10 });
    last.payload.repeat.anchor.occurrence = 10;
    expect(rowRepeat(last, now)).toMatchObject({ repeats: true, progress: '10 of 10', last: true });
  });

  it('marks a row its series has moved past, and a plain one', () => {
    expect(rowRepeat({ seriesId: 's', occurrence: 2, payload: {} }, now)).toEqual({
      repeats: false,
      label: '',
      progress: '',
      last: false,
      former: true,
    });
    expect(rowRepeat({ payload: {} }, now).former).toBe(false);
    expect(rowRepeat(null, now).repeats).toBe(false);
  });
});
