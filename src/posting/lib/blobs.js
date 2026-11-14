// Uploading a blob to the write account's PDS, and the blob shape records
// carry. Both session drivers answer `com.atproto.repo.uploadBlob`; the
// backend one sends the bytes through Virga's server, which needs an explicit
// media type, so every caller passes one.

import { toJsonShape } from './recordCid.js';

// An upload's deadline grows with its size: a fixed one fails a big image on
// a slow uplink every time, retries included. The rate is per upload, and
// publish runs four at once, so 16 KiB/s each assumes about half a megabit up
// in all; a 1.9 MiB image gets about two and a half minutes.
export const BLOB_UPLOAD_BASE_MS = 30_000;
export const BLOB_UPLOAD_MIN_BYTES_PER_SECOND = 16 * 1024;

/** How long an upload of `byteCount` bytes may take before it is given up. */
export function blobUploadTimeoutMs(byteCount) {
  const bytes = Number.isFinite(byteCount) && byteCount > 0 ? byteCount : 0;
  return (
    BLOB_UPLOAD_BASE_MS +
    Math.ceil((bytes / BLOB_UPLOAD_MIN_BYTES_PER_SECOND) * 1000)
  );
}

/** A blob's CID, from either the JSON form or the legacy `{ cid }` form. */
export function blobCid(blob) {
  if (!blob || typeof blob !== 'object') return null;
  const json = toJsonShape(blob);
  return json?.ref?.$link || (typeof json?.cid === 'string' ? json.cid : null);
}

/** Whether a value is a blob a record can carry. */
export function isBlob(blob) {
  return !!blobCid(blob) && typeof toJsonShape(blob)?.mimeType === 'string';
}

function abortError() {
  const err = new Error('The upload was cancelled.');
  err.name = 'AbortError';
  err.canceled = true;
  return err;
}

/**
 * Upload bytes as a blob of the write account, returning the blob in its JSON
 * form (`{ $type: 'blob', ref: { $link }, mimeType, size }`).
 *
 * @param {{ did: string, agent: object }} target
 * @param {Blob | Uint8Array | ArrayBuffer} data
 * @param {{ encoding: string, signal?: AbortSignal, timeoutMs?: number }} options
 *   `timeoutMs` defaults to blobUploadTimeoutMs of the byte count
 */
export async function uploadBlob(
  target,
  data,
  { encoding, signal, timeoutMs } = {},
) {
  const type =
    encoding ||
    (typeof Blob !== 'undefined' && data instanceof Blob ? data.type : '');
  if (!type || type === 'application/octet-stream') {
    throw new Error('A blob upload needs its media type.');
  }
  if (signal?.aborted) throw abortError();

  const bytes =
    data instanceof Uint8Array
      ? data
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(await data.arrayBuffer());

  // The request gets its own signal, so a timeout or a cancel actually stops
  // the transfer instead of leaving it to use the uplink after we've given up.
  // The race still settles at once for an agent that ignores the signal.
  const request = new AbortController();
  let timer;
  let onAbort;
  const stop = new Promise((_, reject) => {
    timer = setTimeout(
      () => {
        reject(
          Object.assign(new Error('The upload timed out.'), { timedOut: true }),
        );
        request.abort();
      },
      timeoutMs ?? blobUploadTimeoutMs(bytes.length),
    );
    if (signal) {
      onAbort = () => {
        reject(abortError());
        request.abort();
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  const upload = target.agent.com.atproto.repo.uploadBlob(bytes, {
    encoding: type,
    signal: request.signal,
  });
  // Rejects with the abort once the race is lost; nothing waits on it then.
  Promise.resolve(upload).catch(() => {});
  try {
    const res = await Promise.race([upload, stop]);
    const blob = toJsonShape(res?.data?.blob);
    if (!blobCid(blob))
      throw new Error('The PDS did not return the uploaded blob.');
    return {
      $type: 'blob',
      ref: { $link: blobCid(blob) },
      mimeType: blob.mimeType || type,
      size: Number.isFinite(blob.size) ? blob.size : bytes.length,
    };
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
