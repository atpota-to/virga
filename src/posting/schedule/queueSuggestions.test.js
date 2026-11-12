import { describe, expect, it } from 'vitest';
import {
  mergeSuggestionsIntoSchedule,
  missingSuggestions,
  scheduleFromSuggestions,
  suggestionsFromBestTimes,
} from './queueSuggestions.js';

// Suggested times come from the account's own best times to post. They are
// offered, never applied: a shipped week may be replaced, any other only added
// to.

describe('suggestionsFromBestTimes', () => {
  it('turns the best cells into the start of their hours, Monday first', () => {
    expect(
      suggestionsFromBestTimes(
        [
          { day: 0, col: 9, avg: 12, posts: 4 },
          { day: 6, col: 20, avg: 9, posts: 3 },
        ],
        1,
      ),
    ).toEqual([
      { dayKey: 'mon', time: '09:00' },
      { dayKey: 'sun', time: '20:00' },
    ]);
  });

  it('reads two-hour columns as their first hour', () => {
    expect(suggestionsFromBestTimes([{ day: 2, col: 9 }], 2)).toEqual([
      { dayKey: 'wed', time: '18:00' },
    ]);
  });

  it('drops cells it can’t place, and repeats', () => {
    expect(
      suggestionsFromBestTimes(
        [
          { day: 9, col: 1 },
          { day: 1, col: 30 },
          null,
          { day: 1, col: 3 },
          { day: 1, col: 3 },
        ],
        1,
      ),
    ).toEqual([{ dayKey: 'tue', time: '03:00' }]);
    expect(suggestionsFromBestTimes(undefined)).toEqual([]);
  });
});

describe('placing suggestions in a week', () => {
  const week = {
    timezone: 'Europe/Paris',
    slots: { mon: ['09:00'], fri: ['17:00'] },
  };
  const picks = [
    { dayKey: 'mon', time: '09:00' },
    { dayKey: 'mon', time: '07:00' },
    { dayKey: 'sat', time: '11:00' },
  ];

  it('lists what the week lacks', () => {
    expect(missingSuggestions(week, picks)).toEqual(picks.slice(1));
    expect(missingSuggestions(null, picks)).toEqual(picks);
  });

  it('adds them in order, keeping what was there and the week’s zone', () => {
    const merged = mergeSuggestionsIntoSchedule(week, picks);
    expect(merged.timezone).toBe('Europe/Paris');
    expect(merged.slots.mon).toEqual(['07:00', '09:00']);
    expect(merged.slots.sat).toEqual(['11:00']);
    expect(merged.slots.fri).toEqual(['17:00']);
    // The week handed in is left alone.
    expect(week.slots.mon).toEqual(['09:00']);
  });

  it('builds a week of them alone, every day present', () => {
    const fresh = scheduleFromSuggestions(picks, 'America/Chicago');
    expect(fresh.timezone).toBe('America/Chicago');
    expect(fresh.slots).toEqual({
      mon: ['07:00', '09:00'],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: ['11:00'],
      sun: [],
    });
  });
});
