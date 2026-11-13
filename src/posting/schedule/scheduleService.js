// Scheduled and queued posts, through Virga's server (/api/schedule/*).
//
// A scheduled post is a row on Virga's server until it goes out: the server's
// worker publishes it, as the account, at its time. Nothing about it is in the
// repo before then. The bodies are the server's (scheduleSerialize.js builds
// the create one); a queued post is a scheduled row with `queued: true` whose
// time is a slot of the weekly schedule (postingQueue.js), which the server
// never sees.
//
// Every call takes the Requester of the account the post is scheduled as
// (`backendFor(asDid)`): the server takes the account from the token, and
// listing, editing and cancelling all act on that account's rows.

import { SCHEDULED_CHANGED_EVENT, emitPostingEvent } from '../events.js';
import { quotaMessage } from './scheduledPostError.js';

const BASE = '/api/schedule';

/** The server's flat cap on pending scheduled rows per account, for everyone. */
export const MAX_PENDING_SCHEDULED = 50;

/** Most moves the server takes in one reorder. */
export const MAX_REORDER_MOVES = 50;

/** The limits /api/limits/status reports that posting reads. */
export const LIMIT_FEATURES = Object.freeze([
  'scheduledPosts',
  'postTimers',
  'conditionalTimers',
]);

function needsBackend() {
  return Object.assign(
    new Error(
      'Scheduling needs this account signed in through Virga’s server.',
    ),
    { code: 'NEEDS_BACKEND', status: 0 },
  );
}

function checkRequester(req) {
  if (!req || typeof req.request !== 'function') throw needsBackend();
}

/** An instant as ISO-Z (the server renders times as `+00:00`), else the input. */
function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  return { ...row, scheduledFor: toIso(row.scheduledFor) };
}

function announce(req, detail) {
  try {
    if (req?.did)
      emitPostingEvent(SCHEDULED_CHANGED_EVENT, { did: req.did, ...detail });
  } catch {
    // A listener's mistake must not turn a saved post into a failed save.
  }
}

/* ---- reading rows ----------------------------------------------------- */

/** Rows that count toward "scheduled at a time": pending or going out. */
export function isActiveScheduledRow(row) {
  return row?.status === 'pending' || row?.status === 'publishing';
}

/** How many of `rows` count toward the scheduled-at-a-time limit. */
export function countActiveScheduled(rows = []) {
  return (rows || []).reduce(
    (n, row) => n + (isActiveScheduledRow(row) ? 1 : 0),
    0,
  );
}

/**
 * Whether a listed row is a published post carrying the "its timer couldn't
 * be set" note: the only published row the list returns. Not part of the
 * queue, and never counted.
 */
export function isTimerNoteRow(row) {
  return (
    row?.status === 'published' &&
    (row?.lastErrorCode === 'TIMER_NOT_ARMED' ||
      row?.last_error_code === 'TIMER_NOT_ARMED')
  );
}

/**
 * The app a row belongs to. Virga's server holds only Virga's rows and says
 * so (`clientKey: 'virga'`); a row that doesn't say is Virga's too.
 */
export function rowClientKey(row) {
  return typeof row?.clientKey === 'string' && row.clientKey ? row.clientKey : 'virga';
}

/**
 * Whether a row may be opened in the composer and saved back: not part-way
 * out, and still waiting (or failed, which a full edit revives).
 */
export function canEditScheduledRow(row) {
  return !row?.partial && (row?.status === 'pending' || row?.status === 'failed');
}

/** Whether a row may be cancelled (or, once failed, dismissed). */
export function canCancelScheduledRow(row) {
  return row?.status === 'pending' || row?.status === 'failed';
}

/* ---- calls ------------------------------------------------------------ */

/**
 * The account's scheduled posts: `rows` is everything waiting, going out or
 * failed (every count, cap and slot calculation uses these), `timerNotes` the
 * published rows whose timer couldn't be set. `unavailable` is the server saying
 * scheduling isn't set up there.
 *
 * @returns {Promise<{ rows: object[], timerNotes: object[], unavailable?: true }>}
 */
export async function listScheduled(req, { signal } = {}) {
  checkRequester(req);
  let body;
  try {
    body = await req.request(`${BASE}/list`, { signal });
  } catch (err) {
    if (err?.code === 'UNAVAILABLE') {
      return { rows: [], timerNotes: [], unavailable: true };
    }
    throw err;
  }
  const all = (Array.isArray(body?.data) ? body.data : []).map(normalizeRow);
  const out = {
    rows: all.filter((row) => row?.status !== 'published'),
    timerNotes: all.filter(isTimerNoteRow),
  };
  if (body?.unavailable === true) out.unavailable = true;
  return out;
}

