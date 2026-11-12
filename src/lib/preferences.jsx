// How Virga looks and behaves for whoever is at this browser: the theme, the
// density, the live sky, the period every chart answers for, and whether the
// sidebar is folded. Kept in localStorage, for every account on the browser
// alike (the archive and the dashboards are per account; these are per
// person at the keyboard).
//
// The theme and density are also stamped on <html> as data-theme and
// data-density, which is what the stylesheets read. index.html stamps them
// once before the first paint, from the same key, so a dark-mode reader
// never sees a white flash.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const PREFERENCES_KEY = 'virga:preferences';

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'system', // 'system' | 'light' | 'dark'
  density: 'comfortable', // 'comfortable' | 'compact'
  sky: false, // the live hillside behind the app
  skyTime: 'archive', // 'archive' (dawn until the first build, then day) | 'day' | 'dawn'
  skyScope: 'dashboard', // 'dashboard' | 'everywhere'
  period: '30d',
  sidebar: 'expanded', // 'expanded' | 'collapsed'
});

const CHOICES = {
  theme: ['system', 'light', 'dark'],
  density: ['comfortable', 'compact'],
  skyTime: ['archive', 'day', 'dawn'],
  skyScope: ['dashboard', 'everywhere'],
  period: ['7d', '30d', '90d', '1y', 'all'],
  sidebar: ['expanded', 'collapsed'],
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

  const value = useMemo(() => ({ ...prefs, effectiveTheme: theme, setPref }), [prefs, theme, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences() {
  const value = useContext(Ctx);
  if (!value) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return value;
}
