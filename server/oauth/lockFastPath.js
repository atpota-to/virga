// Lock fast path for the OAuth token lookup, behind OAUTH_LOCK_FAST_PATH=true.
//
// @atproto/oauth-client takes requestLock and reads the session store before
// every request it signs. With Supabase behind both, each proxied XRPC call
// pays a lock acquire, a session read and a lock release, plus polling while
// another request for the same account holds the lock, though only a small
// share of those lookups refresh anything. The lock exists for refreshes:
// refresh tokens are single-use, and the PDS deletes the whole session when
// one is replayed.
//
// With the flag on, a lookup reads the stored session first and, when its
// access token has more than FAST_PATH_MARGIN_MS left, runs without the lock.
// The library only refreshes a token within 40 s of expiry, so nothing can
// refresh on that path. Everything else takes the lock: a token near expiry, a
// missing session, and every forced refresh (the library's answer to a 401 on
// a token it thought was valid).
//
// Skipping the lock lets a lookup read a token another instance is replacing.
// The request carrying it gets a 401 and forces a refresh, and a forced
// refresh rotates whatever is stored, so it would invalidate the replacement
// the other instance just wrote and feed itself: in simulation one forced
// refresh set off over a thousand rotations. So a forced refresh whose refused
// token has already been replaced in the store adopts the replacement instead
// of rotating again (installClientHooks). Both hooks reach into the library,
// and without either one the fast path stays off.

import { AsyncLocalStorage } from 'node:async_hooks';

// Far wider than the library's own refresh window (10 s plus up to 30 s of
// jitter in SessionGetter's isStale), so no refresh can start on the fast path.
export const FAST_PATH_MARGIN_MS = 5 * 60 * 1000;
// The key the library locks under: this plus the DID.
export const LOCK_KEY_PREFIX = '@atproto-oauth-client-';

// { forced: true } inside a forced refresh; { prefetched: { sub, value } } on
// the fast path, so the library's own store read reuses the one just made.
const lockContext = new AsyncLocalStorage();
// { used } for one signed request: the access token its lookup returned.
const tokenUse = new AsyncLocalStorage();
const TRACKED = Symbol('oauthTokenUseTracked');

/** Whether the deployment asked for the fast path. */
export function fastPathRequested(env = process.env) {
  return String(env.OAUTH_LOCK_FAST_PATH || '').toLowerCase() === 'true';
}

/**
 * Whether the session's access token has more than `marginMs` left. A token
 * with no expiry is one the library never refreshes; an unreadable expiry
 * takes the locked path.
 */
export function hasTimeLeft(
  session,
  now = Date.now(),
  marginMs = FAST_PATH_MARGIN_MS,
) {
  if (!session || !session.tokenSet) return false;
  const expiresAt = session.tokenSet.expires_at;
  if (expiresAt == null) return true;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at - now > marginMs;
}

/** The session the fast path already read for `sub`, if this lookup is on it. */
export function prefetchedSession(sub) {
  const prefetched = lockContext.getStore()?.prefetched;
  return prefetched && prefetched.sub === sub ? prefetched.value : undefined;
}

/**
 * The requestLock handed to NodeOAuthClient.
 *
 * @param {object} deps
 * @param {(key: string, fn: Function) => Promise<any>} deps.lock - the full
 *   lock (in-process, then cross-instance)
 * @param {(sub: string) => Promise<object|undefined>} deps.readSession - a
 *   store read that ignores any prefetched value
 * @param {() => boolean} deps.isArmed - whether this client's hooks are in
 * @param {number} [deps.marginMs]
 */
export function createRequestLock({
  lock,
  readSession,
  isArmed,
  marginMs = FAST_PATH_MARGIN_MS,
}) {
  if (typeof isArmed !== 'function')
    throw new TypeError('createRequestLock needs isArmed');
  return async function requestLock(key, fn) {
    if (
      !isArmed() ||
      lockContext.getStore()?.forced ||
      !String(key).startsWith(LOCK_KEY_PREFIX)
    ) {
      return lock(key, fn);
    }
    const sub = String(key).slice(LOCK_KEY_PREFIX.length);
    const stored = await readSession(sub);
    if (!hasTimeLeft(stored, Date.now(), marginMs)) return lock(key, fn);
    return lockContext.run({ prefetched: { sub, value: stored } }, fn);
  };
}

/**
 * Wrap the client's SessionGetter so that a forced refresh is marked (and so
 * always takes the lock) and adopts a replacement for its refused token rather
 * than rotating again.
 *
 * @param {object} sessionGetter - NodeOAuthClient#sessionGetter
 * @returns {boolean} whether both hooks are in place; the caller arms the fast
 *   path only on true
 */
export function installClientHooks(sessionGetter) {
  if (
    !sessionGetter ||
    typeof sessionGetter.get !== 'function' ||
    typeof sessionGetter.getter !== 'function'
  ) {
    return false;
  }
  const get = sessionGetter.get.bind(sessionGetter);
  const refresh = sessionGetter.getter;

  sessionGetter.get = async (sub, options) => {
    if (options && options.noCache) {
      return lockContext.run({ forced: true }, () => get(sub, options));
    }
    const session = await get(sub, options);
    const use = tokenUse.getStore();
    if (use)
      use.used = session && session.tokenSet && session.tokenSet.access_token;
    return session;
  };

  // Runs under the lock, with `stored` read fresh from the store.
  sessionGetter.getter = function (sub, options, stored) {
    const refused = tokenUse.getStore()?.used;
    const current = stored && stored.tokenSet && stored.tokenSet.access_token;
    if (
      lockContext.getStore()?.forced &&
      refused &&
      current &&
      current !== refused &&
      hasTimeLeft(stored)
    ) {
      return Promise.resolve(stored);
    }
    return refresh.call(this, sub, options, stored);
  };

  return true;
}

/**
 * Record which access token each request this session signs carries, so a
 * forced refresh can tell whether its token was already replaced. A session
 * that isn't tracked still works; its forced refreshes rotate.
 *
 * @param {object} session - an OAuthSession
 * @returns {object} the same session
 */
export function trackTokenUse(session) {
  if (
    !session ||
    typeof session.fetchHandler !== 'function' ||
    session[TRACKED]
  )
    return session;
  const fetchHandler = session.fetchHandler.bind(session);
  session.fetchHandler = (pathname, init) =>
    tokenUse.run({ used: undefined }, () => fetchHandler(pathname, init));
  session[TRACKED] = true;
  return session;
}
