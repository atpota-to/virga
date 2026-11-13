// The confidential OAuth client (@atproto/oauth-client-node), wrapped with a
// per-instance session cache, the lock fast path and the error shapes the
// handlers read.
//
// The library is pinned to 0.3.16, which runs on @atproto/oauth-client 0.5.x.
// Its 0.6 line replaced the client's addEventListener with onUpdate/onDelete
// hooks passed in the options, and calling addEventListener there throws,
// which would stop the client from starting and turn every route into a 503.
// So both are wired: the hooks are passed, and addEventListener is called only
// when the client has it.

import crypto from 'node:crypto';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { JoseKey } from '@atproto/jwk-jose';
import { AtprotoDohHandleResolver } from '@atproto-labs/handle-resolver';
import { APPVIEW } from '../../src/config.js';
import { TtlCache } from '../ttlCache.js';
import { envInt } from '../env.js';
import { SCOPE, clientMetadata, loadPrivateKeys } from './config.js';
import { getStorage, resetStorageForTests } from './storage.js';
import { createSafeFetch } from './safeFetch.js';
import {
  fastPathRequested,
  installClientHooks,
  trackTokenUse,
} from './lockFastPath.js';

const DOH_ENDPOINT = 'https://dns.google/resolve';

const errorText = (error) => (error && error.message) || String(error);

// What the library itself treats as the end of a session (its SessionGetter's
// deleteOnError): the refresh was refused, the grant revoked or invalid, or no
// loaded key can sign for it. Matched by name, because the classes come from
// the copy of @atproto/oauth-client that oauth-client-node bundles.
const TERMINAL_RESTORE_ERRORS = new Set([
  'TokenRefreshError',
  'TokenRevokedError',
  'TokenInvalidError',
  'AuthMethodUnsatisfiableError',
]);

/** Whether a failed restore is the grant itself being dead, as opposed to the network or a store. */
export function isTerminalRestoreError(error) {
  for (let e = error, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (TERMINAL_RESTORE_ERRORS.has(e.constructor?.name)) return true;
  }
  return false;
}

/** What identifies a stored grant: changes on every refresh and every sign-in. */
function grantFingerprint(session) {
  if (!session) return 'none';
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(session.tokenSet ?? session))
    .digest('hex');
}

/**
 * A handle resolver that tries DNS over HTTPS (TXT, then the library's own
 * well-known fallback) and then the public AppView's resolveHandle. The final
 * error's text is what classifyAuthorizeError matches, so keep it.
 */
