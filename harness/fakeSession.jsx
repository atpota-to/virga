// Stand-in for src/session/useAtprotoSession.jsx, swapped in by
// vite.harness.config.js. Presents two made-up accounts from harness/world.js
// as signed in on this browser (Mira, with the full archive, and Field Lab, a
// quiet second account), each with an agent that answers the dashboard's
// signed-in reads from memory, so the whole app can be opened, used and
// screenshotted without an OAuth round trip. Switching between them happens
// in place, as it does in the real app.
//
// The real module's exported shape and value are mirrored exactly: if it
// grows an export or a field, this needs the same one. Nothing here ships;
// see harness/README.md.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { buildRepoCar } from './buildCar.js';
import { installFakeNetwork, pageOf } from './fakeNetwork.js';
import { LAB, ME, PDS, buildWorld, tidAt } from './world.js';
import { OAUTH_CALLBACK_PATH } from '../src/config.js';
import { makeReauthRequiredError } from '../src/session/accounts.js';
import { capabilitiesFrom } from '../src/session/sessionController.js';

const Ctx = createContext(null);

const params = new URLSearchParams(window.location.search);
const latency = params.has('latency') ? Number(params.get('latency')) || 0 : 60;
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
// How each account is signed in: a browser session unless ?mode=backend.
const MODE = params.get('mode') === 'backend' ? 'backend' : 'browser';

const world = buildWorld();
installFakeNetwork(world, { latency });
installSecondAccount();

/**
 * The second account's public face: its profile, DID document, repo and
 * (empty) author feed, answered in front of the world's router, which knows
 * only Mira.
 */
function installSecondAccount() {
  const inner = window.fetch;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const created = new Date(world.now - 140 * 86_400_000).toISOString();
  const profile = { did: LAB.did, handle: LAB.handle, displayName: LAB.displayName, avatar: LAB.avatar, followersCount: 212, followsCount: 48, postsCount: 0, createdAt: created };
  let car = null;
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    const q = url.searchParams;
    const method = url.pathname.split('/xrpc/')[1] || '';
    const isLab = (v) => v === LAB.did || v === LAB.handle;
    if (url.hostname === 'public.api.bsky.app') {
      if (method === 'app.bsky.actor.getProfile' && isLab(q.get('actor'))) return sleep(latency).then(() => json(profile));
      if (method === 'app.bsky.feed.getAuthorFeed' && isLab(q.get('actor'))) return sleep(latency).then(() => json({ feed: [] }));
      if (method === 'app.bsky.actor.getProfiles' && q.getAll('actors').some(isLab)) {
        const rest = q.getAll('actors').filter((a) => !isLab(a));
        const others = rest.length ? await (await inner(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${rest.map((a) => `actors=${encodeURIComponent(a)}`).join('&')}`)).json() : { profiles: [] };
        return json({ profiles: [profile, ...(others.profiles || [])] });
      }
    }
    if (url.hostname === 'plc.directory' && decodeURIComponent(url.pathname).includes(LAB.did)) {
      await sleep(latency);
      if (url.pathname.endsWith('/log/audit')) {
        return json([
          {
            did: LAB.did,
            operation: { type: 'plc_operation', alsoKnownAs: [`at://${LAB.handle}`], services: { atproto_pds: { type: 'AtprotoPersonalDataServer', endpoint: PDS } } },
            cid: 'bafyharness',
            nullified: false,
            createdAt: created,
          },
        ]);
      }
      return json({ id: LAB.did, alsoKnownAs: [`at://${LAB.handle}`], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] });
    }
    if (url.origin === PDS && method === 'com.atproto.sync.getRepo' && q.get('did') === LAB.did) {
      await sleep(latency);
      if (q.get('since')) return json({ error: 'InvalidRequest', message: 'Unknown revision' }, 400);
      car ||= buildRepoCar(LAB.did, [['app.bsky.actor.profile/self', { $type: 'app.bsky.actor.profile', displayName: LAB.displayName }]]);
      const bytes = await car;
      return new Response(bytes, { headers: { 'Content-Type': 'application/vnd.ipld.car', 'Content-Length': String(bytes.byteLength) } });
    }
    return inner(input, init);
  };
}

