// Video for posts, through Bluesky's video service: one upload of the whole
// file, then the service's job is polled until it hands back the blob it
// wrote to the account's PDS. Everything is done as the write account: its
// PDS mints the service-auth tokens, so the blob lands in the repo the post is
// written to.
//
// The service needs two kinds of token. Calls about the account (upload
// limits, job status) carry one addressed to the service itself. The upload
// carries one addressed to the account's PDS for `com.atproto.repo.uploadBlob`,
// which the service presents when it writes the processed blob there.

import { toJsonShape } from './recordCid.js';

export const VIDEO_SERVICE_HOST = 'video.bsky.app';
export const VIDEO_SERVICE_URL = `https://${VIDEO_SERVICE_HOST}`;
export const VIDEO_SERVICE_DID = `did:web:${VIDEO_SERVICE_HOST}`;

// ISO megabytes: the service refuses at exactly 300,000,000 bytes.
export const VIDEO_MAX_SIZE_BYTES = 300 * 1000 * 1000;
export const VIDEO_MAX_SIZE_LABEL = '300 MB';
export const VIDEO_MAX_DURATION_SECONDS = 600;
export const VIDEO_SUPPORTED_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/mpeg',
];
export const VIDEO_FILE_INPUT_ACCEPT = VIDEO_SUPPORTED_MIME_TYPES.join(',');
export const VIDEO_ALT_MAX_GRAPHEMES = 1000;

// The upload token outlives a slow upload of a large file, and stays under an
// hour, the longest a PDS will mint one for.
export const VIDEO_UPLOAD_TOKEN_TTL_SECONDS = 30 * 60;

// A ten-minute video routinely takes more than five minutes to process.
export const VIDEO_POLL_MAX_TIME_MS = 30 * 60 * 1000;
export const VIDEO_POLL_INTERVAL_MS = 1500;
export const VIDEO_POLL_FAILURE_INTERVAL_MS = 5000;
export const VIDEO_POLL_MAX_CONSECUTIVE_FAILURES = 50;
// Grace polls for a job reported complete before its blob shows up.
export const VIDEO_POLL_MAX_COMPLETED_WITHOUT_BLOB = 5;

// The defaults of a bare pollVideoJobStatus call; uploadVideo passes the
// long-video numbers above.
const BARE_POLL_INTERVAL_MS = 1000;
const BARE_MAX_CONSECUTIVE_FAILURES = 3;

const MIME_EXTENSIONS = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/mpeg': 'mpeg',
};

// What the service says when it refuses, in plain words.
const LIMIT_MESSAGES = {
  'User is not allowed to upload videos':
    'This account isn’t able to upload videos.',
  'Uploading is disabled at the moment':
    'Video uploads are turned off for now. Try again later.',
  "Failed to get user's upload stats":
    'Couldn’t tell whether this account can upload video right now. Try again.',
  'User has exceeded daily upload bytes limit':
    'This account has reached today’s video upload limit. It resets tomorrow.',
  'User has exceeded daily upload videos limit':
    'This account has reached today’s limit on videos. It resets tomorrow.',
  'Account is not old enough to upload videos':
    'This account isn’t old enough to upload video yet.',
  'Confirm your email address to upload videos':
    'Confirm this account’s email address to upload video.',
};

/** A video failure with a sentence the composer can show as it is. */
export class VideoError extends Error {
  constructor(message, { code = 'VIDEO_FAILED', cause, status } = {}) {
    super(message);
    this.name = 'VideoError';
    this.code = code;
    if (cause) this.cause = cause;
    if (status) this.status = status;
  }
}

function abortError() {
  const err = new Error('The video upload was cancelled.');
  err.name = 'AbortError';
  err.canceled = true;
  return err;
}

/** An absolute video-service URL, dropping nullish params. */
export function videoServiceUrl(route, params = {}) {
  const url = new URL(VIDEO_SERVICE_URL);
  url.pathname = route;
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.href;
}

/** `1234567` → `'1.2 MB'`, in the service's ISO megabytes. */
export function formatVideoSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0.0 MB';
  return `${(value / 1000 / 1000).toFixed(1)} MB`;
}

