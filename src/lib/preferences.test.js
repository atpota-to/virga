import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, effectiveTheme, readPreferences } from './preferences.jsx';

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
});
