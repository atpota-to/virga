// POST /api/oauth/logout: sign this device out.
//
// The token it was called with is deleted, and only when the DID has no other
// live token is the grant revoked and its oauth_sessions row deleted. A count
// that can't be read keeps the grant: other devices may still be using it.
//
// A token that can't be read (the store is down, as opposed to "no such
// token") is a 503 with the token left in place. Deleting it then would leave
// nothing to name the DID by, so if this was its last device the grant would
// never be revoked; kept, the same call can be made again and finish the job.
//
// Revoking the grant also stops that account's scheduled posts and timers
// until it signs in again; they fail once their retries run out.

import { bearerToken, methodGuard, sendJson } from '../../http.js';
import { getOAuthClient } from '../client.js';
import { unavailableReason } from '../config.js';
import { getStorage } from '../storage.js';

const TRANSIENT = 'Signing out could not finish. Try again in a moment.';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return undefined;

  const token = bearerToken(req);
  if (!token)
    return sendJson(res, 200, {
      success: true,
      message: 'No session to logout',
    });

  const { frontendSessionStore, sessionStore } = getStorage();
  const { userDid, error } =
    await frontendSessionStore.validateWithDetails(token);
  if (error) {
    console.warn(
      `[oauth/logout] could not read the token (${error}); kept for a retry`,
    );
    return sendJson(res, 503, {
      success: false,
      code: 'VALIDATION_TRANSIENT_ERROR',
      error: TRANSIENT,
    });
  }
  if (!(await frontendSessionStore.deleteToken(token))) {
    // Left in the table, the token counts as a live device, so the grant
    // would be kept for good once the reader's own copy is gone.
    console.warn('[oauth/logout] could not delete the token; kept for a retry');
    return sendJson(res, 503, {
      success: false,
      code: 'LOGOUT_TRANSIENT_ERROR',
      error: TRANSIENT,
    });
  }

  let grantRevoked = false;
  if (userDid) {
    const remaining = await frontendSessionStore.countForUser(userDid);
    if (remaining === 0) {
      if (!unavailableReason()) {
        try {
          await getOAuthClient().revokeSession(userDid);
        } catch (revokeError) {
          console.warn(
            `[oauth/logout] could not revoke the grant for ${userDid}: ${revokeError?.message || revokeError}`,
          );
        }
      }
      await sessionStore.forceDelete(userDid);
      grantRevoked = true;
    }
    console.log(
      `[oauth/logout] signed a device out for ${userDid} (${grantRevoked ? 'grant revoked' : `${remaining ?? 'unknown'} other sessions kept`})`,
    );
  }

  return sendJson(res, 200, {
    success: true,
    message: 'Logged out successfully',
    grantRevoked,
  });
}