/**
 * Whether a file can be sent: a supported type, not empty, not over the size
 * limit. `{ ok: true }` or `{ ok: false, code, message }`.
 * @param {File} file
 */
export function validateVideoFile(file) {
  if (!file || typeof file.size !== 'number') {
    return {
      ok: false,
      code: 'VIDEO_MISSING',
      message: 'Choose a video to add.',
    };
  }
  if (!VIDEO_SUPPORTED_MIME_TYPES.includes(file.type)) {
    return {
      ok: false,
      code: 'VIDEO_TYPE',
      message: 'Videos can be MP4, MOV, WebM or MPEG.',
    };
  }
  if (file.size <= 0) {
    return {
      ok: false,
      code: 'VIDEO_EMPTY',
      message: 'This video file is empty.',
    };
  }
  if (file.size > VIDEO_MAX_SIZE_BYTES) {
    return {
      ok: false,
      code: 'VIDEO_TOO_LARGE',
      message: `Videos can be up to ${VIDEO_MAX_SIZE_LABEL}; this one is ${formatVideoSize(file.size)}.`,
    };
  }
  return { ok: true };
}

/**
 * The job status in a service answer: getJobStatus wraps it in
 * `{ jobStatus }`, uploadVideo returns it flat.
 */
export function normalizeJobStatus(result) {
  if (!result || typeof result !== 'object') return null;
  const status =
    result.jobStatus && typeof result.jobStatus === 'object'
      ? result.jobStatus
      : result;
  return status.jobId || status.state || status.blob ? status : null;
}

/**
 * Whether a blob is one a record can carry. Only a blob the service sent will
 * do; one made up from a job id would publish a video that never loads.
 */
export function isUsableVideoBlob(blob) {
  if (!blob || typeof blob !== 'object') return false;
  return (
    (typeof blob.ref?.$link === 'string' && blob.ref.$link.length > 0) ||
    (typeof blob.cid === 'string' && blob.cid.length > 0) ||
    (typeof blob.ref?.toString === 'function' && blob.ref.asCID === blob.ref)
  );
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });

/**
 * Poll a processing job until the service returns its blob.
 *
 * @param {string} jobId
 * @param {string | (() => Promise<string>)} token - a service-addressed token,
 *   or a function minting one
 * @param {(status: { state: string, progress: number, message?: string }) => void} [onProgress]
 * @param {object} [options] - `signal`, `fetch`, `pollIntervalMs`,
 *   `failureIntervalMs`, `maxPollTimeMs`, `maxConsecutiveFailures`,
 *   `maxCompletedWithoutBlobPolls`
 * @returns {Promise<object>} the job status, always with a usable blob
 */
