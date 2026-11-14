// The two calls to Virga's server about the Terms of Service and Privacy
// Policy (server/terms/handlers): ask whether an account has agreed, and
// record that it has. The version sent is the one this page shows; the
// server refuses any other.

import { BACKEND_URL } from '../config.js';
import { backendAddress, requestError } from '../session/backendClient.js';
import { TERMS_VERSION } from './version.js';

export const TERMS_API = Object.freeze({ status: '/api/terms/status', accept: '/api/terms/accept' });

const REPORT_TIMEOUT_MS = 15_000;

/**
 * Whether the account behind `requester` (a long session's, from
 * `backendFor(did)`) has agreed: `{ accepted, acceptedAt, version }`.
 * Throws the requester's error when the server can't say.
 */
export async function fetchTermsStatus(requester, { signal } = {}) {
  const body = await requester.request(TERMS_API.status, { signal, timeoutMs: 15_000 });
  return { accepted: body?.accepted === true, acceptedAt: body?.acceptedAt || null, version: body?.version ?? null };
}

/**
 * Record that the account behind `requester` agrees: `{ acceptedAt }`, the
 * time on the server's row. Throws on any refusal, and on any answer that
 * isn't the server saying it has the row: a host that serves a page for a
 * path it doesn't know answers 200 too, and that is not a record.
 */
export async function recordAcceptance(requester, { version = TERMS_VERSION } = {}) {
  const body = await requester.request(TERMS_API.accept, { method: 'POST', body: { version }, timeoutMs: 20_000 });
  if (body?.success !== true || body.identity !== 'session' || typeof body.acceptedAt !== 'string') throw requestError(200, body);
  return { acceptedAt: body.acceptedAt };
}

/**
 * Report an agreement made on a browser session. There is no session with
 * Virga's server to send, so the DID goes in the body and the server marks
 * the row as the browser's own word. The server's answer says only that it
 * took the report. Throws an error with `code` and `status` when it didn't
 * land.
 */
export async function reportAcceptance({ did, version = TERMS_VERSION, backendUrl = BACKEND_URL, fetch = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetch(backendAddress(backendUrl, TERMS_API.accept).href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, did }),
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REPORT_TIMEOUT_MS) : undefined,
    });
  } catch (cause) {
    throw Object.assign(new Error('Couldn’t reach Virga’s server.'), { status: 0, code: 'NETWORK_ERROR', cause });
  }
  const body = await res.json().catch(() => null);
  // A deployment with no server answers /api/* with a page, not JSON.
  if (!res.ok || body?.success !== true) throw requestError(res.status, body);
  return { identity: body.identity || null };
}
