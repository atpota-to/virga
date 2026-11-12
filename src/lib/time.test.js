import { describe, it, expect } from 'vitest';
import { formatDateShort, relativeTime } from './time.js';

// Local-time constructors throughout, so the tests hold in any time zone.
const at = (y, m, d, h = 12, min = 0, sec = 0) => new Date(y, m - 1, d, h, min, sec);

describe('relativeTime', () => {
  const now = at(2026, 11, 12, 15, 0);

  it('counts minutes and hours as elapsed time', () => {
    expect(relativeTime(at(2026, 11, 12, 14, 59, 30), now)).toBe('just now');
    expect(relativeTime(at(2026, 11, 12, 14, 55), now)).toBe('5m ago');
    expect(relativeTime(at(2026, 11, 12, 9, 0), now)).toBe('6h ago');
  });

  it('counts days on the calendar, not in 24-hour blocks', () => {
    // 11pm two nights ago is 40 hours back, which is still "2d ago".
    expect(relativeTime(at(2026, 11, 10, 23, 0), now)).toBe('2d ago');
    // Late last night is under a day back, so it stays in hours.
    expect(relativeTime(at(2026, 11, 11, 22, 0), now)).toBe('17h ago');
  });

  it('counts weeks, then gives the date', () => {
    expect(relativeTime(at(2026, 10, 28), now)).toBe('2w ago');
    expect(relativeTime(at(2026, 8, 3), now)).toBe('Aug 3, 2026');
  });

  it('accepts a timestamp or an ISO string, and returns nothing for neither', () => {
    expect(relativeTime(now.getTime() - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(new Date(now.getTime() - 3_600_000).toISOString(), now)).toBe('1h ago');
    expect(relativeTime('not a date', now)).toBe('');
  });
});

describe('formatDateShort', () => {
  it('prints the short date in local time', () => {
    expect(formatDateShort(at(2025, 1, 29))).toBe('Jan 29, 2025');
    expect(formatDateShort(at(2025, 1, 29).getTime())).toBe('Jan 29, 2025');
  });

  it('prints nothing for an unreadable date', () => {
    expect(formatDateShort('nope')).toBe('');
    expect(formatDateShort(null)).toBe('');
  });
});
