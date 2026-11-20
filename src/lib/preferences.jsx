// How Virga looks and behaves for whoever is at this browser: the sky, the
// accent, the density, the period every chart answers for, how numbers and
// dates are written, and whether the sidebar is folded. Kept in localStorage,
// for every account on the browser alike (the archive and the dashboards are
// per account; these are per person at the keyboard).
//
// The sky is the theme (lib/sky.js): dawn, day and dusk are light pages,
// night is the dark one, and the sky can follow the clock. The sky in force,
// the theme it brings, the accent, the contrast and the density are stamped
// on <html> as data-sky, data-theme, data-accent, data-contrast and
// data-density, which is what the stylesheets read (rootAttributes below).
// index.html stamps them once before the first paint, from the same key, so
// a reader at night never sees a white flash; preferences.test.js runs that
// script against rootAttributes, so the two can't drift.
//
// The formats (locale, first day of the week) are handed to lib/locale.js,
// which the plain formatting functions read. `formats` in the context value
// changes whenever they do; App keys the shell on it, so every page is
// drawn again in the new formats rather than keeping strings in the old.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LOCALE_CHOICES, WEEK_START_CHOICES, localeStamp, resolveLocale, resolveWeekStart, setActiveLocale, setActiveWeekStart } from './locale.js';
import { SKY_CHOICES, hourOf, phaseAtHour, skyColor, skyFor, themeOf } from './sky.js';

export { SKY_CHOICES, skyColor };

export const PREFERENCES_KEY = 'virga:preferences';

/**
 * The accents: the colour of the data and of whatever is pressed. Not a
 * free choice of colour: each of these has a full, checked set of steps in
 * styles/theme.css, and styles/theme.test.js holds every one named here to
 * it. Blue is the one Virga starts with.
 */
export const ACCENT_CHOICES = ['blue', 'violet', 'teal', 'amber', 'rose', 'graphite'];

export const DEFAULT_PREFERENCES = Object.freeze({
  // 'clock' (the time of day here; night on a device set to dark) | 'dawn' | 'day' | 'dusk' | 'night'.
  // Night is the dark theme. lib/sky.js reads it.
  sky: 'clock',
  liveSky: false, // the 3D hillside, drawn in the sky at the top of the page
  accent: 'blue', // one of ACCENT_CHOICES
  contrast: 'system', // 'system' (high when the device asks for more contrast) | 'normal' | 'high'
  density: 'comfortable', // 'comfortable' | 'compact'
  period: '30d', // a preset key, or 'custom' with the two days below
  periodFrom: '', // 'YYYY-MM-DD', the first day of a custom range
  periodTo: '', // 'YYYY-MM-DD', its last
  sidebar: 'expanded', // 'expanded' | 'collapsed'
  locale: 'system', // 'system' (English, in the browser's region) | one of LOCALE_CHOICES
  weekStart: 'system', // 'system' (the locale's own) | 'monday' | 'sunday' | 'saturday'
  // 'on' | 'off'. Off, no view count is read or shown on this browser
  // (lib/views.js), for anyone who would rather not see them.
  viewCounts: 'on',
});

const CHOICES = {
  sky: SKY_CHOICES,
  accent: ACCENT_CHOICES,
  contrast: ['system', 'normal', 'high'],
  density: ['comfortable', 'compact'],
  period: ['7d', '30d', '90d', '1y', 'all', 'custom'],
  sidebar: ['expanded', 'collapsed'],
  locale: ['system', ...LOCALE_CHOICES],
  weekStart: ['system', ...Object.keys(WEEK_START_CHOICES)],
  viewCounts: ['on', 'off'],
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
  if (typeof raw.liveSky === 'boolean') out.liveSky = raw.liveSky;
  // What an earlier version stored: `theme` was light, dark or the system's,
  // and `sky` was the switch for the live hillside. A theme that was picked
  // becomes the sky that looks like it, and the switch keeps its meaning.
  if (!SKY_CHOICES.includes(raw.sky)) {
    if (raw.theme === 'dark') out.sky = 'night';
    else if (raw.theme === 'light') out.sky = 'day';
    if (typeof raw.sky === 'boolean' && typeof raw.liveSky !== 'boolean') out.liveSky = raw.sky;
  }
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

/** 'normal' or 'high', from the preference and whether the system asks for more contrast. */
export function effectiveContrast(contrast, systemMore) {
  if (contrast === 'normal' || contrast === 'high') return contrast;
  return systemMore ? 'high' : 'normal';
}

/**
 * What <html> carries for the stylesheets, as its data-* attributes: the sky
 * in force (the one picked, or the clock's) and the theme it brings, the
 * contrast in force (the preference, or the system's), the accent and the
 * density. The second argument is what the device says: whether it asks for
 * a dark page or for more contrast, and its local hour.
 */
export function rootAttributes(prefs, { dark = false, moreContrast = false, hour = 12 } = {}) {
  const sky = skyFor(prefs?.sky, { dark, hour });
  return {
    sky,
    theme: themeOf(sky),
    accent: ACCENT_CHOICES.includes(prefs?.accent) ? prefs.accent : DEFAULT_PREFERENCES.accent,
    contrast: effectiveContrast(prefs?.contrast, moreContrast),
    density: prefs?.density === 'compact' ? 'compact' : 'comfortable',
  };
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

/**
 * The local hour, looked at again each minute while `watching`, and only
 * handed on when it moves the sky from one phase to the next: the page is
 * not drawn again for a minute that changes nothing.
 */
function useSkyHour(watching) {
  const [hour, setHour] = useState(() => hourOf());
  useEffect(() => {
    if (!watching) return undefined;
    const look = () => {
      const now = hourOf();
      setHour((was) => (phaseAtHour(was) === phaseAtHour(now) ? was : now));
    };
    look();
    const timer = window.setInterval(look, 60_000);
    return () => window.clearInterval(timer);
  }, [watching]);
  return hour;
}

export function PreferencesProvider({ children }) {
  const [prefs, setState] = useState(() => readPreferences());
  const systemDark = useSystemQuery('(prefers-color-scheme: dark)');
  const systemMoreContrast = useSystemQuery('(prefers-contrast: more)');
  const hour = useSkyHour(prefs.sky === 'clock');
  const { sky, theme, accent, contrast, density } = rootAttributes(prefs, { dark: systemDark, moreContrast: systemMoreContrast, hour });
  // In render, not in an effect: the formats have to be in place before the
  // first child formats a number, and an effect runs after they all have.
  const formats = useMemo(() => applyFormats({ locale: prefs.locale, weekStart: prefs.weekStart }), [prefs.locale, prefs.weekStart]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.sky = sky;
    root.dataset.theme = theme;
    root.dataset.accent = accent;
    root.dataset.contrast = contrast;
    root.dataset.density = density;
    // The browser's own chrome (a phone's toolbar) runs into the top of the sky.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', skyColor(sky, contrast));
  }, [sky, theme, accent, contrast, density]);

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
    () => ({ ...prefs, effectiveSky: sky, effectiveTheme: theme, effectiveContrast: contrast, systemDark, formats, setPref, setPrefs }),
    [prefs, sky, theme, contrast, systemDark, formats, setPref, setPrefs],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences() {
  const value = useContext(Ctx);
  if (!value) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return value;
}
