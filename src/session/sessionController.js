// The session layer's workings, apart from React: which account is open,
// how each account's agent is built (src/session/browserDriver.js for a
// browser session, src/session/backendClient.js for a long one), switching,
// signing in and out, and noticing a sign-in that has ended. The provider in
// useAtprotoSession.jsx holds the state; this decides what goes in it.

import { OAUTH_RETURN_PATH, OAUTH_SCOPE, POSTING_TOKENS } from '../config.js';
import { readSessionHint, syncSessionHint, writeSessionHint } from '../lib/sessionHint.js';
import { SESSION_NOTICE_EVENT } from '../accounts/accountCopy.js';
import { missingScopes } from './scopes.js';
import * as A from './accounts.js';
import * as B from './backendClient.js';
import * as H from './sessionHealth.js';

export const NO_ACTIVE = { did: null, agent: null, session: null, mode: null };

// The 401 codes the server gives when the token is good but the account's
// grant couldn't be restored (revoked at the PDS, or a refresh that died).
const GRANT_GONE_CODES = new Set(['OAUTH_SESSION_MISSING', 'SESSION_EXPIRED']);

/**
 * What an account can do here, from its row and its status:
 * `{ mode, canPost, canSchedule, canUseAi, missing }`. `missing` lists the
 * tokens Virga asks for that the session wasn't granted (well-formed ones
 * only). A grant nobody has read yet is taken to be enough; a write that
 * fails for want of it then asks for a fresh sign-in (scopes.js
 * isMissingScopeError). Scheduling and the adviser run on Virga's server,
 * so they need a long session that still holds.
 */
export function capabilitiesFrom(row, status) {
  const mode = row?.mode || null;
  const live = Boolean(row) && status !== 'needsSignIn';
  const granted = typeof row?.scope === 'string' ? row.scope : null;
  const missing = granted == null ? [] : missingScopes(granted, OAUTH_SCOPE);
  const postingGranted = granted == null || missingScopes(granted, POSTING_TOKENS).length === 0;
  const longSession = mode === 'backend' && live;
  return { mode, canPost: live && postingGranted, canSchedule: longSession, canUseAi: longSession, missing };
}

/**
 * Everything that isn't React state: the drivers, the agents built for
 * accounts that aren't open, the session checks. `set` is the provider's
 * state setters (`rows`, `statuses`, `active`, `switching`, `error`), which
 * are stable. `env` is the world outside, passed in so the tests can stand
 * in for it:
 *
 *   storage, tabStorage   localStorage and sessionStorage (or null)
 *   browser               src/session/browserDriver.js's driver
 *   backendUrl, fetch     Virga's server, and the fetch to reach it with
 *   loadAgent             () => Promise<Agent class>
 *   backendReturn         readBackendReturn's result for this page load
 *   onCallbackPath        whether this load is a browser sign-in's callback
 *   authMode              the mode for new sign-ins
 *   getProfile, resolvePdsUrl, rememberPdsUrl, resetAnalyticsStore,
 *   deleteDatabase, dispatch(name, detail), origin(), assign(url), sleep(ms)
 */
