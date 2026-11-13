// Stand-in for src/session/useAtprotoSession.jsx, swapped in by
// vite.harness.config.js. Presents two made-up accounts from harness/world.js
// as signed in on this browser (Mira, with the full archive, and Field Lab, a
// quiet second account). Each has a fake agent (harness/fakeXrpc.js) that
// answers its signed-in reads and takes its writes; long-session accounts
// also get a requester for Virga's server, the real one from
// src/session/backendClient.js, pointed at the fake server in
// harness/fakeServer.js. Switching between accounts happens in place, as it
// does in the real app.
//
// The real module's exported shape and value are mirrored exactly: if it
// grows an export or a field, this needs the same one. Nothing here ships;
// see harness/README.md for the address flags (harness/harness.js reads them).

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createHarness, readFlags } from './harness.js';
import { SERVER_ORIGIN } from './fakeServer.js';
import { LAB, ME } from './world.js';
import { OAUTH_CALLBACK_PATH } from '../src/config.js';
import { makeReauthRequiredError } from '../src/session/accounts.js';
import { backendSignOut, checkBackendSession, createBackendRequester } from '../src/session/backendClient.js';
import { resolvePdsUrl } from '../src/session/pds.js';
import { capabilitiesFrom } from '../src/session/sessionController.js';
import { confirmSessionDead, interpretLiteSessionResponse, statusFromCheck } from '../src/session/sessionHealth.js';

const Ctx = createContext(null);

const flags = readFlags(window.location.search);
const harness = createHarness(flags);
harness.install();
const { latency } = flags;
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
// Late-bound, so requests go through the fake network installed above.
const fetchNow = (input, init) => window.fetch(input, init);

const expiredAtStart = (id) => Boolean(flags.expired) && id.handle.startsWith(flags.expired);

// Long sessions hold a token from Virga's server, minted as a sign-in would.
const tokens = new Map();
if (flags.mode === 'backend' && !flags.signedOut) {
  for (const id of flags.accounts) if (!expiredAtStart(id)) tokens.set(id.did, harness.server.mintToken(id.did));
}

