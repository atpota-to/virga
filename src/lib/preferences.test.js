import { describe, expect, it } from 'vitest';
import { afterEach } from 'vitest';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, applyFormats, effectiveTheme, readPreferences } from './preferences.jsx';
import { activeLocale, activeWeekStart, setActiveLocale, setActiveWeekStart } from './locale.js';
import { readFileSync } from 'node:fs';
import { ACCENT_CHOICES, effectiveContrast, rootAttributes, themeColor } from './preferences.jsx';

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

describe('a custom period', () => {
  it('is kept with its two days, and dropped without them', () => {
    const kept = readPreferences(store(JSON.stringify({ period: 'custom', periodFrom: '2026-10-01', periodTo: '2026-10-31' })));
    expect(kept).toMatchObject({ period: 'custom', periodFrom: '2026-10-01', periodTo: '2026-10-31' });
    expect(readPreferences(store(JSON.stringify({ period: 'custom', periodFrom: '2026-10-01' }))).period).toBe('30d');
    expect(readPreferences(store(JSON.stringify({ period: 'custom', periodFrom: 'October', periodTo: '2026-10-31' }))).period).toBe('30d');
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

describe('the accent, the contrast and the sky’s time', () => {
  it('start as blue, the system’s contrast, and the sky following the archive', () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({ accent: 'blue', contrast: 'system', skyTime: 'archive' });
    expect(ACCENT_CHOICES[0]).toBe('blue');
  });

  it('keep a choice this version knows and drop one it doesn’t', () => {
    const kept = readPreferences(store(JSON.stringify({ accent: 'teal', contrast: 'high', skyTime: 'dusk' })));
    expect(kept).toMatchObject({ accent: 'teal', contrast: 'high', skyTime: 'dusk' });
    for (const skyTime of ['archive', 'clock', 'dawn', 'day', 'dusk', 'night']) {
      expect(readPreferences(store(JSON.stringify({ skyTime }))).skyTime).toBe(skyTime);
    }
    // Not a colour picker: a hex value is no accent.
    const odd = readPreferences(store(JSON.stringify({ accent: '#ff00ff', contrast: 'max', skyTime: 'noon' })));
    expect(odd).toMatchObject({ accent: 'blue', contrast: 'system', skyTime: 'archive' });
  });

  it('follow the system’s contrast only when asked to', () => {
    expect(effectiveContrast('system', true)).toBe('high');
    expect(effectiveContrast('system', false)).toBe('normal');
    expect(effectiveContrast('normal', true)).toBe('normal');
    expect(effectiveContrast('high', false)).toBe('high');
  });

  it('are stamped on the page as four attributes, with nothing unknown let through', () => {
    expect(rootAttributes(DEFAULT_PREFERENCES)).toEqual({ theme: 'light', accent: 'blue', contrast: 'normal', density: 'comfortable' });
    expect(rootAttributes(DEFAULT_PREFERENCES, { dark: true, moreContrast: true })).toEqual({ theme: 'dark', accent: 'blue', contrast: 'high', density: 'comfortable' });
    expect(rootAttributes({ theme: 'light', accent: 'rose', contrast: 'normal', density: 'compact' }, { dark: true, moreContrast: true })).toEqual({
      theme: 'light',
      accent: 'rose',
      contrast: 'normal',
      density: 'compact',
    });
    expect(rootAttributes({ accent: 'mauve', density: 'roomy' })).toMatchObject({ accent: 'blue', density: 'comfortable' });
    expect(rootAttributes(null)).toMatchObject({ theme: 'light', accent: 'blue' });
  });

  it('give the browser’s chrome the page ground', () => {
    expect(themeColor('light')).toBe('#f5f6f8');
    expect(themeColor('dark')).toBe('#0c0e12');
    expect(themeColor('light', 'high')).toBe('#ffffff');
    expect(themeColor('dark', 'high')).toBe('#000000');
  });
});

describe('the script that stamps the page before the first paint', () => {
  const scriptOf = (path) => /<script>([\s\S]*?)<\/script>/.exec(readFileSync(new URL(path, import.meta.url), 'utf8'))[1];
  const app = scriptOf('../../index.html');

  /** Run the inline script against a stand-in page, and return what it stamped on <html>. */
  function stamp(script, stored, { dark = false, moreContrast = false, storageThrows = false, noMatchMedia = false } = {}) {
    const dataset = {};
    const storage = {
      getItem: (key) => {
        if (storageThrows) throw new Error('refused');
        return key === PREFERENCES_KEY ? stored : null;
      },
    };
    const matchMedia = (query) => ({ matches: query.includes('prefers-color-scheme: dark') ? dark : query.includes('prefers-contrast: more') ? moreContrast : false });
    new Function('localStorage', 'document', 'window', script)(storage, { documentElement: { dataset } }, noMatchMedia ? {} : { matchMedia });
    return dataset;
  }

  it('is the same in the app and in the harness', () => {
    expect(scriptOf('../../harness/index.html')).toBe(app);
  });

  it('stamps what the provider will, for every stored choice and every device', () => {
    const stored = [
      null,
      '{not json',
      '5',
      '{}',
      JSON.stringify({ theme: 'dark', accent: 'graphite', contrast: 'high', density: 'compact' }),
      JSON.stringify({ theme: 'light', accent: 'blue', contrast: 'normal' }),
      JSON.stringify({ theme: 'system', accent: 'mauve', contrast: 'max', density: 'roomy' }),
      ...ACCENT_CHOICES.map((accent) => JSON.stringify({ accent })),
    ];
    for (const value of stored) {
      for (const dark of [false, true]) {
        for (const moreContrast of [false, true]) {
          const system = { dark, moreContrast };
          expect(stamp(app, value, system), `${value} on ${JSON.stringify(system)}`).toEqual(rootAttributes(readPreferences(store(value)), system));
        }
      }
    }
  });

  it('still stamps the defaults where storage is refused or the browser can’t be asked', () => {
    expect(stamp(app, null, { storageThrows: true, dark: true })).toEqual({ theme: 'dark', accent: 'blue', contrast: 'normal', density: 'comfortable' });
    expect(stamp(app, null, { noMatchMedia: true })).toEqual({ theme: 'light', accent: 'blue', contrast: 'normal', density: 'comfortable' });
  });
});
