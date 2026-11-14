// What the Scheduled, Weekly schedule and Timers pages (and the time picker)
// show, worked out from the server's rows and the account's weekly schedule.
// Pure: every clock is passed in, and nothing here reads storage or the
// network.

import {
  MIN_LEAD_MS,
  QUEUE_HORIZON_DAYS,
  WEEKDAYS,
  enumerateSlots,
  isScheduleEmpty,
  isShippedDefaultSchedule,
  resolveTimezone,
  zonedWallTime,
  zonedWallTimeToUtc,
} from '../schedule/postingQueue.js';
import {
  canCancelScheduledRow,
  canEditScheduledRow,
} from '../schedule/scheduleService.js';
import { friendlyScheduleError } from '../schedule/scheduledPostError.js';
import { splitQueueRows } from '../schedule/queueReorder.js';
import {
  describeTimer,
  normalizeTimer,
  readStoredTimer,
  timeUntil,
  timerBucket,
  timerSlotSentence,
  TIMER_BUCKET_FEATURE,
} from '../timers/selfDestruct.js';

const instant = (value) => (value ? new Date(value).getTime() : NaN);
const byTime = (a, b) => instant(a.scheduledFor) - instant(b.scheduledFor);

/* ---- the scheduled list ---------------------------------------------- */

/**
 * listScheduled's `rows` in the page's three sections, each soonest first:
 *
 *   attention  didn't go out (failed), whatever its kind
 *   queue      waiting in the weekly queue, or going out from it now
 *   timed      waiting for a time of its own, or going out now
 */
export function scheduledSections(rows = []) {
  const attention = [];
  const queue = [];
  const timed = [];
  for (const row of rows || []) {
    if (!row) continue;
    if (row.status === 'failed') attention.push(row);
    else if (row.status === 'pending' || row.status === 'publishing')
      (row.queued ? queue : timed).push(row);
  }
  return {
    attention: attention.sort(byTime),
    queue: queue.sort(byTime),
    timed: timed.sort(byTime),
  };
}

function embedKind(embed) {
  return embed && typeof embed === 'object' ? embed.type : null;
}

/**
 * What a scheduled row holds, for its line of facts: its words, how many
 * posts, pictures, a quote or link, whether replies or quotes are limited,
 * and its timer as a sentence.
 */
export function rowFacts(row) {
  const posts = Array.isArray(row?.payload?.posts) ? row.payload.posts : [];
  const text = String(posts[0]?.record?.text || '').trim();
  let images = 0;
  let quote = false;
  let link = false;
  for (const post of posts) {
    const embed = post?.embed;
    const kind = embedKind(embed);
    if (kind === 'images') images += embed.images?.length || 0;
    if (kind === 'external') link = true;
    if (kind === 'record') quote = true;
    if (kind === 'recordWithMedia') {
      quote = true;
      if (embedKind(embed.media) === 'images')
        images += embed.media.images?.length || 0;
      if (embedKind(embed.media) === 'external') link = true;
    }
  }
  const gates = row?.payload?.gates || {};
  const limited =
    Array.isArray(gates.threadgate) ||
    (Array.isArray(gates.postgate) && gates.postgate.length > 0);
  const spec = row?.payload?.selfDestruct;
  const timer = spec ? readStoredTimer({ ...spec, enabled: true }).timer : null;
  return {
    text,
    posts: posts.length,
    images,
    quote,
    link,
    limited,
    timer: timer?.enabled ? describeTimer(timer) : '',
  };
}

/** A row's facts as short tags, in the order the row shows them. */
export function rowTags(facts) {
  const tags = [];
  if (facts.posts > 1) tags.push(`Thread of ${facts.posts}`);
  if (facts.images)
    tags.push(facts.images === 1 ? '1 image' : `${facts.images} images`);
  if (facts.quote) tags.push('Quote');
  if (facts.link) tags.push('Link card');
  if (facts.limited) tags.push('Replies or quotes limited');
  return tags;
}

