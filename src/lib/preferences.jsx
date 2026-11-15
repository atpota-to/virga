// How Virga looks and behaves for whoever is at this browser: the theme, the
// density, the live sky, the period every chart answers for, how numbers and
// dates are written, and whether the sidebar is folded. Kept in localStorage, for every account on the browser
// alike (the archive and the dashboards are per account; these are per
// person at the keyboard).
//
// The theme, accent, contrast and density are also stamped on <html> as
// data-theme, data-accent, data-contrast and data-density, which is what
// the stylesheets read (rootAttributes below). index.html stamps them once
// before the first paint, from the same key, so a dark-mode reader never
// sees a white flash; preferences.test.js runs that script against
// rootAttributes, so the two can't drift.
//
// The formats (locale, first day of the week) are handed to lib/locale.js,
// which the plain formatting functions read. `formats` in the context value
// changes whenever they do; App keys the shell on it, so every page is
// drawn again in the new formats rather than keeping strings in the old.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LOCALE_CHOICES, WEEK_START_CHOICES, localeStamp, resolveLocale, resolveWeekStart, setActiveLocale, setActiveWeekStart } from './locale.js';

export const PREFERENCES_KEY = 'virga:preferences';

/**
 * The accents: the colour of the data and of whatever is pressed. Not a
 * free choice of colour: each of these has a full, checked set of steps in
 * styles/theme.css, and styles/theme.test.js holds every one named here to
 * it. Blue is the one Virga starts with.
 */
export const ACCENT_CHOICES = ['blue', 'violet', 'teal', 'amber', 'rose', 'graphite'];

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'system', // 'system' | 'light' | 'dark'
  accent: 'blue', // one of ACCENT_CHOICES
  contrast: 'system', // 'system' (high when the device asks for more contrast) | 'normal' | 'high'
  density: 'comfortable', // 'comfortable' | 'compact'
  sky: false, // the live hillside behind the app
  // 'archive' (dawn until the first build, then day; dusk, then night, in the dark theme)
  // | 'clock' (the time of day here) | 'dawn' | 'day' | 'dusk' | 'night'. hillside/phase.js reads it.
  skyTime: 'archive',
  skyScope: 'dashboard', // 'dashboard' | 'everywhere'
  period: '30d', // a preset key, or 'custom' with the two days below
  periodFrom: '', // 'YYYY-MM-DD', the first day of a custom range
  periodTo: '', // 'YYYY-MM-DD', its last
  sidebar: 'expanded', // 'expanded' | 'collapsed'
  locale: 'system', // 'system' (English, in the browser's region) | one of LOCALE_CHOICES
  weekStart: 'system', // 'system' (the locale's own) | 'monday' | 'sunday' | 'saturday'
});

const CHOICES = {
  theme: ['system', 'light', 'dark'],
  accent: ACCENT_CHOICES,
  contrast: ['system', 'normal', 'high'],
  density: ['comfortable', 'compact'],
  skyTime: ['archive', 'clock', 'dawn', 'day', 'dusk', 'night'],
  skyScope: ['dashboard', 'everywhere'],
  period: ['7d', '30d', '90d', '1y', 'all', 'custom'],
  sidebar: ['expanded', 'collapsed'],
  locale: ['system', ...LOCALE_CHOICES],
  weekStart: ['system', ...Object.keys(WEEK_START_CHOICES)],
};

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The stored preferences, every key checked: anything missing, or a value
 * this version doesn't know, falls back to its default rather than reaching
 * the stylesheet as nonsense.
 */
export function readPreferences(store = storage()) {
  let raw = null;
  try {
    raw = JSON.parse(store?.getItem(PREFERENCES_KEY) || 'null');
  } catch {
    raw = null;
  }
  const out = { ...DEFAULT_PREFERENCES };
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, allowed] of Object.entries(CHOICES)) {
    if (allowed.includes(raw[key])) out[key] = raw[key];
  }
  if (typeof raw.sky === 'boolean') out.sky = raw.sky;
  for (const key of ['periodFrom', 'periodTo']) {
    if (typeof raw[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw[key])) out[key] = raw[key];
  }
  // A custom period with no readable range is no period at all.
  if (out.period === 'custom' && !(out.periodFrom && out.periodTo)) out.period = DEFAULT_PREFERENCES.period;
  return out;
}

