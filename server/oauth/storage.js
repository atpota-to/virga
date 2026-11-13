// The OAuth client's stores, on Supabase:
//
//   oauth_sessions     the library's session per DID (tokens, DPoP key)
//   oauth_state        the library's in-flight authorization state, for 1 h
//   frontend_sessions  the browser's opaque `vg_` tokens, one per sign-in per device
//   oauth_locks        the cross-instance refresh lock (acquire/release RPCs)
//
// Every operation asks getSupabaseClient() afresh, so the test seam works and
// an unconfigured deployment degrades instead of throwing at import.

import crypto from 'node:crypto';
import { getSupabaseClient } from '../supabase.js';
import { TtlCache } from '../ttlCache.js';
import { envInt } from '../env.js';
import { TOKEN_PATTERN, TOKEN_PREFIX } from './config.js';
import { encryptSession, decryptSession } from './sessionCrypto.js';
import { createRequestLock, prefetchedSession } from './lockFastPath.js';

export const TABLES = Object.freeze({
  sessions: 'oauth_sessions',
  state: 'oauth_state',
  frontend: 'frontend_sessions',
});

const DAY_MS = 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 60 * 60 * 1000;
const TOKEN_DAYS = 30;
// A validated token with fewer than this many days left is renewed to
// SLIDE_TO_MS from now, at most once a day per token per instance.
const SLIDE_WHEN_LEFT_MS = 7 * DAY_MS;
const SLIDE_TO_MS = TOKEN_DAYS * DAY_MS;
// How long the session store remembers a DID's granted scope and PDS, for
// /api/oauth/session to name without a read of its own. Longer than the
// OAuth session cache, so a restore served from that cache still has a note.
const SESSION_NOTE_TTL_MS = 10 * 60 * 1000;
const VALIDATE_RETRIES = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** An http(s) origin plus optional path, with no credentials, query or fragment; else null. */
export function normalizePds(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

const errorText = (error) =>
  (error && (error.message || error.code)) || String(error);

/**
 * The library's session store (NodeSavedSessionStore), keyed by DID.
 *
 * Each read and write also notes the session's PDS (its token set's audience)
 * and granted scope, which /api/oauth/session reports without a read of its
 * own.
 */
export class SessionStore {
  constructor({ table = TABLES.sessions } = {}) {
    this.table = table;
    this.notes = new TtlCache({ ttlMs: SESSION_NOTE_TTL_MS, max: 10000 });
  }

  /** Note what a read or write says about the session; never throws. */
  noteSession(sub, session) {
    try {
      const tokenSet = session && session.tokenSet;
      if (!sub || !tokenSet || (tokenSet.sub && tokenSet.sub !== sub)) return;
      const pds = normalizePds(tokenSet.aud);
      const scope = typeof tokenSet.scope === 'string' ? tokenSet.scope : null;
      this.notes.set(sub, { pds, scope });
    } catch {
      // The note is an extra; the store's own work must not depend on it.
    }
  }

  /** The granted scope last seen for `sub` on this instance, or null. */
  scopeFor(sub) {
    return this.notes.get(sub)?.scope || null;
  }

  /** The PDS last seen for `sub` on this instance, or null. */
  pdsFor(sub) {
    return this.notes.get(sub)?.pds || null;
  }

  async set(sub, session) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured');
    // Before the write: a refresh or a sign-in names the PDS as it saves.
    this.noteSession(sub, session);
    const { error } = await supabase
      .from(this.table)
      .upsert(
        {
          sub,
          session_data: encryptSession(session),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'sub' },
      );
    if (error) {
      console.error(
        `[oauth] could not save the session for ${sub}: ${errorText(error)}`,
      );
      throw error;
    }
  }

  async get(sub) {
    // On the lock fast path the row was read a moment ago to choose the path;
    // hand the library that read.
    const prefetched = prefetchedSession(sub);
    if (prefetched !== undefined) return prefetched;
    return this.read(sub);
  }

  /** A read of the stored row, ignoring any prefetched value. Undefined when there is none or it can't be read. */
  async read(sub) {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return undefined;
      const { data, error } = await supabase
        .from(this.table)
        .select('session_data')
        .eq('sub', sub)
        .single();
      if (error) {
        if (error.code !== 'PGRST116')
          console.error(
            `[oauth] could not read the session for ${sub}: ${errorText(error)}`,
          );
        return undefined;
      }
      const session = decryptSession(data?.session_data);
      this.noteSession(sub, session);
      return session;
    } catch (error) {
      console.error(
        `[oauth] could not read the session for ${sub}: ${errorText(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Deliberately a no-op. The library deletes a session when a refresh
   * fails, but on serverless many of those failures are transient (another
   * instance may have just refreshed it), and deleting the row would end a
   * grant that still works. A grant that is really dead keeps failing until
   * the account signs in again; only an explicit logout removes it
   * (forceDelete).
   */
  async del(sub) {
    console.log(
      `[oauth] kept the session for ${sub} after the library asked to delete it`,
    );
  }

  /** Really delete a DID's session: sign-out of its last device. */
  async forceDelete(sub) {
    this.notes.delete(sub);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return false;
      const { error } = await supabase.from(this.table).delete().eq('sub', sub);
      if (error) {
        console.error(
          `[oauth] could not delete the session for ${sub}: ${errorText(error)}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error(
        `[oauth] could not delete the session for ${sub}: ${errorText(error)}`,
      );
      return false;
    }
  }
}