/**
 * A scheduled row's state as `{ tone, label, detail }`: 'wait' (pending),
 * 'busy' (going out), 'danger' (failed, with the reason in Virga's words),
 * and 'warn' for a thread part of which is already out.
 */
export function rowStatus(row, now = Date.now()) {
  if (row?.status === 'publishing')
    return { tone: 'busy', label: 'Going out now', detail: '' };
  if (row?.status === 'failed') {
    return {
      tone: 'danger',
      label: row.partial ? 'Stopped part way' : 'Didn’t go out',
      detail: row.partial
        ? `${friendlyScheduleError(row.lastError, row.lastErrorCode)} Part of the thread is already out; retrying posts the rest.`
        : friendlyScheduleError(row.lastError, row.lastErrorCode),
    };
  }
  if (row?.partial)
    return {
      tone: 'warn',
      label: 'Part of it is out',
      detail: 'Part of this thread is already out. The rest follows.',
    };
  const ms = instant(row?.scheduledFor);
  if (Number.isFinite(ms) && ms <= now)
    return { tone: 'busy', label: 'Due now', detail: '' };
  return { tone: 'wait', label: 'Waiting', detail: '' };
}

/**
 * How close to its time a waiting row stops offering "Post now". Posting now
 * publishes first and takes the scheduled copy off after, so a row the
 * per-minute worker can pick up while that publish runs (a few seconds of
 * uploads and writes) would go out twice. Two minutes covers a worker tick
 * and a slow publish.
 */
export const POST_NOW_CUTOFF_MS = 2 * 60 * 1000;

/**
 * Whether a waiting row is due, or close enough to its time that the worker
 * may take it before "Post now" could take it off: its time (or its next
 * retry, when the row carries one) is within POST_NOW_CUTOFF_MS. A row whose
 * time has passed with no retry time known counts as due, since it may be
 * waiting out a retry the list doesn't show.
 */
export function rowIsDueSoon(row, now = Date.now()) {
  if (row?.status !== 'pending') return false;
  const at = instant(row.scheduledFor);
  const retry = instant(row.nextAttemptAt);
  const dueAt = Number.isFinite(retry) && retry > at ? retry : at;
  return Number.isFinite(dueAt) && dueAt <= now + POST_NOW_CUTOFF_MS;
}

/**
 * What can be done to a row from this page:
 *   edit     open it in the composer (waiting or failed)
 *   postNow  post it now and drop the scheduled copy (whole, and not about
 *            to go out at its time: rowIsDueSoon)
 *   retry    send a failed one again as it is
 *   cancel   take it off the schedule
 */
export function rowActions(row, now = Date.now()) {
  const waitingOrFailed = row?.status === 'pending' || row?.status === 'failed';
  return {
    edit: canEditScheduledRow(row),
    postNow: waitingOrFailed && !row?.partial && !rowIsDueSoon(row, now),
    retry: row?.status === 'failed',
    cancel: canCancelScheduledRow(row),
  };
}

/** The collection a timer can go on (the server refuses any other). */
const BSKY_POST = 'app.bsky.feed.post';

/**
 * What the "A timer couldn't be set" list offers for one note row:
 *
 *   arm      the post to hand TimerDialog (`{ uri, text, postedAt,
 *            extraUris, row }`), or null when there's no Bluesky post to
 *            put a timer on
 *   dismiss  whether Dismiss is offered (always: the note is the account's)
 *   note     a sentence in place of the button, or ''
 */
export function timerNoteActions(row) {
  const uri = typeof row?.resultUri === 'string' ? row.resultUri : '';
  const [, , repo = '', collection = ''] = uri.split('/');
  if (!uri || collection !== BSKY_POST) return { arm: null, dismiss: true, note: '' };
  const rkeys = Array.isArray(row.payload?.rkeys) ? row.payload.rkeys : [];
  return {
    arm: {
      uri,
      text: rowFacts(row).text,
      postedAt: row.scheduledFor,
      extraUris: rkeys
        .slice(1)
        .filter((k) => typeof k === 'string' && k)
        .map((k) => `at://${repo}/${collection}/${k}`),
      row,
    },
    dismiss: true,
    note: '',
  };
}

