/**
 * Scheduled posts: the store and the publisher.
 *
 *   1. Queue CRUD against the `scheduled_posts` table through the service-role
 *      client (which bypasses RLS), so every helper here is handed a DID the
 *      caller has already resolved from the session token.
 *   2. publishScheduledPost(row): restore the account's OAuth session and write
 *      the post or thread to its PDS, retrying once on "Invalid token", driven
 *      by the cron worker rather than a request.
 *
 * The payload (one shape for a single post and a thread):
 *
 *   payload = {
 *     posts: [ PostSpec, ... ],          // 1 = a single post; more = a thread
 *     gates: { threadgate, postgate },   // applied to posts[0] (the root) only
 *     media: { [mediaId]: { storagePath, encoding } },  // filled in at create
 *     rkeys: [ tid, ... ],               // one per post, minted from the time
 *     tz?, selfDestruct?
 *   }
 *   PostSpec = { record: { text, facets?, langs?, labels?, tags? }, embed?: EmbedSpec }
 *   EmbedSpec =
 *     | { type:'images', images:[{ mediaId, alt, aspectRatio? }] }
 *     | { type:'external', uri, title, description, thumbMediaId?, thumbUrl?, associatedRefs? }
 *     | { type:'record', uri, cid }
 *     | { type:'recordWithMedia', uri, cid, media: <images|external EmbedSpec> }
 *
 * Blobs are uploaded to the PDS at publish time (a PDS garbage-collects blobs
 * nothing references). Image and thumbnail bytes wait in the private
 * `scheduled-media` Storage bucket meanwhile; a card thumbnail may instead be a
 * thumbUrl the worker fetches. Quote and record embeds are just { uri, cid }.
 *
 * Threads publish in order, each post replying to the one before. The
 * { uri, cid } of each written post is saved as `progress` after every post, so
 * a retry resumes rather than writing earlier posts again.
 */

import crypto from 'node:crypto';
import { Agent } from '@atproto/api';
import { TID } from '@atproto/common-web';
import { getOAuthClient } from '../oauth/client.js';
import { getSupabaseClient } from '../supabase.js';
import { isSafeHttpsUrlShape, safeFetchBuffer } from '../net/safeFetch.js';
import {
  MIN_LIFESPAN_SECONDS,
  MAX_LIFESPAN_SECONDS,
  parseEffects,
  parseConditions,
  snippetFromScheduledPayload,
} from '../timers/selfDestruct.js';
import {
  QuotaExceededError,
  maxPending,
  scheduledPostsCeiling,
} from '../limits/limits.js';

const TABLE = 'scheduled_posts';
export const MEDIA_BUCKET = 'scheduled-media';

export const MAX_HORIZON_DAYS = 90;
export const MAX_THREAD_POSTS = 25;
// Bluesky allows up to 10 photos a post: 1–4 as app.bsky.embed.images, 5–10 as
// app.bsky.embed.gallery (see buildEmbed).
export const MAX_IMAGES_PER_POST = 10;
export const TARGET = 'bluesky';
// `external.associatedRefs` names the atproto records behind a linked page
// (standard.site's document and publication). Bluesky's AppView hydrates the
// richer publisher card from them, and resolves at most four per card.
export const MAX_ASSOCIATED_REFS = 4;
export const MAX_POST_TEXT = 3000;

const DAY_MS = 24 * 60 * 60 * 1000;

export { maxPending };

export class NonRetryableError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'NonRetryableError';
    this.nonRetryable = true;
    this.code = code;
  }
}

// ─── Failure codes ──────────────────────────────────────────────────────────
// The closed vocabulary written to last_error_code beside the sentence in
// last_error. The client decides what to offer (reconnect, re-attach images,
// wait) from the code, so it keeps working when a sentence is reworded. The
// column has no CHECK, so this list is the only thing keeping it closed.
export const FAILURE_CODES = Object.freeze([
  'SESSION_UNAVAILABLE',
  'MEDIA_MISSING',
  'TIMED_OUT',
  'RATE_LIMITED',
  'REFUSED',
  // The post published, but the self-destruct timer it asked for couldn't be
  // set. The one code that rides on a 'published' row: the author needs to
  // know the post won't take itself down.
  'TIMER_NOT_ARMED',
  'UNKNOWN',
]);
const FAILURE_CODE_SET = new Set(FAILURE_CODES);

/** A permitted code, or null (an unknown code is dropped, never stored). */
export function normalizeFailureCode(code) {
  return typeof code === 'string' && FAILURE_CODE_SET.has(code) ? code : null;
}

/** An Error carrying one of the codes above. Retriable: the code says why, not whether. */
function codedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * The best guess at why a publish attempt failed, from an Error or a bare
 * sentence. Order matters: a 429 is both rate-limited and a refusal, and the
 * specific reading is the useful one.
 */
export function classifyFailure(err) {
  if (!err) return 'UNKNOWN';

  if (typeof err !== 'string') {
    const own = normalizeFailureCode(err.code);
    if (own) return own;
    // An XRPCError: `status` is the HTTP code, `error` the PDS's own name for it.
    const status = err.status ?? err.statusCode;
    const kind = err.error || '';
    if (status === 429 || kind === 'RateLimitExceeded') return 'RATE_LIMITED';
    if (
      status === 401 ||
      status === 403 ||
      kind === 'ExpiredToken' ||
      kind === 'InvalidToken'
    ) {
      return 'SESSION_UNAVAILABLE';
    }
    if (
      kind === 'InvalidRequest' ||
      kind === 'BlockedActor' ||
      status === 400
    ) {
      return 'REFUSED';
    }
  }

  const text = String(
    (typeof err === 'string' ? err : err.message) || '',
  ).toLowerCase();
  if (!text) return 'UNKNOWN';
  if (/rate.?limit|too many requests|\b429\b/.test(text)) return 'RATE_LIMITED';
  if (
    /ran out of time|timed out|timeout|etimedout|socket hang up|aborted/.test(
      text,
    )
  ) {
    return 'TIMED_OUT';
  }
  if (
    /account session|invalid token|expired token|not authenticated|unauthorized/.test(
      text,
    )
  ) {
    return 'SESSION_UNAVAILABLE';
  }
  if (
    /images for this scheduled post are missing|missing bytes for media|media download failed/.test(
      text,
    )
  ) {
    return 'MEDIA_MISSING';
  }
  if (
    /invalidrequest|invalid request|rejected|refused|not allowed/.test(text)
  ) {
    return 'REFUSED';
  }
  return 'UNKNOWN';
}

function isInvalidToken(err) {
  return (
    err?.message === 'Invalid token' ||
    err?.message?.includes('Invalid token') ||
    err?.error === 'InvalidToken'
  );
}

// ─── Database errors ────────────────────────────────────────────────────────

/** True when the database has no such table: the migration hasn't been applied. */
export function isMissingTable(error) {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    // Anchored, so "column x of relation y does not exist" isn't read as a missing table.
    (typeof error.message === 'string' &&
      /^(could not find the table|relation "[^"]+" does not exist)/i.test(
        error.message,
      ))
  );
}

/** True when the database has no such function: the migration hasn't been applied. */
export function isUndefinedFunction(error) {
  if (!error) return false;
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    (typeof error.message === 'string' &&
      /could not find the function/i.test(error.message))
  );
}

