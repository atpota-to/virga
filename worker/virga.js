// The worker's calls to Vercel's moderator route (server/defense/handlers/
// moderator.js): what to do with a DM, an agent turn counted, a write
// described for the check, and each of the agent's tools. Signed with
// DEFENSE_WORKER_SECRET over the exact body (server/defense/workerAuth.js),
// and sent as application/octet-stream so the bytes arrive as signed.

import { signWorkerRequest } from '../server/defense/workerAuth.js';

export const MODERATOR_PATH = '/api/defense/moderator';

export class VirgaError extends Error {
  constructor(message, { status = 0, code = null } = {}) {
    super(message);
    this.name = 'VirgaError';
    this.status = status;
    this.code = code;
  }
}

/** `call(op, body)` resolves to the route's `data`, or throws a VirgaError. */
export function virgaClient({ base, secret, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 55_000 }) {
  return {
    async call(op, body = {}) {
      const text = JSON.stringify({ ...body, op });
      let res;
      try {
        res = await fetchImpl(`${base}${MODERATOR_PATH}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            Accept: 'application/json',
            'x-virga-worker': signWorkerRequest({ secret, method: 'POST', path: MODERATOR_PATH, body: text, now: now() }),
          },
          body: text,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new VirgaError(`Virga didn’t answer: ${err?.message || err}`);
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) throw new VirgaError(json?.error || `HTTP ${res.status}`, { status: res.status, code: json?.code || null });
      return json?.data ?? null;
    },
  };
}
