// Repeating scheduled posts: the rule a row carries, and when its next
// occurrence is due.
//
// A repeating post is a series of rows, one per occurrence, of which only one
// waits at a time. The row that waits carries the rule in its payload:
//
//   payload.repeat = {
//     every:  'day' | 'week' | '2weeks' | 'month',
//     tz:     'Europe/Paris',          // the zone the writer picked the time in
//     until:  'YYYY-MM-DD' | null,     // the last local date one may go out on
//     count:  N | null,                // how many occurrences the series has
//     anchor: { date: 'YYYY-MM-DD', time: 'HH:MM', occurrence: n },
//   }
//
// The anchor says "occurrence n goes out at this wall-clock date and time in
// tz". Every later occurrence is counted from it, never from the one before,
// so nothing drifts: 9:00 stays 9:00 across a clock change (the instant moves,
// the wall clock doesn't), and a post on the 31st goes out on the last day of
// a shorter month and is back on the 31st the month after.
//
// The wall-clock arithmetic is the server's own copy of what the client does
// in src/posting/schedule/postingQueue.js (the browser bundle and the server
// share no code); harness/fakeServer.test.js holds the two to the same
// answers.

export const REPEAT_EVERY = Object.freeze(['day', 'week', '2weeks', 'month']);

// "After N times" at its most: a daily post for a little over a year.
export const MAX_REPEAT_COUNT = 400;

// How many slots a series may skip looking for one still ahead of now. A
// daily series whose worker was down for years is the only way to reach it,
// and such a series is over.
const MAX_MISSED_SLOTS = 3700;

const DAY_STEPS = { day: 1, week: 7, '2weeks': 14 };

// ─── Wall clocks ────────────────────────────────────────────────────────────

const formatters = new Map();

/** A cached formatter for `tz`. Throws a RangeError for a zone Intl doesn't know. */
function formatterFor(tz) {
  let dtf = formatters.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, dtf);
  }
  return dtf;
}

/** Whether `tz` is a zone this runtime can compute in. */
export function isTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) such that wall-clock-as-UTC = instant + offset, for `tz` at `instantMs`. */
function tzOffsetMs(instantMs, tz) {
  const map = {};
  for (const p of formatterFor(tz).formatToParts(new Date(instantMs))) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // some engines render midnight as '24'
  const asUtc = Date.UTC(
    +map.year,
    +map.month - 1,
    +map.day,
    hour,
    +map.minute,
    +map.second,
  );
  return asUtc - instantMs;
}

const pad = (n) => String(n).padStart(2, '0');

/** The wall-clock date ('YYYY-MM-DD') and time ('HH:MM') of an instant in `tz`. */
export function wallTimeInZone(instantMs, tz) {
  const local = new Date(instantMs + tzOffsetMs(instantMs, tz));
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}

function parseDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  // Date.UTC rolls 31 Feb into March; a date that isn't on the calendar isn't one.
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

function parseTime(time) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || ''));
  return m ? { hh: +m[1], mm: +m[2] } : null;
}

/**
 * The instant (ms) of a wall-clock date and time in `tz`, or null when either
 * can't be read. The offset is worked out for that date, so it is right on
 * both sides of a clock change. A time that doesn't exist on a spring-forward
 * day resolves forward to the next instant that does.
 */
