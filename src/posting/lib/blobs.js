// Uploading a blob to the write account's PDS, and the blob shape records
// carry. Both session drivers answer `com.atproto.repo.uploadBlob`; the
// backend one sends the bytes through Virga's server, which needs an explicit
// media type, so every caller passes one.

import { toJsonShape } from './recordCid.js';

export const BLOB_UPLOAD_TIMEOUT_MS = 60_000;

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
 */
export async function uploadBlob(
  target,
  data,
  { encoding, signal, timeoutMs = BLOB_UPLOAD_TIMEOUT_MS } = {},
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

  let timer;
  let onAbort;
  const stop = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error('The upload timed out.'), { timedOut: true }),
        ),
      timeoutMs,
    );
    if (signal) {
      onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  try {
    const res = await Promise.race([
      target.agent.com.atproto.repo.uploadBlob(bytes, {
        encoding: type,
        ...(signal ? { signal } : {}),
      }),
      stop,
    ]);
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
