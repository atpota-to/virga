import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  activeLocale,
  activeWeekStart,
  fmtInt,
  localeSample,
  localeStamp,
  regionWeekStart,
  resolveLocale,
  resolveWeekStart,
  setActiveLocale,
  setActiveWeekStart,
  systemLocale,
  uses12Hour,
  weekOrder,
  weekdayOffset,
} from './locale.js';
import { bucketStartMs } from './analytics.js';
import { hourColumns, hourRange, weekdayOrder } from '../reports/models.js';

afterEach(() => {
  setActiveLocale(DEFAULT_LOCALE);
  setActiveWeekStart(1);
});

describe('the active formats', () => {
  it('start as US English with a Monday week, which the other tests assume', () => {
    expect(activeLocale()).toBe('en-US');
    expect(activeWeekStart()).toBe(1);
    expect(uses12Hour()).toBe(true);
    expect(fmtInt(1234567)).toBe('1,234,567');
  });

  it('fall back rather than keep something Intl would throw on', () => {
    expect(setActiveLocale('not a locale')).toBe('en-US');
    expect(setActiveLocale(null)).toBe('en-US');
    expect(setActiveWeekStart(9)).toBe(1);
    expect(setActiveWeekStart('sunday')).toBe(1);
  });

  it('change the stamp a cache keys on', () => {
    const before = localeStamp();
    setActiveLocale('en-DE');
    expect(localeStamp()).not.toBe(before);
    const german = localeStamp();
    setActiveWeekStart(0);
    expect(localeStamp()).not.toBe(german);
  });

  it('know which clock a locale reads', () => {
    setActiveLocale('en-GB');
    expect(uses12Hour()).toBe(false);
    setActiveLocale('en-US');
    expect(uses12Hour()).toBe(true);
  });
});

describe('following the browser', () => {
  it('keeps the words English and takes the region', () => {
    expect(systemLocale(['de-DE', 'en'])).toBe('en-DE');
    expect(systemLocale(['en-AU'])).toBe('en-AU');
    expect(systemLocale(['fr'])).toBe('en-FR');
    expect(systemLocale(['ja-JP'])).toBe('en-JP');
  });

  it('gives the default when there is nothing to read', () => {
    expect(systemLocale([])).toBe('en-US');
    expect(systemLocale(['???'])).toBe('en-US');
    expect(systemLocale(null)).toBe('en-US');
  });

  it('is what "system" means; a named format is itself', () => {
    expect(resolveLocale('system', ['nl-NL'])).toBe('en-NL');
    expect(resolveLocale('en-GB', ['nl-NL'])).toBe('en-GB');
    expect(resolveLocale('xx-YY', ['nl-NL'])).toBe('en-NL');
  });
});

describe('the first day of the week', () => {
  it('comes from the region unless a day is named', () => {
    expect(regionWeekStart('en-US')).toBe(0);
    expect(regionWeekStart('en-GB')).toBe(1);
    expect(resolveWeekStart('system', 'en-US')).toBe(0);
    expect(resolveWeekStart('monday', 'en-US')).toBe(1);
    expect(resolveWeekStart('saturday', 'en-GB')).toBe(6);
    expect(resolveWeekStart('someday', 'en-GB')).toBe(1);
  });

  it('orders the week from it', () => {
    expect(weekOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOffset(0, 1)).toBe(6);
    expect(weekdayOffset(0, 0)).toBe(0);
    expect(weekdayOffset(3, 6)).toBe(4);
  });

  it('moves where a week bucket starts', () => {
    // Wednesday 11 November 2026.
    const wed = new Date(2026, 10, 11, 15, 0).getTime();
    expect(new Date(bucketStartMs(wed, 'week')).getDate()).toBe(9); // Monday
    setActiveWeekStart(0);
    expect(new Date(bucketStartMs(wed, 'week')).getDate()).toBe(8); // Sunday
    setActiveWeekStart(6);
    expect(new Date(bucketStartMs(wed, 'week')).getDate()).toBe(7); // Saturday
  });

  it('moves the order the best-time rows are drawn in, not what they mean', () => {
    expect(weekdayOrder()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    setActiveWeekStart(0);
    expect(weekdayOrder()).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });
});

describe('hours', () => {
  it('read on the clock the locale uses', () => {
    expect(hourRange(9, 2)).toBe('6–8 pm');
    expect(hourColumns(2)[1].label).toBe('6a');
    setActiveLocale('en-DE');
    expect(hourRange(9, 2)).toBe('18–20');
    expect(hourRange(11, 2)).toBe('22–00');
    expect(hourColumns(2).map((c) => c.label)).toEqual(['00', '06', '12', '18']);
  });
});

describe('localeSample', () => {
  it('shows a number, a date and a time as the locale writes them', () => {
    expect(localeSample('en-US')).toBe('1,234.5 · Nov 14, 2026 · 2:30 PM');
    expect(localeSample('en-DE')).toBe('1.234,5 · 14 Nov 2026 · 14:30');
  });
});
