// The AI help while posting, through cocoon's /api/ai/* endpoints: the
// adviser's read of a draft, the style reading it proofreads against, and
// image descriptions.
//
// Each call takes the Requester of the posting account (`backendFor(asDid)`):
// cocoon takes the account from the token, counts the request against that
// account's monthly allowance and rate limit, and passes the text on to the
// AI gateway. Nothing is sent for an account signed in only in the browser.
// The body never names the account or claims a membership; cocoon works both
// out itself, and tags Virga's requests by the client the token belongs to.
//
// Every function rejects with an Error whose message can be shown as it is,
// keeping `status`, `code` (`monthly_limit`, `rate_limited`,
// `not_enough_posts`, …), `detail` and `payload` for callers that branch.

import { blobToBase64 } from '../schedule/scheduleSerialize.js';
import {
  clearAdviserUsage,
  markAdviserLimitReached,
  recordAdviserUsage,
} from './usage.js';

/** cocoon's gateway gives up at 25 s; this leaves room for the trip there. */
export const AI_REQUEST_TIMEOUT_MS = 30_000;

/** Image types cocoon's describer takes. */
export const ALT_TEXT_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** cocoon's ceiling on one image's base64. */
export const MAX_ALT_TEXT_BASE64 = 8 * 1024 * 1024;

function aiError(message, extra = {}) {
  return Object.assign(new Error(message), {
    status: 0,
    code: null,
    detail: null,
    payload: null,
    ...extra,
  });
}

function abortError() {
  const err = new Error('Cancelled.');
  err.name = 'AbortError';
  err.canceled = true;
  return err;
}

const isAbort = (err) => err?.name === 'AbortError' || err?.canceled === true;

/** What to tell the writer about a failed AI request. */
export function aiErrorMessage(err) {
  const code = err?.code || null;
  const detail = typeof err?.detail === 'string' ? err.detail : '';
  if (code === 'NEEDS_BACKEND') return err.message;
  if (code === 'monthly_limit')
    return 'This month’s free uses of this are used up. They start again on the first of the month.';
  if (code === 'not_enough_posts')
    return 'There aren’t enough posts to learn from yet. It needs at least 5.';
  if (code === 'rate_limited')
    return 'That’s the limit on AI requests for now. Try again later.';
  if (code === 'TIMEOUT') return 'That took too long. Try again.';
  if (code === 'NETWORK_ERROR')
    return 'Couldn’t reach Virga’s server. Check the connection and try again.';
  if (code === 'VIRGA_CLIENT_UNAVAILABLE' || err?.status === 503)
    return 'AI help isn’t available right now.';
  if (err?.status === 401)
    return 'This account needs to sign in again to use AI help.';
  if (err?.status === 429)
    return 'The AI service is busy. Try again in a moment.';
  if (err?.status === 413) return 'That’s too large to send for AI help.';
  if (detail) return detail;
  if (err?.status)
    return `The AI request didn’t work (${err.status}). Try again.`;
  return err?.message || 'The AI request didn’t work. Try again.';
}

/**
 * POST `body` to `path` as the requester's account. A `signal` already
 * aborted sends nothing: a read the composer has moved past must not send the
 * draft. Once sent, the request runs to its end (cocoon counts it whatever
 * happens here), and the caller drops an answer it no longer wants.
 */