/** The library's state store: one row per authorization in flight, for an hour. */
export class StateStore {
  constructor({ table = TABLES.state } = {}) {
    this.table = table;
  }

  async set(key, state) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured');
    const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
    const { error } = await supabase
      .from(this.table)
      .upsert(
        { key, state_data: state, expires_at: expiresAt },
        { onConflict: 'key' },
      );
    if (error) {
      console.error(
        `[oauth] could not save sign-in state: ${errorText(error)}`,
      );
      throw error;
    }
  }

  async get(key) {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return undefined;
      const { data, error } = await supabase
        .from(this.table)
        .select('state_data, expires_at')
        .eq('key', key)
        .single();
      if (error) {
        if (error.code !== 'PGRST116')
          console.error(
            `[oauth] could not read sign-in state: ${errorText(error)}`,
          );
        return undefined;
      }
      if (data && new Date(data.expires_at) < new Date()) {
        await this.del(key);
        return undefined;
      }
      return data?.state_data;
    } catch (error) {
      console.error(
        `[oauth] could not read sign-in state: ${errorText(error)}`,
      );
      return undefined;
    }
  }

  async del(key) {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase.from(this.table).delete().eq('key', key);
      if (error)
        console.error(
          `[oauth] could not delete sign-in state: ${errorText(error)}`,
        );
    } catch (error) {
      console.error(
        `[oauth] could not delete sign-in state: ${errorText(error)}`,
      );
    }
  }
}

/**
 * The browser's session tokens: `vg_` + 64 hex, each naming a DID for 30
 * days, renewed while in use. A token is opaque and maps to one DID for its
 * whole life, so validated tokens are cached per instance; a sign-out on
 * another instance is honoured within FRONTEND_SESSION_CACHE_TTL_MS.
 */
export class FrontendSessionStore {
  constructor({
    table = TABLES.frontend,
    cacheTtlMs = envInt(process.env, 'FRONTEND_SESSION_CACHE_TTL_MS', 60000),
  } = {}) {
    this.table = table;
    this.tokenDidCache = new TtlCache({ ttlMs: cacheTtlMs, max: 10000 });
    // token -> when this instance last renewed it
    this.slidAt = new TtlCache({ ttlMs: DAY_MS, max: 10000 });
  }

  /** Whether a string has the shape of one of these tokens. One that doesn't is answered as not found, with no read. */
  ownsToken(token) {
    return typeof token === 'string' && TOKEN_PATTERN.test(token);
  }

  generateToken() {
    return TOKEN_PREFIX + crypto.randomBytes(32).toString('hex');
  }