export async function pollVideoJobStatus(
  jobId,
  token,
  onProgress,
  options = {},
) {
  const {
    signal,
    fetch: fetchImpl,
    pollIntervalMs = BARE_POLL_INTERVAL_MS,
    failureIntervalMs = null,
    maxPollTimeMs = VIDEO_POLL_MAX_TIME_MS,
    maxConsecutiveFailures = BARE_MAX_CONSECUTIVE_FAILURES,
    maxCompletedWithoutBlobPolls = VIDEO_POLL_MAX_COMPLETED_WITHOUT_BLOB,
  } = options || {};
  const startTime = Date.now();
  let consecutiveFailures = 0;
  let completedWithoutBlob = 0;

  for (;;) {
    if (signal?.aborted) throw abortError();
    if (Date.now() - startTime > maxPollTimeMs) {
      throw new VideoError(
        'This video is still processing after a long wait. Try adding it again later.',
        {
          code: 'VIDEO_PROCESSING_TIMEOUT',
        },
      );
    }

    let jobStatus;
    try {
      const bearer = typeof token === 'function' ? await token() : token;
      const doFetch = fetchImpl || globalThis.fetch;
      const response = await doFetch(
        videoServiceUrl('/xrpc/app.bsky.video.getJobStatus', { jobId }),
        {
          headers: { Authorization: `Bearer ${bearer}` },
          signal,
        },
      );
      const result = await response.json();
      consecutiveFailures = 0;
      jobStatus = normalizeJobStatus(result);

      // A blob means ready, whatever else the answer says: a video sent twice
      // comes back as error "already_exists" with a good blob.
      if (isUsableVideoBlob(jobStatus?.blob)) return jobStatus;
      if (!response.ok) throw new Error('Failed to get job status');
      if (!jobStatus) throw new Error('Malformed job status response');
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw abortError();
      consecutiveFailures++;
      if (consecutiveFailures >= maxConsecutiveFailures) throw error;
      await sleep(
        failureIntervalMs ?? pollIntervalMs * (consecutiveFailures + 1),
        signal,
      );
      continue;
    }

    onProgress?.({
      state: jobStatus.state,
      progress: jobStatus.progress || 0,
      message: jobStatus.message,
    });

    if (jobStatus.state === 'JOB_STATE_FAILED') {
      const failure = new VideoError(
        jobStatus.message ||
          jobStatus.error ||
          'The video service couldn’t process this video.',
        { code: 'VIDEO_PROCESSING_FAILED' },
      );
      failure.failureCode = jobStatus.failureCode;
      failure.jobError = jobStatus.error;
      throw failure;
    }
    if (jobStatus.state === 'JOB_STATE_COMPLETED') {
      completedWithoutBlob++;
      if (completedWithoutBlob > maxCompletedWithoutBlobPolls) {
        throw new VideoError(
          jobStatus.error === 'already_exists'
            ? 'This video was already processed, but the service didn’t send it back. Trim or re-save the video and try again.'
            : 'Video processing finished without returning a video. Try adding it again.',
          { code: 'VIDEO_NO_BLOB' },
        );
      }
    }
    await sleep(pollIntervalMs, signal);
  }
}

function pdsAudience(pdsUrl) {
  let host;
  try {
    host = new URL(pdsUrl).hostname;
  } catch {
    throw new VideoError(
      'Couldn’t find this account’s server to upload the video to.',
      {
        code: 'VIDEO_NO_PDS',
      },
    );
  }
  return `did:web:${host}`;
}

async function mintToken(target, { aud, lxm, exp }) {
  const res = await target.agent.com.atproto.server.getServiceAuth({
    aud,
    lxm,
    ...(exp ? { exp } : {}),
  });
  const token = res?.data?.token;
  if (!token)
    throw new VideoError('Couldn’t get permission to upload the video.', {
      code: 'VIDEO_AUTH',
    });
  return token;
}

/**
 * The write account's video upload limits:
 * `{ canUpload, message?, remainingDailyVideos?, remainingDailyBytes? }`.
 * @param {{ did: string, agent: object }} target
 * @param {{ fetch?: typeof fetch, signal?: AbortSignal }} [options]
 */
export async function getVideoUploadLimits(
  target,
  { fetch: fetchImpl, signal } = {},
) {
  const token = await mintToken(target, {
    aud: VIDEO_SERVICE_DID,
    lxm: 'app.bsky.video.getUploadLimits',
  });
  const doFetch = fetchImpl || globalThis.fetch;
  const res = await doFetch(
    videoServiceUrl('/xrpc/app.bsky.video.getUploadLimits'),
    {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    throw new VideoError(
      'Couldn’t check this account’s video limits. Try again.',
      {
        code: 'VIDEO_LIMITS',
        status: res.status,
      },
    );
  }
  return body;
}

/** The limit message as a sentence, or the service's own words. */
export function videoLimitMessage(message) {
  return (
    LIMIT_MESSAGES[message] ||
    message ||
    'This account can’t upload video right now.'
  );
}

function randomName(file) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(12);
  globalThis.crypto?.getRandomValues?.(bytes);
  let token = '';
  for (const b of bytes) token += alphabet[b % alphabet.length];
  return `${token}.${MIME_EXTENSIONS[file.type] || 'mp4'}`;
}

