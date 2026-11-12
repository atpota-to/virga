// Stand-in for src/session/useAtprotoSession.jsx, swapped in by
// vite.harness.config.js. Presents the made-up account from harness/world.js
// as signed in, with an agent that answers the dashboard's signed-in reads
// (followers, notifications, the follow records) from memory, so the whole
// app can be opened, used and screenshotted without an OAuth round trip.
//
// The real module's exported shape is mirrored exactly: if it grows an
// export, this needs the same one. Nothing here ships; see harness/README.md.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { installFakeNetwork, pageOf } from './fakeNetwork.js';
import { ME, buildWorld, tidAt } from './world.js';
import { OAUTH_CALLBACK_PATH } from '../src/config.js';

const Ctx = createContext(null);

const params = new URLSearchParams(window.location.search);
const latency = params.has('latency') ? Number(params.get('latency')) || 0 : 60;
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const world = buildWorld();
installFakeNetwork(world, { latency });

/** The signed-in reads and the two follow writes, from the world. */
function buildAgent() {
  const records = {
    'app.bsky.graph.follow': [...world.follows].sort((a, b) => (a.uri < b.uri ? 1 : -1)),
    'app.bsky.feed.like': world.likes,
    'app.bsky.feed.repost': world.reposts,
  };
  return {
    app: {
      bsky: {
        graph: {
          async getFollowers({ limit, cursor }) {
            await sleep(latency);
            const { rows, cursor: next } = pageOf(world.followers, limit, cursor);
            return { data: { followers: rows, cursor: next } };
          },
        },
        notification: {
          async listNotifications({ limit, cursor }) {
            await sleep(latency);
            const { rows, cursor: next } = pageOf(world.notifications, limit, cursor);
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
            const uri = `at://${ME.did}/${collection}/${tidAt(Date.now())}`;
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

/**
 * Query flags:
 *   ?signedout   start on the front page; signing in as anyone but "nobody"
 *                lands in the dashboard
 *   ?latency=0   drop the simulated delay on every request (default 60ms)
 *
 * Opening /oauth/callback shows a sign-in that came back declined.
 */
export function AtprotoSessionProvider({ children }) {
  const declined = window.location.pathname.startsWith(OAUTH_CALLBACK_PATH);
  const [signedIn, setSignedIn] = useState(!params.has('signedout') && !declined);
  const agent = useMemo(() => buildAgent(), []);

  const signIn = useCallback(async (input) => {
    await sleep(500);
    if (/^nobody/i.test(String(input))) throw new Error(`Failed to resolve identity: ${input}`);
    setSignedIn(true);
  }, []);

  const signOut = useCallback(async () => {
    setSignedIn(false);
  }, []);

  const value = useMemo(
    () => ({
      session: signedIn ? { sub: ME.did } : null,
      agent: signedIn ? agent : null,
      did: signedIn ? ME.did : null,
      loading: false,
      error: declined
        ? Object.assign(new Error('The user denied the request'), {
            params: new URLSearchParams({ error: 'access_denied' }),
          })
        : null,
      signIn,
      signOut,
    }),
    [signedIn, agent, declined, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAtprotoSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAtprotoSession must be used inside <AtprotoSessionProvider>');
  return v;
}
