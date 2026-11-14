// A scheduled post that repeats: the rule the composer holds, what it sends
// to Virga's server, when the occurrences fall, and the words for all of it.
// Pure: every clock and zone is passed in.
//
// In the composer the rule rides on the schedule (`schedule.repeat`):
//
//   { every: 'day' | 'week' | '2weeks' | 'month', until?: 'YYYY-MM-DD', count?: N }
//
// The server stores it with the zone it was picked in and an anchor ("the
// occurrence numbered n goes out at this wall-clock date and time"), and
// counts every later occurrence from that anchor, so 9:00 stays 9:00 across
// a clock change and the 31st falls on the last day of a shorter month. The
// arithmetic here is the client's copy of server/schedule/recurrence.js (the
// bundle can't import the server); harness/fakeServer.test.js holds the two
// to the same answers.

import { activeLocale } from '../../lib/locale.js';
import { zonedWallTime, zonedWallTimeToUtc } from './postingQueue.js';

export const REPEAT_EVERY = Object.freeze(['day', 'week', '2weeks', 'month']);

/** The most a post may repeat "after N times" (the server's ceiling). */
export const MAX_REPEAT_COUNT = 400;

// As the server: how many missed slots a series looks past for its next one.
const MAX_MISSED_SLOTS = 3700;

export const REPEAT_OPTIONS = Object.freeze([
  { value: '', label: 'Doesn’t repeat' },
  { value: 'day', label: 'Every day' },
  { value: 'week', label: 'Every week' },
  { value: '2weeks', label: 'Every two weeks' },
  { value: 'month', label: 'Every month' },
]);

/** Why a reply can't repeat, and why a queued post can't. */
export const REPEAT_REPLY_HINT =
  'A reply can’t repeat: it would answer the same post again each time.';
export const REPEAT_QUEUE_HINT =
  'A post in the queue can’t repeat. Schedule it for a set time instead.';

const DAY_STEPS = { day: 1, week: 7, '2weeks': 14 };
const pad = (n) => String(n).padStart(2, '0');

function parseDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/**
 * A rule as the composer holds it: `{ every, until?, count? }`, or null for
 * a post that doesn't repeat (or a rule that can't be read). Takes the
 * composer's own shape and the server's stored one.
 */
export function normalizeRepeat(raw) {
  if (!raw || typeof raw !== 'object' || !REPEAT_EVERY.includes(raw.every))
    return null;
  const out = { every: raw.every };
  const count = Number(raw.count);
  if (raw.count !== null && raw.count !== undefined && raw.count !== '' && Number.isInteger(count) && count >= 1)
    out.count = count;
  else if (typeof raw.until === 'string' && parseDate(raw.until))
    out.until = raw.until;
  return out;
}

/** How a rule ends, for the picker: 'never' | 'on' | 'after'. */
export function repeatEnds(repeat) {
  const r = normalizeRepeat(repeat);
  if (!r) return 'never';
  if (r.count) return 'after';
  return r.until ? 'on' : 'never';
}

/**
 * Why a rule can't be used for a post going out at `at` (an ISO string) on
 * the clock of `tz`, or ''. `occurrence` is the number of the occurrence
 * being edited, 1 for a new post.
 */
export function repeatProblem(repeat, at, tz, { occurrence = 1 } = {}) {
  if (!repeat) return '';
  const r = normalizeRepeat(repeat);
  if (!r) return 'Choose how often it repeats.';
  if (repeat.count !== undefined && repeat.count !== null && repeat.count !== '') {
    const n = Number(repeat.count);
    if (!Number.isInteger(n) || n < 2)
      return 'A post that repeats a number of times goes out at least twice.';
    if (n > MAX_REPEAT_COUNT)
      return `A post can repeat up to ${MAX_REPEAT_COUNT} times. Choose an end date, or no end, for more.`;
    if (n < occurrence)
      return `This post has already gone out ${occurrence - 1} ${occurrence - 1 === 1 ? 'time' : 'times'}, so it can’t end after ${n}.`;
  }
  if (repeat.until !== undefined && repeat.until !== null && repeat.until !== '') {
    if (!parseDate(repeat.until)) return 'Choose the date it ends on.';
    const first = zonedWallTime(at, tz);
    if (first && repeat.until < first.date)
      return 'The date it ends on is before it first goes out.';
  }
  return '';
}

/** The rule as the server takes it in `payload.repeat`, or null. */
export function repeatForServer(repeat, tz) {
  const r = normalizeRepeat(repeat);
  if (!r) return null;
  const out = { every: r.every, tz };
  if (r.count) out.count = r.count;
  else if (r.until) out.until = r.until;
  return out;
}

