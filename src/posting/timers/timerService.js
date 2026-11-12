// Timers on published posts, through cocoon's /api/self-destruct/* endpoints.
//
// A timer is a row on Virga's server, not a record in the repo, because it has
// to act while this browser is closed: when it comes due, cocoon reads the
// post's public counts and deletes it, limits its replies or turns off its
// quotes (the rule model is ./selfDestruct.js; this file is the transport).
//
// Every call takes the requester of the account the post was written as
// (`backendFor(<DID in the post URI>)`): cocoon takes the acting account from
// the token and refuses a post outside that repo, and a timer sent with
// another account's token would be refused or, worse, look like that
// account's.

import { TIMERS_CHANGED_EVENT, emitPostingEvent } from '../events.js';
import { bskyUrlFor, parseRecordUri } from '../lib/postLink.js';
import {
  fitTimerToPost,
  immediateTimerProblem,
  settleForPublish,
  timerAdjustmentNote,
  timerUsage,
  toWireSpec,
} from './selfDestruct.js';

const BASE = '/api/self-destruct';

/** cocoon keeps at most this much of a post's text beside its timer. */
export const TIMER_SNIPPET_MAX = 200;

/** cocoon arms a thread of at most this many posts besides the root. */
export const MAX_EXTRA_URIS = 100;

function codedError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

/** The account a post URI belongs to (`at://<did>/…`), or null. */
export function timerDidForUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('at://')) return null;
  const did = uri.slice(5).split('/')[0];
  return did.startsWith('did:') ? did : null;
}

/** A line of the post for the timer list: one space between words, ≤200. */
export function timerSnippet(text) {
  const flat = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return undefined;
  return flat.length > TIMER_SNIPPET_MAX
    ? `${flat.slice(0, TIMER_SNIPPET_MAX - 1).trimEnd()}…`
    : flat;
}

function needsBackend() {
  return codedError(
    'NEEDS_BACKEND',
    'Timers need this account signed in through Virga’s server.',
  );
}

function checkRequester(req, uri) {
  if (!req || typeof req.request !== 'function') return needsBackend();
  const did = timerDidForUri(uri);
  if (!did) {
    return codedError(
      'BAD_POST',
      'This post couldn’t be read, so its timer couldn’t be set.',
    );
  }
  if (req.did && req.did !== did) {
    return codedError(
      'WRONG_ACCOUNT',
      'A timer has to be set as the account that wrote the post.',
    );
  }
  return null;
}

/* ---- outcomes --------------------------------------------------------- */

/**
 * Whether cocoon said plainly that timers aren't on here (`code:
 * 'UNAVAILABLE'`, its migrations not applied). The only failure that may hide
 * the feature for the session.
 */
export function isTimersUnavailableError(err) {
  return !!err && err.code === 'UNAVAILABLE';
}

/**
 * Whether a failure means this cocoon has no timer endpoints at all: a
 * missing route (404, or 405 where the path exists for other methods), or
 * UNAVAILABLE. Real refusals are 400/402/409 with a code.
 */
export function isTimersUnsupported(err) {
  return (
    !!err &&
    (err.status === 404 || err.status === 405 || err.code === 'UNAVAILABLE')
  );
}

/**
 * Whether a failed arm may still have armed: the request timed out, the
 * connection dropped, or a gateway gave up (408/502/504), so cocoon may have
 * written the timer before the answer was lost. A status of cocoon's own (400,
 * 409, 503 UNAVAILABLE) is an answer; so is a request never sent.
 */
export function isArmOutcomeUnknown(err) {
  if (!err || isTimersUnsupported(err)) return false;
  if (err.code === 'TIMEOUT' || err.code === 'NETWORK_ERROR') return true;
  if (typeof err.status === 'number' && err.status > 0) {
    return err.status === 408 || err.status === 502 || err.status === 504;
  }
  if (err.code) return false;
  const name = err.name || '';
  if (name === 'TimeoutError' || name === 'AbortError' || name === 'TypeError')
    return true;
  return /timed out|timeout|failed to fetch|load failed|network|connection/i.test(
    err.message || '',
  );
}

/**
 * Whether a refusal definitely means the timer was not armed: a 4xx about the
 * request itself, or the feature being off. Not 408/429 (try later) or
 * 401/403 (the token, not the timer): after those an earlier attempt may still
 * have landed.
 */
