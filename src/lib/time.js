// The two date strings the dashboard prints, in the reader's own time zone.
// The charts bucket by local time (see analytics.js), so their captions do
// too: someone reading their own numbers reads them on their own clock.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Past this many days, a relative time gives way to the date. */
const RELATIVE_DAYS = 30;

function toMs(date) {
  if (date instanceof Date) return date.getTime();
  if (typeof date === 'number') return date;
  return Date.parse(date);
}

/** Whole calendar days between two moments, on the local calendar. */
function calendarDaysAgo(t, now) {
  const a = new Date(t);
  const b = new Date(now);
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  // Rounded, because a day that held a clock change is 23 or 25 hours long.
  return Math.round((startB - startA) / DAY);
}

/** "Jan 29, 2025": the short date. Empty for anything that isn't a date. */
export function formatDateShort(date) {
  const t = toMs(date);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * "just now", "5m ago", "19h ago", "3d ago", "2w ago", and past
 * RELATIVE_DAYS the short date.
 *
 * Minutes and hours are elapsed time. From a day on, the count is calendar
 * days, so something from 11pm two nights ago is "2d ago", not "1d ago".
 */
export function relativeTime(date, now = new Date()) {
  const t = toMs(date);
  const n = toMs(now);
  if (!Number.isFinite(t) || !Number.isFinite(n)) return '';
  const delta = n - t;
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  const days = calendarDaysAgo(t, n);
  // Hours while it's still the same day, too: "1d ago" for something from
  // this morning would be wrong on the calendar the reader is looking at.
  if (delta < DAY || days < 1) return `${Math.floor(delta / HOUR)}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < RELATIVE_DAYS) return `${Math.floor(days / 7)}w ago`;
  return formatDateShort(t);
}
