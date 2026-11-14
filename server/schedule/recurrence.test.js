// When a repeating post next goes out: the wall clock of its zone across
// clock changes, month ends, the ends of a series, and slots missed while
// nothing ran.

import { describe, it, expect } from 'vitest';
import {
  MAX_REPEAT_COUNT,
  REPEAT_EVERY,
  isTimeZone,
  nextOccurrence,
  occurrenceTime,
  reanchor,
  validateRepeat,
  wallTimeInZone,
  wallTimeToUtc,
} from './recurrence.js';

const ms = (iso) => Date.parse(iso);
const iso = (at) => new Date(at).toISOString();

/** A stored rule anchored at a wall-clock time. */
const rule = (every, date, time, tz, extra = {}) => ({
  every,
  tz,
  until: null,
  count: null,
  anchor: { date, time, occurrence: 1 },
  ...extra,
});

/** The instants of occurrences 1..n. */
const times = (repeat, n) =>
  Array.from({ length: n }, (_, i) => iso(occurrenceTime(repeat, i + 1).at));

describe('wall clocks', () => {
  it('knows a real zone from a made-up one', () => {
    expect(isTimeZone('Europe/Paris')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone(null)).toBe(false);
  });

  it('reads an instant on a zone’s clock, on both sides of a clock change', () => {
    expect(wallTimeInZone(ms('2026-07-01T07:00:00Z'), 'Europe/Paris')).toEqual({
      date: '2026-07-01',
      time: '09:00',
    });
    expect(wallTimeInZone(ms('2026-12-01T08:00:00Z'), 'Europe/Paris')).toEqual({
      date: '2026-12-01',
      time: '09:00',
    });
    // Late evening in New York is already tomorrow in UTC.
    expect(
      wallTimeInZone(ms('2026-03-01T03:30:00Z'), 'America/New_York'),
    ).toEqual({ date: '2026-02-28', time: '22:30' });
  });

  it('turns a wall-clock time back into its instant', () => {
    expect(iso(wallTimeToUtc('2026-07-01', '09:00', 'Europe/Paris'))).toBe(
      '2026-07-01T07:00:00.000Z',
    );
    expect(iso(wallTimeToUtc('2026-12-01', '09:00', 'Europe/Paris'))).toBe(
      '2026-12-01T08:00:00.000Z',
    );
    expect(iso(wallTimeToUtc('2026-06-15', '00:00', 'Asia/Kolkata'))).toBe(
      '2026-06-14T18:30:00.000Z',
    );
  });

  it('moves a time that doesn’t exist on a spring-forward day to just past the gap', () => {
    // 29 March 2026, Paris: 02:00 to 03:00 doesn't happen.
    expect(iso(wallTimeToUtc('2026-03-29', '02:30', 'Europe/Paris'))).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(
      wallTimeInZone(wallTimeToUtc('2026-03-29', '02:30', 'Europe/Paris'), 'Europe/Paris'),
    ).toEqual({ date: '2026-03-29', time: '03:30' });
  });

  it('refuses a date or a time that isn’t one', () => {
    expect(wallTimeToUtc('2026-02-30', '09:00', 'UTC')).toBeNull();
    expect(wallTimeToUtc('2026-2-3', '09:00', 'UTC')).toBeNull();
    expect(wallTimeToUtc('2026-02-03', '24:00', 'UTC')).toBeNull();
    expect(wallTimeToUtc('2026-02-03', '9:00', 'UTC')).toBeNull();
  });
});

