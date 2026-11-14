// How Virga looks and behaves for whoever is at this browser: the theme, the
// density, the live sky, the period every chart answers for, how numbers and
// dates are written, and whether the sidebar is folded. Kept in localStorage, for every account on the browser
// alike (the archive and the dashboards are per account; these are per
// person at the keyboard).
//
// The theme and density are also stamped on <html> as data-theme and
// data-density, which is what the stylesheets read. index.html stamps them
// once before the first paint, from the same key, so a dark-mode reader
// never sees a white flash.
//
// The formats (locale, first day of the week) are handed to lib/locale.js,
// which the plain formatting functions read. `formats` in the context value
// changes whenever they do; App keys the shell on it, so every page is
// drawn again in the new formats rather than keeping strings in the old.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LOCALE_CHOICES, WEEK_START_CHOICES, localeStamp, resolveLocale, resolveWeekStart, setActiveLocale, setActiveWeekStart } from './locale.js';

export const PREFERENCES_KEY = 'virga:preferences';

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'system', // 'system' | 'light' | 'dark'
  density: 'comfortable', // 'comfortable' | 'compact'
  sky: false, // the live hillside behind the app
  skyTime: 'archive', // 'archive' (dawn until the first build, then day) | 'day' | 'dawn'
  skyScope: 'dashboard', // 'dashboard' | 'everywhere'
  period: '30d',
  sidebar: 'expanded', // 'expanded' | 'collapsed'
  locale: 'system', // 'system' (English, in the browser's region) | one of LOCALE_CHOICES
  weekStart: 'system', // 'system' (the locale's own) | 'monday' | 'sunday' | 'saturday'
});

const CHOICES = {
  theme: ['system', 'light', 'dark'],
  density: ['comfortable', 'compact'],
  skyTime: ['archive', 'day', 'dawn'],
  skyScope: ['dashboard', 'everywhere'],
  period: ['7d', '30d', '90d', '1y', 'all'],
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

const Ctx = createContext(null);

function useSystemDark() {
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const [dark, setDark] = useState(() => Boolean(query?.matches));
  useEffect(() => {
    if (!query) return undefined;
    const onChange = () => setDark(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, [query]);
  return dark;
}

export function PreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(() => readPreferences());
  const systemDark = useSystemDark();
  const theme = effectiveTheme(prefs.theme, systemDark);
  // In render, not in an effect: the formats have to be in place before the
  // first child formats a number, and an effect runs after they all have.
  const formats = useMemo(() => applyFormats({ locale: prefs.locale, weekStart: prefs.weekStart }), [prefs.locale, prefs.weekStart]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = prefs.density;
    // The browser's own chrome (a phone's toolbar) follows the page ground.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0c0e12' : '#f5f6f8');
  }, [theme, prefs.density]);

  const setPref = useCallback((key, value) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      writePreferences(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ ...prefs, effectiveTheme: theme, formats, setPref }), [prefs, theme, formats, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences() {
  const value = useContext(Ctx);
  if (!value) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return value;
}