/** Scheduling can't run here: no Supabase, or its migration isn't applied. */
function unavailable(message) {
  return codedError(message, 'UNAVAILABLE');
}

/** A thrown Error for a Supabase error, coded UNAVAILABLE when the schema is missing. */
function dbError(error) {
  if (isMissingTable(error) || isUndefinedFunction(error)) {
    return unavailable(
      `scheduling needs its database migration: ${error.message}`,
    );
  }
  return new Error(error?.message || 'database error');
}

function requireSupabase() {
  const supabase = getSupabaseClient();
  if (!supabase) throw unavailable('Supabase is not configured');
  return supabase;
}

const nowIso = () => new Date().toISOString();

// ─── Sessions ───────────────────────────────────────────────────────────────

/**
 * The account's OAuth session, or null. The client wrapper answers null when
 * the grant is missing or a refresh fails, but throws when the client itself
 * never started (a missing or broken key), and that library message would be
 * stored on the row as an UNKNOWN failure nobody can act on. Both mean
 * "couldn't reach the session", so both take the caller's SESSION_UNAVAILABLE
 * path; the cause goes to the log.
 */
async function restoreSessionSafe(userDid, options) {
  try {
    return await getOAuthClient().restoreSession(userDid, options);
  } catch (error) {
    console.error(
      `[schedule] couldn't restore the session for ${userDid}:`,
      error?.message || error,
    );
    return null;
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * A spec's associatedRefs as strongRefs safe to write into a record: `at://`
 * URIs with a CID, no duplicates, at most four. Null when nothing is left, so
 * an empty array never reaches the post.
 */
export function normalizeAssociatedRefs(raw) {
  if (!Array.isArray(raw)) return null;
  const refs = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const uri = typeof item.uri === 'string' ? item.uri.trim() : '';
    const cid = typeof item.cid === 'string' ? item.cid.trim() : '';
    if (!uri.startsWith('at://') || !cid) continue;
    if (refs.some((ref) => ref.uri === uri)) continue;
    refs.push({ $type: 'com.atproto.repo.strongRef', uri, cid });
    if (refs.length === MAX_ASSOCIATED_REFS) break;
  }
  return refs.length > 0 ? refs : null;
}

function validateEmbedSpec(embed, { allowRecordWithMedia = true } = {}) {
  if (!embed) return null;
  switch (embed.type) {
    case 'images':
      if (!Array.isArray(embed.images) || embed.images.length === 0) {
        return 'images embed needs at least one image';
      }
      if (embed.images.length > MAX_IMAGES_PER_POST) {
        return `a post can have at most ${MAX_IMAGES_PER_POST} images`;
      }
      if (embed.images.some((i) => !i || !i.mediaId))
        return 'each image needs a mediaId';
      return null;
    case 'external':
      if (!embed.uri) return 'external embed needs a uri';
      // The worker fetches thumbUrl server-side and uploads it to the PDS, so
      // anything but a public https URL is refused here: otherwise a caller
      // could point it at an internal host and read the answer out of their
      // own repo. uploadRemoteThumb checks again at fetch time.
      if (embed.thumbUrl != null && !isSafeHttpsUrlShape(embed.thumbUrl)) {
        return 'external embed thumbUrl must be a public https URL';
      }
      // Written verbatim into the repo at publish time, so the shape is
      // checked rather than trusted. A ref that doesn't resolve is harmless
      // (the card falls back to plain), but a malformed one breaks the record.
      if (embed.associatedRefs != null) {
        if (!Array.isArray(embed.associatedRefs)) {
          return 'external embed associatedRefs must be an array';
        }
        if (embed.associatedRefs.length > MAX_ASSOCIATED_REFS) {
          return `external embed can carry at most ${MAX_ASSOCIATED_REFS} associatedRefs`;
        }
        if (!normalizeAssociatedRefs(embed.associatedRefs)) {
          return 'each associatedRef needs an at:// uri and a cid';
        }
      }
      return null;
    case 'record':
      if (!embed.uri || !embed.cid) return 'record embed needs uri and cid';
      return null;
    case 'recordWithMedia':
      if (!allowRecordWithMedia) return 'nested recordWithMedia is not allowed';
      if (!embed.uri || !embed.cid)
        return 'recordWithMedia needs the quoted uri and cid';
      return validateEmbedSpec(embed.media, { allowRecordWithMedia: false });
    default:
      return `unknown embed type: ${embed.type}`;
  }
}

/** The four time guards a create, an edit, a move and a reorder all apply. */
function checkTime(scheduledFor) {
  if (!scheduledFor) return { error: 'scheduledFor is required' };
  const when = new Date(scheduledFor);
  if (Number.isNaN(when.getTime()))
    return { error: 'scheduledFor is not a valid datetime' };
  if (when.getTime() <= Date.now())
    return { error: 'scheduledFor must be in the future' };
  if (when.getTime() > Date.now() + MAX_HORIZON_DAYS * DAY_MS) {
    return { error: `scheduledFor must be within ${MAX_HORIZON_DAYS} days` };
  }
  return { when };
}

/**
 * Validate a create (or a full edit). Returns { ok: true, value } or
 * { ok: false, error }. The endpoint stashes the media and fills in
 * payload.media afterwards.
 */
export function validateCreate({
  scheduledFor,
  target = TARGET,
  payload,
  queued = false,
} = {}) {
  const time = checkTime(scheduledFor);
  if (time.error) return { ok: false, error: time.error };
  const { when } = time;

  if (target !== TARGET)
    return { ok: false, error: `target must be one of: ${TARGET}` };

  if (!payload || typeof payload !== 'object')
    return { ok: false, error: 'payload is required' };
  const posts = payload.posts;
  if (!Array.isArray(posts) || posts.length === 0) {
    return { ok: false, error: 'payload.posts must be a non-empty array' };
  }
  if (posts.length > MAX_THREAD_POSTS) {
    return {
      ok: false,
      error: `a thread can have at most ${MAX_THREAD_POSTS} posts`,
    };
  }

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    if (!p || !p.record || typeof p.record !== 'object') {
      return { ok: false, error: `posts[${i}].record is required` };
    }
    const text = typeof p.record.text === 'string' ? p.record.text : '';
    if (text.length > MAX_POST_TEXT) {
      return {
        ok: false,
        error: `posts[${i}] text exceeds ${MAX_POST_TEXT} characters`,
      };
    }
    if (!text.trim() && !p.embed)
      return { ok: false, error: `posts[${i}] needs text or an embed` };
    const embedErr = validateEmbedSpec(p.embed);
    if (embedErr) return { ok: false, error: `posts[${i}]: ${embedErr}` };
  }

  const gates = payload.gates || {};

  // Checked here, while the writer is still at the keyboard, rather than at
  // publish time hours later when a refusal is nobody's to act on.
  const selfDestruct = validateSelfDestructSpec(
    payload.selfDestruct,
    when.getTime(),
  );
  if (selfDestruct.error) return { ok: false, error: selfDestruct.error };

  return {
    ok: true,
    value: {
      scheduledFor: when.toISOString(),
      target: TARGET,
      posts,
      // threadgate [] is a real gate ("nobody can reply"): only null or
      // absent means no gate, so `??`, never `||`.
      gates: {
        threadgate: gates.threadgate ?? null,
        postgate: gates.postgate ?? null,
      },
      queued: !!queued,
      selfDestruct: selfDestruct.value,
    },
  };
}