/** One row (no `partial` flag; the list has that). */
export async function getScheduled(req, id, { signal } = {}) {
  checkRequester(req);
  const body = await req.request(`${BASE}/get`, { query: { id }, signal });
  return normalizeRow(body?.data ?? null);
}

/**
 * A row's stored images as `{ [mediaId]: { base64, encoding } }`, for editing.
 * An image the server can no longer read is left out (its media was swept, or
 * never arrived), so the caller sees what is there.
 */
export async function getScheduledMedia(req, id, { signal } = {}) {
  checkRequester(req);
  const body = await req.request(`${BASE}/media`, {
    query: { id },
    signal,
    timeoutMs: 60_000,
  });
  return body?.data && typeof body.data === 'object' ? body.data : {};
}

/**
 * Schedule a post or thread. `body` is serializeForSchedule's. Answers
 * the server's row. QUOTA_EXCEEDED (with `payload.feature`) and RATE_LIMITED
 * arrive as thrown errors.
 */
export async function createScheduled(req, body, { signal } = {}) {
  checkRequester(req);
  const res = await req.request(`${BASE}/create`, {
    method: 'POST',
    body,
    signal,
    // The body carries every image as base64.
    timeoutMs: 60_000,
  });
  const row = normalizeRow(res?.data ?? null);
  announce(req, { change: 'created', id: row?.id ?? null });
  return row;
}

/**
 * Change a scheduled row. `patch` is one of the server's four shapes:
 *   `{ scheduledFor }`                     move it (time only)
 *   the same body as create                rewrite it (every image again)
 *   `{ retry: true }`                      send a failed row again as it is
 *   `{ acknowledgeTimer: true }`           clear a "timer couldn't be set" note
 * Answers the server's row.
 */
export async function updateScheduled(req, id, patch = {}, { signal } = {}) {
  checkRequester(req);
  const body = { ...patch, id };
  if (body.scheduledFor !== undefined)
    body.scheduledFor = toIso(body.scheduledFor);
  const content = !!patch.payload;
  const res = await req.request(`${BASE}/update`, {
    method: 'POST',
    body,
    signal,
    timeoutMs: content ? 60_000 : 30_000,
  });
  const row = normalizeRow(res?.data ?? null);
  const change = patch.retry
    ? 'retried'
    : patch.acknowledgeTimer
      ? 'acknowledged'
      : content
        ? 'edited'
        : 'moved';
  announce(req, { change, id });
  return row;
}

export function retryScheduled(req, id, options) {
  return updateScheduled(req, id, { retry: true }, options);
}

export function acknowledgeTimerNote(req, id, options) {
  return updateScheduled(req, id, { acknowledgeTimer: true }, options);
}

/**
 * Whether a reorder failure means this server has no reorder endpoint (or
 * too many moves for it), so the caller should move rows one at a time. Real
 * refusals are 409/400 with a code.
 */
export function isReorderUnsupported(err) {
  return (
    !!err &&
    (err.reorderUnsupported === true ||
      err.status === 404 ||
      err.status === 405)
  );
}

/**
 * Move queued posts to new slots, all at once (row-at-a-time writes can stop
 * half way and leave two posts sharing a minute). The server refuses the lot (409
 * NOT_REORDERABLE, or DELETE_TIME_TOO_EARLY naming one) when any row isn't
 * movable; that throws, and nothing was written.
 *
 * Where the endpoint is missing (404/405), or the moves are more than it
 * takes, it falls back to one time-only update per row, carrying on past
 * refusals: `failed` lists them, with the first refusal kept as `refusal`, so
 * the page can reload and try again from what was saved.
 *
 * @param {Array<{ id: string, scheduledFor: string|Date }>} moves
 * @returns {Promise<{ moved: number, fallback: boolean, failed: Array<{ id, error }>, refusal: Error|null }>}
 */
