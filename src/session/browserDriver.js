// Browser sign-ins, for any number of accounts, over the one
// BrowserOAuthClient (src/lib/oauthClient.js). The library keeps every
// account's session in its own IndexedDB, but it also keeps a "current"
// account of its own, which `restore(sub)` moves and `revoke(sub)` clears
// whoever it names. Virga keeps its own open account (`virga:account`), so
// that pointer never decides anything: `init()` runs only on the callback
// path (to finish a sign-in), and once, for a browser that signed in before
// Virga remembered accounts, to learn who that was.

import { getOauthClient, getOauthEvents } from '../lib/oauthClient.js';

/**
 * Why a restore failed, in the two answers the app acts on. 'expired' is
 * definitive: the stored session is gone, revoked, or can't be refreshed,
 * and only a new sign-in brings it back. Everything else (no network, an
 * authorization server that didn't answer) is 'unknown'.
 *
 * The library's error classes are passed in (`mod` is the imported
 * package), because their names don't survive minification.
 */
export function classifyRestoreError(err, mod = {}) {
  const definitive = [mod.TokenRefreshError, mod.TokenRevokedError, mod.TokenInvalidError, mod.AuthMethodUnsatisfiableError].filter(
    (C) => typeof C === 'function',
  );
  if (definitive.some((C) => err instanceof C)) return 'expired';
  // A session store that holds nothing usable for the sub reads back as a
  // TypeError inside the library; so does a DID it can't parse.
  if (err instanceof TypeError && !/fetch|network|load failed/i.test(String(err?.message || ''))) return 'expired';
  const message = String(err?.message || '');
  if (/deleted by another process|no refresh token|session .*(revoked|invalid)|invalid_grant/i.test(message)) return 'expired';
  return 'unknown';
}

/** The scope a session was granted, without a network round trip, or null. */
export async function grantedScopeOf(session) {
  try {
    const info = await session?.getTokenInfo?.(false);
    return typeof info?.scope === 'string' ? info.scope : null;
  } catch {
    return null;
  }
}

/** A callback's result, as opposed to a restore that init() fell back to. */
export function isCallbackResult(result) {
  return Boolean(result && result.session && Object.prototype.hasOwnProperty.call(result, 'state'));
}

export function createBrowserDriver({
  getClient = getOauthClient,
  loadModule = () => import('@atproto/oauth-client-browser'),
  events = getOauthEvents(),
} = {}) {
  let mod = null;
  const module = async () => (mod ||= await loadModule());

  return {
    /**
     * On the callback path: finish the sign-in. Resolves to
     * `{ session, intent }`, or null when there was no callback to finish.
     * A sign-in that came back declined throws the library's error, which
     * carries `params` (callbackErrorMessage reads them).
     */
    async finishCallback() {
      const client = await getClient();
      const result = await client.init();
      if (!isCallbackResult(result)) return null;
      return { session: result.session, intent: typeof result.state === 'string' ? result.state : 'add' };
    },

    /** The library's own current session, for a browser from before the account list. */
    async legacySession() {
      const client = await getClient();
      const result = await client.init();
      return result?.session || null;
    },

    /**
     * An account's session, without refreshing it first (it refreshes on
     * its first request if it has to). Throws an error with
     * `restoreFailure: 'expired' | 'unknown'`.
     */
    async restore(did) {
      const client = await getClient();
      try {
        return await client.restore(did, false);
      } catch (err) {
        const m = await module().catch(() => ({}));
        err.restoreFailure = classifyRestoreError(err, m);
        throw err;
      }
    },

    /** Redirects to the account's authorization server; normally never resolves. */
    async signIn(input, { scope, intent = 'add' } = {}) {
      const client = await getClient();
      await client.signIn(input, { scope, state: intent });
    },

    /**
     * End one account's session in this browser. Through the session, not
     * `client.revoke`, which would also clear the library's pointer for
     * whichever account it named.
     */
    async signOut(did, session = null) {
      let s = session;
      if (!s) {
        try {
          const client = await getClient();
          s = await client.restore(did, false);
        } catch {
          return;
        }
      }
      try {
        await s.signOut();
      } catch {
        // Revocation is best-effort; the stored session is deleted either way.
      }
    },

    grantedScope: grantedScopeOf,

    /**
     * Calls `fn(sub, { revoked })` whenever the library drops a session:
     * `revoked` when it was signed out on purpose (here or in another tab),
     * otherwise it expired or a refresh was refused.
     */
    onDeleted(fn) {
      const handler = async (event) => {
        const sub = event?.detail?.sub;
        const cause = event?.detail?.cause;
        const m = await module().catch(() => ({}));
        const revoked = typeof m.TokenRevokedError === 'function' && cause instanceof m.TokenRevokedError;
        fn(sub, { revoked });
      };
      events.addEventListener('deleted', handler);
      return () => events.removeEventListener('deleted', handler);
    },
  };
}