/**
 * Normalize the optional `payload.selfDestruct` a scheduled post may carry:
 * { lifespanSeconds, deleteAt?, conditions, effects }. Returns { value } (null
 * when absent) or { error }.
 *
 * Only what can be judged before the post exists is checked; the worker runs
 * the full arm validation once the records are written. `scheduledForMs` is
 * when the post will publish: a pinned deleteAt before then (plus the minimum
 * lifespan) is a promise nobody could mean, so it's refused here while the
 * writer can still fix it.
 */
export function validateSelfDestructSpec(raw, scheduledForMs = null) {
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw !== 'object')
    return { error: 'selfDestruct must be an object' };
  const seconds = Math.floor(Number(raw.lifespanSeconds));
  if (!Number.isFinite(seconds))
    return { error: 'selfDestruct.lifespanSeconds is required' };
  if (seconds < MIN_LIFESPAN_SECONDS) {
    return {
      error: `a post has to stand for at least ${MIN_LIFESPAN_SECONDS / 60} minutes`,
    };
  }
  if (seconds > MAX_LIFESPAN_SECONDS) {
    return {
      error: `a timer can run for at most ${MAX_LIFESPAN_SECONDS / 86400} days`,
    };
  }
  let deleteAt = null;
  if (raw.deleteAt) {
    const at = new Date(raw.deleteAt).getTime();
    if (!Number.isFinite(at))
      return { error: 'selfDestruct.deleteAt is not a valid datetime' };
    if (
      Number.isFinite(scheduledForMs) &&
      at < scheduledForMs + MIN_LIFESPAN_SECONDS * 1000
    ) {
      return {
        error:
          'the delete time is before this post would even publish. pick a later delete time, or use a duration instead.',
      };
    }
    deleteAt = new Date(at).toISOString();
  }

  // Strict about what a rule says: an effect or clause this server doesn't
  // recognise is refused, never defaulted, because the default is delete and
  // delete is no stand-in for a rule the writer meant to be gentler.
  const effects = parseEffects(raw.effects);
  if (effects.error) return { error: effects.error };
  const conditions = parseConditions(raw.conditions);
  if (conditions.error) return { error: conditions.error };

  return {
    value: {
      lifespanSeconds: seconds,
      deleteAt,
      conditions: conditions.value,
      effects: effects.value,
    },
  };
}

/** Validate a time-only move: the same time guards as a create. */
export function validateReschedule({ scheduledFor } = {}) {
  const time = checkTime(scheduledFor);
  if (time.error) return { ok: false, error: time.error };
  return { ok: true, value: { scheduledFor: time.when.toISOString() } };
}

// A single move refused for stranding the post's pinned delete time. A
// reorder names the post in its own sentence (strandedMoveError), since one
// drag moves several.
export const DELETE_TIME_TOO_EARLY_ERROR =
  "this post's delete time would come before it goes out, or within five minutes of it. pick an earlier slot, or change its lifespan first.";

/**
 * The pinned delete time a move to `scheduledFor` would strand, or null. A
 * move changes the time without going back through validateSelfDestructSpec,
 * so a post dragged past its own delete time is caught here, while the writer
 * can choose again. A slot exactly five minutes before is allowed.
 */
export function strandsDeleteTime(payload, scheduledFor) {
  const deleteAt = payload?.selfDestruct?.deleteAt;
  if (!deleteAt) return null;
  const at = new Date(deleteAt).getTime();
  const when = new Date(scheduledFor).getTime();
  if (!Number.isFinite(at) || !Number.isFinite(when)) return null;
  return when > at - MIN_LIFESPAN_SECONDS * 1000
    ? new Date(at).toISOString()
    : null;
}

/**
 * A reorder's refusal, naming the post by the opening of its text (the queue
 * shows posts by text, not id). A post with no text is "one of these posts".
 */
export function strandedMoveError(payload) {
  const text = (snippetFromScheduledPayload(payload) || '')
    .replace(/\s+/g, ' ')
    .trim();
  const who = text
    ? `"${text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text}"`
    : 'one of these posts';
  return `the delete time on ${who} would come before it goes out in this order, or within five minutes of it. move it earlier, or change its lifespan first. your queue is unchanged.`;
}

/** Every mediaId a post's embed references (images and card thumbnails). */
export function collectMediaIds(embed, out = []) {
  if (!embed) return out;
  if (embed.type === 'images') embed.images.forEach((i) => out.push(i.mediaId));
  else if (embed.type === 'external' && embed.thumbMediaId)
    out.push(embed.thumbMediaId);
  else if (embed.type === 'recordWithMedia') collectMediaIds(embed.media, out);
  return out;
}

// ─── Media (Supabase Storage) ───────────────────────────────────────────────

/**
 * Stash one image's bytes under the row. `subdir` lets an edit write into a
 * fresh folder instead of overwriting objects a publish in flight is reading.
 */
export async function storeMedia(
  scheduledPostId,
  mediaId,
  base64,
  encoding,
  subdir = '',
) {
  const supabase = requireSupabase();
  const ext = (encoding && String(encoding).split('/')[1]) || 'bin';
  const safeId = String(mediaId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `${scheduledPostId}/${subdir ? `${subdir}/` : ''}${safeId}.${ext}`;
  const bytes = Buffer.from(base64, 'base64');
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, bytes, { contentType: encoding, upsert: true });
  if (error) throw new Error(`media upload failed: ${error.message}`);
  return path;
}