/* ---- times in the queue's zone --------------------------------------- */

/** A zone as people write it: 'America/New_York' → 'America/New York'. */
export function zoneLabel(tz) {
  return String(tz || '').replace(/_/g, ' ');
}

function safeFormat(ms, tz, options) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...options,
      timeZone: tz || undefined,
    }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(ms));
  }
}

/** 'Fri 14 Nov, 9:00 AM' (with the year when it isn't this one), in `tz`. */
export function formatInZone(value, tz, now = Date.now()) {
  const ms = instant(value);
  if (!Number.isFinite(ms)) return '';
  const sameYear =
    new Date(ms).getUTCFullYear() === new Date(now).getUTCFullYear();
  return safeFormat(ms, tz, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** '9:00 AM' in `tz`. */
export function timeInZone(value, tz) {
  const ms = instant(value);
  if (!Number.isFinite(ms)) return '';
  return safeFormat(ms, tz, { hour: 'numeric', minute: '2-digit' });
}

/** An 'HH:MM' slot as this browser writes a time of day: '17:30' → '5:30 PM'. */
export function slotLabel(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  return new Date(Date.UTC(2000, 0, 3, +m[1], +m[2])).toLocaleTimeString(
    undefined,
    {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    },
  );
}

/**
 * Rows grouped by the day they go out, in the queue's zone:
 * `[{ key, label, rows }]`, in the rows' order. Labels say Today, Tomorrow,
 * a weekday this week, else the date; a time already past is Overdue.
 */
export function groupByZonedDay(rows = [], tz, now = Date.now()) {
  const today = zonedWallTime(now, tz);
  const dayIndex = (date) =>
    Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const groups = [];
  for (const row of rows || []) {
    const ms = instant(row?.scheduledFor);
    let key;
    let label;
    const wall = Number.isFinite(ms) ? zonedWallTime(ms, tz) : null;
    if (!wall || !today) {
      key = 'unknown';
      label = 'No time';
    } else if (ms <= now) {
      key = 'overdue';
      label = 'Overdue';
    } else {
      key = wall.date;
      const diff = dayIndex(wall.date) - dayIndex(today.date);
      if (diff === 0) label = 'Today';
      else if (diff === 1) label = 'Tomorrow';
      else if (diff < 7) label = safeFormat(ms, tz, { weekday: 'long' });
      else
        label = safeFormat(ms, tz, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        });
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, label, rows: [row] });
  }
  return groups;
}

/* ---- reordering ------------------------------------------------------- */

/**
 * The queue as drawn while its order changes: every row stays where it is,
 * except that the places this app's movable rows hold are filled, in turn, by
 * `movableIds` (the new order). Other apps' rows and rows part way out keep
 * their places.
 */
export function previewOrder(queueRows = [], movableIds = []) {
  const movable = new Set(movableIds);
  const byId = new Map((queueRows || []).map((r) => [r.id, r]));
  const next = movableIds.map((id) => byId.get(id)).filter(Boolean);
  let i = 0;
  return (queueRows || []).map((row) =>
    movable.has(row.id) && next[i] ? next[i++] : row,
  );
}

/** `ids` with `id` moved `delta` places (clamped), or the same array when it can't move. */
export function moveId(ids = [], id, delta) {
  const from = ids.indexOf(id);
  if (from < 0 || !delta) return ids;
  const to = Math.max(0, Math.min(ids.length - 1, from + delta));
  if (to === from) return ids;
  const out = ids.slice();
  out.splice(from, 1);
  out.splice(to, 0, id);
  return out;
}

/** `ids` with `id` put at `index`. */
export function moveIdTo(ids = [], id, index) {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  return moveId(ids, id, index - from);
}

/** The ids of the rows that may move in the queue, soonest first. */
export function movableIds(rows = [], now = Date.now()) {
  return splitQueueRows(rows, { now }).movable.map((r) => r.id);
}