export function createSessionController(set, env) {
  const { browser } = env;
  const agents = new Map(); // did -> Promise<Agent>, for accounts other than the open one
  const built = new Map(); // did -> { mode, token }, what each account's agent was built from
  const browserSessions = new Map(); // did -> OAuthSession
  const requesters = new Map(); // did -> { token, requester }
  const signingOut = new Set(); // dids whose session this tab is ending on purpose
  const lastRecovery = new Map(); // did -> ms of the last forced check
  // Long sessions whose grant the server last said it couldn't restore. The
  // lite check only reads the grant's row, which outlives a refresh token
  // that has died, so its "valid" can't clear this: only a full check or an
  // answer that came back through the grant can.
  const grantGone = new Set();
  const learning = new Map(); // did -> the full check under way
  let active = NO_ACTIVE;
  let statuses = {};
  let switchSeq = 0;
  let started = null;

  const rows = () => A.readAccounts(env.storage);
  const find = (did) => A.findAccount(rows(), did);

  function refreshRows() {
    const list = rows();
    syncSessionHint(env.storage, list);
    set.rows(list);
    return list;
  }

  function setStatus(did, status) {
    if (statuses[did] === status) return;
    statuses = { ...statuses, [did]: status };
    set.statuses(statuses);
  }

  function clearStatus(did) {
    if (!(did in statuses)) return;
    const next = { ...statuses };
    delete next[did];
    statuses = next;
    set.statuses(statuses);
  }

  function statusOf(did) {
    const account = find(did);
    if (!account || account.signedOut) return 'needsSignIn';
    if (account.mode === 'backend' && !A.readBackendToken(env.storage, did)) return 'needsSignIn';
    return statuses[did] || 'ready';
  }

  function forgetBuilt(did) {
    built.delete(did);
    agents.delete(did);
    requesters.delete(did);
    browserSessions.delete(did);
    grantGone.delete(did);
    backendChecker.forget(did);
    browserChecker.forget(did);
  }

  function publish(next) {
    active = next;
    set.active(next);
  }

  /**
   * An account that can't be used again without a new sign-in. Its row is
   * kept (signed out) and its token dropped. `discovered` is false when this
   * tab ended the session itself; only a discovered death sends the open
   * account's reader to sign in again (SessionNotices listens).
   */
  function markNeedsSignIn(did, { discovered = true } = {}) {
    const store = env.storage;
    A.markSignedOut(store, did);
    A.removeBackendToken(store, did);
    forgetBuilt(did);
    setStatus(did, 'needsSignIn');
    refreshRows();
    if (discovered) env.dispatch(A.SESSION_EXPIRED_EVENT, { did });
  }

  /**
   * A 401 from the server: maybe dead, maybe a cold start. Confirm before
   * acting (sessionHealth.js), and not more than once every ten seconds.
   * One that says the grant couldn't be restored is about the grant, not the
   * token, which the lite check can't see into: that one is asked of the full
   * check, and the account is shown as unknown (which offers a sign-in) until
   * something says the grant holds again.
   */
  function onUnauthorized(did, code = null) {
    if (GRANT_GONE_CODES.has(code) && usable(did)) {
      grantGone.add(did);
      setStatus(did, 'unknown');
    }
    const at = lastRecovery.get(did) || 0;
    if (Date.now() - at < 10_000) return;
    lastRecovery.set(did, Date.now());
    if (GRANT_GONE_CODES.has(code)) learnBackendSession(did).catch(() => {});
    else backendChecker.check(did, { force: true }).catch(() => {});
  }

  // An answer that came back through the grant: it holds after all.
  function onAuthorized(did) {
    if (grantGone.delete(did) && statuses[did] === 'unknown') setStatus(did, 'ready');
  }

  function settleCheck(did, result) {
    const status = H.statusFromCheck(result);
    if (status === 'needsSignIn') {
      if (!find(did)?.signedOut) markNeedsSignIn(did);
    } else if (status === 'ready' && grantGone.has(did)) {
      setStatus(did, 'unknown');
    } else setStatus(did, status);
  }

  const backendChecker = H.createSessionChecker({
    async probe(did) {
      const token = A.readBackendToken(env.storage, did);
      if (!token) return { status: H.SESSION_CHECK_STATUS.EXPIRED, definitive: false };
      return H.interpretLiteSessionResponse(await B.checkBackendSession({ backendUrl: env.backendUrl, fetch: env.fetch, token }));
    },
    onResult: settleCheck,
    sleep: env.sleep,
  });

  // A browser session is read from this browser's own store, so its answer
  // needs no confirming: a session the library can't restore is gone.
  const browserChecker = H.createSessionChecker({
    rounds: 1,
    async probe(did) {
      try {
        const session = browserSessions.get(did) || (await browser.restore(did));
        browserSessions.set(did, session);
        return { status: H.SESSION_CHECK_STATUS.VALID, definitive: false };
      } catch (err) {
        return err?.restoreFailure === 'expired'
          ? { status: H.SESSION_CHECK_STATUS.EXPIRED, definitive: true }
          : { status: H.SESSION_CHECK_STATUS.UNKNOWN, definitive: false };
      }
    },
    onResult: settleCheck,
    sleep: env.sleep,
  });

  // The token is read at each request, not kept: another tab that signs the
  // account in again replaces it, and an agent holding the old one would
  // fail every call while the account looked fine.
  const tokenReader = (did) => () => A.readBackendToken(env.storage, did);

  function backendAgent(Agent, did) {
    return new Agent({
      did,
      fetchHandler: B.createBackendFetchHandler({ backendUrl: env.backendUrl, fetch: env.fetch, token: tokenReader(did), did, onUnauthorized, onAuthorized }),
    });
  }

  /** Build `{ did, agent, session, mode }` for an account. Throws REAUTH_REQUIRED when only a sign-in will do. */
  async function build(account) {
    const { did } = account;
    const Agent = await env.loadAgent();
    if (account.mode === 'backend') {
      const token = A.readBackendToken(env.storage, did);
      if (!token) throw A.makeReauthRequiredError(did);
      built.set(did, { mode: 'backend', token });
      return { did, agent: backendAgent(Agent, did), session: { sub: did, did, mode: 'backend' }, mode: 'backend' };
    }
    let oauth = browserSessions.get(did);
    if (!oauth) {
      try {
        oauth = await browser.restore(did);
      } catch (err) {
        if (err?.restoreFailure === 'expired') throw Object.assign(A.makeReauthRequiredError(did), { cause: err });
        throw err;
      }
      browserSessions.set(did, oauth);
      browser.grantedScope(oauth).then((scope) => {
        if (scope && find(did)?.scope !== scope) {
          A.updateAccount(env.storage, did, { scope });
          refreshRows();
        }
      });
    }
    built.set(did, { mode: 'browser', token: null });
    return { did, agent: new Agent(oauth), session: { sub: did, did, mode: 'browser', oauth }, mode: 'browser' };
  }

  /**
   * Ask the server what this long session was granted, and where the repo
   * is. This is the check that restores the grant, so it is the one that can
   * tell a grant that has died from one that holds.
   */
  function learnBackendSession(did) {
    if (learning.has(did)) return learning.get(did);
    const p = learnOnce(did).finally(() => learning.delete(did));
    learning.set(did, p);
    return p;
  }

  async function learnOnce(did) {
    const token = A.readBackendToken(env.storage, did);
    if (!token) return;
    const res = await B.fetchBackendSession({ backendUrl: env.backendUrl, fetch: env.fetch, token });
    // Signed in again (or out) while it ran: the answer was about another token.
    if (A.readBackendToken(env.storage, did) !== token) return;
    if (res.ok && res.data?.success) {
      if (typeof res.data.scope === 'string' && find(did)?.scope !== res.data.scope) {
        A.updateAccount(env.storage, did, { scope: res.data.scope });
        refreshRows();
      }
      if (typeof res.data.pds === 'string') env.rememberPdsUrl(did, res.data.pds);
      if (res.data.oauthSessionMissing) grantGone.add(did);
      else grantGone.delete(did);
      setStatus(did, res.data.oauthSessionMissing ? 'unknown' : 'ready');
    } else if (res.status === 401) {
      // About the token (the full check answers a lost grant with a 200):
      // the lite check's rules decide whether it has gone.
      backendChecker.check(did, { force: true }).catch(() => {});
    }
  }

  /** Fill in names and pictures from the public profile, for rows that lack them (and the open one, once). */
  const refreshed = new Set();
  async function refreshDisplay() {
    const list = rows().filter((a) => !refreshed.has(a.did) && (A.needsRefresh(a) || a.did === active.did));
    for (const account of list) {
      refreshed.add(account.did);
      try {
        const p = await env.getProfile(account.did);
        if (!p) continue;
        A.updateAccount(env.storage, account.did, {
          // An account whose handle no longer points at it reads as
          // "handle.invalid", which is no name to keep.
          handle: p.handle && p.handle !== 'handle.invalid' ? p.handle : account.handle,
          displayName: p.displayName?.trim() || null,
          avatar: p.avatar || null,
        });
      } catch {
        refreshed.delete(account.did);
      }
    }
    if (list.length) refreshRows();
  }

  /** Open `account`, publishing its triple in one update. */
  async function open(account) {
    const built = await build(account);
    publish(built);
    const store = env.storage;
    A.writeActiveDid(store, account.did);
    A.touchAccount(store, account.did);
    agents.delete(account.did);
    refreshRows();
    if (built.mode === 'backend') learnBackendSession(account.did).catch(() => {});
    refreshDisplay().catch(() => {});
    return built;
  }

  /** Open the next account that works, starting with `first`; or none. */
  async function openFirstWorking(candidates) {
    for (const account of candidates) {
      try {
        return await open(account);
      } catch (err) {
        if (A.isReauthRequiredError(err)) markNeedsSignIn(account.did, { discovered: false });
        else setStatus(account.did, 'unknown');
      }
    }
    return null;
  }

  async function leave(did) {
    const others = A.signedInAccounts(rows()).filter((a) => a.did !== did && statusOf(a.did) !== 'needsSignIn');
    if (others.length) set.switching(others[0].did);
    try {
      const opened = await openFirstWorking(others);
      if (!opened) {
        publish(NO_ACTIVE);
        A.writeActiveDid(env.storage, null);
      }
    } finally {
      set.switching(null);
    }
  }

  /** Whether `did` can be opened without a sign-in, as far as this browser knows. */
  function usable(did) {
    const account = find(did);
    if (!account || account.signedOut) return false;
    return account.mode !== 'backend' || Boolean(A.readBackendToken(env.storage, did));
  }

  /**
   * Whether a sign-in that just came back should leave the account that was
   * open before it open. Signing another account back in (to post as it from
   * the composer, or from Settings) is for that account's sake: it doesn't
   * switch the app to it. A new account, or the open one signing in again,
   * opens as usual.
   */
  function keepsOpen(intent, did, openBefore) {
    return intent === 'reauth' && Boolean(openBefore) && openBefore !== did && usable(openBefore);
  }

  /**
   * End a long-session token this browser no longer holds, keeping the
   * account's grant. While the token lives the server counts the account as
   * signed in somewhere, so a later sign-out elsewhere wouldn't end the grant;
   * but ending the grant here would be worse: the token may come from a
   * sign-in this browser never asked for (another site can start one), and
   * the grant is what the account's scheduled posts and timers run on. Only
   * a sign-out the reader asks for ends the grant.
   */
  function dropToken(token) {
    if (token) B.backendSignOut({ backendUrl: env.backendUrl, fetch: env.fetch, token, keepGrant: true }).catch(() => {});
  }

  async function start() {
    const store = env.storage;
    let list = rows();
    const openBefore = A.takeOpenAtSignIn(env.tabStorage);

    if (env.backendReturn?.kind === 'error') {
      set.error(env.backendReturn.error);
      dropToken(env.backendReturn.orphanToken);
    }
    if (env.backendReturn?.kind === 'session') {
      const { did, token, intent } = env.backendReturn;
      const before = A.findAccount(list, did);
      const replaced = A.readBackendToken(store, did);
      A.writeBackendToken(store, did, token);
      if (replaced && replaced !== token) dropToken(replaced);
      list = A.recordSignIn(store, { did, mode: 'backend' });
      if (!keepsOpen(intent, did, openBefore)) A.writeActiveDid(store, did);
      H.clearReauthAttempts(env.tabStorage);
      forgetBuilt(did);
      clearStatus(did);
      // The account moved to a long session: end the browser one it had,
      // through the session (client.revoke would clear the library's
      // pointer for whichever account it named).
      if (before?.mode === 'browser') browser.signOut(did).catch(() => {});
    }

    if (env.onCallbackPath) {
      try {
        const done = await browser.finishCallback();
        if (done) {
          const did = done.session.sub;
          const before = A.findAccount(list, did);
          browserSessions.set(did, done.session);
          const scope = await browser.grantedScope(done.session);
          list = A.recordSignIn(store, { did, mode: 'browser', scope: scope ?? undefined });
          if (!keepsOpen(done.intent, did, openBefore)) A.writeActiveDid(store, did);
          clearStatus(did);
          if (before?.mode === 'backend') {
            const token = A.readBackendToken(store, did);
            A.removeBackendToken(store, did);
            dropToken(token);
          }
        }
      } catch (err) {
        set.error(err);
      }
    }

    // A browser that signed in before Virga kept a list of accounts has
    // only the hint and the library's own idea of who is signed in.
    if (!list.length && readSessionHint(store)) {
      try {
        const legacy = await browser.legacySession();
        if (legacy) {
          browserSessions.set(legacy.sub, legacy);
          const scope = await browser.grantedScope(legacy);
          list = A.recordSignIn(store, { did: legacy.sub, mode: 'browser', scope: scope ?? undefined });
          A.writeActiveDid(store, legacy.sub);
        }
      } catch {
        // Tried again next time; the hint stays until the list says otherwise.
        set.rows(list);
        return;
      }
    }

    refreshRows();
    const first = A.pickActiveAccount(list, A.readActiveDid(store));
    if (!first) {
      refreshDisplay().catch(() => {});
      return;
    }
    const rest = A.signedInAccounts(list).filter((a) => a.did !== first.did);
    try {
      await open(first);
      return;
    } catch (err) {
      if (A.isReauthRequiredError(err)) markNeedsSignIn(first.did, { discovered: false });
      else {
        // Couldn't tell (no network): keep the account as it is, try once
        // more in a moment, and don't open a different one behind its back.
        setStatus(first.did, 'unknown');
        await env.sleep(1_500);
        try {
          await open(first);
          return;
        } catch {
          return;
        }
      }
    }
    await openFirstWorking(rest);
    refreshDisplay().catch(() => {});
  }

  function onBrowserSessionDropped(sub, { revoked } = {}) {
    const account = sub ? find(sub) : null;
    if (!account || account.mode !== 'browser') return;
    browserSessions.delete(sub);
    agents.delete(sub);
    if (signingOut.has(sub)) return;
    // Already signed out (another tab marks the row before it ends the
    // session): reread follows that, and there is nothing to sign in again.
    if (account.signedOut) return;
    // Signed out on purpose in another tab: follow it quietly. Anything
    // else (a refresh the server refused) is a session that ended.
    markNeedsSignIn(sub, { discovered: !revoked });
    if (revoked && active.did === sub) leave(sub).catch(() => {});
  }

  /**
   * Another tab changed the list. Follow what it did to the accounts built
   * here: one signed out or removed is left (the open one with a notice, as
   * its archive must not stay on screen), one whose kind of sign-in changed
   * is built again, and one signed back in loses the "signed out" this tab
   * had for it.
   */
  async function followOtherTab(list) {
    for (const account of list) {
      if (statuses[account.did] === 'needsSignIn' && usable(account.did)) {
        clearStatus(account.did);
        forgetBuilt(account.did);
      }
    }
    for (const [did, was] of [...built]) {
      if (did === active.did) continue;
      const row = A.findAccount(list, did);
      if (!row || !usable(did) || row.mode !== was.mode) forgetBuilt(did);
    }

    const did = active.did;
    if (!did || signingOut.has(did)) return;
    const row = A.findAccount(list, did);
    if (!row || !usable(did)) {
      // This tab already knows (it found the session had ended, and is
      // sending its reader to sign in again).
      if (statuses[did] === 'needsSignIn') return;
      forgetBuilt(did);
      clearStatus(did);
      env.dispatch(SESSION_NOTICE_EVENT, {
        text: `${A.reauthNoticeLabel(row || { did })} isn’t signed in here any more: another tab signed it out, or its sign-in ended.`,
        tone: 'info',
      });
      await leave(did);
      return;
    }
    const was = built.get(did);
    if (was && row.mode !== was.mode) {
      // Moved to a long session (or back) in another tab: the session this
      // tab's agent holds has been ended.
      forgetBuilt(did);
      try {
        await open(row);
      } catch (err) {
        if (A.isReauthRequiredError(err)) markNeedsSignIn(did);
        else setStatus(did, 'unknown');
      }
    } else if (was?.mode === 'backend') {
      const token = A.readBackendToken(env.storage, did);
      if (token !== was.token) {
        // Signed in again elsewhere: the agent reads the new token itself,
        // but what this tab thought of the old one no longer holds.
        built.set(did, { mode: 'backend', token });
        backendChecker.forget(did);
        lastRecovery.delete(did);
        grantGone.delete(did);
        clearStatus(did);
      }
    }
  }

  return {
    /**
     * Restore what there is to restore, once however often it's called
     * (StrictMode runs the provider's effect twice). Listens for the browser
     * library's dropped sessions from then on.
     */
    startOnce() {
      if (!started) {
        browser.onDeleted(onBrowserSessionDropped);
        started = start().catch(() => {});
      }
      return started;
    },

    statusOf,

    async switchAccount(did) {
      if (!did || did === active.did) return;
      const account = find(did);
      if (!account) throw new Error('That account isn’t remembered in this browser.');
      if (statusOf(did) === 'needsSignIn') throw A.makeReauthRequiredError(did);
      const seq = ++switchSeq;
      set.switching(did);
      try {
        const built = await build(account);
        if (seq !== switchSeq) return;
        publish(built);
        const store = env.storage;
        A.writeActiveDid(store, did);
        A.touchAccount(store, did);
        agents.delete(did);
        refreshRows();
        if (built.mode === 'backend') learnBackendSession(did).catch(() => {});
        refreshDisplay().catch(() => {});
      } catch (err) {
        if (A.isReauthRequiredError(err)) markNeedsSignIn(did, { discovered: false });
        else setStatus(did, 'unknown');
        throw err;
      } finally {
        if (seq === switchSeq) set.switching(null);
      }
    },

    async signIn(input, { mode = env.authMode, intent = 'add' } = {}) {
      const handle = String(input || '').trim().replace(/^@/, '');
      A.writeOpenAtSignIn(env.tabStorage, intent === 'reauth' ? active.did : null);
      if (mode === 'backend') {
        return B.startBackendSignIn({
          backendUrl: env.backendUrl,
          fetch: env.fetch,
          handle,
          origin: env.origin(),
          returnPath: OAUTH_RETURN_PATH,
          mode,
          intent,
          sessionStorage: env.tabStorage,
          assign: env.assign,
        });
      }
      // Marked before the redirect, so the load after it restores.
      writeSessionHint(env.storage);
      return browser.signIn(handle, { scope: OAUTH_SCOPE, intent });
    },

    async signOutAccount(did) {
      const account = find(did);
      if (!account) return;
      const store = env.storage;
      signingOut.add(did);
      // Marked before the session ends, so another tab that has it open
      // follows the sign-out (reread) instead of reading the dropped session
      // as one that expired and sending its reader to sign in again.
      A.markSignedOut(store, did);
      try {
        if (account.mode === 'backend') {
          const token = A.readBackendToken(store, did);
          // Per device: the server keeps other browsers' sessions. The token
          // goes from this browser whatever the server said.
          await B.backendSignOut({ backendUrl: env.backendUrl, fetch: env.fetch, token });
          A.removeBackendToken(store, did);
        } else {
          await browser.signOut(did, browserSessions.get(did) || null);
        }
      } finally {
        signingOut.delete(did);
      }
      forgetBuilt(did);
      clearStatus(did);
      refreshRows();
      if (active.did === did) await leave(did);
    },

    async removeAccount(did, { deleteData = false } = {}) {
      if (!find(did)) return;
      await this.signOutAccount(did);
      const store = env.storage;
      A.forgetAccount(store, did);
      clearStatus(did);
      refreshed.delete(did);
      if (deleteData) {
        A.removeLocalData(store, did);
        await Promise.all(A.localDatabases(did).map(env.deleteDatabase));
        // The analytics store keeps one connection per account; the deleted
        // database's has gone, so start them all afresh.
        env.resetAnalyticsStore();
      }
      refreshRows();
    },

    async agentFor(did) {
      if (did && did === active.did && active.agent) return active.agent;
      const account = find(did);
      if (!account || statusOf(did) === 'needsSignIn') throw A.makeReauthRequiredError(did);
      if (!agents.has(did)) {
        const p = build(account).then((b) => b.agent);
        agents.set(did, p);
        p.catch((err) => {
          if (agents.get(did) === p) agents.delete(did);
          if (A.isReauthRequiredError(err)) markNeedsSignIn(did);
        });
      }
      return agents.get(did);
    },

    async targetFor(did) {
      const [agent, pdsUrl] = await Promise.all([this.agentFor(did), env.resolvePdsUrl(did)]);
      return { did, agent, pdsUrl };
    },

    backendFor(did) {
      const account = find(did);
      if (!account || account.mode !== 'backend' || account.signedOut) return null;
      const token = A.readBackendToken(env.storage, did);
      if (!token) return null;
      const held = requesters.get(did);
      if (held?.token === token) return held.requester;
      const requester = B.createBackendRequester({ backendUrl: env.backendUrl, fetch: env.fetch, token: tokenReader(did), did, onUnauthorized });
      requesters.set(did, { token, requester });
      return requester;
    },

    async checkAccount(did) {
      const account = find(did);
      if (!account || account.signedOut) return H.SESSION_CHECK_STATUS.EXPIRED;
      const checker = account.mode === 'backend' ? backendChecker : browserChecker;
      const result = await checker.check(did);
      // The same reading settleCheck gives the account's status: an
      // "expired" the server didn't confirm (a cold start, a missing
      // session row) is unknown, not signed out, and so is a grant the
      // server couldn't restore, whatever the lite check says of its row.
      if (result.status === H.SESSION_CHECK_STATUS.EXPIRED && !result.definitive) return H.SESSION_CHECK_STATUS.UNKNOWN;
      if (result.status === H.SESSION_CHECK_STATUS.VALID && grantGone.has(did)) return H.SESSION_CHECK_STATUS.UNKNOWN;
      return result.status;
    },

    /** Another tab changed the account list: read it again, and follow it. */
    reread() {
      return followOtherTab(refreshRows()).catch(() => {});
    },
  };
}