async function fetchMediaBytes(storagePath) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .download(storagePath);
  if (error) throw new Error(`media download failed: ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Remove stashed objects. Best-effort (cleanup never fails a call), but it
 * says whether the bytes are really gone: the media sweep may only stamp a
 * row reclaimed once they are.
 */
async function removeQuietly(paths) {
  if (!paths || paths.length === 0) return true;
  try {
    const supabase = requireSupabase();
    const { error } = await supabase.storage.from(MEDIA_BUCKET).remove(paths);
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.warn(`[schedule] media cleanup failed: ${err.message}`);
    return false;
  }
}

/** Remove every stashed object a media map names (best-effort). */
async function deleteMedia(mediaMap) {
  return removeQuietly(
    Object.values(mediaMap || {})
      .map((m) => m?.storagePath)
      .filter(Boolean),
  );
}

// ─── Queue ──────────────────────────────────────────────────────────────────

export const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A malformed id would reach Postgres as a cast error (a 500); every lookup
// by id answers "not found" for one instead.
const isRowId = (id) => typeof id === 'string' && UUID_SHAPE.test(id);

const quotaError = (limit) => new QuotaExceededError('scheduledPosts', limit);

/** The account's pending and publishing rows (one count, shared by retry and revival). */
async function countActive(supabase, userDid) {
  const { count, error } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('user_did', userDid)
    .in('status', ['pending', 'publishing']);
  if (error) throw dbError(error);
  return count || 0;
}

/**
 * Schedule a post, refusing it when the account is at its ceiling (the flat
 * cap, or a lower SCHEDULED_POSTS_LIMIT). The count and the insert happen in
 * create_scheduled_post_capped under a per-DID advisory lock, so two creates
 * arriving together can't both read a count under the ceiling.
 */
export async function createScheduledPost({
  userDid,
  scheduledFor,
  payload,
  queued = false,
}) {
  const supabase = requireSupabase();
  const ceiling = scheduledPostsCeiling();
  const { data, error } = await supabase.rpc('create_scheduled_post_capped', {
    p_user_did: userDid,
    p_scheduled_for: scheduledFor,
    p_target: TARGET,
    p_payload: payload,
    p_queued: !!queued,
    p_max_active: ceiling,
  });
  if (error) throw dbError(error);
  if (data && data.ok === false) throw quotaError(ceiling);
  // The insert may or may not have landed, so never retry blindly: report it.
  if (!data || !data.post)
    throw new Error('the scheduled post could not be saved');
  return settleRkeyCollisions(data.post, userDid);
}

/**
 * Re-mint a freshly inserted row's rkeys if they collide with another row's.
 *
 * assignRkeys reads committed rows, so two same-second creates can each miss
 * the other and mint the same 10-bit clockid (about 1 in 1024 a pair). Left
 * standing, that is silent data loss: putRecord is an upsert, so the second
 * post would overwrite the first at the shared address. Settled after commit,
 * when both rows can see each other: the later row (created_at, then id, an
 * order both racers agree on) re-mints; the earlier keeps its keys.
 *
 * Best-effort, never failing the create. The guarded update stands down if
 * the row was already claimed, where re-minting under the worker would be the
 * greater harm.
 */
async function settleRkeyCollisions(row, userDid) {
  try {
    const mine = new Set(row?.payload?.rkeys || []);
    if (mine.size === 0) return row;
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, created_at, payload')
      .eq('user_did', userDid)
      .in('status', ['pending', 'publishing', 'failed', 'published'])
      .neq('id', row.id);
    if (error) return row;

    const isEarlier = (other) => {
      const a = new Date(other.created_at).getTime();
      const b = new Date(row.created_at).getTime();
      if (a !== b) return a < b;
      return String(other.id) < String(row.id);
    };
    const clashes = (data || []).some(
      (other) =>
        isEarlier(other) &&
        (other.payload?.rkeys || []).some((k) => mine.has(k)),
    );
    if (!clashes) return row;

    const rkeys = await assignRkeys({
      userDid,
      scheduledFor: row.scheduled_for,
      postCount: Array.isArray(row.payload?.posts)
        ? row.payload.posts.length
        : 0,
    });
    const { data: updated, error: updErr } = await supabase
      .from(TABLE)
      .update({ payload: { ...row.payload, rkeys }, updated_at: nowIso() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select()
      .single();
    if (updErr || !updated) return row;
    console.warn(`[schedule] settled an rkey collision for ${row.id}`);
    return updated;
  } catch (err) {
    console.warn(`[schedule] rkey collision settle failed: ${err.message}`);
    return row;
  }
}

export async function updatePayload(id, payload) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ payload, updated_at: nowIso() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw dbError(error);
  return data;
}

const LIST_COLUMNS =
  'id, scheduled_for, status, target, queued, payload, progress, result_uri, attempts, max_attempts, last_error, last_error_code, created_at';

/**
 * The account's queue: waiting, publishing and failed rows, plus the one
 * published shape a reader still needs to see, a post whose self-destruct
 * timer couldn't be set (TIMER_NOT_ARMED). It stays listed until the reader
 * acknowledges it (acknowledgeTimerFailure).
 */
export async function listScheduledPosts(userDid) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select(LIST_COLUMNS)
    .eq('user_did', userDid)
    .or(
      'status.in.(pending,failed,publishing),and(status.eq.published,last_error_code.eq.TIMER_NOT_ARMED)',
    )
    .order('scheduled_for', { ascending: true });
  if (error) throw dbError(error);
  return data || [];
}

/** One of the account's rows, or null. */
export async function getScheduledPost(id, userDid) {
  if (!isRowId(id)) return null;
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .eq('user_did', userDid)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw dbError(error);
  }
  return data;
}

/**
 * Clear the TIMER_NOT_ARMED note from one of the account's published rows,
 * once they've seen it. Status and code are both in the predicate, so this
 * can never touch a live queue row or clear other bookkeeping. Returns the
 * row, or null.
 */
export async function acknowledgeTimerFailure(id, userDid) {
  if (!isRowId(id)) return null;
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ last_error: null, last_error_code: null, updated_at: nowIso() })
    .eq('id', id)
    .eq('user_did', userDid)
    .eq('status', 'published')
    .eq('last_error_code', 'TIMER_NOT_ARMED')
    .select()
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw dbError(error);
  }
  return data;
}

/**
 * A row's stashed images as { [mediaId]: { base64, encoding } }, to rebuild
 * the post in the composer. Null when the row isn't the account's. An image
 * that can't be read (the 30-day sweep removes a failed row's bytes) is left
 * out rather than failing the whole read, which would make the row impossible
 * to open: the composer rebuilds it without that image and the writer adds it
 * again.
 */
export async function getScheduledMediaMap(id, userDid) {
  const row = await getScheduledPost(id, userDid);
  if (!row) return null;
  const media = (row.payload && row.payload.media) || {};
  const out = {};
  for (const [mediaId, m] of Object.entries(media)) {
    if (!m || !m.storagePath) continue;
    try {
      const bytes = await fetchMediaBytes(m.storagePath);
      out[mediaId] = {
        base64: Buffer.from(bytes).toString('base64'),
        encoding: m.encoding,
      };
    } catch (err) {
      console.warn(
        `[schedule] stashed media unreadable for ${id}/${mediaId}: ${err.message}`,
      );
    }
  }
  return out;
}

/**
 * Cancel one of the account's rows, and drop its stashed images. Takes
 * 'pending' and 'failed' (dismissing a failed row is this same call); a
 * 'publishing' row may be mid-write and is left alone. Null when nothing was
 * cancelled.
 */
export async function cancelScheduledPost(id, userDid) {
  if (!isRowId(id)) return null;
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status: 'cancelled', updated_at: nowIso() })
    .eq('id', id)
    .eq('user_did', userDid)
    .in('status', ['pending', 'failed'])
    .select()
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw dbError(error);
  }
  await deleteMedia(data?.payload?.media);
  return data;
}

/**
 * Move a pending row to a new time. Its rkeys (and so its records' createdAt)
 * come from the scheduled time, so they're re-minted for the new one; the old
 * keys were never written, since the row is still pending. Returns the row,
 * null when it can't move, or { blocked } with the reason.
 */
export async function rescheduleScheduledPost({ id, userDid, scheduledFor }) {
  const supabase = requireSupabase();
  const row = await getScheduledPost(id, userDid);
  if (!row) return null;
  if (row.status !== 'pending') return null;
  // A mid-thread failure puts the row back to 'pending' with the posts already
  // written in `progress`. Moving it would leave those live at the old time
  // and publish only the tail at the new one.
  if (Array.isArray(row.progress) && row.progress.length > 0) {
    return { blocked: 'PARTIALLY_PUBLISHED', status: row.status };
  }
  // Refused rather than quietly honoured: the writer picked that delete time
  // against the old slot, and only they can say which should move.
  const stranded = strandsDeleteTime(row.payload, scheduledFor);
  if (stranded) return { blocked: 'DELETE_TIME_TOO_EARLY', deleteAt: stranded };

  const postCount = Array.isArray(row.payload?.posts)
    ? row.payload.posts.length
    : 0;
  const rkeys = await assignRkeys({ userDid, scheduledFor, postCount });
  const payload = { ...(row.payload || {}), rkeys };

  // `progress` is in the predicate, not only checked above: between that read
  // and this write the worker can claim the row, write the root, fail a later
  // post and requeue it as 'pending' with progress. A status-only guard would
  // then wipe the progress and re-mint the keys, and the retry would publish
  // the whole thread again at new addresses.
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      scheduled_for: scheduledFor,
      payload,
      next_attempt_at: null,
      updated_at: nowIso(),
    })
    .eq('id', id)
    .eq('user_did', userDid)
    .eq('status', 'pending')
    .eq('progress', '[]')
    .select()
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null; // began publishing in between
    throw dbError(error);
  }
  return data;
}

/**
 * Put a failed row back in the queue exactly as it stands (same rkeys, same
 * progress, same content) for another run of attempts.
 *
 * The only recovery a thread that failed partway has: editing, moving and
 * reordering all refuse a row with progress, and the claim never picks up
 * 'failed'. Keeping the keys and the progress lets the resume loop finish the
 * tail at the original addresses. A revival is a create in all but name, so
 * it takes the same ceiling. Returns the row, or null.
 */
export async function retryFailedScheduledPost({ id, userDid }) {
  const supabase = requireSupabase();
  const existing = await getScheduledPost(id, userDid);
  if (!existing) return null;
  if (existing.status !== 'failed') return null;

  // Counted outside the create's advisory lock, so a revival racing a create
  // can pass the ceiling by one.
  const ceiling = scheduledPostsCeiling();
  if ((await countActive(supabase, userDid)) >= ceiling)
    throw quotaError(ceiling);

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: 'pending',
      attempts: 0,
      next_attempt_at: null,
      locked_at: null,
      locked_by: null,
      updated_at: nowIso(),
    })
    .eq('id', id)
    .eq('user_did', userDid)
    .eq('status', 'failed')
    .select()
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw dbError(error);
  }
  return data;
}

// A reorder is one drag of the queue, so it's bounded by what a person can
// hold at once, and by the RPC, which refuses anything longer.
export const MAX_REORDER_MOVES = 50;

/**
 * Apply a whole permutation of the account's pending queue: every row moves
 * or none does (reorder_scheduled_posts). Record keys are re-minted for the
 * new times here, because TID minting lives in JS.
 *
 * @param {{ userDid: string, moves: Array<{ id: string, scheduledFor: string }> }} args
 * @returns {Promise<{ ok: true, moved: number }
 *   | { ok: false, code: 'BAD_REQUEST', error: string }
 *   | { ok: false, code: 'NOT_REORDERABLE' }
 *   | { ok: false, code: 'DELETE_TIME_TOO_EARLY', id: string, deleteAt: string, error: string }
 *   | { ok: false, code: 'UNAVAILABLE' }>}
 *   DELETE_TIME_TOO_EARLY names the first post whose new slot would come after
 *   (or within five minutes of) its pinned delete time. UNAVAILABLE means the
 *   database has no reorder function; the caller answers 404 so the client
 *   moves the rows one at a time instead. Nothing is written on any refusal.
 */
export async function reorderScheduledPosts({ userDid, moves }) {
  const bad = (error) => ({ ok: false, code: 'BAD_REQUEST', error });
  const refused = { ok: false, code: 'NOT_REORDERABLE' };

  if (!userDid)
    return bad('the reorder did not arrive in a shape we could read.');
  if (
    !Array.isArray(moves) ||
    moves.length === 0 ||
    moves.length > MAX_REORDER_MOVES
  ) {
    return bad(`a reorder carries between one and ${MAX_REORDER_MOVES} posts.`);
  }

  const wanted = new Map();
  for (const move of moves) {
    const id = typeof move?.id === 'string' ? move.id.trim() : '';
    // Checked here rather than left to Postgres, where a malformed id in the
    // `in` filter is a cast error and would read as a server fault.
    if (!UUID_SHAPE.test(id))
      return bad('a post id in that reorder could not be read.');
    if (wanted.has(id)) return bad('a post appears twice in that reorder.');
    const when = validateReschedule({ scheduledFor: move?.scheduledFor });
    if (!when.ok) {
      return bad(
        `a reorder needs a new time for every post — in the future, and within ${MAX_HORIZON_DAYS} days.`,
      );
    }
    wanted.set(id, when.value.scheduledFor);
  }

  const supabase = requireSupabase();
  const ids = [...wanted.keys()];
  const { data: rows, error } = await supabase
    .from(TABLE)
    .select('id, status, progress, payload')
    .eq('user_did', userDid)
    .in('id', ids);
  if (error) throw dbError(error);

  // The RPC checks all of this again under its row locks and is the
  // authority; this pass avoids minting keys for a reorder that will be
  // refused anyway.
  const byId = new Map((rows || []).map((r) => [r.id, r]));
  if (byId.size !== ids.length) return refused;
  for (const row of byId.values()) {
    if (row.status !== 'pending') return refused;
    if (Array.isArray(row.progress) && row.progress.length > 0) return refused;
  }
  // A move past a post's own pinned delete time refuses the whole reorder:
  // half a permutation is the thing this exists to prevent.
  for (const id of ids) {
    const row = byId.get(id);
    const stranded = strandsDeleteTime(row.payload, wanted.get(id));
    if (stranded) {
      return {
        ok: false,
        code: 'DELETE_TIME_TOO_EARLY',
        id,
        deleteAt: stranded,
        error: strandedMoveError(row.payload),
      };
    }
  }

  // assignRkeys re-rolls against keys already stored on the account's rows;
  // `minted` covers those handed out earlier in this batch, not stored yet.
  const minted = new Set();
  const payload = [];
  for (const id of ids) {
    const scheduledFor = wanted.get(id);
    const posts = byId.get(id).payload?.posts;
    const postCount = Array.isArray(posts) ? posts.length : 0;
    const move = { id, scheduledFor };
    if (postCount > 0) {
      let rkeys = await assignRkeys({ userDid, scheduledFor, postCount });
      for (
        let attempt = 1;
        attempt < 8 && rkeys.some((k) => minted.has(k));
        attempt++
      ) {
        rkeys = await assignRkeys({ userDid, scheduledFor, postCount });
      }
      rkeys.forEach((k) => minted.add(k));
      move.rkeys = rkeys;
    }
    payload.push(move);
  }

  const { data, error: rpcErr } = await supabase.rpc(
    'reorder_scheduled_posts',
    {
      p_user_did: userDid,
      p_moves: payload,
    },
  );
  if (rpcErr) {
    if (isUndefinedFunction(rpcErr)) return { ok: false, code: 'UNAVAILABLE' };
    throw dbError(rpcErr);
  }
  if (!data || data.ok !== true) {
    if (data?.code === 'BAD_REQUEST') {
      return bad(
        data.error || 'the reorder did not arrive in a shape we could read.',
      );
    }
    return refused;
  }
  return { ok: true, moved: data.moved ?? payload.length };
}

/**
 * Rewrite a row's whole content (an edit saved from the composer): stash the
 * referenced media again, drop media no longer used, re-mint rkeys if the
 * time or the thread's length moved, and rewrite payload, time and queued.
 * Takes 'pending' and 'failed': reworking a post that ran out of attempts is
 * how a reader gets it back in the queue, so a failed row comes back pending.
 * Returns the row, null when it can't be edited, or { blocked } with why.
 */
export async function updateScheduledPostContent({
  id,
  userDid,
  scheduledFor,
  posts,
  gates,
  mediaBytes = {},
  queued = false,
  tz = undefined,
  selfDestruct = null,
}) {
  const supabase = requireSupabase();
  const existing = await getScheduledPost(id, userDid);
  if (!existing) return null;
  if (existing.status !== 'pending' && existing.status !== 'failed')
    return null;
  // Part of the thread is already on the PDS. Clearing progress and
  // re-minting keys would publish those posts again at new addresses, so this
  // is refused before any media is touched. The status lets the endpoint say
  // the truthful thing about what happens next.
  if (Array.isArray(existing.progress) && existing.progress.length > 0) {
    return { blocked: 'PARTIALLY_PUBLISHED', status: existing.status };
  }

  // Reviving a failed row is a create in all but name, so it takes the
  // ceiling; a pending row holds its slot either way. Checked before any
  // bytes are stashed, so a refusal leaves nothing in Storage.
  if (existing.status === 'failed') {
    const ceiling = scheduledPostsCeiling();
    if ((await countActive(supabase, userDid)) >= ceiling)
      throw quotaError(ceiling);
  }

  // Stash into a folder unique to this edit. The worker may already be
  // publishing this row from the old paths; writing over them would hand it
  // new bytes for old text. Nothing it holds is touched until the guarded
  // update below says the edit won.
  const referencedIds = [];
  for (const p of posts) collectMediaIds(p.embed, referencedIds);
  const editDir = `e-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const media = {};
  try {
    for (const mid of referencedIds) {
      const mb = mediaBytes[mid];
      if (!mb || !mb.base64)
        throw new Error(`missing bytes for media "${mid}"`);
      const storagePath = await storeMedia(
        id,
        mid,
        mb.base64,
        mb.encoding,
        editDir,
      );
      media[mid] = { storagePath, encoding: mb.encoding };
    }
    const oldPaths = Object.values(existing.payload?.media || {})
      .map((m) => m?.storagePath)
      .filter(Boolean);
    const newPaths = Object.values(media).map((m) => m.storagePath);

    // Keys are minted from the time, so they only need re-minting when the
    // time or the thread's length changes. When both hold still the stored
    // keys stay: if a crashed attempt wrote a post the saved progress never
    // learned about, the next putRecord at that address overwrites it with
    // this edit instead of leaving an orphan at an abandoned key.
    const sameTime =
      new Date(scheduledFor).getTime() ===
      new Date(String(existing.scheduled_for).replace(' ', 'T')).getTime();
    const storedRkeys = Array.isArray(existing.payload?.rkeys)
      ? existing.payload.rkeys
      : [];
    const rkeys =
      sameTime && storedRkeys.length === posts.length
        ? storedRkeys
        : await assignRkeys({ userDid, scheduledFor, postCount: posts.length });
    // tz is the scheduling device's zone, kept for the client's round trip.
    const payload = {
      posts,
      gates,
      media,
      rkeys,
      tz: tz ?? existing.payload?.tz,
      selfDestruct,
    };

    const patch = {
      scheduled_for: scheduledFor,
      target: TARGET,
      queued: !!queued,
      payload,
      // A reworked failed row starts over: a clean attempt count and no stale
      // lock or error from the run that gave up.
      status: 'pending',
      attempts: 0,
      locked_at: null,
      locked_by: null,
      progress: [],
      next_attempt_at: null,
      last_error: null,
      last_error_code: null,
      // Fresh bytes get the full retention clock.
      media_reclaimed_at: null,
      updated_at: nowIso(),
    };
    // Status and progress stay in the predicate, so a row the worker claimed
    // (or claimed, partly wrote and requeued) during the stash matches nothing
    // and comes back as PGRST116.
    const { data, error } = await supabase
      .from(TABLE)
      .update(patch)
      .eq('id', id)
      .eq('user_did', userDid)
      .in('status', ['pending', 'failed'])
      .eq('progress', '[]')
      .select()
      .single();
    if (error) {
      // Lost the race: the bytes just written are referenced by nobody, and
      // the old ones are still being read by the publish in flight.
      if (error.code === 'PGRST116') {
        await removeQuietly(newPaths);
        return null;
      }
      throw dbError(error);
    }
    await removeQuietly(oldPaths.filter((p) => !newPaths.includes(p)));
    return data;
  } catch (err) {
    // The edit never landed, so nothing references this edit's folder.
    await removeQuietly(Object.values(media).map((m) => m.storagePath));
    throw err;
  }
}

