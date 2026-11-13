// GET /api/oauth/session[?lite=1]: whether this browser's token is still good,
// and what its grant is.
//
// Lite is the cheap probe: one oauth_sessions read, no restore, no refresh,
// no write. Full restores the session (which may refresh it) and reports the
// granted scope and the PDS, both noted by the session store as it read the
// row. No profile fetch: the scope has no getProfile, and the app reads
// display data from the public AppView.

import { bearerToken, methodGuard, sendJson } from '../../http.js';
import { getOAuthClient } from '../client.js';
import { sendUnavailable, unavailableReason } from '../config.js';
import { getStorage } from '../storage.js';
import { restoreWithRetry } from '../restore.js';
import { queryParam } from '../respond.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return undefined;

  try {
    const token = bearerToken(req);
    if (!token) {
      return sendJson(res, 401, {
        success: false,
        error: 'Missing or invalid authorization header',
        authenticated: false,
      });
    }

    const unavailable = unavailableReason();
    if (unavailable) return sendUnavailable(res, unavailable);

    const { sessionStore, frontendSessionStore } = getStorage();
    const validation = await frontendSessionStore.validateWithDetails(token);
    if (!validation.userDid) {
      if (validation.error) {
        console.warn(
          `[oauth/session] token store unavailable (${validation.error})`,
        );
        return sendJson(res, 503, {
          success: false,
          error: 'Session validation temporarily unavailable, please retry',
          authenticated: false,
          code: 'VALIDATION_TRANSIENT_ERROR',
        });
      }
      return sendJson(res, 401, {
        success: false,
        error: 'Invalid or expired session',
        authenticated: false,
        code: 'FRONTEND_SESSION_INVALID',
      });
    }

    const userDid = validation.userDid;
    const lite = queryParam(req, 'lite');

    if (lite === '1' || lite === 'true') {
      const stored = await sessionStore.get(userDid);
      // A grant this instance already found refused reads as missing here
      // too, so the app asks for a sign-in instead of failing every call.
      const exists =
        !!stored && !getOAuthClient().isDeadGrantSession?.(userDid, stored);
      const scope = exists ? sessionStore.scopeFor(userDid) : null;
      return sendJson(res, 200, {
        success: true,
        authenticated: true,
        lite: true,
        client: 'virga',
        oauthSessionMissing: !exists,
        ...(scope ? { scope } : {}),
        user: { did: userDid },
      });
    }

    const oauthSession = await restoreWithRetry(getOAuthClient(), userDid, {
      tag: 'oauth/session',
    });
    const scope = oauthSession ? sessionStore.scopeFor(userDid) : null;
    const pds = oauthSession ? sessionStore.pdsFor(userDid) : null;
    return sendJson(res, 200, {
      success: true,
      authenticated: true,
      client: 'virga',
      oauthSessionMissing: !oauthSession,
      ...(scope ? { scope } : {}),
      ...(pds ? { pds } : {}),
      user: { did: userDid },
    });
  } catch (error) {
    console.error(`[oauth/session] ${error?.message || error}`);
    return sendJson(res, 500, {
      success: false,
      error: error?.message || 'Internal error',
      authenticated: false,
    });
  }
}
