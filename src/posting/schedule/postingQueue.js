// Posting queue slot math (pure). A weekly template gives local wall-clock
// posting times per weekday; a queued post takes the next open future slot, and
// reordering re-packs upcoming slot times onto rows in their new order. Instants
// are computed and compared in UTC, as the backend does.
//
//   schedule = { timezone: 'America/New_York' | '', slots: { mon: ['09:00','17:00'], … } }
//
// `now` is injectable everywhere for deterministic tests.
//
// cocoon's list holds every client's rows for the account (each with its
// `clientKey`), so two weekly schedules can place posts in one repo. Every
// queued row holds its minute, whoever placed it; only this app's own rows
// are ever moved.

export const QUEUE_HORIZON_DAYS = 90; // matches backend MAX_HORIZON_DAYS
export const MIN_LEAD_MS = 60 * 1000; // never place a slot < 1 min out

// The week a schedule starts with until the account changes it: weekdays at
// 09:00 and 17:00. Must match settings.js's default queue.
export const DEFAULT_POSTING_QUEUE = Object.freeze({
  timezone: '',
  slots: Object.freeze({
    mon: Object.freeze(['09:00', '17:00']),
    tue: Object.freeze(['09:00', '17:00']),
    wed: Object.freeze(['09:00', '17:00']),
    thu: Object.freeze(['09:00', '17:00']),
    fri: Object.freeze(['09:00', '17:00']),
    sat: Object.freeze([]),
    sun: Object.freeze([]),
  }),
});

// Canonical weekday order (Mon-first) + display labels, for the schedule editor.
export const WEEKDAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

// UTC getUTCDay() (0=Sun..6=Sat) → our slot keys.
const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Date bucketing for grouped scheduled lists