export async function reclaimStuck(olderThanSeconds = 600) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('reclaim_stuck_scheduled_posts', {
    p_older_than_seconds: olderThanSeconds,
  });
  if (error) {
    console.warn(`[schedule] reclaim failed: ${error.message}`);
    return 0;
  }
  return data || 0;
}

// How long a failed row's stashed images are kept, so the writer can come back
// and send it again. After that the bytes are just sitting in Storage.
export const MEDIA_RECLAIM_AFTER_DAYS = 30;

/**
 * Delete the stashed images of failed rows nobody came back to, and stamp
 * them reclaimed. The row and its text survive, so the post can still be read
 * and dismissed. A row whose delete fails is left unstamped for a later sweep
 * (removing an already-gone path is harmless).
 *
 * @returns {Promise<{ swept: number, failed: number, unavailable: boolean }>}
 */
export async function reclaimFailedMedia(
  olderThanDays = MEDIA_RECLAIM_AFTER_DAYS,
) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('reclaim_failed_scheduled_media', {
    p_older_than_days: olderThanDays,
  });
  if (error) {
    if (isUndefinedFunction(error))
      return { swept: 0, failed: 0, unavailable: true };
    console.warn(`[schedule] media reclaim query failed: ${error.message}`);
    return { swept: 0, failed: 0, unavailable: false };
  }

  let swept = 0;
  let failed = 0;
  for (const row of data || []) {
    try {
      // Stamped only after the delete really happened: stamping first would
      // tell later sweeps to forget bytes still in the bucket.
      const gone = await deleteMedia(row.payload?.media);
      if (!gone) {
        failed += 1;
        continue;
      }
      const { error: stampErr } = await supabase
        .from(TABLE)
        .update({ media_reclaimed_at: nowIso() })
        .eq('id', row.id);
      if (stampErr) throw new Error(stampErr.message);
      swept += 1;
    } catch (err) {
      failed += 1;
      console.warn(
        `[schedule] media reclaim failed for ${row.id}: ${err.message}`,
      );
    }
  }
  return { swept, failed, unavailable: false };
}