export function isDefiniteArmRefusal(err) {
  if (!err) return false;
  if (isTimersUnavailableError(err)) return true;
  const status = err.status;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    ![401, 403, 408, 429].includes(status)
  );
}

/** Timers still counting down (or mid-check). */
export function isLiveTimer(row) {
  return row?.status === 'armed' || row?.status === 'checking';
}

export function countLiveTimers(rows = []) {
  return (rows || []).reduce((n, row) => n + (isLiveTimer(row) ? 1 : 0), 0);
}

/** The post's page on bsky.app, or null once it's gone (or isn't a post). */
export function timerPostUrl(row) {
  if (!row?.postUri || row.status === 'deleted') return null;
  const parsed = parseRecordUri(row.postUri);
  return parsed?.kind === 'post' ? bskyUrlFor(row.postUri) : null;
}

/* ---- availability ------------------------------------------------------ */

// Whether this cocoon can hold a timer at all. Asked once per page load (it
// only changes with a deploy); any list or arm answer settles it too. Only
// cocoon's explicit word hides the feature (`unavailable: true` from the
// list, or UNAVAILABLE), never a 404 from a deploy that hasn't caught up.
// 'unknown' still offers timers; a failed arm is reported where it happens.

let availability = 'unknown';
let probed = false;
let probing = null;

function settleAvailability(state) {
  availability = state;
  probed = true;
}

/** 'available' | 'unavailable' | 'unknown', as last heard on this page. */
export function timerAvailability() {
  return availability;
}

/**
 * Ask once whether timers can be armed here. Resolves to the state; never
 * rejects. A failed probe counts as asked (leaving 'unknown') so a dead
 * network isn't asked again on every composer open; with no requester it
 * isn't asked at all.
 */
export function probeTimerAvailability(req) {
  if (probed) return Promise.resolve(availability);
  if (!req) return Promise.resolve(availability);
  if (probing) return probing;
  probing = listTimers(req)
    .then(() => availability)
    .catch(() => {
      probed = true;
      return availability;
    })
    .finally(() => {
      probing = null;
    });
  return probing;
}

/**
 * When `err` is cocoon's explicit UNAVAILABLE, stop offering timers on this
 * page. Anything else changes nothing. Returns whether it did.
 */
export function markTimersUnavailable(err) {
  if (!isTimersUnavailableError(err)) return false;
  settleAvailability('unavailable');
  return true;
}

/** Forget what was heard (tests, and a sign-in to another server). */
export function resetTimerAvailability() {
  availability = 'unknown';
  probed = false;
  probing = null;
}

/* ---- reads ------------------------------------------------------------- */

/**
 * The account's timers, and whether this cocoon can hold one. By default:
 * live ones, ones that gave up, and rules that acted without deleting in the
 * last week; `history` returns everything settled instead.
 *
 * `unavailable` (cocoon's migrations aren't applied) is not "nothing is
 * counting down". A real failure throws.
 *
 * @returns {Promise<{ rows: object[], unavailable: boolean }>}
 */
export async function listTimers(req, { history = false, signal } = {}) {
  if (!req || typeof req.request !== 'function') throw needsBackend();
  try {
    const body = await req.request(`${BASE}/list`, {
      query: history ? { history: '1' } : undefined,
      signal,
    });
    const unavailable = body?.unavailable === true;
    settleAvailability(unavailable ? 'unavailable' : 'available');
    return { rows: Array.isArray(body?.data) ? body.data : [], unavailable };
  } catch (err) {
    if (isTimersUnavailableError(err)) {
      settleAvailability('unavailable');
      return { rows: [], unavailable: true };
    }
    throw err;
  }
}

/**
 * Timer slots in use per bucket (selfDestruct.timerUsage): live timers plus
 * scheduled posts waiting with one, leaving out the row an edit rewrites.
 * `scheduledRows` is listScheduled's `rows`. Null when the timer list can't be
 * read, so the caller lets cocoon decide.
 */
export async function loadTimerUsage(
  req,
  { scheduledRows = [], exceptScheduledId = null } = {},
) {
  try {
    const { rows } = await listTimers(req);
    return timerUsage({
      liveRows: rows,
      scheduledRows,
      exceptScheduledId,
    });
  } catch {
    return null;
  }
}