/** Whole-calendar-day difference (local) between an instant and `now`. */
export function dayDiff(iso, now = new Date()) {
  const d = new Date(iso);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

/** A human bucket label: Overdue / Today / Tomorrow / In N days / weekday + date. */
export function dateBucketLabel(iso, now = new Date()) {
  const diff = dayDiff(iso, now);
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff <= 6) return `In ${diff} days`;
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Group already-time-sorted rows into consecutive date buckets.
 * Returns [{ label, rows }] preserving order.
 */
export function groupByDateBucket(
  rows,
  getIso = (r) => r.scheduledFor,
  now = new Date(),
) {
  const groups = [];
  for (const row of rows) {
    const label = dateBucketLabel(getIso(row), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

export function resolveTimezone(schedule) {
  const tz = schedule && schedule.timezone;
  if (tz) return tz;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isScheduleEmpty(schedule) {
  const slots = (schedule && schedule.slots) || {};
  return !Object.values(slots).some(
    (arr) => Array.isArray(arr) && arr.length > 0,
  );
}

/**
 * Whether a slot map is still the shipped Mon–Fri 9-and-5 default, i.e. a week
 * nobody chose, which suggested times may replace rather than add to. An empty
 * week is not the shipped one; pair with isScheduleEmpty to tell them apart.
 *
 * @param {Object} slots - map of weekday key → array of 'HH:MM' strings
 * @returns {boolean} true when every weekday matches the shipped defaults
 */
export function isShippedDefaultSchedule(slots) {
  const defaults = DEFAULT_POSTING_QUEUE.slots;
  return WEEKDAYS.every(({ key }) => {
    const mine = (slots?.[key] || []).slice().sort();
    const theirs = (defaults[key] || []).slice().sort();
    return (
      mine.length === theirs.length && mine.every((t, i) => t === theirs[i])
    );
  });
}

/** Offset (ms) such that localWallClockUTCms = instantMs + offset, for `tz` at `instantMs`. */
function tzOffsetMs(instantMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map = {};
  for (const p of dtf.formatToParts(new Date(instantMs))) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // some engines render midnight as '24'
  const asUTC = Date.UTC(
    +map.year,
    +map.month - 1,
    +map.day,
    hour,
    +map.minute,
    +map.second,
  );
  return asUTC - instantMs;
}

/** The calendar date (Y/M/D) that `instantMs` falls on in `tz`. */
function zonedYMD(instantMs, tz) {
  const off = tzOffsetMs(instantMs, tz);
  const local = new Date(instantMs + off);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
  };
}

/** Add `days` to a {y,m,d} calendar date (handles month/year rollover). */
function addDays({ y, m, d }, days) {
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(t);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

/** Slot key ('mon'…'sun') for a calendar date — weekday is timezone-independent. */
function weekdayKeyOf({ y, m, d }) {
  return DOW_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * The UTC instant of a wall-clock `HH:MM` on calendar date {y,m,d} in `tz`.
 * DST-correct: the offset is recomputed for that specific date (two-pass to
 * resolve fall-back / spring-forward boundaries). A wall time that does not
 * exist on a spring-forward day resolves forward to the next valid instant.
 */
function zonedSlotToUTC(y, m, d, hh, mm, tz) {
  const naiveUTC = Date.UTC(y, m - 1, d, hh, mm);
  const a = naiveUTC - tzOffsetMs(naiveUTC, tz);
  const b = naiveUTC - tzOffsetMs(a, tz);
  // `b` is real only if the offset in force at `b` is the one it was built
  // from. Otherwise the wall time falls in the spring-forward gap, and the later
  // candidate is the instant just past it (else a 2:30am slot fires at 1:30am).
  if (tzOffsetMs(b, tz) === naiveUTC - b) return new Date(b);
  return new Date(Math.max(a, b));
}

// The backend's horizon is rolling (validateCreate refuses anything past its own
// now + MAX_HORIZON_DAYS at request time), but the loop walks calendar days, so
// a day-90 slot can sit past it. The margin also absorbs clock skew and latency.
const HORIZON_MARGIN_MS = 60 * 60 * 1000;

/** Generator of slot Dates in ascending chronological order across the horizon. */
export function* enumerateSlots(
  schedule,
  fromMs,
  tz = resolveTimezone(schedule),
) {
  const slots = (schedule && schedule.slots) || {};
  const start = zonedYMD(fromMs, tz);
  const horizonMs =
    fromMs + QUEUE_HORIZON_DAYS * 24 * 60 * 60 * 1000 - HORIZON_MARGIN_MS;
  for (let off = 0; off <= QUEUE_HORIZON_DAYS; off++) {
    const date = addDays(start, off);
    // Sorting HH:MM strings orders the wall clock only; a slot pushed past the
    // spring-forward gap can land after a later one, so sort the instants.
    const times = (slots[weekdayKeyOf(date)] || []).slice().sort();
    const dayInstants = [];
    for (const t of times) {
      const [hh, mm] = String(t)
        .split(':')
        .map((n) => parseInt(n, 10));
      if (Number.isNaN(hh) || Number.isNaN(mm)) continue;
      const instant = zonedSlotToUTC(date.y, date.m, date.d, hh, mm, tz);
      if (instant.getTime() > horizonMs) continue;
      dayInstants.push(instant);
    }
    dayInstants.sort((x, z) => x - z);
    yield* dayInstants;
  }
}

function minuteKey(value) {
  return Math.floor(new Date(value).getTime() / 60000);
}

/**
 * Next open future slot for a new queued post, or null if the schedule is empty
 * or the queue is full to the horizon. `queuedRows`: the existing queued rows
 * ({ scheduledFor }) whose slots are already taken, every client's, leaving out
 * the row being edited (so a re-save doesn't walk to the back).
 */
export function nextOpenSlot(schedule, queuedRows = [], now = new Date()) {
  if (isScheduleEmpty(schedule)) return null;
  const tz = resolveTimezone(schedule);
  const nowMs = now.getTime();
  const taken = new Set(queuedRows.map((r) => minuteKey(r.scheduledFor)));
  for (const slot of enumerateSlots(schedule, nowMs, tz)) {
    const ms = slot.getTime();
    if (ms <= nowMs + MIN_LEAD_MS) continue;
    if (taken.has(minuteKey(ms))) continue;
    return slot;
  }
  return null;
}

/** An instant as one ISO-Z string, or null when there isn't a usable one. */
function toIsoOrNull(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Pair ordered queued rows with upcoming slots, in order. Returns
 * `{ id, oldScheduledFor, newScheduledFor }[]`, both ISO-Z (Postgres renders the
 * old one as +00:00, which would never string-match toISOString).
 * `newScheduledFor` is null past the horizon. The caller reschedules only rows
 * whose time changed (pendingMoves).
 *
 * `orderedRows` are the rows this app may move. `occupied` are queued rows it
 * may not (another client's, or a thread part-way out): their minutes are
 * skipped, so a re-pack never lands on top of them.
 */
export function recomputeQueueAssignment(
  schedule,
  orderedRows = [],
  now = new Date(),
  { occupied = [] } = {},
) {
  const tz = resolveTimezone(schedule);
  const nowMs = now.getTime();
  const held = new Set(
    (occupied || [])
      .map((r) => minuteKey(r?.scheduledFor))
      .filter((m) => Number.isFinite(m)),
  );
  const slots = [];
  if (!isScheduleEmpty(schedule) && orderedRows.length > 0) {
    for (const slot of enumerateSlots(schedule, nowMs, tz)) {
      if (slot.getTime() <= nowMs + MIN_LEAD_MS) continue;
      if (held.has(minuteKey(slot))) continue;
      slots.push(slot);
      if (slots.length === orderedRows.length) break;
    }
  }
  return orderedRows.map((row, i) => ({
    id: row.id,
    oldScheduledFor: toIsoOrNull(row.scheduledFor),
    newScheduledFor: slots[i] ? slots[i].toISOString() : null,
  }));
}

// Reading a set of scheduled rows

/**
 * Counts for the posting surfaces: queued (weekly queue), scheduled (a one-off
 * time) and failed. `queued` is soonest-first. A queued row caught mid-publish
 * is in neither count, since it is no longer waiting.
 */
export function summarizeQueue(rows = []) {
  const queued = rows
    .filter((r) => r?.queued && r.status === 'pending')
    .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));
  const scheduledCount = rows.filter(
    (r) =>
      r && !r.queued && (r.status === 'pending' || r.status === 'publishing'),
  ).length;
  const failedCount = rows.filter((r) => r?.status === 'failed').length;
  return { queued, queuedCount: queued.length, scheduledCount, failedCount };
}

/** How far off an instant is, in the roundest unit that still says something. */
export function relativeWhen(iso, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'due now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs} hr`;
  const days = Math.round(hrs / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** The first line of a scheduled row, for a list; media-only posts get a label. */
export function postSnippet(row, max = 60) {
  const text = (row?.payload?.posts?.[0]?.record?.text || '').trim();
  if (!text) return 'a post with media';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * What to say when "Add to queue" on an edited queued post moved it off its
 * own slot because that slot had come too close (nextOpenSlot refuses
 * anything within MIN_LEAD_MS), or '' when it kept its place or never had one.
 *
 * @param {{ queued?: boolean, scheduledFor?: string } | null} editingRow
 * @param {Date} when - the slot it was given
 * @param {Date} now
 */
export function queueSlotMoveNote(
  editingRow,
  when,
  now,
  minLeadMs = MIN_LEAD_MS,
) {
  if (!editingRow?.queued || !when) return '';
  const ownSlotMs = new Date(editingRow.scheduledFor || NaN).getTime();
  if (Number.isNaN(ownSlotMs)) return '';
  if (ownSlotMs > now.getTime() + minLeadMs) return '';
  const whenMs = when.getTime();
  if (whenMs === ownSlotMs) return '';
  // An unreadable slot must not throw: this runs before the queue write.
  const away = Number.isNaN(whenMs)
    ? ''
    : relativeWhen(new Date(whenMs).toISOString(), now.getTime());
  return away
    ? `Added to your queue. Its time had come too close to keep, so it moved to the next open slot, ${away}.`
    : 'Added to your queue. Its time had come too close to keep, so it moved to the next open slot.';
}
