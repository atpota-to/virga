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
import { AccessLine } from '../components/AccessBadge.jsx';
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
 * The top of a page, set straight on the sky, the same shape on every page:
 * its title, one line under it (`sub`), what the page can touch, and at
 * most one row of controls.
 *
 * - `crumbs` say where it sits. They show only beside the folded rail: the
 *   open sidebar says it already, and on a phone the app bar's back link
 *   does.
 * - `access` is a list of ACCESS kinds (components/AccessBadge.jsx), drawn
 *   as one muted line under the sub. This is the only place a page says it.
 * - `titleTools` is drawn on the title's line, after the <h1> and outside
 *   it, so its name stays out of the heading's: the dashboard's ⋯, or ✎
 *   Rename while customizing. Give it a medium (36px) ghost icon; the line
 *   centres one that size.
 * - `actions` sit at the right of the title's line, centred on it, and wrap
 *   under the text when there isn't room. On a phone they are one row that
 *   never wraps, with the period picker first (it scrolls sideways when it
 *   must) and the rest at its far end. A row with no picker in it wraps
 *   instead, rather than push the page sideways.
 * - `children` go under all of that, 12px down, inside the page's column
 *   (the posting nav row on a phone).
 *
 * A header's controls are only ever the period picker (always the last of
 * `actions`), Customize and Done. Anything else a page can do belongs by
 * what it acts on: Export over the list it exports, a chart's actions under
 * the chart, an add at the head of the list it adds to. New post is the
 * chrome's.
 */
export function PageHeader({ crumbs = null, title, sub = null, access = null, titleTools = null, actions = null, children = null }) {
  return (
    <header className="page-header">
      <div className="page-header-in">
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
        <div className="page-header-row">
          <div className="page-header-text">
            <div className="page-title-row">
              <h1 className="page-title">{title}</h1>
              {titleTools && <div className="page-title-tools">{titleTools}</div>}
            </div>
            {sub && <p className="page-sub">{sub}</p>}
            {access?.length > 0 && <AccessLine kinds={access} className="page-access meta" />}
          </div>
          {actions && <div className="page-actions">{actions}</div>}
        </div>
        {children && <div className="page-header-extra">{children}</div>}
      </div>
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

/**
 * The page's window, in its header: the presets and Custom, which opens a
 * range of dates. Pressing one sets the window every chart answers for.
 *
 * `options` are the keys to offer ('7d' … 'all', and 'custom'), for a page
 * that only answers for some of them; every one by default. `effective` is
 * the key to show pressed when the page reads a window other than the one
 * chosen (Best time needs at least 90 days, so under it shows 90d pressed),
 * without changing the choice the other pages read.
 *
 * On a phone the Custom key is its calendar alone (shell.css); its words,
 * the range's dates once there is one, stay in the markup as its name.
 */
export function PeriodPicker({ options = null, effective = null }) {
  const [period, setPeriod, setCustom] = usePeriod();
  const [picking, setPicking] = useState(false);
  const offered = (key) => !options || options.includes(key);
  return (
    <>
      <Segmented
        className="period-picker"
        label="Period"
        value={effective ?? (period.custom ? CUSTOM_PERIOD : period.key)}
        onChange={(key) => (key === CUSTOM_PERIOD ? setPicking(true) : setPeriod(key))}
        options={[
          ...ANALYTICS_PERIODS.filter((p) => offered(p.key)).map((p) => ({
            value: p.key,
            label: SHORT[p.key] || p.label,
            title: periodWindowWord(p),
            ariaLabel: periodWindowWord(p),
          })),
          offered(CUSTOM_PERIOD) && {
            value: CUSTOM_PERIOD,
            icon: CalendarRange,
            label: period.custom ? period.label : 'Custom',
            title: period.custom ? `${period.label}. Press to change the dates.` : 'Pick a range of dates',
            ariaLabel: period.custom ? `Custom range: ${period.label}. Change the dates` : 'Custom range of dates',
          },
        ].filter(Boolean)}
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
