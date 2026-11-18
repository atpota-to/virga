// The worker's calls to Virga's Defense routes, signed. The worker on the
// droplet holds this one secret (DEFENSE_WORKER_SECRET) and nothing else of
// Virga's: no database key, no user's session, and not the moderator's
// (docs/DEFENSE-THREATS.md). A call carries
//
//   X-Virga-Worker: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.METHOD.path.sha256(body)">
//
// and is taken within five minutes of its time. The secret never travels, and
// a captured header is good for one route, one body and those few minutes.
// The routes the worker calls today (run, dm) take no body, so the body is
// the empty string; they choose their own work and take nothing else from the
// call.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const WORKER_HEADER = 'x-virga-worker';
export const WORKER_WINDOW_SECONDS = 300;

const digest = (body) => createHash('sha256').update(typeof body === 'string' || Buffer.isBuffer(body) ? body : '').digest('hex');
const message = (t, method, path, body) => `${t}.${String(method || 'GET').toUpperCase()}.${path}.${digest(body)}`;

/** The header for a call to `path` with `method` and `body`, signed with `secret` at `now`. */
export function signWorkerRequest({ secret, method = 'POST', path, body = '', now = Date.now() }) {
  if (!secret) throw new Error('signWorkerRequest needs the secret');
  const t = Math.floor(now / 1000);
  const v1 = createHmac('sha256', secret).update(message(t, method, path, body)).digest('hex');
  return `t=${t},v1=${v1}`;
}

function pathOf(req) {
  try {
    return new URL(req?.url || '', 'http://local').pathname;
  } catch {
    return '';
  }
}

/**
 * Whether a request carries a good signature for its own method, path and
 * `body` (the raw body it was sent with; empty for the routes that take
 * none). False when DEFENSE_WORKER_SECRET isn't set: without it no worker
 * can call.
 */
export function isWorkerAuthorized(req, env = process.env, now = Date.now(), { body = '' } = {}) {
  const secret = env?.DEFENSE_WORKER_SECRET;
  if (!secret) return false;
  const raw = req?.headers?.[WORKER_HEADER];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(String(header || ''));
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(Math.floor(now / 1000) - t) > WORKER_WINDOW_SECONDS) return false;
  const want = createHmac('sha256', secret).update(message(t, req.method, pathOf(req), body)).digest();
  const given = Buffer.from(m[2], 'hex');
  return given.length === want.length && timingSafeEqual(given, want);
}