  /** A new token for `userDid`; throws when it can't be stored. */
  async create(userDid, expiresInDays = TOKEN_DAYS) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured');
    const token = this.generateToken();
    const expiresAt = new Date(
      Date.now() + expiresInDays * DAY_MS,
    ).toISOString();
    const { error } = await supabase
      .from(this.table)
      .insert({ token, user_did: userDid, expires_at: expiresAt });
    if (error) {
      console.error(
        `[oauth] could not create a session token for ${userDid}: ${errorText(error)}`,
      );
      throw error;
    }
    return token;
  }

  /**
   * The DID a token names. The answer keeps "no such token" apart from "the
   * store can't say", because the client treats only the first as signed out:
   *
   *   { userDid, error: null }    valid
   *   { userDid: null, error: null }    not found or expired (definitive)
   *   { userDid: null, error: <code> }  transient; the caller should retry
   */
  async validateWithDetails(token) {
    if (!this.ownsToken(token)) return { userDid: null, error: null };

    const cached = this.tokenDidCache.get(token);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        await this.slideIfDue(token, cached.userDid, cached.expiresAt);
        return { userDid: cached.userDid, error: null };
      }
      // Expired: fall through to a definitive read.
      this.tokenDidCache.delete(token);
    }

    for (let attempt = 0; attempt <= VALIDATE_RETRIES; attempt++) {
      try {
        if (attempt > 0) await sleep(300 * attempt);
        const supabase = getSupabaseClient();
        if (!supabase) {
          if (attempt < VALIDATE_RETRIES) continue;
          return { userDid: null, error: 'SUPABASE_UNAVAILABLE' };
        }
        const { data, error } = await supabase
          .from(this.table)
          .select('user_did, expires_at')
          .eq('token', token)
          .single();
        if (error) {
          if (error.code === 'PGRST116') return { userDid: null, error: null };
          console.error(
            `[oauth] token read failed (attempt ${attempt + 1}): ${errorText(error)}`,
          );
          if (attempt < VALIDATE_RETRIES) continue;
          return { userDid: null, error: 'QUERY_ERROR' };
        }
        const expiresAt = new Date(data.expires_at).getTime();
        if (!(expiresAt > Date.now())) {
          await this.deleteToken(token);
          return { userDid: null, error: null };
        }
        this.tokenDidCache.set(token, { userDid: data.user_did, expiresAt });
        await this.slideIfDue(token, data.user_did, expiresAt);
        return { userDid: data.user_did, error: null };
      } catch (error) {
        console.error(
          `[oauth] token read threw (attempt ${attempt + 1}): ${errorText(error)}`,
        );
        if (attempt < VALIDATE_RETRIES) continue;
        return { userDid: null, error: 'EXCEPTION' };
      }
    }
    return { userDid: null, error: 'MAX_RETRIES_EXCEEDED' };
  }

  /**
   * Renew a token with fewer than seven days left to thirty days from now, at
   * most once a day per token on this instance. Best effort: a failed renewal
   * leaves the token valid until its old expiry.
   */
  async slideIfDue(token, userDid, expiresAt) {
    const now = Date.now();
    if (expiresAt - now >= SLIDE_WHEN_LEFT_MS) return;
    if (this.slidAt.get(token)) return;
    this.slidAt.set(token, now);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const renewed = now + SLIDE_TO_MS;
      const { error } = await supabase
        .from(this.table)
        .update({ expires_at: new Date(renewed).toISOString() })
        .eq('token', token)
        .eq('user_did', userDid);
      if (error) {
        console.warn(
          `[oauth] could not renew a session token: ${errorText(error)}`,
        );
        return;
      }
      this.tokenDidCache.set(token, { userDid, expiresAt: renewed });
    } catch (error) {
      console.warn(
        `[oauth] could not renew a session token: ${errorText(error)}`,
      );
    }
  }

  /**
   * Delete one token.
   * @returns {Promise<boolean>} whether the delete went through (a token of the wrong shape counts as gone)
   */
  async deleteToken(token) {
    this.tokenDidCache.delete(token);
    this.slidAt.delete(token);
    if (!this.ownsToken(token)) return true;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return false;
      const { error } = await supabase
        .from(this.table)
        .delete()
        .eq('token', token);
      if (error) {
        console.error(
          `[oauth] could not delete a session token: ${errorText(error)}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error(
        `[oauth] could not delete a session token: ${errorText(error)}`,
      );
      return false;
    }
  }

  /**
   * How many unexpired tokens the DID still has.
   * @returns {Promise<number|null>} null when the count couldn't be read
   */
  async countForUser(userDid) {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return null;
      const { count, error } = await supabase
        .from(this.table)
        .select('token', { count: 'exact', head: true })
        .eq('user_did', userDid)
        .gt('expires_at', new Date().toISOString());
      if (error) {
        console.error(
          `[oauth] could not count session tokens for ${userDid}: ${errorText(error)}`,
        );
        return null;
      }
      return typeof count === 'number' ? count : null;
    } catch (error) {
      console.error(
        `[oauth] could not count session tokens for ${userDid}: ${errorText(error)}`,
      );
      return null;
    }
  }
}

/**
 * Serializes one key within an instance. Polls every 10 ms; not FIFO, which
 * is fine for the handful of requests one account makes at once.
 */
export class MemoryLock {
  constructor() {
    this.locks = new Map();
  }

  async lock(key, fn) {
    while (this.locks.has(key)) await sleep(10);
    this.locks.set(key, true);
    try {
      return await fn();
    } finally {
      this.locks.delete(key);
    }
  }
}

/**
 * The cross-instance lock, over oauth_locks. Concurrent requests for one
 * account land on different serverless instances, and refresh tokens are
 * single-use and rotating: two instances refreshing at once get the session
 * revoked as a replay. The library takes requestLock around every token
 * lookup, so wrapping that with this lock means one instance refreshes at a
 * time; the rest wait, then read the winner's rotated tokens.
 *
 * Fail-open: with Supabase unavailable, an RPC error, or no lock within
 * maxWaitMs, fn() runs anyway. A rare double refresh is better than blocking
 * every request, and the wait itself usually lets a loser read fresh tokens.
 */
export class SupabaseLock {
  constructor({
    ttlSeconds = 20,
    maxWaitMs = 6000,
    pollMinMs = 75,
    pollMaxMs = 250,
  } = {}) {
    // The TTL frees the lock if a holder dies; the wait stays well inside a function's maxDuration.
    this.ttlSeconds = ttlSeconds;
    this.maxWaitMs = maxWaitMs;
    this.pollMinMs = pollMinMs;
    this.pollMaxMs = pollMaxMs;
  }

  async lock(key, fn) {
    const supabase = getSupabaseClient();
    if (!supabase) return fn();

    const holder = crypto.randomUUID();
    const deadline = Date.now() + this.maxWaitMs;
    let acquired = false;

    while (Date.now() < deadline) {
      try {
        const { data, error } = await supabase.rpc('acquire_oauth_lock', {
          p_key: key,
          p_holder: holder,
          p_ttl_seconds: this.ttlSeconds,
        });
        if (error) {
          console.warn(
            `[oauth] lock acquire failed (${errorText(error)}); going on without it`,
          );
          break;
        }
        if (data === true) {
          acquired = true;
          break;
        }
      } catch (error) {
        console.warn(
          `[oauth] lock acquire threw (${errorText(error)}); going on without it`,
        );
        break;
      }
      const jitter =
        this.pollMinMs +
        Math.floor(Math.random() * (this.pollMaxMs - this.pollMinMs));
      await sleep(jitter);
    }

    try {
      return await fn();
    } finally {
      if (acquired) {
        try {
          await supabase.rpc('release_oauth_lock', {
            p_key: key,
            p_holder: holder,
          });
        } catch (error) {
          // The TTL expires it anyway.
          console.warn(
            `[oauth] lock release failed (${errorText(error)}); it expires by itself`,
          );
        }
      }
    }
  }
}

/**
 * The stores and the refresh lock, as NodeOAuthClient takes them.
 *
 * The lock is two tiers: the in-process lock collapses same-instance
 * concurrency to at most one cross-instance acquisition per key, and the
 * cross-instance lock serializes the refresh across serverless instances.
 * `fastPath.armed` is set by the client wrapper once its hooks are in
 * (client.js); until then every lookup takes the full lock.
 */
export function createStorage() {
  const sessionStore = new SessionStore();
  const stateStore = new StateStore();
  const frontendSessionStore = new FrontendSessionStore();
  const memoryLock = new MemoryLock();
  const distributedLock = new SupabaseLock();
  const fastPath = { armed: false };
  const lock = (key, fn) =>
    memoryLock.lock(key, () => distributedLock.lock(key, fn));
  return {
    sessionStore,
    stateStore,
    frontendSessionStore,
    memoryLock,
    distributedLock,
    fastPath,
    lock,
    requestLock: createRequestLock({
      lock,
      readSession: (sub) => sessionStore.read(sub),
      isArmed: () => fastPath.armed,
    }),
  };
}

let storage = null;

/** This instance's stores, built on first use. */
export function getStorage() {
  if (!storage) storage = createStorage();
  return storage;
}

/** Tests only: forget the stores (and with them every per-instance cache). */
export function resetStorageForTests() {
  storage = null;
}