/** Rows with the times an assignment gives them (an optimistic redraw), re-sorted. */
export function applyAssignment(rows = [], assignment = []) {
  const next = new Map(
    (assignment || [])
      .filter((a) => a?.newScheduledFor)
      .map((a) => [a.id, a.newScheduledFor]),
  );
  return (rows || []).map((row) =>
    next.has(row.id) ? { ...row, scheduledFor: next.get(row.id) } : row,
  );
}

/* ---- limits ----------------------------------------------------------- */

/**
 * The scheduled-posts line under the list: '2 of 3 scheduled posts in use.'
 * for a limited account, the server's
 * ceiling for one without a limit, '' when nothing is known.
 */
export function scheduledLimitsLine(limits) {
  if (!limits) return '';
  const limit = limits.features?.scheduledPosts?.limit;
  const used = limits.usage?.scheduledPosts;
  if (Number.isFinite(limit)) {
    if (!Number.isFinite(used))
      return `This account can keep ${limit} scheduled ${limit === 1 ? 'post' : 'posts'} at a time.`;
    return `${Math.min(used, limit)} of ${limit} scheduled ${limit === 1 ? 'post' : 'posts'} in use.`;
  }
  const cap = limits.caps?.scheduledPosts;
  if (Number.isFinite(cap))
    return `No limit on scheduled posts, beyond the ${cap} that can wait at a time.`;
  if (limits.policy) return 'No limit on scheduled posts.';
  return '';
}

/**
 * The timers line: what's in use in each limited bucket, counting scheduled
 * posts that carry a timer. '' when neither bucket is limited, or nothing is
 * known. `fallbackUsage` ({ plain, conditional }, from timerUsage) fills in a
 * count the server didn't send.
 */
export function timerLimitsLine(limits, fallbackUsage = null) {
  if (!limits) return '';
  const parts = [];
  for (const [bucket, noun] of [
    ['plain', 'plain timer'],
    ['conditional', 'conditional timer'],
  ]) {
    const feature = TIMER_BUCKET_FEATURE[bucket];
    const limit = limits.features?.[feature]?.limit;
    if (!Number.isFinite(limit)) continue;
    let used = limits.usage?.[feature];
    if (!Number.isFinite(used) && fallbackUsage) used = fallbackUsage[bucket];
    const nouns = limit === 1 ? noun : `${noun}s`;
    parts.push(
      Number.isFinite(used)
        ? `${Math.min(used, limit)} of ${limit} ${nouns}`
        : `${limit} ${nouns}`,
    );
  }
  if (parts.length === 0) {
    const cap = limits.caps?.timers;
    if (Number.isFinite(cap))
      return `No limit on timers, beyond the ${cap} that can count down at a time.`;
    return limits.policy ? 'No limit on timers.' : '';
  }
  return `In use: ${parts.join(' and ')}, counting scheduled posts with a timer.`;
}

/** The slot sentence for each limited bucket that's full, for a callout. */
export function fullTimerBuckets(limits) {
  const out = [];
  for (const bucket of ['plain', 'conditional']) {
    const feature = TIMER_BUCKET_FEATURE[bucket];
    const limit = limits?.features?.[feature]?.limit;
    const used = limits?.usage?.[feature];
    if (Number.isFinite(limit) && Number.isFinite(used) && used >= limit)
      out.push(timerSlotSentence(bucket, limit));
  }
  return out;
}

/* ---- timers ------------------------------------------------------------ */

/** What a settled timer's state reads as. */
export const SETTLED_LABEL = {
  deleted: 'Deleted',
  acted: 'Changed',
  spared: 'Kept',
  cancelled: 'Called off',
  failed: 'Still up',
};

const TIMER_FAILURES = {
  SESSION_UNAVAILABLE:
    'Virga’s server couldn’t act as this account: its session had ended. The post is still up.',
  ENGAGEMENT_UNAVAILABLE:
    'Bluesky didn’t answer when the post’s counts were checked. The post is still up.',
  TIMED_OUT: 'Virga’s server ran out of time. The post is still up.',
  RATE_LIMITED: 'Bluesky was rate limiting this account. The post is still up.',
  REFUSED: 'Bluesky refused the change. The post is still up.',
};