export async function claimDuePosts(runId, limit = 20) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('claim_scheduled_posts', {
    p_run_id: runId,
    p_limit: limit,
  });
  if (error) {
    const err = dbError(error);
    err.message = `claim failed: ${err.message}`;
    throw err;
  }
  return data || [];
}

/** Save a thread's progress (the refs written so far) so a retry resumes. */
export async function markProgress(id, progress) {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from(TABLE)
    .update({ progress, updated_at: nowIso() })
    .eq('id', id);
  if (error) throw dbError(error);
}

/** Write a row's bookkeeping fields. */
export async function writeBookkeeping(id, fields) {
  const supabase = requireSupabase();
  const { error } = await supabase.from(TABLE).update(fields).eq('id', id);
  if (error) throw dbError(error);
}

/** The row went out: record its root and drop its stashed images. */
export async function markPublished(id, { uri, cid }, mediaMap) {
  await writeBookkeeping(id, {
    status: 'published',
    result_uri: uri,
    result_cid: cid,
    locked_at: null,
    locked_by: null,
    last_error: null,
    last_error_code: null,
    updated_at: nowIso(),
  });
  await deleteMedia(mediaMap);
}

/**
 * Record a failed attempt: back in the queue with backoff, or retired.
 * `code` is one of FAILURE_CODES when the caller has the error; otherwise the
 * sentence is read, so the column is filled either way. Answers 'failed' or
 * 'retry'.
 */