export function wallTimeToUtc(date, time, tz) {
  const d = parseDate(date);
  const t = parseTime(time);
  if (!d || !t) return null;
  const naive = Date.UTC(d.y, d.m - 1, d.d, t.hh, t.mm);
  const a = naive - tzOffsetMs(naive, tz);
  const b = naive - tzOffsetMs(a, tz);
  // `b` is real only if the offset in force at `b` is the one it was built
  // from. Otherwise the wall time falls in the spring-forward gap, and the
  // later candidate is the instant just past it.
  if (tzOffsetMs(b, tz) === naive - b) return b;
  return Math.max(a, b);
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The local date `steps` periods after the anchor's, for a rule's `every`. */
function dateAfter(anchorDate, every, steps) {
  const a = parseDate(anchorDate);
  if (!a) return null;
  if (every === 'month') {
    const index = a.y * 12 + (a.m - 1) + steps;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    // The anchor's day of the month, or the month's last day when it is
    // shorter: the 31st goes out on 30 April and again on 31 May.
    const d = Math.min(a.d, daysInMonth(y, m));
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  const days = DAY_STEPS[every];
  if (!days) return null;
  const at = new Date(Date.UTC(a.y, a.m - 1, a.d) + steps * days * 86_400_000);
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

// ─── The rule ───────────────────────────────────────────────────────────────

/**
 * Normalize the `payload.repeat` a create or an edit may carry. Answers
 * `{ value }` (null when the post doesn't repeat) or `{ error }`.
 *
 * `scheduledFor` is the time of the occurrence being written and `occurrence`
 * its number in the series (1 for a new one): together they become the anchor
 * every later occurrence is counted from. `fallbackTz` is the scheduling
 * device's zone, used when the rule names none.
 */
export function validateRepeat(
  raw,
  { scheduledFor, occurrence = 1, fallbackTz } = {},
) {
  if (raw === null || raw === undefined || raw === false) return { value: null };
  if (typeof raw !== 'object' || Array.isArray(raw))
    return { error: 'repeat must be an object' };
  if (!REPEAT_EVERY.includes(raw.every)) {
    return {
      error: `repeat.every must be one of: ${REPEAT_EVERY.join(', ')}`,
    };
  }
  const tz = isTimeZone(raw.tz)
    ? raw.tz
    : isTimeZone(fallbackTz)
      ? fallbackTz
      : null;
  if (!tz) return { error: 'repeat.tz must be a time zone this server knows' };

  const whenMs = new Date(scheduledFor).getTime();
  if (!Number.isFinite(whenMs))
    return { error: 'a repeating post needs a time to repeat from' };
  const n = Number.isInteger(occurrence) && occurrence >= 1 ? occurrence : 1;
  const anchor = { ...wallTimeInZone(whenMs, tz), occurrence: n };

  const hasUntil = raw.until !== null && raw.until !== undefined && raw.until !== '';
  const hasCount = raw.count !== null && raw.count !== undefined && raw.count !== '';
  if (hasUntil && hasCount) {
    return {
      error:
        'a repeating post ends on a date or after a number of times, not both.',
    };
  }

  let until = null;
  if (hasUntil) {
    if (typeof raw.until !== 'string' || !parseDate(raw.until))
      return { error: 'repeat.until must be a date, as YYYY-MM-DD' };
    // Plain string order is date order for YYYY-MM-DD.
    if (raw.until < anchor.date) {
      return {
        error: 'the date a repeating post ends on is before it next goes out.',
      };
    }
    until = raw.until;
  }

  let count = null;
  if (hasCount) {
    count = Number(raw.count);
    if (!Number.isInteger(count) || count < 2) {
      return {
        error: 'a post that repeats a number of times goes out at least twice.',
      };
    }
    if (count > MAX_REPEAT_COUNT) {
      return {
        error: `a post can repeat at most ${MAX_REPEAT_COUNT} times. choose an end date, or no end, for more.`,
      };
    }
    if (count < n) {
      return {
        error: `this post has already gone out ${n - 1} times, so it can't end after ${count}.`,
      };
    }
  }

  return { value: { every: raw.every, tz, until, count, anchor } };
}

/** A stored rule that can be computed with, or null. */
function readRule(repeat) {
  if (!repeat || typeof repeat !== 'object') return null;
  if (!REPEAT_EVERY.includes(repeat.every) || !isTimeZone(repeat.tz)) return null;
  const anchor = repeat.anchor;
  if (!anchor || !parseDate(anchor.date) || !parseTime(anchor.time)) return null;
  const at = Number.isInteger(anchor.occurrence) && anchor.occurrence >= 1 ? anchor.occurrence : 1;
  return { ...repeat, anchor: { ...anchor, occurrence: at } };
}

/**
 * When occurrence `k` of a rule goes out: `{ date, at }` (its local date and
 * its instant in ms), or null for a rule or a number that can't be read.
 */
export function occurrenceTime(repeat, k) {
  const rule = readRule(repeat);
  if (!rule || !Number.isInteger(k) || k < rule.anchor.occurrence) return null;
  const date = dateAfter(rule.anchor.date, rule.every, k - rule.anchor.occurrence);
  if (!date) return null;
  const at = wallTimeToUtc(date, rule.anchor.time, rule.tz);
  return at === null ? null : { date, at };
}

/**
 * The occurrence that follows number `occurrence`, as
 * `{ occurrence, scheduledFor }`, or null when the series is over (its count
 * is used up, or its end date has passed) or the rule can't be read.
 *
 * It is the first slot still ahead of `nowMs`, not simply the next number: a
 * series whose worker was down, or whose occurrence was retried days late,
 * picks up at its next time rather than sending every slot it missed in a
 * burst. Missed slots still count toward "after N times".
 */
export function nextOccurrence(repeat, occurrence, nowMs = Date.now()) {
  const rule = readRule(repeat);
  if (!rule) return null;
  const from = Number.isInteger(occurrence) && occurrence >= rule.anchor.occurrence
    ? occurrence
    : rule.anchor.occurrence;
  for (let k = from + 1; k <= from + MAX_MISSED_SLOTS; k++) {
    if (rule.count !== null && rule.count !== undefined && k > rule.count)
      return null;
    const slot = occurrenceTime(rule, k);
    if (!slot) return null;
    if (rule.until && slot.date > rule.until) return null;
    if (slot.at > nowMs)
      return { occurrence: k, scheduledFor: new Date(slot.at).toISOString() };
  }
  return null;
}

/**
 * A rule with its anchor moved to `scheduledFor` for occurrence `occurrence`:
 * what a move or an edit of the waiting occurrence does, so the ones after it
 * follow the new time.
 */
export function reanchor(repeat, scheduledFor, occurrence) {
  const rule = readRule(repeat);
  const whenMs = new Date(scheduledFor).getTime();
  if (!rule || !Number.isFinite(whenMs)) return repeat;
  const n = Number.isInteger(occurrence) && occurrence >= 1 ? occurrence : rule.anchor.occurrence;
  return {
    ...repeat,
    anchor: { ...wallTimeInZone(whenMs, rule.tz), occurrence: n },
  };
}