export function AtprotoSessionProvider({ children }) {
  const declined = window.location.pathname.startsWith(OAUTH_CALLBACK_PATH);
  const signedOutAtStart = flags.signedOut || declined;
  const requesters = useRef(new Map());

  const [rows, setRows] = useState(() =>
    harness.worlds.map((world, i) => ({
      did: world.me.did,
      handle: world.me.handle,
      displayName: world.profile.displayName,
      avatar: world.profile.avatar,
      mode: flags.mode,
      scope: world.scope,
      lastUsed: world.now - i * 86_400_000 * 3,
      status: signedOutAtStart || expiredAtStart(world.me) ? 'needsSignIn' : 'ready',
    })),
  );
  const firstOpen = rows.find((r) => r.status === 'ready');
  const [activeDid, setActiveDid] = useState(firstOpen ? firstOpen.did : null);
  const [switching, setSwitching] = useState(null);

  const find = useCallback((did) => rows.find((r) => r.did === did) || null, [rows]);
  const setStatus = (did, status) =>
    setRows((list) => list.map((r) => (r.did === did ? { ...r, status, lastUsed: status === 'ready' ? Date.now() : r.lastUsed } : r)));

  const signIn = useCallback(async (input) => {
    await sleep(500);
    if (/^nobody/i.test(String(input))) throw new Error(`Failed to resolve identity: ${input}`);
    const id = String(input).replace(/^@/, '') === LAB.handle || input === LAB.did ? LAB : ME;
    if (!harness.worldOf(id.did)) throw new Error(`Failed to resolve identity: ${input}`);
    if (flags.mode === 'backend') tokens.set(id.did, harness.server.mintToken(id.did));
    setStatus(id.did, 'ready');
    setActiveDid(id.did);
  }, []);

  const switchAccount = useCallback(
    async (did) => {
      if (!did || did === activeDid) return;
      const row = find(did);
      if (!row || row.status === 'needsSignIn') throw makeReauthRequiredError(did);
      setSwitching(did);
      await sleep(Math.max(latency * 3, 150));
      setSwitching(null);
      setStatus(did, 'ready');
      setActiveDid(did);
    },
    [activeDid, find],
  );

  const endSession = useCallback(async (did) => {
    const token = tokens.get(did);
    tokens.delete(did);
    requesters.current.delete(did);
    // Per device, as the real one: the server ends the grant only with the last token.
    if (token) await backendSignOut({ backendUrl: SERVER_ORIGIN, token, fetch: fetchNow });
  }, []);

  const signOutAccount = useCallback(
    async (did) => {
      await endSession(did);
      setStatus(did, 'needsSignIn');
      if (did === activeDid) {
        const next = rows.find((r) => r.did !== did && r.status !== 'needsSignIn');
        setActiveDid(next ? next.did : null);
      }
    },
    [activeDid, rows, endSession],
  );

  const removeAccount = useCallback(
    async (did) => {
      await endSession(did);
      setRows((list) => list.filter((r) => r.did !== did));
      if (did === activeDid) {
        const next = rows.find((r) => r.did !== did && r.status !== 'needsSignIn');
        setActiveDid(next ? next.did : null);
      }
    },
    [activeDid, rows, endSession],
  );

  const signOut = useCallback(() => (activeDid ? signOutAccount(activeDid) : Promise.resolve()), [activeDid, signOutAccount]);

  const agentFor = useCallback(
    async (did) => {
      const row = find(did);
      if (!row || row.status === 'needsSignIn') throw makeReauthRequiredError(did);
      return harness.agentFor(did);
    },
    [find],
  );
  const targetFor = useCallback(async (did) => {
    const [agent, pdsUrl] = await Promise.all([agentFor(did), resolvePdsUrl(did)]);
    return { did, agent, pdsUrl };
  }, [agentFor]);

  const liteCheck = useCallback(async (did) => {
    const token = tokens.get(did);
    if (!token) return { status: 'expired', definitive: true };
    return interpretLiteSessionResponse(await checkBackendSession({ backendUrl: SERVER_ORIGIN, token, fetch: fetchNow }));
  }, []);

  // A 401 from the server: confirmed the way the real session layer does
  // (three checks, 2.5 s apart) before the account is shown as signed out.
  const onUnauthorized = useCallback(
    (did) => {
      confirmSessionDead(() => liteCheck(did)).then((verdict) => {
        if (verdict !== 'dead') return;
        tokens.delete(did);
        requesters.current.delete(did);
        setStatus(did, 'needsSignIn');
      });
    },
    [liteCheck],
  );

  const backendFor = useCallback(
    (did) => {
      const row = find(did);
      const token = tokens.get(did);
      if (!row || row.mode !== 'backend' || row.status === 'needsSignIn' || !token) return null;
      const held = requesters.current.get(did);
      if (held?.token === token) return held.requester;
      const requester = createBackendRequester({ backendUrl: SERVER_ORIGIN, token, did, fetch: fetchNow, onUnauthorized });
      requesters.current.set(did, { token, requester });
      return requester;
    },
    [find, onUnauthorized],
  );
  const capabilitiesFor = useCallback(
    (did) => {
      const row = find(did);
      return capabilitiesFrom(row, row ? row.status : 'needsSignIn');
    },
    [find],
  );
  const checkAccount = useCallback(
    async (did) => {
      const row = find(did);
      if (!row || row.status === 'needsSignIn') return 'expired';
      if (row.mode !== 'backend') return 'valid';
      const result = await liteCheck(did);
      if (statusFromCheck(result) === 'needsSignIn') setStatus(did, 'needsSignIn');
      return result.status;
    },
    [find, liteCheck],
  );

  const accounts = useMemo(() => [...rows].sort((a, b) => b.lastUsed - a.lastUsed), [rows]);
  const active = activeDid ? find(activeDid) : null;

  const value = useMemo(
    () => ({
      session: active ? { sub: active.did, did: active.did, mode: active.mode } : null,
      agent: active ? harness.agentFor(active.did) : null,
      did: active?.did || null,
      loading: false,
      switching,
      error: declined
        ? Object.assign(new Error('The user denied the request'), {
            params: new URLSearchParams({ error: 'access_denied' }),
          })
        : null,
      signIn,
      signOut,
      mode: active?.mode || null,
      accounts,
      switchAccount,
      signOutAccount,
      removeAccount,
      agentFor,
      targetFor,
      backendFor,
      capabilitiesFor,
      checkAccount,
      authMode: flags.mode,
    }),
    [active, switching, declined, signIn, signOut, accounts, switchAccount, signOutAccount, removeAccount, agentFor, targetFor, backendFor, capabilitiesFor, checkAccount],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAtprotoSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAtprotoSession must be used inside <AtprotoSessionProvider>');
  return v;
}
