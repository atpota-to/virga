// What the worker does, apart from its loop: call Virga's run route, signed,
// and work out how long to wait before the next call. Pure enough to test
// against the server's own check (drive.test.js).
//
// In phase 3 this is all the worker does. It holds one secret,
// DEFENSE_WORKER_SECRET, and calls one route; Virga's server chooses the work,
// opens the sessions and writes. The DMs, the shield's socket and attack mode
// join it in phases 4 and 5 (docs/DEFENSE.md).

import { signWorkerRequest } from '../server/defense/workerAuth.js';

export const RUN_PATH = '/api/defense/run';
const MAX_BACKOFF_MS = 10 * 60_000;

/** The worker's settings from its environment; throws a sentence naming what's missing. */
export function readConfig(env = process.env) {
  const raw = String(env.VIRGA_URL || '').trim().replace(/\/+$/, '');
  let base;
  try {
    base = new URL(raw);
  } catch {
    throw new Error('VIRGA_URL must be the address of Virga’s deployment, e.g. https://virga.example');
  }
  const local = base.hostname === 'localhost' || base.hostname === '127.0.0.1';
  if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) throw new Error('VIRGA_URL must be https (http only for localhost)');
  if (base.pathname !== '/' || base.search || base.hash) throw new Error('VIRGA_URL must be an origin, with no path');
  const secret = String(env.DEFENSE_WORKER_SECRET || '');
  if (secret.length < 32) throw new Error('DEFENSE_WORKER_SECRET must be set, 32 characters or more (openssl rand -hex 32), the same as on Vercel');
  const seconds = Number(env.WORKER_INTERVAL_SECONDS || 60);
  const intervalMs = Number.isFinite(seconds) && seconds >= 15 ? seconds * 1000 : 60_000;
  return { base: base.origin, secret, intervalMs };
}

/**
 * One call to the run route. Resolves to `{ ok, status, summary?, error? }`;
 * never throws, so the loop's only job is to wait and call again.
 */
export async function driveOnce({ base, secret, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 70_000 }) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetchImpl(`${base}${RUN_PATH}`, {
      method: 'POST',
      headers: { 'x-virga-worker': signWorkerRequest({ secret, method: 'POST', path: RUN_PATH, now: now() }), Accept: 'application/json' },
      signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.success === false) return { ok: false, status: res.status, error: body?.error || `HTTP ${res.status}` };
    return { ok: true, status: res.status, summary: body?.data ?? null };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err) };
  }
}

/**
 * How long until the next call: the interval, give or take a tenth so two
 * workers drift apart, and doubling after each failure in a row up to ten
 * minutes. A 401 is a wrong secret, which waiting won't fix, so it waits the
 * longest.
 */
export function nextDelay({ intervalMs, failures = 0, status = 200, random = Math.random }) {
  const jitter = 1 + (random() * 0.2 - 0.1);
  if (status === 401) return MAX_BACKOFF_MS;
  if (!failures) return Math.round(intervalMs * jitter);
  return Math.min(MAX_BACKOFF_MS, Math.round(intervalMs * 2 ** Math.min(failures, 8) * jitter));
}