export async function markFailedOrRetry(
  row,
  errMessage,
  { terminal = false, code } = {},
) {
  const attempts = row.attempts; // already incremented by the claim
  const exhausted = terminal || attempts >= row.max_attempts;
  const failureCode = normalizeFailureCode(code) || classifyFailure(errMessage);

  if (exhausted) {
    await writeBookkeeping(row.id, {
      status: 'failed',
      last_error: errMessage?.slice(0, 500),
      last_error_code: failureCode,
      locked_at: null,
      locked_by: null,
      updated_at: nowIso(),
    });
    // The stashed images stay: a failed row is still editable, and deleting
    // them would break the retry the reader is offered. They go when the row
    // is dismissed, when a retry publishes, or when the media sweep runs.
    return 'failed';
  }

  const backoffMin = Math.min(2 ** attempts, 60);
  const nextAttemptAt = new Date(
    Date.now() + backoffMin * 60 * 1000,
  ).toISOString();
  await writeBookkeeping(row.id, {
    status: 'pending',
    next_attempt_at: nextAttemptAt,
    last_error: errMessage?.slice(0, 500),
    last_error_code: failureCode,
    locked_at: null,
    locked_by: null,
    updated_at: nowIso(),
  });
  return 'retry';
}

// ─── Publish ────────────────────────────────────────────────────────────────

/** Run an XRPC write, retrying once with a fresh session on "Invalid token". */
async function callWithTokenRetry(userDid, sessionRef, fn) {
  try {
    return await fn(new Agent(sessionRef.session));
  } catch (err) {
    if (!isInvalidToken(err)) throw err;
    const fresh = await restoreSessionSafe(userDid, { fresh: true });
    if (!fresh) throw err;
    sessionRef.session = fresh;
    return await fn(new Agent(fresh));
  }
}

/** Upload stashed bytes as a blob and return its ref. */
async function uploadStashedBlob(userDid, sessionRef, mediaItem) {
  const bytes = await fetchMediaBytes(mediaItem.storagePath);
  const result = await callWithTokenRetry(userDid, sessionRef, (agent) =>
    agent.uploadBlob(bytes, { encoding: mediaItem.encoding }),
  );
  return result.data.blob;
}

// The PDS refuses image blobs over about 1 MB, so a larger thumbnail would
// only be fetched to be refused.
const MAX_THUMB_BYTES = 1_000_000;
const THUMB_TIMEOUT_MS = 8000;

/** Fetch a card thumbnail server-side and upload it; null on any failure. */
async function uploadRemoteThumb(userDid, sessionRef, thumbUrl) {
  try {
    // https only, public addresses only (checked again on every redirect),
    // size-capped. Checked here as well as at create, against stored specs.
    const { bytes: buf, contentType } = await safeFetchBuffer(thumbUrl, {
      maxBytes: MAX_THUMB_BYTES,
      timeoutMs: THUMB_TIMEOUT_MS,
    });
    if (!buf || buf.byteLength === 0) return null;
    const bytes = new Uint8Array(buf);
    const result = await callWithTokenRetry(userDid, sessionRef, (agent) =>
      agent.uploadBlob(bytes, { encoding: contentType || 'image/jpeg' }),
    );
    return result.data.blob;
  } catch (err) {
    // A missing card thumbnail shouldn't fail the post.
    console.warn(`[schedule] thumb fetch failed: ${err.message}`);
    return null;
  }
}

/** Build the app.bsky.embed.* value for a stored EmbedSpec. */
export async function buildEmbed(userDid, sessionRef, spec, mediaMap) {
  if (!spec) return undefined;
  switch (spec.type) {
    case 'images': {
      const images = [];
      for (const im of spec.images) {
        const item = mediaMap[im.mediaId];
        // A payload naming media that never reached Storage can only ever
        // fail; say so once, terminally, rather than burning every attempt.
        if (!item || !item.storagePath) {
          throw new NonRetryableError(
            'the images for this scheduled post are missing. edit it and re-attach them.',
            'MEDIA_MISSING',
          );
        }
        const blob = await uploadStashedBlob(userDid, sessionRef, item);
        images.push({
          alt: im.alt || '',
          image: blob,
          aspectRatio: im.aspectRatio || undefined,
        });
      }
      // app.bsky.embed.images holds at most 4; 5–10 go as a gallery.
      if (images.length > 4) {
        return {
          $type: 'app.bsky.embed.gallery',
          items: images.map((img) => ({
            $type: 'app.bsky.embed.gallery#image',
            ...img,
          })),
        };
      }
      return { $type: 'app.bsky.embed.images', images };
    }
    case 'external': {
      const external = {
        uri: spec.uri,
        title: spec.title || '',
        description: spec.description || '',
      };
      const associatedRefs = normalizeAssociatedRefs(spec.associatedRefs);
      if (associatedRefs) external.associatedRefs = associatedRefs;
      let thumb = null;
      if (spec.thumbMediaId && mediaMap[spec.thumbMediaId]) {
        thumb = await uploadStashedBlob(
          userDid,
          sessionRef,
          mediaMap[spec.thumbMediaId],
        );
      } else if (spec.thumbUrl) {
        thumb = await uploadRemoteThumb(userDid, sessionRef, spec.thumbUrl);
      }
      if (thumb) external.thumb = thumb;
      return { $type: 'app.bsky.embed.external', external };
    }
    case 'record':
      return {
        $type: 'app.bsky.embed.record',
        record: { uri: spec.uri, cid: spec.cid },
      };
    case 'recordWithMedia': {
      const media = await buildEmbed(userDid, sessionRef, spec.media, mediaMap);
      return {
        $type: 'app.bsky.embed.recordWithMedia',
        record: {
          $type: 'app.bsky.embed.record',
          record: { uri: spec.uri, cid: spec.cid },
        },
        media,
      };
    }
    default:
      return undefined;
  }
}