/**
 * Followers change between syncs, as they do: from the second sweep on, a
 * dozen people have left and three have arrived, so the Unfollow tracker has
 * something to find. The sweep count is kept across reloads, with the
 * archive; clear the site's data to start over.
 */
const SWEEPS_KEY = 'virga-harness:follower-sweeps';
const arrivals = [0, 1, 2].map((i) => {
  const at = world.now - (3 + i * 5) * 3_600_000;
  const did = `did:plc:virgaharnessnew${String(i).padStart(4, '0')}`;
  return {
    did,
    handle: ['tove.example.org', 'quentin.example.net', 'zadie.example.com'][i],
    displayName: ['Tove Haddad', 'Quentin Abara', ''][i],
    avatar: '',
    viewer: { followedBy: `at://${did}/app.bsky.graph.follow/${tidAt(at, 900 + i)}` },
  };
});
let followerList = world.followers;

function followersForSweep() {
  let n = 0;
  try {
    n = Number(localStorage.getItem(SWEEPS_KEY) || 0) + 1;
    localStorage.setItem(SWEEPS_KEY, String(n));
  } catch {
    n = 1;
  }
  if (n < 2) return world.followers;
  return [...arrivals, ...world.followers.filter((_, i) => i % 397 !== 11)];
}

/**
 * One account's signed-in reads and its writes, from memory. Mira's come
 * from the world; Field Lab's are a handful of followers and nothing else.
 */
function buildAgent(did) {
  const mine = did === ME.did;
  const records = mine
    ? {
        'app.bsky.graph.follow': [...world.follows].sort((a, b) => (a.uri < b.uri ? 1 : -1)),
        'app.bsky.feed.like': world.likes,
        'app.bsky.feed.repost': world.reposts,
      }
    : {};
  const labFollowers = world.cast.slice(0, 12).map((p, i) => ({
    ...p,
    viewer: { followedBy: `at://${p.did}/app.bsky.graph.follow/${tidAt(world.now - (i + 2) * 86_400_000, 700 + i)}` },
  }));
  return {
    did,
    app: {
      bsky: {
        graph: {
          async getFollowers({ limit, cursor }) {
            await sleep(latency);
            if (!mine) {
              const { rows, cursor: next } = pageOf(labFollowers, limit, cursor);
              return { data: { followers: rows, cursor: next } };
            }
            if (!cursor) followerList = followersForSweep();
            const { rows, cursor: next } = pageOf(followerList, limit, cursor);
            return { data: { followers: rows, cursor: next } };
          },
        },
        notification: {
          async listNotifications({ limit, cursor }) {
            await sleep(latency);
            const { rows, cursor: next } = pageOf(mine ? world.notifications : [], limit, cursor);
            return { data: { notifications: rows, cursor: next } };
          },
        },
      },
    },
    com: {
      atproto: {
        repo: {
          async listRecords({ collection, limit, cursor }) {
            await sleep(latency);
            const { rows, cursor: next } = pageOf(records[collection] || [], limit, cursor);
            return { data: { records: rows, cursor: next } };
          },
          async createRecord({ collection, record }) {
            await sleep(latency * 4);
            const uri = `at://${did}/${collection}/${tidAt(Date.now())}`;
            (records[collection] ||= []).unshift({ uri, value: record });
            return { data: { uri, cid: 'bafyharness' } };
          },
          async deleteRecord({ collection, rkey }) {
            await sleep(latency * 4);
            records[collection] = (records[collection] || []).filter((r) => !r.uri.endsWith(`/${rkey}`));
            return { data: {} };
          },
        },
      },
    },
  };
}

const IDENTITIES = params.get('accounts') === '1' ? [ME] : [ME, LAB];

/**
 * Query flags:
 *   ?signedout     start on the front page, with the accounts remembered but
 *                  signed out; signing in as anyone but "nobody" lands in the
 *                  dashboard (as Field Lab for lab.example.org, else Mira)
 *   ?accounts=1    only Mira, as before there were two
 *   ?mode=backend  the accounts have long sessions (the default is browser
 *                  sessions)
 *   ?latency=0     drop the simulated delay on every request (default 60ms)
 *
 * Opening /oauth/callback shows a sign-in that came back declined.
 */
