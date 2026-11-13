// POST /api/oauth/logout: sign this device out.
//
// The token it was called with is deleted, and only when the DID has no other
// live token is the grant revoked and its oauth_sessions row deleted. A count
// that can't be read keeps the grant: other devices may still be using it.
//
// With { "keepGrant": true } in the body only the token goes, whatever the
// count. The app sends that for a token it is discarding rather than signing
// out with: one that came back from a sign-in it never started, or one a newer
// sign-in replaced. Anyone can start a sign-in for anyone (the authorization
// server approves it silently when consent already exists), so a token the
// reader never asked for must not be able to end the grant their scheduled
// posts and timers run on.
//
// A token that can't be read (the store is down, as opposed to "no such
// token") is a 503 with the token left in place. Deleting it then would leave
// nothing to name the DID by, so if this was its last device the grant would
// never be revoked; kept, the same call can be made again and finish the job.
//
// The count, the revoke and the delete run under the DID's grant lock, which
// a sign-in also takes to mint its token, so a sign-in finishing on another
// device in the meantime is never left with a token and no grant.
//
// Revoking the grant also stops that account's scheduled posts and timers
// until it signs in again; they fail once their retries run out.

import { bearerToken, methodGuard, readJson, sendJson } from '../../http.js';
import { getOAuthClient } from '../client.js';
import { unavailableReason } from '../config.js';
import { getStorage, grantLockKey } from '../storage.js';

const TRANSIENT = 'Signing out could not finish. Try again in a moment.';

/** Revoke and delete the DID's grant if it has no live token left. */
async function endGrantIfLastDevice(storage, userDid) {
  const { frontendSessionStore, sessionStore } = storage;
  const remaining = await frontendSessionStore.countForUser(userDid);
  if (remaining !== 0) return { remaining, grantRevoked: false };
  if (!unavailableReason()) {
    try {
      await getOAuthClient().revokeSession(userDid);
    } catch (revokeError) {
      console.warn(
        `[oauth/logout] could not revoke the grant for ${userDid}: ${revokeError?.message || revokeError}`,
      );
    }
  }
  // Counted again in case the lock fell open (it does when it can't be had in
  // time) and a sign-in minted a token meanwhile: the row is then its grant.
  const now = await frontendSessionStore.countForUser(userDid);
  if (now !== 0) return { remaining: now, grantRevoked: false };
  await sessionStore.forceDelete(userDid);
  return { remaining: 0, grantRevoked: true };
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return undefined;

  const token = bearerToken(req);
  if (!token)
    return sendJson(res, 200, {
      success: true,
      message: 'No session to logout',
    });

  const keepGrant = (await readJson(req)).keepGrant === true;
  const storage = getStorage();
  const { frontendSessionStore } = storage;
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
  if (userDid && keepGrant) {
    console.log(
      `[oauth/logout] dropped a discarded token for ${userDid}; grant kept`,
    );
  } else if (userDid) {
    const outcome = await storage.lock(grantLockKey(userDid), () =>
      endGrantIfLastDevice(storage, userDid),
    );
    grantRevoked = outcome.grantRevoked;
    console.log(
      `[oauth/logout] signed a device out for ${userDid} (${grantRevoked ? 'grant revoked' : `${outcome.remaining ?? 'unknown'} other sessions kept`})`,
    );
  }

  return sendJson(res, 200, {
    success: true,
    message: 'Logged out successfully',
    grantRevoked,
  });
}
