// What every /api/schedule/* handler shares: the caller's DID, the answer
// when scheduling isn't set up, the row shape the client reads, and how an
// unexpected error is turned into a sentence that leaks nothing.

import { sendJson } from '../http.js';
import { isSupabaseConfigured } from '../supabase.js';
import { resolveUserDid } from '../oauth/auth.js';
import { quotaBody } from '../limits/limits.js';

export const UNAVAILABLE_ERROR =
  "scheduling isn't set up on Virga's server yet.";

/** 503 UNAVAILABLE: no Supabase here, or its migration isn't applied. */
export function sendUnavailable(res) {
  return sendJson(res, 503, {
    success: false,
    error: UNAVAILABLE_ERROR,
    code: 'UNAVAILABLE',
  });
}

/** True when Supabase is configured; otherwise answers 503 UNAVAILABLE and returns false. */
export function requireScheduling(res) {
  if (isSupabaseConfigured()) return true;
  sendUnavailable(res);
  return false;
}

/** The caller's DID, or null after answering 401/503 with the auth's code. */
export async function authorize(req, res) {
  const auth = await resolveUserDid(req);
  if (auth.userDid) return auth.userDid;
  const body = { success: false, error: auth.error };
  if (auth.code) body.code = auth.code;
  sendJson(res, auth.status || 401, body);
  return null;
}

/**
 * A row as the client reads it. `clientKey` is a constant: every row is
 * Virga's, and the client only lets a reader edit, retry or reorder rows that
 * say so. `partial` (some of the thread is already out) is the list's.
 */
export function publicRow(row, { partial = false } = {}) {
  const out = {
    id: row.id,
    scheduledFor: row.scheduled_for,
    status: row.status,
  };
  if (partial)
    out.partial = Array.isArray(row.progress) && row.progress.length > 0;
  Object.assign(out, {
    target: row.target,
    queued: !!row.queued,
    payload: row.payload,
    resultUri: row.result_uri || null,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error || null,
    lastErrorCode: row.last_error_code || null,
    createdAt: row.created_at,
    clientKey: 'virga',
  });
  return out;
}

/**
 * Answer an error a handler didn't expect to handle itself. A quota refusal
 * keeps its wording and fields; a missing schema is 503 UNAVAILABLE;
 * anything else is a fixed sentence, because the raw message is a Supabase
 * string naming tables and columns.
 */
export function sendFailure(res, tag, error, sentence) {
  if (error?.code === 'QUOTA_EXCEEDED')
    return sendJson(res, 409, quotaBody(error));
  if (error?.code === 'UNAVAILABLE') {
    console.warn(`[${tag}] unavailable: ${error.message}`);
    return sendUnavailable(res);
  }
  console.error(`[${tag}] error:`, error?.message || error);
  return sendJson(res, 500, {
    success: false,
    error: sentence,
    code: 'INTERNAL',
  });
}

// What the client already refuses to send (scheduleSerialize.js
// MAX_MEDIA_BASE64_CHARS). Vercel turns away bodies over 4.5 MB before a
// handler runs, so this only meets a body that didn't come from the client.
export const MAX_MEDIA_BASE64_CHARS = 4_000_000;

/** The base64 characters a request's media carries in total. */
export function mediaBase64Chars(mediaBytes) {
  let total = 0;
  for (const item of Object.values(mediaBytes || {})) {
    if (item && typeof item.base64 === 'string') total += item.base64.length;
  }
  return total;
}

/** Answers 413 MEDIA_TOO_LARGE and returns true when the media is over the cap. */
export function refuseOversizedMedia(res, mediaBytes) {
  if (mediaBase64Chars(mediaBytes) <= MAX_MEDIA_BASE64_CHARS) return false;
  sendJson(res, 413, {
    success: false,
    error:
      'that is more image than can be sent ahead. use fewer or smaller images.',
    code: 'MEDIA_TOO_LARGE',
  });
  return true;
}

/** The `id` a GET names, as a single string, or ''. */
export function queryId(req) {
  const raw = req?.query?.id;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : '';
}