export function AtprotoSessionProvider({ children }) {
  const declined = window.location.pathname.startsWith(OAUTH_CALLBACK_PATH);
  const signedOutAtStart = params.has('signedout') || declined;
  const agents = useRef(new Map());
  const agentOf = useCallback((did) => {
    if (!agents.current.has(did)) agents.current.set(did, buildAgent(did));
    return agents.current.get(did);
  }, []);

  const [rows, setRows] = useState(() =>
    IDENTITIES.map((id, i) => ({
      did: id.did,
      handle: id.handle,
      displayName: id.displayName,
      avatar: id === ME ? world.profile.avatar : id.avatar,
      mode: MODE,
      lastUsed: world.now - i * 86_400_000 * 3,
      status: signedOutAtStart ? 'needsSignIn' : 'ready',
    })),
  );
  const [activeDid, setActiveDid] = useState(signedOutAtStart ? null : ME.did);
  const [switching, setSwitching] = useState(null);

  const find = useCallback((did) => rows.find((r) => r.did === did) || null, [rows]);
  const setStatus = (did, status) => setRows((list) => list.map((r) => (r.did === did ? { ...r, status, lastUsed: status === 'ready' ? Date.now() : r.lastUsed } : r)));

  const signIn = useCallback(async (input) => {
    await sleep(500);
    if (/^nobody/i.test(String(input))) throw new Error(`Failed to resolve identity: ${input}`);
    const did = String(input).replace(/^@/, '') === LAB.handle || input === LAB.did ? LAB.did : ME.did;
    setStatus(did, 'ready');
    setActiveDid(did);
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

  const signOutAccount = useCallback(
    async (did) => {
      setStatus(did, 'needsSignIn');
      if (did === activeDid) {
        const next = rows.find((r) => r.did !== did && r.status !== 'needsSignIn');
        setActiveDid(next ? next.did : null);
      }
    },
    [activeDid, rows],
  );

  const removeAccount = useCallback(
    async (did) => {
      setRows((list) => list.filter((r) => r.did !== did));
      if (did === activeDid) {
        const next = rows.find((r) => r.did !== did && r.status !== 'needsSignIn');
        setActiveDid(next ? next.did : null);
      }
    },
    [activeDid, rows],
  );

  const signOut = useCallback(() => (activeDid ? signOutAccount(activeDid) : Promise.resolve()), [activeDid, signOutAccount]);

  const agentFor = useCallback(
    async (did) => {
      const row = find(did);
      if (!row || row.status === 'needsSignIn') throw makeReauthRequiredError(did);
      return agentOf(did);
    },
    [find, agentOf],
  );
  const targetFor = useCallback(async (did) => ({ did, agent: await agentFor(did), pdsUrl: PDS }), [agentFor]);
  // No fake of Virga's server yet, so no account has a requester.
  const backendFor = useCallback(() => null, []);
  const capabilitiesFor = useCallback(
    (did) => {
      const row = find(did);
      return capabilitiesFrom(row, row ? row.status : 'needsSignIn');
    },
    [find],
  );
  const checkAccount = useCallback(async (did) => (find(did)?.status === 'needsSignIn' ? 'expired' : 'valid'), [find]);

  const accounts = useMemo(() => [...rows].sort((a, b) => b.lastUsed - a.lastUsed), [rows]);
  const active = activeDid ? find(activeDid) : null;

  const value = useMemo(
    () => ({
      session: active ? { sub: active.did, did: active.did, mode: active.mode } : null,
      agent: active ? agentOf(active.did) : null,
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
      authMode: MODE,
    }),
    [active, agentOf, switching, declined, signIn, signOut, accounts, switchAccount, signOutAccount, removeAccount, agentFor, targetFor, backendFor, capabilitiesFor, checkAccount],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAtprotoSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAtprotoSession must be used inside <AtprotoSessionProvider>');
  return v;
}