export function writePreferences(prefs, store = storage()) {
  try {
    store?.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    // A full or refused localStorage costs the preference, nothing else.
  }
}

/**
 * Hand the formats a set of preferences means to lib/locale.js, and return
 * the stamp that names them. Safe to call again with the same preferences.
 */
export function applyFormats(prefs) {
  const tag = setActiveLocale(resolveLocale(prefs?.locale));
  setActiveWeekStart(resolveWeekStart(prefs?.weekStart, tag));
  return localeStamp();
}

/** 'light' or 'dark', from the preference and what the system asks for. */
export function effectiveTheme(theme, systemDark) {
  if (theme === 'light' || theme === 'dark') return theme;
  return systemDark ? 'dark' : 'light';
}

/** 'normal' or 'high', from the preference and whether the system asks for more contrast. */
export function effectiveContrast(contrast, systemMore) {
  if (contrast === 'normal' || contrast === 'high') return contrast;
  return systemMore ? 'high' : 'normal';
}

/**
 * What <html> carries for the stylesheets, as its data-* attributes: the
 * theme and contrast in force (the preference, or the system's), the accent
 * and the density. `system` is what the device asks for.
 */
export function rootAttributes(prefs, { dark = false, moreContrast = false } = {}) {
  return {
    theme: effectiveTheme(prefs?.theme, dark),
    accent: ACCENT_CHOICES.includes(prefs?.accent) ? prefs.accent : DEFAULT_PREFERENCES.accent,
    contrast: effectiveContrast(prefs?.contrast, moreContrast),
    density: prefs?.density === 'compact' ? 'compact' : 'comfortable',
  };
}

/**
 * The page ground of a theme, for the browser's own chrome (a phone's
 * toolbar). The same as --bg in styles/theme.css; theme.test.js checks.
 */
export function themeColor(theme, contrast = 'normal') {
  if (contrast === 'high') return theme === 'dark' ? '#000000' : '#ffffff';
  return theme === 'dark' ? '#0c0e12' : '#f5f6f8';
}

const Ctx = createContext(null);

/** Whether the device answers yes to a media query, kept up to date. */
function useSystemQuery(text) {
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(text) : null;
  const [matches, setMatches] = useState(() => Boolean(query?.matches));
  useEffect(() => {
    if (!query) return undefined;
    const onChange = () => setMatches(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
}

export function PreferencesProvider({ children }) {
  const [prefs, setState] = useState(() => readPreferences());
  const systemDark = useSystemQuery('(prefers-color-scheme: dark)');
  const systemMoreContrast = useSystemQuery('(prefers-contrast: more)');
  const { theme, accent, contrast, density } = rootAttributes(prefs, { dark: systemDark, moreContrast: systemMoreContrast });
  // In render, not in an effect: the formats have to be in place before the
  // first child formats a number, and an effect runs after they all have.
  const formats = useMemo(() => applyFormats({ locale: prefs.locale, weekStart: prefs.weekStart }), [prefs.locale, prefs.weekStart]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.accent = accent;
    root.dataset.contrast = contrast;
    root.dataset.density = density;
    // The browser's own chrome (a phone's toolbar) follows the page ground.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', themeColor(theme, contrast));
  }, [theme, accent, contrast, density]);

  const setPref = useCallback((key, value) => {
    setState((prev) => {
      const next = { ...prev, [key]: value };
      writePreferences(next);
      return next;
    });
  }, []);

  /** Several preferences in one write: a custom period is three values that only mean something together. */
  const setPrefs = useCallback((patch) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      writePreferences(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ ...prefs, effectiveTheme: theme, effectiveContrast: contrast, formats, setPref, setPrefs }),
    [prefs, theme, contrast, formats, setPref, setPrefs],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences() {
  const value = useContext(Ctx);
  if (!value) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return value;
}
