// Who is asking for AI help: the DID behind the request's `Authorization:
// Bearer <vg_token>`, and nothing else. Every allowance and limit is keyed on
// it, so a DID (or a membership claim) in the body is never read.

import { resolveUserDid } from '../oauth/auth.js';

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<{ ok: true, did: string } | { ok: false, status: number, error: string, code?: string }>}
 *   401 for a missing, unknown or expired session (FRONTEND_SESSION_INVALID),
 *   503 when the session store can't be read (VALIDATION_TRANSIENT_ERROR).
 */
export async function resolveAiCaller(req) {
  const auth = await resolveUserDid(req);
  if (auth.userDid) return { ok: true, did: auth.userDid };
  return {
    ok: false,
    status: auth.status || 401,
    error: auth.error || 'Invalid or expired session',
    ...(auth.code ? { code: auth.code } : {}),
  };
}