/* ---- writes ------------------------------------------------------------ */

/**
 * The create body for a timer, or null when the fitted rule is off. Effects
 * are always present: cocoon reads absent effects as delete, so a rule that
 * only limits replies would otherwise take the post down.
 */
export function timerBody({
  uri,
  cid,
  extraUris = [],
  snippet,
  postedAt,
  rule,
  fit,
  now = Date.now(),
}) {
  const startedAt = Date.parse(postedAt);
  const spec = toWireSpec(
    fitTimerToPost(rule, fit),
    Number.isFinite(startedAt) ? startedAt : now,
  );
  if (!spec) return null;
  const body = {
    postUri: uri,
    postCid: cid || undefined,
    extraUris: (extraUris || []).filter(Boolean).slice(0, MAX_EXTRA_URIS),
    snippet: timerSnippet(snippet),
    postedAt: Number.isFinite(startedAt)
      ? new Date(startedAt).toISOString()
      : undefined,
    lifespanSeconds: spec.lifespanSeconds,
    conditions: spec.conditions,
    effects: spec.effects,
  };
  // Only when the writer pinned a time instead of a length.
  if (spec.deleteAt) body.deleteAt = spec.deleteAt;
  return body;
}

async function sendCreate(req, body, signal) {
  const res = await req.request(`${BASE}/create`, {
    method: 'POST',
    body,
    signal,
  });
  return res?.data ?? null;
}

function announce(did, detail) {
  try {
    emitPostingEvent(TIMERS_CHANGED_EVENT, { did, ...detail });
  } catch {
    // A listener's mistake must never turn an armed timer into a failed one.
  }
}

/**
 * What became of an arm whose answer never arrived. Never rejects.
 *
 * Retries once (create is idempotent per live post, so a landed first attempt
 * answers with its timer), then looks for the post among the live timers.
 * Only a definite refusal of the retry, or the post found counting down, is
 * conclusive: the list holds at most a page of timers, so not finding the
 * post there is 'unconfirmed', not 'failed'.
 *
 * @returns {Promise<{ status: 'armed'|'failed'|'unconfirmed', row?: object, error?: Error }>}
 */
export async function confirmArmAfterUnknown(req, body, firstError = null) {
  let retryError = null;
  try {
    const row = await sendCreate(req, body);
    announce(req.did || timerDidForUri(body.postUri), {
      change: 'armed',
      postUri: body.postUri,
      id: row?.id ?? null,
    });
    return { status: 'armed', row };
  } catch (err) {
    markTimersUnavailable(err);
    if (isDefiniteArmRefusal(err)) return { status: 'failed', error: err };
    retryError = err;
  }
  try {
    const { rows } = await listTimers(req);
    const found = rows.find(
      (row) => row?.postUri === body.postUri && isLiveTimer(row),
    );
    if (found) {
      announce(req.did || timerDidForUri(body.postUri), {
        change: 'armed',
        postUri: body.postUri,
        id: found.id ?? null,
      });
      return { status: 'armed', row: found };
    }
  } catch {
    // No answer from the list either; it may be armed or not.
  }
  return { status: 'unconfirmed', error: retryError || firstError };
}

/**
 * Put a timer on a post: one request, never rejects.
 *
 *   armed       cocoon has it (`row` is cocoon's)
 *   failed      cocoon said no, the rule can't be kept, or the requester
 *               isn't the post's account (`error`, with a `code` where one
 *               is known; QUOTA_EXCEEDED carries `payload.feature`)
 *   confirming  the answer was lost; `confirmation` resolves to what became
 *               of it (confirmArmAfterUnknown) without holding the caller
 *   none        the fitted rule is off: nothing to send
 *
 * `fit` is composerTimerFit's; `postedAt` is when the post went up (the
 * window runs from there). `preflight` refuses, before sending, a pinned time
 * that has already passed or is more than 30 days out: right for putting an
 * existing post on a timer. armAfterPublish turns it off, because a pin that
 * passed while the post was being written is the five-minute floor instead.
 *
 * @returns {Promise<{ status: 'armed'|'failed'|'confirming'|'none', row?, error?, confirmation?, adjusted: null|'floor' }>}
 */
