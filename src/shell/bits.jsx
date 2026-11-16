// Small pieces every page uses: the logo, the page header, the period picker,
// toasts, and the hook that counts taps on the logo.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import { ANALYTICS_PERIODS } from '../lib/analytics.js';
import { CUSTOM_PERIOD, customPeriod, dayKey, periodPhrase, periodWindowWord, resolvePeriod } from '../lib/periods.js';
import { activeLocale } from '../lib/locale.js';
import { usePreferences } from '../lib/preferences.jsx';
import { Link } from '../lib/router.jsx';
import Segmented from '../components/Segmented.jsx';

/**
 * The mark: a cloud's arc with rain falling from it that never lands. Drawn
 * in the colour of the words beside it, straight on the sky.
 */
export function LogoMark({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="logo-mark" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M5 11a7 7 0 0 1 14 0M8.5 14.5l-1 4M12.3 14.5l-1.3 6M16 14.5l-.9 3.2" />
    </svg>
  );
}

/**
 * The easter egg: five taps on the logo, each within a second and a half of
 * the last, turn the live sky on (or off again). Returns the click handler.
 */
export function useSkyTaps() {
  const { liveSky, setPref } = usePreferences();
  const toast = useToast();
  const taps = useRef({ n: 0, at: 0 });
  return useCallback(() => {
    const now = Date.now();
    const t = taps.current;
    t.n = now - t.at < 1500 ? t.n + 1 : 1;
    t.at = now;
    if (t.n >= 5) {
      t.n = 0;
      setPref('liveSky', !liveSky);
      toast?.(liveSky ? 'The live sky is put away.' : 'The live sky is out. Settings › Appearance puts it away again.');
    }
  }, [liveSky, setPref, toast]);
}

/**
 * The top of a page, set straight on the sky: where it sits (crumbs, shown
 * where the sidebar isn't there to say it), its title, a line under it, and
 * the page's own controls at the right.
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

/**
 * The window every chart answers for, kept across visits: one of the
 * presets, or a range of dates. Returns the period, a setter for a preset
 * key, and a setter for a custom range (two 'YYYY-MM-DD' days).
 */
export function usePeriod() {
  const { period, periodFrom, periodTo, setPref, setPrefs } = usePreferences();
  const value = useMemo(() => resolvePeriod({ period, periodFrom, periodTo }), [period, periodFrom, periodTo]);
  const setCustom = useCallback((from, to) => setPrefs({ period: CUSTOM_PERIOD, periodFrom: from, periodTo: to }), [setPrefs]);
  return [value, (key) => setPref('period', key), setCustom];
}

export function PeriodPicker() {
  const [period, setPeriod, setCustom] = usePeriod();
  const [picking, setPicking] = useState(false);
  return (
    <>
      <Segmented
        className="period-picker"
        label="Period"
        value={period.custom ? CUSTOM_PERIOD : period.key}
        onChange={(key) => (key === CUSTOM_PERIOD ? setPicking(true) : setPeriod(key))}
        options={[
          ...ANALYTICS_PERIODS.map((p) => ({
            value: p.key,
            label: SHORT[p.key] || p.label,
            title: periodWindowWord(p),
            ariaLabel: periodWindowWord(p),
          })),
          {
            value: CUSTOM_PERIOD,
            icon: CalendarRange,
            label: period.custom ? period.label : 'Custom',
            title: period.custom ? `${period.label}. Press to change the dates.` : 'Pick a range of dates',
            ariaLabel: period.custom ? `Custom range: ${period.label}. Change the dates` : 'Custom range of dates',
          },
        ]}
      />
      <RangeDialog
        open={picking}
        period={period}
        onClose={() => setPicking(false)}
        onApply={(from, to) => {
          setCustom(from, to);
          setPicking(false);
        }}
      />
    </>
  );
}

const DAY_MS = 86_400_000;

/** The dialog behind Custom: two days, checked as they're typed. */
function RangeDialog({ open, period, onClose, onApply }) {
  const today = dayKey(Date.now());
  // Starts from the range in use, or the window the preset covers, so the
  // first thing to do is nudge an end rather than type both from nothing.
  const initial = () => ({
    from: period.custom ? period.from : dayKey(Date.now() - ((period.days || 30) - 1) * DAY_MS),
    to: period.custom ? period.to : today,
  });
  const [range, setRange] = useState(initial);
  useEffect(() => {
    if (open) setRange(initial());
    // Only when it opens: typing must not be overwritten by the period it came from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const result = customPeriod(range.from, range.to);
  const problem = !range.from || !range.to
    ? 'Pick both days.'
    : range.to < range.from
      ? 'The last day is before the first.'
      : !result
        ? 'That range hasn’t started yet.'
        : null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Custom range"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="range-form" disabled={Boolean(problem)}>
            Show this range
          </Button>
        </>
      }
    >
      <form
        id="range-form"
        className="dialog-form range-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) onApply(range.from, range.to);
        }}
      >
        <div className="range-fields">
          <label className="field">
            <span className="field-label">First day</span>
            <input className="input" type="date" value={range.from} max={range.to || today} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} data-autofocus />
          </label>
          <label className="field">
            <span className="field-label">Last day</span>
            <input className="input" type="date" value={range.to} min={range.from || undefined} max={today} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </label>
        </div>
        <p className="field-hint" role="status">
          {problem || `${result.days.toLocaleString(activeLocale())} ${result.days === 1 ? 'day' : 'days'}, in your time zone. Changes are measured against ${result.days === 1 ? 'the day' : `the ${result.days} days`} before.`}
        </p>
      </form>
    </Dialog>
  );
}

export { periodPhrase };

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
