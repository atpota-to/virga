import { describe, expect, it } from 'vitest';
import { afterEach } from 'vitest';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, applyFormats, effectiveTheme, readPreferences } from './preferences.jsx';
import { activeLocale, activeWeekStart, setActiveLocale, setActiveWeekStart } from './locale.js';

function store(value) {
  return { getItem: (k) => (k === PREFERENCES_KEY ? value : null) };
}

describe('preferences', () => {
  it('are the defaults when nothing is stored, or something unreadable is', () => {
    expect(readPreferences(store(null))).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences(store('{not json'))).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it('keep the values this version knows and drop the rest', () => {
    const out = readPreferences(store(JSON.stringify({ theme: 'dark', density: 'roomy', sky: true, period: '90d', extra: 1 })));
    expect(out).toEqual({ ...DEFAULT_PREFERENCES, theme: 'dark', sky: true, period: '90d' });
  });

  it('keep the live sky off unless it was asked for', () => {
    expect(DEFAULT_PREFERENCES.sky).toBe(false);
    expect(readPreferences(store(JSON.stringify({ sky: 'yes' }))).sky).toBe(false);
  });

  it('follow the system only when asked to', () => {
    expect(effectiveTheme('system', true)).toBe('dark');
    expect(effectiveTheme('system', false)).toBe('light');
    expect(effectiveTheme('light', true)).toBe('light');
    expect(effectiveTheme('dark', false)).toBe('dark');
  });

  it('keep a named format and week start, and follow the browser otherwise', () => {
    const out = readPreferences(store(JSON.stringify({ locale: 'en-GB', weekStart: 'sunday' })));
    expect(out.locale).toBe('en-GB');
    expect(out.weekStart).toBe('sunday');
    const odd = readPreferences(store(JSON.stringify({ locale: 'tlh', weekStart: 'someday' })));
    expect(odd.locale).toBe('system');
    expect(odd.weekStart).toBe('system');
  });
});

describe('applyFormats', () => {
  afterEach(() => {
    setActiveLocale('en-US');
    setActiveWeekStart(1);
  });

  it('hands the formats to lib/locale.js and names them', () => {
    const stamp = applyFormats({ locale: 'en-GB', weekStart: 'sunday' });
    expect(activeLocale()).toBe('en-GB');
    expect(activeWeekStart()).toBe(0);
    expect(applyFormats({ locale: 'en-GB', weekStart: 'sunday' })).toBe(stamp);
    expect(applyFormats({ locale: 'en-GB', weekStart: 'monday' })).not.toBe(stamp);
  });

  it('takes the week start from the format when none is named', () => {
    applyFormats({ locale: 'en-US', weekStart: 'system' });
    expect(activeWeekStart()).toBe(0);
    applyFormats({ locale: 'en-DE', weekStart: 'system' });
    expect(activeWeekStart()).toBe(1);
  });
});