export async function createTimer(
  req,
  {
    uri,
    cid,
    extraUris = [],
    snippet,
    postedAt,
    rule,
    fit,
    signal,
    now = Date.now(),
    preflight = true,
  } = {},
) {
  const refused = checkRequester(req, uri);
  if (refused) return { status: 'failed', error: refused, adjusted: null };

  const fitted = fitTimerToPost(rule, fit);
  if (!fitted.enabled) return { status: 'none', adjusted: null };
  if (preflight) {
    const problem = immediateTimerProblem(fitted, now);
    if (problem)
      return {
        status: 'failed',
        error: codedError('TIMER_PROBLEM', problem),
        adjusted: null,
      };
  }
  const startedAt = Date.parse(postedAt);
  const { adjusted } = settleForPublish(
    fitted,
    Number.isFinite(startedAt) ? startedAt : now,
  );
  const body = timerBody({
    uri,
    cid,
    extraUris,
    snippet,
    postedAt,
    rule,
    fit,
    now,
  });
  if (!body) return { status: 'none', adjusted: null };

  try {
    const row = await sendCreate(req, body, signal);
    settleAvailability('available');
    announce(req.did || timerDidForUri(uri), {
      change: 'armed',
      postUri: uri,
      id: row?.id ?? null,
    });
    return { status: 'armed', row, adjusted };
  } catch (err) {
    markTimersUnavailable(err);
    if (isArmOutcomeUnknown(err) && !signal?.aborted) {
      return {
        status: 'confirming',
        error: err,
        adjusted,
        confirmation: confirmArmAfterUnknown(req, body, err),
      };
    }
    return { status: 'failed', error: err, adjusted };
  }
}

/**
 * Arm the timer for what `publish` just wrote: the root post carries it and
 * the rest of a thread goes with it. Waits through a lost answer (one retry,
 * then a look at the timers list); `onConfirming` hears when that starts, so
 * the composer can say so. Never rejects.
 *
 * Resolves to `{ status: 'armed'|'failed'|'unconfirmed'|'none', row?, error?,
 * adjusted, note }`, where `note` is the sentence for the "Posted" message
 * when the timer was moved to the five-minute floor (timerAdjustmentNote).
 *
 * @param {object|null} req - backendFor(<DID of the written posts>)
 * @param {{ posts: Array<{ uri, cid }>, root: { uri, cid } }} publishResult
 * @param {object} rule - the writer's TimerRule (unfitted)
 */
export async function armAfterPublish(
  req,
  publishResult,
  rule,
  { snippet, postedAt, fit, onConfirming, now = Date.now() } = {},
) {
  try {
    const root = publishResult?.root || publishResult?.posts?.[0] || null;
    if (!root?.uri) {
      return {
        status: 'failed',
        error: codedError('BAD_POST', 'Nothing was written to put a timer on.'),
        adjusted: null,
        note: '',
      };
    }
    const extraUris = (publishResult.posts || [])
      .map((p) => p?.uri)
      .filter((u) => u && u !== root.uri);
    const first = await createTimer(req, {
      uri: root.uri,
      cid: root.cid,
      extraUris,
      snippet,
      postedAt: postedAt || new Date(now).toISOString(),
      rule,
      fit,
      now,
      preflight: false,
    });
    const note = first.adjusted
      ? timerAdjustmentNote(first.adjusted, fitTimerToPost(rule, fit).effects)
      : '';
    if (first.status !== 'confirming') return { ...first, note };
    try {
      onConfirming?.();
    } catch {
      // The caller's message isn't ours to fail on.
    }
    const outcome = await first.confirmation;
    return { ...outcome, adjusted: first.adjusted, note };
  } catch (error) {
    return { status: 'failed', error, adjusted: null, note: '' };
  }
}

/**
 * Call a timer off, leaving the post where it is. Answers cocoon's row
 * (`{ id, status: 'cancelled' }`). 409 NOT_CANCELLABLE means it is being
 * checked or has settled: reload rather than patch, the worker may hold it.
 */
export async function cancelTimer(req, id, { signal } = {}) {
  if (!req || typeof req.request !== 'function') throw needsBackend();
  const res = await req.request(`${BASE}/cancel`, {
    method: 'POST',
    body: { id },
    signal,
  });
  announce(req.did, { change: 'cancelled', id });
  return res?.data ?? null;
}