/** Why a timer gave up, in Virga's words. */
export function friendlyTimerError(code, raw) {
  const known = TIMER_FAILURES[String(code || '').toUpperCase()];
  if (known) return known;
  const s = String(raw || '').toLowerCase();
  if (s.includes('session')) return TIMER_FAILURES.SESSION_UNAVAILABLE;
  if (s.includes('rate')) return TIMER_FAILURES.RATE_LIMITED;
  return 'The timer gave up. The post is still up.';
}

/** A timer row's rule as the timer model holds it (the server's row has no `enabled`). */
export function ruleOfTimerRow(row) {
  return normalizeTimer({
    enabled: true,
    lifespanSeconds: row?.lifespanSeconds,
    conditions: row?.conditions,
    effects: row?.effects,
  });
}

/**
 * Everything a timer row shows: its words, when it acts, the rule, what
 * happened, and what can be done. `now` drives the countdown.
 */
export function timerRowModel(row, now = Date.now()) {
  const live = row?.status === 'armed' || row?.status === 'checking';
  const rule = ruleOfTimerRow(row);
  const extensions = Number(row?.extensions) || 0;
  let acted = Array.isArray(row?.acted)
    ? row.acted.filter((a) => a && typeof a === 'object')
    : [];
  // A plain delete that went to plan says no more than its state does.
  if (
    row?.status === 'deleted' &&
    acted.every((a) => a.action === 'delete' && a.ok !== false)
  )
    acted = [];
  return {
    id: row?.id,
    text: String(row?.snippet || '').trim(),
    live,
    when: live
      ? row.status === 'checking'
        ? 'Checking now'
        : `Acts ${timeUntil(row.checkAt, now)}`
      : SETTLED_LABEL[row?.status] || '',
    rule: describeTimer(rule, now),
    bucket: timerBucket(rule),
    extensions:
      extensions > 0
        ? extensions === 1
          ? 'Kept once so far'
          : `Kept ${extensions} times so far`
        : '',
    resolution: !live && row?.resolution ? sentence(row.resolution) : '',
    acted: acted.map((a) => ({ ok: a.ok !== false, text: actedText(a) })),
    failure:
      row?.status === 'failed'
        ? friendlyTimerError(row.lastErrorCode, row.lastError)
        : '',
    canCancel: row?.status === 'armed' || row?.status === 'failed',
    cancelLabel: row?.status === 'failed' ? 'Dismiss' : 'Call off',
  };
}

