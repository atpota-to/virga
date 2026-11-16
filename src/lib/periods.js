// The window a chart answers for: one of the presets (7 days to all time)
// or a range of dates picked by hand. Pure: what a stored choice means, the
// words for it, and where it ends.
//
//   preset   { key: '30d', days: 30, label: '30 days' }
//   custom   { key: 'custom:2026-10-01:2026-10-31', days: 31, start: <ms>,
//              end: <ms>, from, to, label: 'Oct 1 – Oct 31, 2026', custom: true }
//
// A preset ends now. A custom range ends at the close of its last day (or
// now, if that day is today), which is what `periodEnd` hands the report
// models in place of now: everything they do is "the `days` days up to
// here", so a range in the past needs nothing else from them.

import { ANALYTICS_PERIODS } from './analytics.js';
import { activeLocale } from './locale.js';

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DEFAULT_PERIOD_KEY = '30d';
export const CUSTOM_PERIOD = 'custom';

/** The preset with this key, or null. */
export function presetPeriod(key) {
  return ANALYTICS_PERIODS.find((p) => p.key === key) || null;
}

/** Local midnight at the start of a 'YYYY-MM-DD' day, or NaN. */
export function dayStartMs(day) {
  const m = DATE.exec(String(day || ''));
  if (!m) return NaN;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  // 2026-02-31 would roll over into March; that isn't the day that was asked for.
  if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return NaN;
  return d.getTime();
}

/** 'YYYY-MM-DD' for the local day holding `ms`. */
export function dayKey(ms) {
  const d = new Date(ms);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function dayWords(ms, withYear) {
  return new Date(ms).toLocaleDateString(activeLocale(), { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
}

/** "Oct 1 – Oct 31, 2026", or with both years when the range crosses one. */
export function rangeLabel(fromMs, toMs, joiner = ' – ') {
  const sameYear = new Date(fromMs).getFullYear() === new Date(toMs).getFullYear();
  if (dayKey(fromMs) === dayKey(toMs)) return dayWords(fromMs, true);
  return `${dayWords(fromMs, !sameYear)}${joiner}${dayWords(toMs, true)}`;
}

/**
 * A range of whole days, from the start of `from` to the end of `to`
 * (both 'YYYY-MM-DD', local). Null when either isn't a date, the range runs
 * backwards, or it starts in the future. A range that reaches past today
 * ends now.
 */
export function customPeriod(from, to, nowMs = Date.now()) {
  const start = dayStartMs(from);
  const last = dayStartMs(to);
  if (!Number.isFinite(start) || !Number.isFinite(last) || last < start || start > nowMs) return null;
  const lastDay = new Date(last);
  // Calendar arithmetic, so a day with a clock change is still one day.
  const close = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1).getTime() - 1;
  const end = Math.min(close, nowMs);
  const days = Math.max(1, Math.round((close + 1 - start) / DAY_MS));
  return { key: `${CUSTOM_PERIOD}:${from}:${to}`, days, start, end, from, to, label: rangeLabel(start, last), custom: true };
}

/**
 * The period a stored choice means: `period` is a preset key or 'custom'
 * (with `periodFrom` and `periodTo`). Anything unreadable is the default.
 */
export function resolvePeriod({ period, periodFrom, periodTo } = {}, nowMs = Date.now()) {
  if (period === CUSTOM_PERIOD) {
    const custom = customPeriod(periodFrom, periodTo, nowMs);
    if (custom) return custom;
  }
  return presetPeriod(period) || presetPeriod(DEFAULT_PERIOD_KEY);
}

/** Where a period's window ends: now for a preset, the range's own end for a custom one. */
export function periodEnd(period, nowMs) {
  return Number.isFinite(period?.end) ? Math.min(period.end, nowMs) : nowMs;
}

/**
 * Where a period's window starts: `days` back from its end for a preset,
 * the first midnight of a custom range, and null for all time (which starts
 * wherever the data does).
 */
export function periodStart(period, nowMs) {
  if (period?.custom) return period.start;
  return period?.days ? nowMs - period.days * DAY_MS : null;
}

/** "the last 30 days", "the last year", "all time", "Oct 1 to Oct 31, 2026": for sentences. */
export function periodPhrase(period) {
  if (period?.custom) return rangeLabel(dayStartMs(period.from), dayStartMs(period.to), ' to ');
  if (!period?.days) return 'all time';
  return period.key === '1y' ? 'the last year' : `the last ${period.label.toLowerCase()}`;
}

/** "Last 30 days", "All time", "Oct 1 – Oct 31, 2026": a card's own caption. */
/**
 * The window as a line under a page's title: "The last 30 days, Oct 17 to
 * Nov 15", "The last year, Nov 16, 2025 to Nov 15, 2026", "Oct 1 to Oct 31"
 * for a range that was picked, "All time".
 */
export function periodLine(period, nowMs = Date.now()) {
  if (period?.custom) return rangeLabel(dayStartMs(period.from), dayStartMs(period.to), ' to ');
  if (!period?.days) return 'All time';
  const phrase = periodPhrase(period);
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}, ${rangeLabel(periodStart(period, nowMs), periodEnd(period, nowMs), ' to ')}`;
}

export function periodWindowWord(period) {
  if (period?.custom) return period.label;
  return period?.days ? `Last ${period.label.toLowerCase()}` : 'All time';
}

/**
 * The window a change is measured against: "the 30 days before", "the year
 * before", and for a custom range "the 31 days before". `capital` starts it
 * with a capital, for the head of a sentence.
 */
export function periodBefore(period, capital = false) {
  const span = period?.custom ? `${period.days} ${period.days === 1 ? 'day' : 'days'}` : String(period?.label || '').toLowerCase();
  return `${capital ? 'The' : 'the'} ${span} before`;
}
