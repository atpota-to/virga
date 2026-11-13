// How the proxy reads and reports a failed upstream XRPC call.

import { ResponseType } from '@atproto/xrpc';

/**
 * The HTTP status to answer with. `XRPCError.status` is the SDK's
 * ResponseType, and two of its values aren't HTTP codes:
 *
 *   1  Unknown          no HTTP answer: an error raised while making the call
 *   2  InvalidResponse  the upstream answered 200 with a body that failed to
 *                       parse or failed the SDK's validation of the output
 *
 * Handed to res.status(), either throws ERR_HTTP_INVALID_STATUS_CODE when the
 * response is written, and the caller gets a 500 about the status code instead
 * of the upstream error. Both mean the upstream gave no usable answer, which
 * is what 502 says.
 *
 * @returns {number} the upstream's own 4xx/5xx, 502 for those two, else 500
 */
export function httpStatusForXrpcError(err) {
  const status = err && (err.status || err.statusCode);
  if (
    status === ResponseType.Unknown ||
    status === ResponseType.InvalidResponse
  )
    return 502;
  if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
  return 500;
}

/**
 * The message for the logs, with the field the SDK's validation refused when
 * there is one; without it every InvalidResponse logs the same sentence.
 */
export function describeXrpcError(err) {
  const message = (err && err.message) || String(err);
  const detail = err && err.validationError && err.validationError.message;
  return detail ? `${message} (${detail})` : message;
}

/**
 * A 4xx saying the record or post doesn't exist: the routine answer to
 * probing for one that may not be there, logged at info rather than error.
 * The message is matched too, for PDS implementations that name it otherwise.
 */
export function isRoutineNotFound(err) {
  if (!err || httpStatusForXrpcError(err) >= 500) return false;
  if (err.error === 'RecordNotFound' || err.error === 'NotFound') return true;
  return (
    typeof err.message === 'string' &&
    err.message.startsWith('Could not locate record')
  );
}

// Connection-establishment failures: the socket never opened, so the PDS never
// saw the request and a retry can't apply a write twice. Failures that can
// happen after the request was sent (headers or body timeouts, ECONNRESET,
// UND_ERR_SOCKET) are left out on purpose.
export const RETRIABLE_CONNECT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** Whether `err` is a connection failure that is safe to retry, writes included. */
export function isRetriableConnectError(err) {
  if (!err) return false;
  // Node's fetch wraps socket failures as `TypeError: fetch failed` with the
  // real one as its cause, and the SDK wraps that again in an XRPCError, so
  // the chain is walked. The message is matched for layers that pass on only
  // a stringified error.
  const texts = [];
  for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (e.code && RETRIABLE_CONNECT_CODES.has(e.code)) return true;
    texts.push(e.message || '');
  }
  return /UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|connect timeout/i.test(
    texts.join(' '),
  );
}

/**
 * Request headers the proxy relays to the upstream call: an allowlist, since
 * the incoming request carries the proxy's own auth and routing headers, which
 * must never be replayed onto the call made for the account. Both are read by
 * the AppView (languages and topics for trends).
 */
export const RELAYED_HEADERS = ['accept-language', 'x-bsky-topics'];

/** The relayable headers of an incoming request; `{}` when there are none. */
export function pickRelayedHeaders(requestHeaders = {}) {
  const relayed = {};
  for (const name of RELAYED_HEADERS) {
    const value = requestHeaders[name];
    // A repeated header arrives as an array; join it as the wire format would.
    const flat = Array.isArray(value) ? value.filter(Boolean).join(',') : value;
    if (typeof flat === 'string' && flat) relayed[name] = flat;
  }
  return relayed;
}

/**
 * The PDS's rate-limit state, passed back in the error body (the proxy
 * answers with its own JSON, so upstream headers are otherwise lost). A client
 * told 429 needs `ratelimit-reset` (epoch seconds) to know when to try again.
 */
export const RATE_LIMIT_HEADERS = [
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'ratelimit-policy',
];

/** Lowercase name -> string value, or null when there are none. Takes a plain object or a Headers. */
export function pickRateLimitHeaders(headers) {
  if (!headers || typeof headers !== 'object') return null;
  const picked = {};
  if (typeof headers.get === 'function') {
    for (const name of RATE_LIMIT_HEADERS) {
      const value = headers.get(name);
      if (value) picked[name] = String(value);
    }
  } else {
    for (const [name, value] of Object.entries(headers)) {
      const lower = name.toLowerCase();
      if (!RATE_LIMIT_HEADERS.includes(lower)) continue;
      if (value === undefined || value === null || value === '') continue;
      picked[lower] = String(value);
    }
  }
  return Object.keys(picked).length > 0 ? picked : null;
}