describe('occurrenceTime', () => {
  it('keeps 9:00 at 9:00 across the autumn clock change, daily', () => {
    // Paris leaves summer time on 25 October 2026.
    const daily = rule('day', '2026-10-23', '09:00', 'Europe/Paris');
    expect(times(daily, 5)).toEqual([
      '2026-10-23T07:00:00.000Z',
      '2026-10-24T07:00:00.000Z',
      '2026-10-25T08:00:00.000Z',
      '2026-10-26T08:00:00.000Z',
      '2026-10-27T08:00:00.000Z',
    ]);
  });

  it('keeps 9:00 at 9:00 across the spring clock change, weekly and every two weeks', () => {
    // New York enters daylight time on 8 March 2026.
    const weekly = rule('week', '2026-03-02', '09:00', 'America/New_York');
    expect(times(weekly, 3)).toEqual([
      '2026-03-02T14:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
      '2026-03-16T13:00:00.000Z',
    ]);
    const fortnightly = rule('2weeks', '2026-03-02', '09:00', 'America/New_York');
    expect(times(fortnightly, 3)).toEqual([
      '2026-03-02T14:00:00.000Z',
      '2026-03-16T13:00:00.000Z',
      '2026-03-30T13:00:00.000Z',
    ]);
  });

  it('goes back to its own time the day after a gap swallowed it', () => {
    const daily = rule('day', '2026-03-28', '02:30', 'Europe/Paris');
    expect(times(daily, 3)).toEqual([
      '2026-03-28T01:30:00.000Z', // 02:30, winter time
      '2026-03-29T01:30:00.000Z', // 03:30: 02:30 doesn't exist that day
      '2026-03-30T00:30:00.000Z', // 02:30 again, summer time
    ]);
  });

  it('puts the 31st on the last day of a shorter month, and back on the 31st after', () => {
    const monthly = rule('month', '2026-01-31', '09:00', 'UTC');
    expect(times(monthly, 6).map((t) => t.slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('gives 29 February to a leap year only', () => {
    const monthly = rule('month', '2027-12-29', '12:00', 'UTC');
    expect(times(monthly, 4).map((t) => t.slice(0, 10))).toEqual([
      '2027-12-29',
      '2028-01-29',
      '2028-02-29',
      '2028-03-29',
    ]);
    const short = rule('month', '2026-12-30', '12:00', 'UTC');
    expect(times(short, 3).map((t) => t.slice(0, 10))).toEqual([
      '2026-12-30',
      '2027-01-30',
      '2027-02-28',
    ]);
  });

  it('rolls monthly over the year, in the zone’s own days', () => {
    // 23:30 on the 31st in Auckland is the morning of the 31st in UTC.
    const monthly = rule('month', '2026-10-31', '23:30', 'Pacific/Auckland');
    expect(times(monthly, 4)).toEqual([
      '2026-10-31T10:30:00.000Z',
      '2026-11-30T10:30:00.000Z',
      '2026-12-31T10:30:00.000Z',
      '2027-01-31T10:30:00.000Z',
    ]);
  });

  it('counts from the anchor’s own number, so a moved series keeps its numbering', () => {
    const moved = rule('week', '2026-06-03', '10:00', 'UTC', {
      anchor: { date: '2026-06-03', time: '10:00', occurrence: 4 },
    });
    expect(iso(occurrenceTime(moved, 4).at)).toBe('2026-06-03T10:00:00.000Z');
    expect(iso(occurrenceTime(moved, 6).at)).toBe('2026-06-17T10:00:00.000Z');
    expect(occurrenceTime(moved, 3)).toBeNull();
  });

  it('answers null for a rule it can’t read', () => {
    expect(occurrenceTime(null, 1)).toBeNull();
    expect(occurrenceTime({ every: 'year' }, 1)).toBeNull();
    expect(
      occurrenceTime(rule('day', '2026-01-01', '09:00', 'Mars/Olympus'), 2),
    ).toBeNull();
    expect(occurrenceTime(rule('day', 'soon', '09:00', 'UTC'), 2)).toBeNull();
  });
});

describe('nextOccurrence', () => {
  const weekly = rule('week', '2026-11-02', '09:00', 'Europe/London');

  it('names the occurrence after this one', () => {
    expect(nextOccurrence(weekly, 1, ms('2026-11-02T09:00:30Z'))).toEqual({
      occurrence: 2,
      scheduledFor: '2026-11-09T09:00:00.000Z',
    });
  });

  it('skips slots that passed while nothing ran, and still counts them', () => {
    // Occurrence 1 went out three weeks late.
    expect(nextOccurrence(weekly, 1, ms('2026-11-24T12:00:00Z'))).toEqual({
      occurrence: 5,
      scheduledFor: '2026-11-30T09:00:00.000Z',
    });
    const counted = { ...weekly, count: 4 };
    expect(nextOccurrence(counted, 1, ms('2026-11-24T12:00:00Z'))).toBeNull();
  });

  it('never names a slot at or before now', () => {
    expect(nextOccurrence(weekly, 1, ms('2026-11-09T09:00:00Z'))).toEqual({
      occurrence: 3,
      scheduledFor: '2026-11-16T09:00:00.000Z',
    });
  });

  it('ends after its count', () => {
    const thrice = { ...weekly, count: 3 };
    const now = ms('2026-11-02T09:01:00Z');
    expect(nextOccurrence(thrice, 1, now).occurrence).toBe(2);
    expect(nextOccurrence(thrice, 2, now).occurrence).toBe(3);
    expect(nextOccurrence(thrice, 3, now)).toBeNull();
  });

  it('ends after its end date, which is the last day one may go out on', () => {
    const until = { ...weekly, until: '2026-11-16' };
    const now = ms('2026-11-02T09:01:00Z');
    expect(nextOccurrence(until, 2, now)).toEqual({
      occurrence: 3,
      scheduledFor: '2026-11-16T09:00:00.000Z',
    });
    expect(nextOccurrence(until, 3, now)).toBeNull();
    expect(
      nextOccurrence({ ...weekly, until: '2026-11-15' }, 2, now),
    ).toBeNull();
  });

  it('reads the end date on the zone’s calendar, not UTC’s', () => {
    // 23:00 on the 5th in Los Angeles is already the 6th in UTC.
    const late = rule('day', '2026-08-03', '23:00', 'America/Los_Angeles', {
      until: '2026-08-05',
    });
    const now = ms('2026-08-04T07:00:00Z');
    expect(nextOccurrence(late, 2, now)).toEqual({
      occurrence: 3,
      scheduledFor: '2026-08-06T06:00:00.000Z',
    });
    expect(nextOccurrence(late, 3, now)).toBeNull();
  });

  it('answers null for a rule it can’t read, rather than guessing', () => {
    expect(nextOccurrence(null, 1)).toBeNull();
    expect(nextOccurrence({ every: 'week' }, 1)).toBeNull();
  });

  it('gives up on a series that has missed years of slots', () => {
    const daily = rule('day', '2000-01-01', '09:00', 'UTC');
    expect(nextOccurrence(daily, 1, ms('2026-11-14T00:00:00Z'))).toBeNull();
  });
});

describe('validateRepeat', () => {
  const at = '2026-11-16T09:00:00.000Z';
  const ok = (raw, opts) =>
    validateRepeat(raw, { scheduledFor: at, fallbackTz: 'Europe/London', ...opts });

  it('is null for a post that doesn’t repeat', () => {
    for (const raw of [null, undefined, false])
      expect(ok(raw)).toEqual({ value: null });
  });

  it('anchors the rule at the scheduled time on the zone’s clock', () => {
    expect(ok({ every: 'week', tz: 'America/New_York' })).toEqual({
      value: {
        every: 'week',
        tz: 'America/New_York',
        until: null,
        count: null,
        anchor: { date: '2026-11-16', time: '04:00', occurrence: 1 },
      },
    });
  });

  it('falls back to the scheduling device’s zone, and refuses to guess past that', () => {
    expect(ok({ every: 'day' }).value.tz).toBe('Europe/London');
    expect(ok({ every: 'day', tz: 'Nowhere/Much' }).value.tz).toBe('Europe/London');
    expect(
      validateRepeat({ every: 'day' }, { scheduledFor: at }).error,
    ).toMatch(/time zone/);
  });

  it('takes every interval it names and no other', () => {
    for (const every of REPEAT_EVERY) expect(ok({ every }).value.every).toBe(every);
    for (const every of ['year', 'hour', '', undefined, 7])
      expect(ok({ every }).error).toMatch(/repeat\.every must be one of/);
    expect(ok('weekly').error).toBe('repeat must be an object');
    expect(ok([]).error).toBe('repeat must be an object');
  });

  it('takes an end date on or after the first occurrence', () => {
    expect(ok({ every: 'day', until: '2026-11-16' }).value.until).toBe('2026-11-16');
    expect(ok({ every: 'day', until: '2026-11-15' }).error).toMatch(
      /before it next goes out/,
    );
    expect(ok({ every: 'day', until: '2026-02-30' }).error).toMatch(/YYYY-MM-DD/);
    expect(ok({ every: 'day', until: 20261116 }).error).toMatch(/YYYY-MM-DD/);
  });

  it('takes a count from two to the ceiling', () => {
    expect(ok({ every: 'day', count: 2 }).value.count).toBe(2);
    expect(ok({ every: 'day', count: '10' }).value.count).toBe(10);
    expect(ok({ every: 'day', count: MAX_REPEAT_COUNT }).value.count).toBe(
      MAX_REPEAT_COUNT,
    );
    expect(ok({ every: 'day', count: 1 }).error).toMatch(/at least twice/);
    expect(ok({ every: 'day', count: 2.5 }).error).toMatch(/at least twice/);
    expect(ok({ every: 'day', count: MAX_REPEAT_COUNT + 1 }).error).toMatch(
      /at most 400 times/,
    );
  });

  it('refuses both ends at once', () => {
    expect(ok({ every: 'day', count: 3, until: '2026-12-01' }).error).toMatch(
      /not both/,
    );
  });

  it('numbers the anchor for an occurrence being edited, and holds the count to it', () => {
    const edit = ok({ every: 'week', count: 10 }, { occurrence: 4 });
    expect(edit.value.anchor.occurrence).toBe(4);
    expect(ok({ every: 'week', count: 4 }, { occurrence: 4 }).value.count).toBe(4);
    expect(ok({ every: 'week', count: 3 }, { occurrence: 4 }).error).toMatch(
      /already gone out 3 times/,
    );
  });

  it('needs a time to repeat from', () => {
    expect(
      validateRepeat({ every: 'day', tz: 'UTC' }, { scheduledFor: 'soon' }).error,
    ).toMatch(/needs a time/);
  });
});

describe('reanchor', () => {
  it('moves the anchor to a new time, keeping the rest of the rule', () => {
    const weekly = rule('week', '2026-11-02', '09:00', 'Europe/Paris', {
      count: 8,
    });
    const moved = reanchor(weekly, '2026-11-18T16:30:00.000Z', 3);
    expect(moved).toEqual({
      ...weekly,
      anchor: { date: '2026-11-18', time: '17:30', occurrence: 3 },
    });
    expect(nextOccurrence(moved, 3, ms('2026-11-18T17:00:00Z'))).toEqual({
      occurrence: 4,
      scheduledFor: '2026-11-25T16:30:00.000Z',
    });
  });

  it('leaves a rule it can’t read as it is', () => {
    expect(reanchor({ every: 'week' }, '2026-11-18T16:30:00.000Z', 3)).toEqual({
      every: 'week',
    });
  });
});