async function postAi(req, path, body, { signal, feature, store } = {}) {
  if (!req || typeof req.request !== 'function') {
    throw aiError(
      'AI help needs this account signed in through Virga’s server.',
      { code: 'NEEDS_BACKEND' },
    );
  }
  if (signal?.aborted) throw abortError();
  let data;
  try {
    data = await req.request(path, {
      method: 'POST',
      body,
      timeoutMs: AI_REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    if (err?.code === 'monthly_limit' && feature && req.did) {
      markAdviserLimitReached(req.did, err.payload?.limit, {
        feature,
        ...(store ? { store } : {}),
      });
    }
    throw Object.assign(new Error(aiErrorMessage(err)), {
      status: err?.status ?? 0,
      code: err?.code ?? null,
      detail: err?.detail ?? null,
      payload: err?.payload ?? null,
      cause: err,
    });
  }
  if (feature && req.did) {
    const opts = { feature, ...(store ? { store } : {}) };
    // No `usage` on a 2xx means cocoon didn't count it: the allowance is
    // unlimited now, so a used-up count kept from before must not stand.
    if (!recordAdviserUsage(req.did, data?.usage, opts))
      clearAdviserUsage(req.did, opts);
  }
  return data;
}

const optionalText = (value) =>
  typeof value === 'string' && value.trim() ? value : undefined;

/**
 * The adviser's read of a draft.
 *
 * @param {object} req - the posting account's Requester
 * @param {object} payload
 * @param {string} payload.text - the draft as read (a thread joined by blank lines)
 * @param {object} [payload.goals] - the setup's goals ({ presets, customText })
 * @param {'post'|'thread'|'selfReply'|'reply'|'quote'} [payload.scenario]
 * @param {object} [payload.context] - from context.js gatherReplyContext
 * @param {object} [payload.writingChecks] - enabledWritingChecks(), plus `style`
 * @param {{ signal?: AbortSignal, store?: Storage }} [options]
 * @returns {Promise<{ sentiment, checks, suggestion, overallStatus, writing?, usage? }>}
 */
export async function analyzePost(req, payload = {}, { signal, store } = {}) {
  const text = typeof payload.text === 'string' ? payload.text : '';
  if (!text.trim()) throw aiError('Write something first.', { code: 'EMPTY' });
  const body = { text };
  if (payload.goals) body.goals = payload.goals;
  if (payload.scenario) body.scenario = payload.scenario;
  if (payload.context) body.context = payload.context;
  if (payload.writingChecks) body.writingChecks = payload.writingChecks;
  return postAi(req, '/api/ai/analyze-post', body, {
    signal,
    feature: 'adviser',
    store,
  });
}

/**
 * A reading of the writer's style from their own posts (newest first), for
 * the proofread to respect.
 *
 * @param {object} req - the posting account's Requester
 * @param {{ posts: Array<string|{text: string}>, guidance?: string, previousSummary?: string }} payload
 * @returns {Promise<{ summary: string, analyzedCount: number, usage? }>}
 */
export async function synthesizeStyle(
  req,
  payload = {},
  { signal, store } = {},
) {
  const body = { posts: Array.isArray(payload.posts) ? payload.posts : [] };
  const guidance = optionalText(payload.guidance);
  const previousSummary = optionalText(payload.previousSummary);
  if (guidance) body.guidance = guidance.trim();
  if (previousSummary) body.previousSummary = previousSummary.trim();
  const data = await postAi(req, '/api/ai/synthesize-style', body, {
    signal,
    feature: 'style',
    store,
  });
  return {
    summary: typeof data?.summary === 'string' ? data.summary.trim() : '',
    analyzedCount: Number.isFinite(data?.analyzedCount)
      ? data.analyzedCount
      : 0,
    ...(data?.usage ? { usage: data.usage } : {}),
  };
}

/**
 * A description of an image. With `followUp` and `previousAltText` it
 * revises the last one; `presets` are quick-note ids and `kind` what the
 * writer says the image is (altTextFollowUp.js).
 *
 * @param {object} req - the posting account's Requester
 * @param {object} payload
 * @param {string} payload.imageBase64 - no `data:` prefix
 * @param {string} payload.mimeType
 * @param {string} [payload.context] - the post's text
 * @param {string} [payload.followUp]
 * @param {string} [payload.previousAltText]
 * @param {string[]} [payload.presets]
 * @param {string|null} [payload.kind]
 * @param {(usage: { used: number, limit: number }) => void} [payload.onUsage]
 * @returns {Promise<string>} the description, trimmed
 */
export async function generateAltText(
  req,
  payload = {},
  { signal, store } = {},
) {
  const {
    imageBase64,
    mimeType,
    context,
    followUp,
    previousAltText,
    presets,
    kind,
    onUsage,
  } = payload;
  if (typeof imageBase64 !== 'string' || !imageBase64) {
    throw aiError('There’s no image to describe.', { code: 'NO_IMAGE' });
  }
  if (!ALT_TEXT_MIME_TYPES.includes(mimeType)) {
    throw aiError(
      'This kind of image can’t be described. Try a JPEG, PNG, WebP or GIF.',
      { code: 'UNSUPPORTED_IMAGE' },
    );
  }
  if (imageBase64.length > MAX_ALT_TEXT_BASE64) {
    throw aiError('That image is too large to describe.', {
      code: 'IMAGE_TOO_LARGE',
    });
  }
  const body = { imageBase64, mimeType };
  if (optionalText(context)) body.context = context;
  if (optionalText(followUp)) body.followUp = followUp;
  if (optionalText(previousAltText)) body.previousAltText = previousAltText;
  if (Array.isArray(presets) && presets.length) body.presets = presets;
  if (kind) body.kind = kind;
  const data = await postAi(req, '/api/ai/alt-text', body, {
    signal,
    feature: 'altText',
    store,
  });
  if (
    typeof onUsage === 'function' &&
    Number.isFinite(data?.usage?.used) &&
    Number.isFinite(data?.usage?.limit)
  ) {
    onUsage({ used: data.usage.used, limit: data.usage.limit });
  }
  return typeof data?.altText === 'string' ? data.altText.trim() : '';
}

/**
 * generateAltText for a File or Blob: the composer's prepared image, so what
 * is described is what will be posted.
 */
export async function generateAltTextForFile(req, file, opts = {}) {
  if (!file)
    throw aiError('There’s no image to describe.', { code: 'NO_IMAGE' });
  const { signal, store, ...payload } = opts;
  const imageBase64 = await blobToBase64(file);
  return generateAltText(
    req,
    { ...payload, imageBase64, mimeType: file.type || 'image/jpeg' },
    { signal, store },
  );
}
