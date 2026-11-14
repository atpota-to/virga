// The caller's DID, from their `Authorization: Bearer <vg_token>`. Any
// endpoint that answers with per-account data goes through this; a DID in the
// body or query is never trusted.

import { bearerToken } from '../http.js';
import { getStorage } from './storage.js';

const INVALID = 'Invalid or expired session';

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<{ userDid: string|null, status: number, error: string|null, code: string|null }>}
 *   200 with the DID; 401 FRONTEND_SESSION_INVALID for a missing, unknown or
 *   expired token (the code the client reads as "signed out"); 503
 *   VALIDATION_TRANSIENT_ERROR when the token store can't be read.
 */
export async function resolveUserDid(req) {
  const token = bearerToken(req);
  if (!token) {
    return {
      userDid: null,
      status: 401,
      error: 'Missing or invalid authorization header',
      code: 'FRONTEND_SESSION_INVALID',
    };
  }
  const validation =
    await getStorage().frontendSessionStore.validateWithDetails(token);
  if (validation.userDid)
    return {
      userDid: validation.userDid,
      status: 200,
      error: null,
      code: null,
    };
  if (validation.error) {
    return {
      userDid: null,
      status: 503,
      error: 'Session validation temporarily unavailable, please retry',
      code: 'VALIDATION_TRANSIENT_ERROR',
    };
  }
  return {
    userDid: null,
    status: 401,
    error: INVALID,
    code: 'FRONTEND_SESSION_INVALID',
  };
}