export function createHandleResolver({ fetch, appview = APPVIEW } = {}) {
  const doh = new AtprotoDohHandleResolver({
    dohEndpoint: DOH_ENDPOINT,
    ...(fetch ? { fetch } : {}),
  });
  return {
    async resolve(handle, options) {
      try {
        const did = await doh.resolve(handle, options);
        if (did) return did;
      } catch (error) {
        console.warn(
          `[oauth] DNS lookup failed for ${handle}: ${errorText(error)}`,
        );
      }
      try {
        const url = `${appview}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`;
        const response = await (fetch || globalThis.fetch)(url, {
          signal: options?.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (typeof data?.did !== 'string' || !data.did.startsWith('did:'))
          throw new Error('no DID in the answer');
        return data.did;
      } catch (error) {
        console.warn(
          `[oauth] AppView lookup failed for ${handle}: ${errorText(error)}`,
        );
        throw new Error(`Failed to resolve identity: ${handle}`);
      }
    },
  };
}

export class OAuthClientWrapper {
  /**
   * @param {object} [options]
   * @param {object} [options.storage] - createStorage()'s result
   * @param {object} [options.env]
   * @param {object} [options.handleResolver]
   * @param {typeof fetch} [options.fetch] - every request the client makes; SSRF-checked by default
   */
  constructor({
    storage = getStorage(),
    env = process.env,
    handleResolver,
    fetch = createSafeFetch(),
  } = {}) {
    this.storage = storage;
    this.env = env;
    this.handleResolver = handleResolver;
    this.fetch = fetch;
    // DID -> restored OAuthSession. Reusing a still-valid session on a warm
    // instance skips restore()'s own store read and lock; each request it
    // signs still looks its token up under requestLock. A stale cached token
    // shows up as "Invalid token" on the XRPC call, and the handlers then
    // restore again with { fresh: true }.
    this.oauthSessionCache = new TtlCache({
      ttlMs: envInt(env, 'OAUTH_SESSION_CACHE_TTL_MS', 60000),
      max: 2000,
    });
    // DID -> how its last restore failed: 'terminal', 'other' or 'dead'.
    this.restoreFailures = new TtlCache({ ttlMs: 60000, max: 5000 });
    // DID -> the fingerprint of a grant restoreWithRetry gave up on. Without
    // it every call for a dead grant spends the whole retry budget (~2.4 s)
    // and sends the authorization server three more refreshes it will refuse.
    // The stored row is still read each time, so a new sign-in (here or on
    // another instance) or a refresh that went through is seen at once.
    this.deadGrants = new TtlCache({
      ttlMs: envInt(env, 'OAUTH_DEAD_GRANT_TTL_MS', 10 * 60 * 1000),
      max: 5000,
    });
    this.client = null;
    this.initPromise = this.initialize();
  }

  /** Whether this client's token lookups may take the lock fast path. */
  get fastPathArmed() {
    return !!this.storage.fastPath.armed;
  }

  async initialize() {
    try {
      const keyset = await this.prepareKeyset();
      this.client = new NodeOAuthClient(this.clientOptions(keyset));
      this.listenForSessionEvents();
      this.armFastPathIfHooked();
      return this.client;
    } catch (error) {
      console.error(
        `[oauth] the OAuth client could not start: ${errorText(error)}`,
      );
      throw error;
    }
  }

  /** What NodeOAuthClient is built from. onUpdate/onDelete are read by oauth-client 0.6 and ignored by 0.5. */
  clientOptions(keyset) {
    return {
      clientMetadata: clientMetadata(this.env),
      keyset,
      stateStore: this.storage.stateStore,
      sessionStore: this.storage.sessionStore,
      requestLock: this.storage.requestLock,
      // Identity, metadata, PAR, token and PDS requests alike: what they reach
      // is named by whoever calls /api/oauth/login (safeFetch.js).
      fetch: this.fetch,
      handleResolver:
        this.handleResolver || createHandleResolver({ fetch: this.fetch }),
      onUpdate: (sub) => this.onSessionUpdated(sub),
      onDelete: (sub, cause) => this.onSessionDeleted(sub, cause),
    };
  }

  onSessionUpdated(sub) {
    console.log(`[oauth] session updated for ${sub}`);
  }

  onSessionDeleted(sub, cause) {
    console.log(
      `[oauth] the library dropped the session for ${sub}: ${cause?.message || 'no reason given'}`,
    );
  }

  /** The event form of the hooks above, for library versions that have it. */
  listenForSessionEvents() {
    if (typeof this.client?.addEventListener !== 'function') return false;
    this.client.addEventListener('updated', (event) =>
      this.onSessionUpdated(event.detail?.sub || event.detail?.did),
    );
    this.client.addEventListener('deleted', (event) =>
      this.onSessionDeleted(event.detail?.sub, event.detail?.cause),
    );
    return true;
  }

  /**
   * The fast path is armed only once its hooks are in this client's own
   * SessionGetter, so a library that changed underneath them falls back to
   * the full lock.
   */
  armFastPathIfHooked(env = this.env) {
    if (!fastPathRequested(env)) return false;
    if (installClientHooks(this.client && this.client.sessionGetter)) {
      this.storage.fastPath.armed = true;
      console.log('[oauth] token lock fast path on (OAUTH_LOCK_FAST_PATH)');
      return true;
    }
    console.warn(
      '[oauth] OAUTH_LOCK_FAST_PATH is set, but this @atproto/oauth-client lacks the hooks it needs; every token lookup keeps the full lock',
    );
    return false;
  }

  async prepareKeyset() {
    const keyset = [];
    for (const jwk of loadPrivateKeys(this.env)) {
      try {
        keyset.push(await JoseKey.fromImportable(jwk, jwk.kid));
      } catch (error) {
        console.warn(
          `[oauth] could not load key ${jwk.kid}: ${errorText(error)}`,
        );
      }
    }
    return keyset;
  }

  async ensureInitialized() {
    if (!this.client) await this.initPromise;
    return this.client;
  }

  /**
   * The authorization server's URL for `handle`. Throws an Error whose cause
   * is the library's, which classifyAuthorizeError reads.
   */
  async generateLoginUrl(handle, options = {}) {
    const client = await this.ensureInitialized();
    try {
      const authUrl = await client.authorize(handle, {
        ...options,
        state: options.state || Math.random().toString(36).substring(2),
        scope: options.scope ?? SCOPE,
      });
      return authUrl instanceof URL ? authUrl.toString() : authUrl;
    } catch (error) {
      console.warn(
        `[oauth] could not start a sign-in for ${handle}: ${errorText(error)}`,
      );
      throw new Error(`Failed to initiate OAuth flow: ${errorText(error)}`, {
        cause: error,
      });
    }
  }

  /**
   * Finish an authorization. On failure throws an Error carrying the app
   * state the flow started with (`appState`, when the library recovered it)
   * and the authorization server's own error code (`oauthError`).
   */
  async handleCallback(params) {
    const client = await this.ensureInitialized();
    try {
      const { session, state } = await client.callback(params);
      this.deadGrants.delete(session.did);
      this.restoreFailures.delete(session.did);
      return { userDID: session.did, session, state };
    } catch (error) {
      const failure = new Error(`Authentication failed: ${errorText(error)}`);
      failure.appState = error?.state;
      failure.oauthError =
        typeof error?.params?.get === 'function'
          ? error.params.get('error')
          : undefined;
      throw failure;
    }
  }

  /**
   * The account's OAuthSession, or null when there is none or it can't be
   * restored. Throws only when the client itself never started.
   */
  async restoreSession(did, { fresh = false } = {}) {
    if (!fresh) {
      const cached = this.oauthSessionCache.get(did);
      if (cached) return cached;
    }
    const client = await this.ensureInitialized();
    if (await this.isKnownDeadGrant(did)) {
      this.restoreFailures.set(did, 'dead');
      return null;
    }
    try {
      const session = await client.restore(did);
      if (session) {
        if (this.fastPathArmed) trackTokenUse(session);
        this.oauthSessionCache.set(did, session);
        this.restoreFailures.delete(did);
        return session;
      }
      this.oauthSessionCache.delete(did);
      this.restoreFailures.set(did, 'other');
      console.log(`[oauth] no session to restore for ${did}`);
      return null;
    } catch (error) {
      this.oauthSessionCache.delete(did);
      this.restoreFailures.set(
        did,
        isTerminalRestoreError(error) ? 'terminal' : 'other',
      );
      console.warn(
        `[oauth] could not restore the session for ${did}: ${errorText(error)}`,
      );
      return null;
    }
  }

  /** How the DID's last restore on this instance failed ('terminal', 'other', 'dead'), or undefined. */
  lastRestoreFailure(did) {
    return this.restoreFailures.get(did);
  }

  /**
   * After a whole retry budget failed: if the last try was the grant itself
   * refusing (not a network or store failure, and not a lost refresh race,
   * which a later try would have won), remember the stored grant as dead.
   * Returns whether it did.
   */
  async noteDeadGrant(did) {
    if (this.restoreFailures.get(did) !== 'terminal') return false;
    const stored = await this.storage.sessionStore.read(did);
    this.deadGrants.set(did, grantFingerprint(stored));
    console.warn(
      `[oauth] the grant for ${did} is refused; answering without a restore until it changes`,
    );
    return true;
  }

  /** Whether the grant stored for `did` is one already found dead. Reads the row only when one was. */
  async isKnownDeadGrant(did) {
    const dead = this.deadGrants.get(did);
    if (dead === undefined) return false;
    const stored = await this.storage.sessionStore.read(did);
    if (grantFingerprint(stored) === dead) return true;
    this.deadGrants.delete(did);
    return false;
  }

  /** The same, for a row the caller has already read (the lite session check). */
  isDeadGrantSession(did, session) {
    const dead = this.deadGrants.get(did);
    return dead !== undefined && grantFingerprint(session) === dead;
  }

  /** Forget a DID's cached session (after a terminal "Invalid token" or a sign-out). */
  evictSession(did) {
    this.oauthSessionCache.delete(did);
  }

  /**
   * Revoke the grant at the authorization server: signOut() on a restored
   * session, else the library's revoke(). Returns whether it went through.
   */
  async revokeSession(did) {
    const client = await this.ensureInitialized();
    this.oauthSessionCache.delete(did);
    try {
      const session = await client.restore(did);
      if (session) {
        try {
          await session.signOut();
        } catch (error) {
          console.warn(
            `[oauth] signOut failed for ${did} (${errorText(error)}); revoking directly`,
          );
          await client.revoke(did);
        }
      } else {
        await client.revoke(did);
      }
      return true;
    } catch (error) {
      console.warn(
        `[oauth] could not revoke the grant for ${did}: ${errorText(error)}`,
      );
      return false;
    }
  }

  getClientMetadata() {
    return clientMetadata(this.env);
  }

  /** The public keys (the library leaves `d` undefined, so it drops out of JSON). */
  async getJWKS() {
    const client = await this.ensureInitialized();
    return client.jwks;
  }
}

let wrapper = null;

/**
 * This instance's OAuth client, built on first use. A start-up failure is
 * logged once here and reaches only the callers that need the client, as a
 * throw from the method they called.
 */
export function getOAuthClient() {
  if (!wrapper) {
    wrapper = new OAuthClientWrapper();
    wrapper.initPromise.catch(() => {
      // Logged by initialize(); kept from being an unhandled rejection.
    });
  }
  return wrapper;
}

/** Tests only: forget the client and the stores, so the next call builds both from the current env. */
export function resetOAuthForTests() {
  wrapper = null;
  resetStorageForTests();
}
