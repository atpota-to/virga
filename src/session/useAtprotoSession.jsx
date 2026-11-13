import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AUTH_MODE, BACKEND_URL, OAUTH_CALLBACK_PATH, OAUTH_RETURN_PATH } from '../config.js';
import { getProfile } from '../lib/atproto.js';
import { resetAnalyticsStore } from '../lib/analyticsStore.js';
import { readSessionHint, restoresAtStartup } from '../lib/sessionHint.js';
import * as A from './accounts.js';
import * as B from './backendClient.js';
import { createBrowserDriver } from './browserDriver.js';
import { rememberPdsUrl, resolvePdsUrl } from './pds.js';
import { NO_ACTIVE, capabilitiesFrom, createSessionController } from './sessionController.js';

// The session layer: every account this browser has signed in with, which
// one is open, and an atproto Agent for any of them. Two kinds of sign-in
// live side by side, each account keeping the one it signed in with:
//
//   browser   atproto OAuth in this browser (src/session/browserDriver.js)
//   backend   a long session held by Virga's server (src/session/backendClient.js)
//
// This is the only module the app imports for auth; the harness swaps it
// for harness/fakeSession.jsx, which has to offer the same value.

const Ctx = createContext(null);

function local() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function perTab() {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function onPath(prefix) {
  return typeof window !== 'undefined' && window.location.pathname.startsWith(prefix);
}

// A return from Virga's server is read, checked against this tab's nonce
// and taken out of the address once, as the module loads: under StrictMode
// an effect runs twice, and the second run would see a clean address (or,
// worse, a token still in it). Whatever came back, the pending sign-in is
// over.
const BACKEND_RETURN = (() => {
  if (typeof window === 'undefined' || !onPath(OAUTH_RETURN_PATH)) return null;
  const pending = B.readSigninPending(perTab());
  const result = B.readBackendReturn(window.location, pending, OAUTH_RETURN_PATH);
  B.clearSigninPending(perTab());
  if (window.location.search || window.location.hash) B.stripReturnFromAddress(window);
  return result;
})();

let agentModule = null;
function loadAgentClass() {
  agentModule ||= import('@atproto/api').then((m) => m.Agent);
  agentModule.catch(() => {
    agentModule = null;
  });
  return agentModule;
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(false);
    let done = false;
    const finish = (ok) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => finish(true);
      req.onerror = () => finish(false);
      // Another tab holding the database open delays the delete until it
      // lets go; don't hold the page up for it.
      req.onblocked = () => setTimeout(() => finish(false), 5_000);
    } catch {
      finish(false);
    }
  });
}

/** The real world, for the controller. */
function browserEnv() {
  return {
    storage: local(),
    tabStorage: perTab(),
    browser: createBrowserDriver(),
    backendUrl: BACKEND_URL,
    fetch: undefined,
    loadAgent: loadAgentClass,
    backendReturn: BACKEND_RETURN,
    onCallbackPath: onPath(OAUTH_CALLBACK_PATH),
    authMode: AUTH_MODE,
    getProfile,
    resolvePdsUrl,
    rememberPdsUrl,
    resetAnalyticsStore,
    deleteDatabase,
    dispatch: (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail })),
    origin: () => window.location.origin,
    assign: (url) => window.location.assign(url),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/**
 * Provides the session layer. The value:
 *
 *   session, agent, did   the open account, always published together
 *   loading               only while the app starts or a sign-in is finished
 *   switching             the DID being switched to, while the old one stays up
 *   error                 a sign-in that came back without a session
 *   signIn, signOut, mode, accounts, switchAccount, signOutAccount,
 *   removeAccount, agentFor, targetFor, backendFor, capabilitiesFor,
 *   checkAccount, authMode
 */
export function AtprotoSessionProvider({ children }) {
  const [rows, setRows] = useState(() => A.readAccounts(local()));
  const [statuses, setStatuses] = useState({});
  const [active, setActive] = useState(NO_ACTIVE);
  const [switching, setSwitching] = useState(null);
  const [error, setError] = useState(null);
  const [ctrl] = useState(() =>
    createSessionController(
      { rows: setRows, statuses: setStatuses, active: setActive, switching: setSwitching, error: setError },
      browserEnv(),
    ),
  );
  // Whether there is anything to restore. Decided once, as the app starts.
  const [restoreWanted] = useState(() =>
    restoresAtStartup({
      hint: readSessionHint(local()),
      onCallback: onPath(OAUTH_CALLBACK_PATH),
      onReturn: BACKEND_RETURN !== null,
      hasAccounts: A.signedInAccounts(A.readAccounts(local())).length > 0,
    }),
  );
  const [loading, setLoading] = useState(restoreWanted);

  useEffect(() => {
    // A visitor who has never signed in loads none of the session stack.
    if (!restoreWanted) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    ctrl.startOnce().then(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [ctrl, restoreWanted]);

  // Another tab signed an account in or out: the list here follows.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === A.ACCOUNTS_KEY || event.key === null) ctrl.reread();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [ctrl]);

  const signIn = useCallback((input, opts) => ctrl.signIn(input, opts), [ctrl]);
  const switchAccount = useCallback((did) => ctrl.switchAccount(did), [ctrl]);
  const signOutAccount = useCallback((did) => ctrl.signOutAccount(did), [ctrl]);
  const removeAccount = useCallback((did, opts) => ctrl.removeAccount(did, opts), [ctrl]);
  const agentFor = useCallback((did) => ctrl.agentFor(did), [ctrl]);
  const targetFor = useCallback((did) => ctrl.targetFor(did), [ctrl]);
  const checkAccount = useCallback((did) => ctrl.checkAccount(did), [ctrl]);
  const signOut = useCallback(async () => {
    if (active.did) await ctrl.signOutAccount(active.did);
  }, [ctrl, active.did]);

  const accounts = useMemo(
    () =>
      rows.map((r) => ({
        did: r.did,
        handle: r.handle,
        displayName: r.displayName,
        avatar: r.avatar,
        mode: r.mode,
        lastUsed: r.lastUsed,
        status: ctrl.statusOf(r.did),
      })),
    // statuses is read through ctrl.statusOf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, statuses, ctrl],
  );

  // Recomputed when the list or a status changes, so a caller holding the
  // old function doesn't read a stale grant.
  const backendFor = useCallback((did) => ctrl.backendFor(did), [ctrl, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const capabilitiesFor = useCallback(
    (did) => {
      const row = rows.find((r) => r.did === did) || null;
      return capabilitiesFrom(row, row ? ctrl.statusOf(did) : 'needsSignIn');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, statuses, ctrl],
  );

  const value = useMemo(
    () => ({
      session: active.session,
      agent: active.agent,
      did: active.did,
      loading,
      switching,
      error,
      signIn,
      signOut,
      mode: active.mode,
      accounts,
      switchAccount,
      signOutAccount,
      removeAccount,
      agentFor,
      targetFor,
      backendFor,
      capabilitiesFor,
      checkAccount,
      authMode: AUTH_MODE,
    }),
    [active, loading, switching, error, signIn, signOut, accounts, switchAccount, signOutAccount, removeAccount, agentFor, targetFor, backendFor, capabilitiesFor, checkAccount],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAtprotoSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAtprotoSession must be used inside <AtprotoSessionProvider>');
  return v;
}