function sentence(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

const ACTED_VERB = {
  limitReplies: ['Limited replies', 'Left the reply settings alone'],
  disableQuotes: ['Turned off quotes', 'Left quotes on'],
  delete: ['Deleted the post', 'Didn’t delete the post'],
};

function actedText(entry) {
  const [done, skipped] = ACTED_VERB[entry.action] || [
    'Acted',
    'Skipped a step',
  ];
  const detail = String(entry.detail || '').trim();
  const verb = entry.ok === false ? skipped : done;
  // The server's detail repeats the verb for a plain success ("deleted").
  const plain = detail.toLowerCase();
  if (
    !plain ||
    plain === entry.action.toLowerCase() ||
    verb.toLowerCase().startsWith(plain)
  )
    return `${verb}.`;
  return `${verb}: ${detail.replace(/[.]$/, '')}.`;
}

/**
 * The timers page's sections, in order: counting down, waiting to go out
 * (scheduled posts with a timer), gave up, and settled.
 */
export function timerSections(groups = [], waiting = []) {
  const live = groups.find((g) => g.key === 'live');
  const rest = groups.filter((g) => g.key !== 'live');
  const out = [];
  if (live) out.push(live);
  if (waiting.length)
    out.push({ key: 'waiting', title: 'Waiting to go out', rows: waiting });
  return out.concat(rest);
}

/** The URIs a set of settled timers deleted, for the archive. */
export function deletedPostUris(rows = []) {
  return (rows || [])
    .filter((r) => r?.status === 'deleted' && typeof r.postUri === 'string')
    .map((r) => r.postUri);
}

/* ---- the weekly schedule ---------------------------------------------- */

/** How many posting times a week holds. */
export function weeklyCount(schedule) {
  return WEEKDAYS.reduce(
    (n, d) => n + (schedule?.slots?.[d.key]?.length || 0),
    0,
  );
}

const SHORT_DAY = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

/**
 * The week in a line: 'Weekdays at 9:00 AM and 5:00 PM', 'Mon, Wed at
 * 9:00 AM; Sat at 10:00 AM', or 'No posting times yet'.
 */
export function weekSummary(schedule) {
  if (isScheduleEmpty(schedule)) return 'No posting times yet.';
  const groups = [];
  for (const { key } of WEEKDAYS) {
    const times = (schedule.slots?.[key] || []).slice().sort();
    if (!times.length) continue;
    const sig = times.join(',');
    const last = groups[groups.length - 1];
    if (last && last.sig === sig) last.days.push(key);
    else groups.push({ sig, days: [key], times });
  }
  const daysPhrase = (days) => {
    const s = days.join(',');
    if (s === 'mon,tue,wed,thu,fri') return 'Weekdays';
    if (s === 'sat,sun') return 'Weekends';
    if (days.length === 7) return 'Every day';
    const order = WEEKDAYS.map((d) => d.key);
    const runs = days.every(
      (d, i) => i === 0 || order.indexOf(d) === order.indexOf(days[i - 1]) + 1,
    );
    if (days.length >= 3 && runs)
      return `${SHORT_DAY[days[0]]} to ${SHORT_DAY[days[days.length - 1]]}`;
    return days.map((d) => SHORT_DAY[d]).join(', ');
  };
  const timesPhrase = (times) => {
    const labels = times.map(slotLabel);
    if (labels.length === 1) return labels[0];
    return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  };
  const lead = (phrase, i) =>
    i > 0 && /^(Weekdays|Weekends|Every day)$/.test(phrase)
      ? phrase.toLowerCase()
      : phrase;
  return `${groups.map((g, i) => `${lead(daysPhrase(g.days), i)} at ${timesPhrase(g.times)}`).join('; ')}.`;
}

function withSlots(schedule, slots) {
  return {
    timezone: typeof schedule?.timezone === 'string' ? schedule.timezone : '',
    slots,
  };
}

function copySlots(schedule) {
  const slots = {};
  for (const { key } of WEEKDAYS)
    slots[key] = [...(schedule?.slots?.[key] || [])];
  return slots;
}

/**
 * The week with `time` ('HH:MM') added to `day`. A week with no zone yet
 * takes `deviceZone`, so the times stay where they were set.
 */
export function addSlot(
  schedule,
  day,
  time,
  deviceZone = resolveTimezone(null),
) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ''))) return schedule;
  const slots = copySlots(schedule);
  if (!slots[day] || slots[day].includes(time)) return schedule;
  slots[day] = [...slots[day], time].sort();
  const next = withSlots(schedule, slots);
  if (!next.timezone) next.timezone = deviceZone;
  return next;
}

export function removeSlot(schedule, day, time) {
  const slots = copySlots(schedule);
  if (!slots[day]) return schedule;
  slots[day] = slots[day].filter((t) => t !== time);
  return withSlots(schedule, slots);
}

export function clearDay(schedule, day) {
  const slots = copySlots(schedule);
  if (!slots[day]) return schedule;
  slots[day] = [];
  return withSlots(schedule, slots);
}

/** The week with `from`'s times put on each of `to` (replacing theirs). */
export function copyDay(schedule, from, to = []) {
  const slots = copySlots(schedule);
  const times = slots[from] || [];
  for (const day of to) if (day !== from && slots[day]) slots[day] = [...times];
  const next = withSlots(schedule, slots);
  if (!next.timezone && times.length) next.timezone = resolveTimezone(null);
  return next;
}