/**
 * Upload a video as the write account and wait for the service to process
 * it. Only the bytes leave for the video service; the file's own name stays
 * behind.
 *
 * @param {{ did: string, agent: object, pdsUrl: string }} target
 * @param {File} file
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {AbortSignal} [options.signal]
 * @param {(p: { phase: 'checking'|'uploading'|'processing', progress?: number }) => void} [options.onProgress]
 * @param {() => number} [options.now]
 * @param {object} [options.poll] - pollVideoJobStatus tuning
 * @returns {Promise<{ blob: object, jobId: string | null }>}
 */
export async function uploadVideo(target, file, options = {}) {
  const {
    fetch: fetchImpl,
    signal,
    onProgress,
    now = () => Date.now(),
    poll = {},
  } = options;
  const doFetch = fetchImpl || globalThis.fetch;
  const check = validateVideoFile(file);
  if (!check.ok) throw new VideoError(check.message, { code: check.code });
  if (signal?.aborted) throw abortError();

  onProgress?.({ phase: 'checking' });
  const limits = await getVideoUploadLimits(target, { fetch: doFetch, signal });
  if (!limits.canUpload) {
    throw new VideoError(videoLimitMessage(limits.message), {
      code: 'VIDEO_LIMIT',
    });
  }

  const uploadToken = await mintToken(target, {
    aud: pdsAudience(target.pdsUrl),
    lxm: 'com.atproto.repo.uploadBlob',
    exp: Math.floor(now() / 1000) + VIDEO_UPLOAD_TOKEN_TTL_SECONDS,
  });
  if (signal?.aborted) throw abortError();

  onProgress?.({ phase: 'uploading' });
  let response;
  try {
    response = await doFetch(
      videoServiceUrl('/xrpc/app.bsky.video.uploadVideo', {
        did: target.did,
        name: randomName(file),
      }),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${uploadToken}`,
          'Content-Type': file.type,
        },
        body: file,
        signal,
      },
    );
  } catch (cause) {
    if (signal?.aborted || cause?.name === 'AbortError') throw abortError();
    throw new VideoError(
      'Couldn’t reach the video service. Check your connection and try again.',
      {
        code: 'VIDEO_NETWORK',
        cause,
      },
    );
  }
  const body = await response.json().catch(() => null);
  let jobStatus = normalizeJobStatus(body);

  // 409 already_exists carries the earlier job for the same bytes.
  const alreadySent =
    response.status === 409 && jobStatus?.error === 'already_exists';
  if (!response.ok && !alreadySent) {
    throw new VideoError(videoLimitMessage(body?.message || body?.error), {
      code: 'VIDEO_REFUSED',
      status: response.status,
    });
  }
  if (!isUsableVideoBlob(jobStatus?.blob)) {
    if (!jobStatus?.jobId) {
      throw new VideoError(
        'The video service didn’t start processing this video. Try again.',
        {
          code: 'VIDEO_NO_JOB',
        },
      );
    }
    onProgress?.({ phase: 'processing', progress: 0 });
    let jobToken = null;
    const token = async () =>
      (jobToken ??= await mintToken(target, {
        aud: VIDEO_SERVICE_DID,
        lxm: 'app.bsky.video.getJobStatus',
      }));
    jobStatus = await pollVideoJobStatus(
      jobStatus.jobId,
      token,
      (s) => onProgress?.({ phase: 'processing', progress: s.progress || 0 }),
      {
        signal,
        fetch: doFetch,
        pollIntervalMs: VIDEO_POLL_INTERVAL_MS,
        failureIntervalMs: VIDEO_POLL_FAILURE_INTERVAL_MS,
        maxConsecutiveFailures: VIDEO_POLL_MAX_CONSECUTIVE_FAILURES,
        ...poll,
      },
    );
  }

  const blob = toJsonShape(jobStatus.blob);
  if (!blob.$type && blob.cid) {
    // The legacy `{ cid, mimeType }` form, in the shape records carry.
    return {
      blob: {
        $type: 'blob',
        ref: { $link: blob.cid },
        mimeType: blob.mimeType || file.type,
        size: blob.size ?? file.size,
      },
      jobId: jobStatus.jobId || null,
    };
  }
  return { blob, jobId: jobStatus.jobId || null };
}