/* ---- when the occurrences fall ---------------------------------------- */

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function dateAfter(anchorDate, every, steps) {
  const a = parseDate(anchorDate);
  if (!a) return null;
  if (every === 'month') {
    const index = a.y * 12 + (a.m - 1) + steps;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    return `${y}-${pad(m)}-${pad(Math.min(a.d, daysInMonth(y, m)))}`;
  }
  const days = DAY_STEPS[every];
  if (!days) return null;
  const at = new Date(Date.UTC(a.y, a.m - 1, a.d) + steps * days * 86_400_000);
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/**
 * A stored rule (`{ every, tz, until, count, anchor }`) for a post first
 * going out at `at` on the clock of `tz`: what the server makes of the
 * composer's rule when it saves it. `occurrence` numbers the anchor.
 */
export function anchoredRepeat(repeat, at, tz, occurrence = 1) {
  const r = normalizeRepeat(repeat);
  const wall = zonedWallTime(at, tz);
  if (!r || !wall) return null;
  return {
    every: r.every,
    tz,
    until: r.until || null,
    count: r.count || null,
    anchor: { date: wall.date, time: wall.time, occurrence },
  };
}

function readStored(repeat) {
  if (!repeat || !REPEAT_EVERY.includes(repeat.every) || !repeat.tz) return null;
  const a = repeat.anchor;
  if (!a || !parseDate(a.date) || !/^\d{2}:\d{2}$/.test(String(a.time || '')))
    return null;
  const n = Number.isInteger(a.occurrence) && a.occurrence >= 1 ? a.occurrence : 1;
  return { ...repeat, anchor: { ...a, occurrence: n } };
}

/** When occurrence `k` of a stored rule goes out: `{ date, at }` (ms), or null. */
export function occurrenceTime(repeat, k) {
  const rule = readStored(repeat);
  if (!rule || !Number.isInteger(k) || k < rule.anchor.occurrence) return null;
  const date = dateAfter(rule.anchor.date, rule.every, k - rule.anchor.occurrence);
  const at = date ? zonedWallTimeToUtc(date, rule.anchor.time, rule.tz) : null;
  return at ? { date, at: at.getTime() } : null;
}

/**
 * The occurrence after number `occurrence` of a stored rule, as
 * `{ occurrence, scheduledFor }`: the first slot still ahead of `nowMs`
 * (missed slots are counted, not sent). Null when the series is over.
 */
export function nextOccurrence(repeat, occurrence, nowMs = Date.now()) {
  const rule = readStored(repeat);
  if (!rule) return null;
  const from =
    Number.isInteger(occurrence) && occurrence >= rule.anchor.occurrence
      ? occurrence
      : rule.anchor.occurrence;
  for (let k = from + 1; k <= from + MAX_MISSED_SLOTS; k++) {
    if (rule.count && k > rule.count) return null;
    const slot = occurrenceTime(rule, k);
    if (!slot) return null;
    if (rule.until && slot.date > rule.until) return null;
    if (slot.at > nowMs)
      return { occurrence: k, scheduledFor: new Date(slot.at).toISOString() };
  }
  return null;
}

/* ---- words ------------------------------------------------------------ */

/** 'Every week', or '' for no rule. */
export function repeatLabel(repeat) {
  const every = repeat && typeof repeat === 'object' ? repeat.every : repeat;
  return REPEAT_OPTIONS.find((o) => o.value && o.value === every)?.label || '';
}

function shortDate(date) {
  const d = parseDate(date);
  if (!d) return '';
  const sameYear = d.y === new Date().getFullYear();
  return new Date(Date.UTC(d.y, d.m - 1, d.d)).toLocaleDateString(activeLocale(), {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/**
 * Where a row stands in its series, for a line of facts: '3 of 10' for a
 * post that ends after a count, 'until 5 Dec' for one that ends on a date,
 * else ''.
 */
export function repeatProgress(repeat, occurrence) {
  if (!repeat) return '';
  if (repeat.count) {
    const n = Number.isInteger(occurrence) ? occurrence : repeat.anchor?.occurrence;
    return n ? `${n} of ${repeat.count}` : `${repeat.count} times`;
  }
  if (repeat.until) return `until ${shortDate(repeat.until)}`;
  return '';
}

/**
 * The picker's line under the Repeat control, for a post first going out at
 * `at` on the clock of `tz`: what repeats, when it ends, and what a month
 * end means.
 */
export function repeatSummary(repeat, at, tz) {
  const r = normalizeRepeat(repeat);
  if (!r) return '';
  const wall = zonedWallTime(at, tz);
  const day = wall ? parseDate(wall.date)?.d : null;
  let line = `${repeatLabel(r)} at this time`;
  if (r.count) line += `, ${r.count} times in all`;
  else if (r.until) line += `, until ${shortDate(r.until)}`;
  line += '.';
  if (r.every === 'month' && day >= 29)
    line += ` In a month with no ${day}${day === 31 ? 'st' : 'th'}, it goes out on the last day.`;
  return line;
}

/** How a toast says a post repeats: ', repeating every week'. */
export function repeatClause(repeat) {
  const label = repeatLabel(repeat);
  return label ? `, repeating ${label.toLowerCase()}` : '';
}

/**
 * What a scheduled row's series amounts to, for the Scheduled page:
 *
 *   repeats   it carries the rule: more follow it
 *   label     'Every week'
 *   progress  '3 of 10' | 'until 5 Dec' | ''
 *   last      this is the series' last occurrence
 *   former    it belonged to a repeating post that has moved on (a failed
 *             occurrence), or was stopped
 */
export function rowRepeat(row, now = Date.now()) {
  const rule = row?.payload?.repeat;
  const inSeries = Boolean(row?.seriesId ?? row?.series_id);
  if (!rule || !REPEAT_EVERY.includes(rule.every)) {
    return { repeats: false, label: '', progress: '', last: false, former: inSeries };
  }
  const occurrence = row.occurrence ?? rule.anchor?.occurrence ?? 1;
  // "After" the later of now and the row's own time: the server plans from
  // the moment the row is settled, which is no earlier than either.
  const from = Math.max(now, new Date(row.scheduledFor || 0).getTime() || 0);
  return {
    repeats: true,
    label: repeatLabel(rule),
    progress: repeatProgress(rule, occurrence),
    last: !nextOccurrence(rule, occurrence, from),
    former: false,
  };
}