const COLLECTION = 'app.bsky.feed.post';

/** One post's record from its spec, without the reply. */
async function assembleRecord(userDid, sessionRef, spec, mediaMap, createdAt) {
  const src = spec.record || {};
  const record = { $type: COLLECTION, text: src.text || '', createdAt };
  if (Array.isArray(src.facets) && src.facets.length)
    record.facets = src.facets;
  if (Array.isArray(src.langs) && src.langs.length) record.langs = src.langs;
  if (src.labels) record.labels = src.labels;
  if (Array.isArray(src.tags) && src.tags.length) record.tags = src.tags;
  const embed = await buildEmbed(userDid, sessionRef, spec.embed, mediaMap);
  if (embed) record.embed = embed;
  return record;
}

// ─── Record keys (TIDs minted from the scheduled time) ───────────────────────
// A post's rkey is TID.fromTime of its scheduled time, so its whole at:// URI
// is known the moment it's scheduled and fixed for the life of the row. That
// is what makes publishing idempotent: the worker writes with putRecord (an
// upsert), so a crash and a reclaim rewrite the same record at the same key
// rather than creating a duplicate. A thread's posts use the base time plus
// their index in microseconds.

/** A scheduled time as microseconds since the epoch (TID.fromTime's unit). */
function scheduledMicros(scheduledFor) {
  const ms = new Date(String(scheduledFor).replace(' ', 'T')).getTime();
  return (Number.isFinite(ms) ? ms : Date.now()) * 1000;
}

function rkeysFor(baseMicros, clockid, count) {
  const out = [];
  for (let i = 0; i < count; i++)
    out.push(TID.fromTime(baseMicros + i, clockid).toString());
  return out;
}

/**
 * One rkey per post for a row at `scheduledFor`, clashing with none of the
 * account's other reserved or published keys. A TID can only clash within
 * one repo, so the 10-bit clockid is re-rolled until nothing overlaps.
 */
export async function assignRkeys({ userDid, scheduledFor, postCount }) {
  const supabase = requireSupabase();
  const baseMicros = scheduledMicros(scheduledFor);
  const { data, error } = await supabase
    .from(TABLE)
    .select('payload')
    .eq('user_did', userDid)
    .in('status', ['pending', 'publishing', 'failed', 'published']);
  if (error) throw dbError(error);
  const taken = new Set();
  for (const r of data || [])
    for (const k of r.payload?.rkeys || []) taken.add(k);

  for (let attempt = 0; attempt < 64; attempt++) {
    const clockid = crypto.randomInt(0, 1024);
    const rkeys = rkeysFor(baseMicros, clockid, postCount);
    if (!rkeys.some((k) => taken.has(k))) return rkeys;
  }
  // Astronomically unlikely; a shared key would only rewrite our own record.
  return rkeysFor(baseMicros, crypto.randomInt(0, 1024), postCount);
}

/** putRecord at a known key: rewriting the same record there can't duplicate it. */
async function putPost(userDid, sessionRef, rkey, record) {
  const res = await callWithTokenRetry(userDid, sessionRef, (agent) =>
    agent.com.atproto.repo.putRecord({
      repo: userDid,
      collection: COLLECTION,
      rkey,
      record,
    }),
  );
  return { uri: res.data.uri, cid: res.data.cid };
}

/** Write the root, then its threadgate and postgate at the same rkey. */
async function writeRoot(userDid, sessionRef, record, rkey, createdAt, gates) {
  const ref = await putPost(userDid, sessionRef, rkey, record);

  // An empty threadgate allow list is a real gate: nobody can reply. Only
  // null or absent means no threadgate. (An empty postgate imposes nothing.)
  if (Array.isArray(gates.threadgate)) {
    await callWithTokenRetry(userDid, sessionRef, (agent) =>
      agent.com.atproto.repo.putRecord({
        repo: userDid,
        collection: 'app.bsky.feed.threadgate',
        rkey,
        record: {
          $type: 'app.bsky.feed.threadgate',
          post: ref.uri,
          createdAt,
          allow: gates.threadgate,
          hiddenReplies: [],
        },
      }),
    );
  }
  if (Array.isArray(gates.postgate) && gates.postgate.length > 0) {
    await callWithTokenRetry(userDid, sessionRef, (agent) =>
      agent.com.atproto.repo.putRecord({
        repo: userDid,
        collection: 'app.bsky.feed.postgate',
        rkey,
        record: {
          $type: 'app.bsky.feed.postgate',
          post: ref.uri,
          createdAt,
          detachedEmbeddingUris: [],
          embeddingRules: gates.postgate,
        },
      }),
    );
  }
  return ref;
}

/**
 * Publish one row (a post or a thread) to the account's PDS. Resumes a
 * partly written thread from row.progress, and calls onProgress after each
 * post so the saved progress stays current. Throws on failure (`.nonRetryable`
 * when retrying can't help). Returns the root's { uri, cid }.
 */
export async function publishScheduledPost(row, { onProgress } = {}) {
  const userDid = row.user_did;
  const session = await restoreSessionSafe(userDid);
  if (!session) {
    // Null means "the grant is gone" or "the store or a refresh hiccupped",
    // so this is retried; a grant that is really gone still ends 'failed'
    // with this sentence once the attempts run out.
    throw codedError(
      "couldn't reach your account session. reconnect your account if this keeps happening.",
      'SESSION_UNAVAILABLE',
    );
  }
  const sessionRef = { session };

  const payload = row.payload || {};
  const posts = Array.isArray(payload.posts) ? payload.posts : [];
  const mediaMap = payload.media || {};
  const gates = payload.gates || {};

  const baseMicros = scheduledMicros(row.scheduled_for);
  const rkeys =
    Array.isArray(payload.rkeys) && payload.rkeys.length >= posts.length
      ? payload.rkeys
      : rkeysFor(baseMicros, 0, posts.length);

  // The root carries the scheduled time exactly and each later post one
  // millisecond more, from its index so a retry stamps the same value.
  // createdAt only resolves to the millisecond, so posts sharing one sort
  // unpredictably, and Bluesky's AppView then leaves the root out of the
  // author's feed.
  const baseMs = Math.floor(baseMicros / 1000);
  const createdAtFor = (i) => new Date(baseMs + i).toISOString();

  const progress = Array.isArray(row.progress) ? [...row.progress] : [];

  for (let i = progress.length; i < posts.length; i++) {
    const rkey = rkeys[i];
    const createdAt = createdAtFor(i);
    const record = await assembleRecord(
      userDid,
      sessionRef,
      posts[i],
      mediaMap,
      createdAt,
    );

    if (i > 0) {
      const root = progress[0];
      const parent = progress[i - 1];
      record.reply = {
        root: { uri: root.uri, cid: root.cid },
        parent: { uri: parent.uri, cid: parent.cid },
      };
    }

    const ref =
      i === 0
        ? await writeRoot(userDid, sessionRef, record, rkey, createdAt, gates)
        : await putPost(userDid, sessionRef, rkey, record);

    progress.push(ref);
    if (onProgress) await onProgress(progress);
  }

  return progress[0];
}