/** The days a "copy to" choice names. */
export const COPY_TARGETS = [
  {
    key: 'weekdays',
    label: 'Every weekday',
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  },
  { key: 'weekend', label: 'The weekend', days: ['sat', 'sun'] },
  { key: 'all', label: 'Every day', days: WEEKDAYS.map((d) => d.key) },
];

/** The week with its wall times kept and its zone changed. */
export function moveToZone(schedule, timezone) {
  return { ...withSlots(schedule, copySlots(schedule)), timezone };
}

/**
 * The next `count` open times: slots of the week not held by a queued row
 * (any app's), soonest first.
 */
export function nextOpenSlots(
  schedule,
  queuedRows = [],
  now = Date.now(),
  count = 5,
) {
  if (isScheduleEmpty(schedule)) return [];
  const taken = new Set(
    (queuedRows || [])
      .map((r) => Math.floor(instant(r?.scheduledFor) / 60000))
      .filter(Number.isFinite),
  );
  const out = [];
  for (const slot of enumerateSlots(schedule, now, resolveTimezone(schedule))) {
    const ms = slot.getTime();
    if (ms <= now + MIN_LEAD_MS) continue;
    if (taken.has(Math.floor(ms / 60000))) continue;
    out.push(slot);
    if (out.length >= count) break;
  }
  return out;
}

/**
 * This app's queued rows whose time isn't one of the week's slots any more
 * (the week changed under them). They keep their time until the queue is
 * re-packed.
 */
export function offScheduleRows(schedule, rows = [], now = Date.now()) {
  const { movable } = splitQueueRows(rows, { now });
  if (!movable.length) return [];
  if (isScheduleEmpty(schedule)) return movable;
  const last = Math.max(
    ...movable.map((r) => instant(r.scheduledFor)).filter(Number.isFinite),
    now,
  );
  const minutes = new Set();
  for (const slot of enumerateSlots(schedule, now, resolveTimezone(schedule))) {
    if (slot.getTime() > last) break;
    minutes.add(Math.floor(slot.getTime() / 60000));
  }
  return movable.filter(
    (r) => !minutes.has(Math.floor(instant(r.scheduledFor) / 60000)),
  );
}

/** Whether the week is the one Virga ships with (for the reset button and suggestions). */
export function isDefaultWeek(schedule) {
  return isShippedDefaultSchedule(schedule?.slots);
}

/* ---- the time picker --------------------------------------------------- */

/**
 * Quick picks for a time, in `tz`: `[{ key, label, at: Date }]`, each inside
 * [min, max]. Fixed times of day (this evening, tomorrow morning) are read
 * on the queue's clock.
 */