export async function reorderScheduled(req, moves, { signal } = {}) {
  checkRequester(req);
  const body = (moves || [])
    .filter((m) => m && m.id && m.scheduledFor)
    .map((m) => ({ id: m.id, scheduledFor: toIso(m.scheduledFor) }));
  if (body.length === 0)
    return { moved: 0, fallback: false, failed: [], refusal: null };
  if (body.length <= MAX_REORDER_MOVES) {
    try {
      const res = await req.request(`${BASE}/reorder`, {
        method: 'POST',
        body: { moves: body },
        signal,
      });
      const moved = Number.isFinite(res?.moved) ? res.moved : body.length;
      announce(req, { change: 'reordered', ids: body.map((m) => m.id) });
      return { moved, fallback: false, failed: [], refusal: null };
    } catch (err) {
      if (!isReorderUnsupported(err)) throw err;
    }
  }

  const failed = [];
  let refusal = null;
  for (const move of body) {
    if (signal?.aborted) {
      failed.push({
        id: move.id,
        error: signal.reason || new Error('Cancelled.'),
      });
      continue;
    }
    try {
      await req.request(`${BASE}/update`, {
        method: 'POST',
        body: { id: move.id, scheduledFor: move.scheduledFor },
        signal,
      });
    } catch (error) {
      failed.push({ id: move.id, error });
      if (!refusal && (error?.code || error?.detail)) refusal = error;
    }
  }
  const moved = body.length - failed.length;
  if (moved > 0) {
    announce(req, {
      change: 'reordered',
      ids: body
        .filter((m) => !failed.some((f) => f.id === m.id))
        .map((m) => m.id),
    });
  }
  return { moved, fallback: true, failed, refusal };
}

/**
 * Cancel a scheduled post (or dismiss a failed one). Allowed for another
 * client's row too. 409 NOT_CANCELLABLE: it is already going out, or gone.
 */
export async function cancelScheduled(req, id, { signal } = {}) {
  checkRequester(req);
  const res = await req.request(`${BASE}/cancel`, {
    method: 'POST',
    body: { id },
    signal,
  });
  announce(req, { change: 'cancelled', id });
  return res?.data ?? null;
}

/* ---- limits ------------------------------------------------------------ */

/**
 * /api/limits/status in one shape: per feature, `limit` (null for no limit
 * but the flat caps) and `usage` (null where the server didn't count it), plus
 * the policy it applied (`'flat'`: the same limits for every account).
 *
 * @returns {{ policy: string|null, isMember: boolean, features: Record<string, { limit: number|null }>, usage: Record<string, number|null>, caps: { scheduledPosts: number|null, timers: number|null } }}
 */
export function normalizeLimits(body) {
  const features = {};
  const usage = {};
  for (const key of LIMIT_FEATURES) {
    const f = body?.features?.[key];
    const limit =
      f && f.isUnlimited !== true && Number.isFinite(f.limit) ? f.limit : null;
    features[key] = { limit };
    const n = body?.usage?.[key];
    usage[key] = Number.isFinite(n) ? n : null;
  }
  // The flat ceilings everyone has (the server reports them beside the policy).
  const cap = (n) => (Number.isFinite(n) && n > 0 ? n : null);
  return {
    policy: typeof body?.policy === 'string' ? body.policy : null,
    isMember: body?.isMember === true,
    features,
    usage,
    caps: {
      scheduledPosts: cap(body?.caps?.scheduledPosts),
      timers: cap(body?.caps?.timers),
    },
  };
}

/** The account's limits and what it has in use (normalizeLimits). */
export async function getLimits(req, { signal } = {}) {
  checkRequester(req);
  const body = await req.request('/api/limits/status', { signal });
  return normalizeLimits(body);
}

/**
 * Why one more post can't be scheduled under the account's limits, or ''
 * when it can (or when nothing is known: the server decides). Editing an existing
 * row doesn't take another slot.
 */
export function scheduledRoomProblem(limits, { editing = false } = {}) {
  if (editing || !limits) return '';
  const limit = limits.features?.scheduledPosts?.limit;
  const used = limits.usage?.scheduledPosts;
  if (!Number.isFinite(limit) || !Number.isFinite(used)) return '';
  if (used < limit) return '';
  return quotaMessage({ feature: 'scheduledPosts', limit });
}

/**
 * "2 of 3 scheduled posts in use" for a limit the server reports, or '' when
 * there is no limit or no count.
 */
export function scheduledUsageLine(limits) {
  const limit = limits?.features?.scheduledPosts?.limit;
  const used = limits?.usage?.scheduledPosts;
  if (!Number.isFinite(limit) || !Number.isFinite(used)) return '';
  return `${Math.min(used, limit)} of ${limit} scheduled ${limit === 1 ? 'post' : 'posts'} in use`;
}
