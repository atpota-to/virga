// Restoring an account's OAuth session with the handlers' retry budget.
//
// Concurrent requests for one account can race a refresh: all load the same
// stale token, one wins the refresh, and the rest transiently fail to
// restore. Waiting a moment lets the losers read the winner's rotated tokens.

const DELAY_STEP_MS = 800;
const ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The account's session, or null after `attempts` tries (0, 800 ms and 1600 ms
 * apart by default). A throw from the client counts as a failed try.
 *
 * @param {{ restoreSession(did: string): Promise<object|null> }} client
 * @param {string} did
 * @param {object} [options]
 * @param {string} [options.tag] - log prefix
 */
export async function restoreWithRetry(
  client,
  did,
  { attempts = ATTEMPTS, delayStepMs = DELAY_STEP_MS, tag = 'oauth' } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const session = await client.restoreSession(did);
      if (session) return session;
    } catch (error) {
      console.warn(
        `[${tag}] restore failed (attempt ${attempt + 1}): ${error?.message || error}`,
      );
    }
    if (attempt < attempts - 1) await sleep(delayStepMs * (attempt + 1));
  }
  console.warn(
    `[${tag}] no OAuth session for ${did} after ${attempts} attempts`,
  );
  return null;
}

/** Whether an XRPC failure is the PDS refusing the access token. */
export function isInvalidTokenError(error) {
  return (
    !!error &&
    (error.error === 'InvalidToken' ||
      (typeof error.message === 'string' &&
        error.message.includes('Invalid token')))
  );
}