export function quickPicks(
  now = Date.now(),
  tz,
  { min = now + MIN_LEAD_MS, max = now + QUEUE_HORIZON_DAYS * 86_400_000 } = {},
) {
  const zone = tz || resolveTimezone(null);
  const today = zonedWallTime(now, zone);
  if (!today) return [];
  const dayAfter = (n) => {
    const d = new Date(Date.parse(`${today.date}T12:00:00Z`) + n * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  const at = (n, time) => zonedWallTimeToUtc(dayAfter(n), time, zone);
  const order = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dow = order.indexOf(today.weekday);
  const untilSat = (6 - dow + 7) % 7 || 7;
  const untilMon = (1 - dow + 7) % 7 || 7;
  const roundUp = (ms, step) => Math.ceil(ms / step) * step;
  const picks = [
    {
      key: 'hour',
      label: 'In an hour',
      at: new Date(roundUp(now + 60 * 60_000, 5 * 60_000)),
    },
    { key: 'evening', label: 'This evening', at: at(0, '18:00') },
    { key: 'morning', label: 'Tomorrow morning', at: at(1, '09:00') },
    { key: 'tomorrow-evening', label: 'Tomorrow evening', at: at(1, '18:00') },
    { key: 'weekend', label: 'This weekend', at: at(untilSat, '10:00') },
    { key: 'next-week', label: 'Next week', at: at(untilMon, '09:00') },
  ];
  return picks.filter(
    (p) => p.at && p.at.getTime() >= min && p.at.getTime() <= max,
  );
}

/**
 * Why a picked time can't be used, or ''. `min`/`max` default to the server's
 * bounds: a minute from now, 90 days out.
 */
export function whenProblem(
  value,
  now = Date.now(),
  { min = now + MIN_LEAD_MS, max = now + QUEUE_HORIZON_DAYS * 86_400_000 } = {},
) {
  const ms = instant(value);
  if (!Number.isFinite(ms)) return 'Choose a date and a time.';
  if (ms < min)
    return ms <= now
      ? 'That time has passed. Choose a later one.'
      : 'Choose a time at least a minute from now.';
  if (ms > max)
    return 'That’s further ahead than a post can wait: choose an earlier time.';
  return '';
}

/* ---- posting a scheduled row now --------------------------------------- */

function coded(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Post a scheduled row now, as the account it was scheduled as, then take
 * the scheduled copy off (one retry), then set its timer if it had one. The
 * post goes out first: a failed cancel leaves a copy waiting (said in
 * `notes`), but a failed post never loses the row.
 *
 * deps: { requester, getScheduledMedia, reconstructFromScheduled, targetFor,
 * publish, resolveMention, cancelScheduled, emitPostsChanged, armTimer }
 * (armTimer(result, state) → armAfterPublish's answer).
 *
 * @returns {Promise<{ result, cancelled: boolean, timer: object|null, notes: string[] }>}
 */
export async function postScheduledNow(row, { did, deps, now = Date.now() }) {
  if (!row?.id)
    throw coded(
      'BAD_ROW',
      'That post couldn’t be read. Reload the page and try again.',
    );
  if (row.partial)
    throw coded(
      'PARTIALLY_PUBLISHED',
      'Part of this thread is already out. Retry it to post the rest.',
    );
  // Checked again here because the confirm dialog can stay open past the
  // row's time; see POST_NOW_CUTOFF_MS.
  if (rowIsDueSoon(row, now))
    throw coded(
      'ALREADY_DUE',
      'It’s about to go out at its scheduled time, so it can’t also be posted now.',
    );
  const hasMedia = Object.keys(row.payload?.media || {}).length > 0;
  const media = hasMedia
    ? await deps.getScheduledMedia(deps.requester, row.id)
    : {};
  const state = deps.reconstructFromScheduled(row, media, { asDid: did });
  const missing = (state.posts || []).some((p) =>
    (p.images || []).some((img) => !img.file && !img.blob),
  );
  if (missing)
    throw coded(
      'IMAGE_MISSING',
      'Some of this post’s images are no longer on Virga’s server. Edit it to add them again, then post it.',
    );
  const target = await deps.targetFor(did);
  const result = await deps.publish({ ...state, schedule: null }, target, {
    resolveMention: deps.resolveMention,
  });
  try {
    deps.emitPostsChanged(did, { added: result.written || [] });
  } catch {
    // The archive catching up is a nicety; the post is out.
  }
  const notes = [];
  let cancelled = false;
  for (let attempt = 0; attempt < 2 && !cancelled; attempt += 1) {
    try {
      await deps.cancelScheduled(deps.requester, row.id);
      cancelled = true;
    } catch (err) {
      if (err?.code === 'NOT_CANCELLABLE' || err?.status === 409) break;
    }
  }
  if (!cancelled)
    notes.push(
      'The scheduled copy couldn’t be taken off, so it may go out again at its time. Cancel it on this page.',
    );
  let timer = null;
  if (state.lifespan?.enabled && deps.armTimer) {
    timer = await deps.armTimer(result, state);
    if (timer?.status === 'failed')
      notes.push(
        `It went out without its timer${timer.error?.message ? `: ${timer.error.message}` : '.'}`,
      );
    else if (timer?.status === 'unconfirmed')
      notes.push(
        'Its timer may not have been set. Posting › Timers shows whether it was.',
      );
  }
  return { result, cancelled, timer, notes };
}
