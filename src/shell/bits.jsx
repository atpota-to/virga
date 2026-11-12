// Small pieces every page uses: the logo, the page header, the period picker,
// toasts, and the hook that counts taps on the logo.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ANALYTICS_PERIODS } from '../lib/analytics.js';
import { usePreferences } from '../lib/preferences.jsx';
import { Link } from '../lib/router.jsx';
import Segmented from '../components/Segmented.jsx';

/** The mark: a cloud's arc with rain falling from it that never lands. */
export function LogoMark({ size = 26 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="logo-mark">
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <path
        d="M6 11a6 6 0 0 1 12 0M9 14l-1 4.5M12.5 14l-1 6M16 14l-1 3.5"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The easter egg: five taps on the logo, each within a second and a half of
 * the last, turn the live sky on (or off again). Returns the click handler.
 */
export function useSkyTaps() {
  const { sky, setPref } = usePreferences();
  const toast = useToast();
  const taps = useRef({ n: 0, at: 0 });
  return useCallback(() => {
    const now = Date.now();
    const t = taps.current;
    t.n = now - t.at < 1500 ? t.n + 1 : 1;
    t.at = now;
    if (t.n >= 5) {
      t.n = 0;
      setPref('sky', !sky);
      toast?.(sky ? 'The sky is put away.' : 'The sky is out. Settings › Appearance puts it away again.');
    }
  }, [sky, setPref, toast]);
}

/**
 * The band at the top of a page: where it sits (crumbs), its title, a line
 * under it, and the page's own controls at the right.
 */
export function PageHeader({ crumbs = null, title, sub = null, actions = null, children = null }) {
  return (
    <header className="page-header">
      <div className="page-header-in">
        <div className="page-header-text">
          {crumbs && (
            <nav className="crumbs" aria-label="Breadcrumb">
              {crumbs.map((c, i) => (
                <span key={c.label}>
                  {c.to ? <Link to={c.to}>{c.label}</Link> : c.label}
                  {i < crumbs.length - 1 && <span aria-hidden="true"> / </span>}
                </span>
              ))}
            </nav>
          )}
          <h1 className="page-title">{title}</h1>
          {sub && <p className="page-sub">{sub}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

const SHORT = { '7d': '7d', '30d': '30d', '90d': '90d', '1y': '1y', all: 'All' };

/** The window every chart answers for, kept across visits. */
export function usePeriod() {
  const { period, setPref } = usePreferences();
  const value = ANALYTICS_PERIODS.find((p) => p.key === period) || ANALYTICS_PERIODS[1];
  return [value, (key) => setPref('period', key)];
}

export function PeriodPicker() {
  const [period, setPeriod] = usePeriod();
  return (
    <Segmented
      className="period-picker"
      label="Period"
      value={period.key}
      onChange={setPeriod}
      options={ANALYTICS_PERIODS.map((p) => ({
        value: p.key,
        label: SHORT[p.key] || p.label,
        title: p.days ? `Last ${p.label.toLowerCase()}` : 'All time',
        ariaLabel: p.days ? `Last ${p.label.toLowerCase()}` : 'All time',
      }))}
    />
  );
}

/** "the last 30 days", "the last year", "all time": for sentences. */
export function periodPhrase(period) {
  if (!period.days) return 'all time';
  return period.key === '1y' ? 'the last year' : `the last ${period.label.toLowerCase()}`;
}

/* ---- toasts ------------------------------------------------------- */

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, { tone = 'info', ms = 4200 } = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), ms);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-tone={t.tone}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/** Whether the viewport is a phone's, kept in step as it resizes. */
export function useIsNarrow(query = '(max-width: 899px)') {
  const mq = useMemo(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null), [query]);
  const [narrow, setNarrow] = useState(() => Boolean(mq?.matches));
  useEffect(() => {
    if (!mq) return undefined;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [mq]);
  return narrow;
}
