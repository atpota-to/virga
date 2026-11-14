// The token lookup's lock fast path (lockFastPath.js), run against the real
// @atproto/oauth-client SessionGetter and OAuthSession and the real
// @atproto/api Agent. Only the store, the lock, the refresh call and the PDS
// are stand-ins, and the PDS behaves like @atproto/oauth-provider: a rotation
// invalidates the previous access token at once, and a reused refresh token
// deletes the session ("replay").
//
// The library is imported from the copy @atproto/oauth-client-node itself
// resolves, which is the one the server runs. A bare import would find the
// browser client's newer copy at the top of node_modules and test the wrong
// library.
//
// What this locks down:
//  1. Off, every lookup takes the full lock.
//  2. On, a token with time left is looked up with one store read and no lock;
//     a token near expiry and every forced refresh take the lock.
//  3. A forced refresh whose refused token was already replaced adopts the
//     replacement instead of rotating again. Without that, one forced refresh
//     on a busy account turns into a rotation storm; the simulation below shows
//     the storm with the hook removed, so it can tell when the hook goes.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@atproto/api';
import {
  FAST_PATH_MARGIN_MS,
  createRequestLock,
  fastPathRequested,
  hasTimeLeft,
  installClientHooks,
  prefetchedSession,
  trackTokenUse,
} from './lockFastPath.js';

const require = createRequire(import.meta.url);
const nodeClientRequire = createRequire(
  require.resolve('@atproto/oauth-client-node'),
);
const { SessionGetter, OAuthSession } = nodeClientRequire(
  '@atproto/oauth-client',
);

const SUB = 'did:plc:fastpath000000000000000000';
const HOUR = 60 * 60 * 1000;
let now = Date.UTC(2026, 9, 6, 12);

beforeEach(() => {
  now = Date.UTC(2026, 9, 6, 12);
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('tests the oauth-client copy the node client runs on', () => {
  const entry = nodeClientRequire.resolve('@atproto/oauth-client');
  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(entry), '..', 'package.json'),
      'utf8',
    ),
  );
  expect(pkg.name).toBe('@atproto/oauth-client');
  // Pinned with oauth-client-node 0.3.16; a change here means the hooks the
  // fast path installs need checking against the new SessionGetter.
  expect(pkg.version).toMatch(/^0\.5\./);
});

// Deterministic stand-in for network time: a number of event-loop turns.
function makeRandom(seed) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}
function turns(rand, lo, hi) {
  let n = lo + Math.floor(rand() * (hi - lo));
  return new Promise((resolve) => {
    const step = () => (n-- > 0 ? setImmediate(step) : resolve());
    step();
  });
}

/**
 * One account's world: its stored session, its PDS, a cross-instance lock, and
 * any number of instances, each with its own SessionGetter and OAuthSession.
 */
function createWorld({ seed = 1, latency = false } = {}) {
  const rand = makeRandom(seed);
  const wait = (lo, hi) => (latency ? turns(rand, lo, hi) : Promise.resolve());
  const counts = {
    reads: 0,
    writes: 0,
    locks: 0,
    refreshes: 0,
    pdsCalls: 0,
    pds401: 0,
    replays: 0,
  };
  const tokenSet = (n, msLeft = HOUR) => ({
    sub: SUB,
    iss: 'https://pds.example.invalid',
    aud: 'https://pds.example.invalid',
    token_type: 'DPoP',
    access_token: `at-${n}`,
    refresh_token: `rt-${n}`,
    scope: 'atproto',
    expires_at: new Date(now + msLeft).toISOString(),
  });
  const pds = { n: 1, current: 'at-1', currentRefresh: 'rt-1', dead: false };
  const hooks = { beforePds: null };
  let stored = { dpopKey: null, authMethod: 'legacy', tokenSet: tokenSet(1) };

  // The full lock: one FIFO queue shared by every instance.
  let tail = Promise.resolve();
  async function lock(_key, fn) {
    counts.locks++;
    const prev = tail;
    let release;
    tail = new Promise((r) => (release = r));
    await prev;
    await wait(1, 6);
    try {
      return await fn();
    } finally {
      await wait(1, 6);
      release();
    }
  }
  const store = {
    async read() {
      counts.reads++;
      await wait(1, 6);
      return pds.dead ? undefined : structuredClone(stored);
    },
    async get(sub) {
      const prefetched = prefetchedSession(sub);
      return prefetched !== undefined ? prefetched : store.read(sub);
    },
    async set(_sub, value) {
      counts.writes++;
      await wait(1, 6);
      stored = structuredClone(value);
    },
    async del() {},
  };
  const serverFactory = {
    async fromIssuer() {
      return {
        authMethod: 'legacy',
        async refresh(ts) {
          counts.refreshes++;
          await wait(10, 40);
          if (ts.refresh_token !== pds.currentRefresh) {
            counts.replays++;
            pds.dead = true;
            throw new Error('Refresh token replayed');
          }
          pds.n++;
          pds.current = `at-${pds.n}`;
          pds.currentRefresh = `rt-${pds.n}`;
          return tokenSet(pds.n);
        },
      };
    },
  };

  function instance({ fastPath, adopt = true }) {
    const requestLock = createRequestLock({
      lock,
      readSession: (sub) => store.read(sub),
      isArmed: () => fastPath,
    });
    const sessionGetter = new SessionGetter(store, serverFactory, {
      hasImplementationLock: true,
      usingLock: requestLock,
    });
    const libraryRefresh = sessionGetter.getter;
    if (fastPath) {
      expect(installClientHooks(sessionGetter)).toBe(true);
      if (!adopt) sessionGetter.getter = libraryRefresh;
    }
    const server = {
      dpopKey: { algorithms: ['ES256'] },
      serverMetadata: { dpop_signing_alg_values_supported: ['ES256'] },
      runtime: { sha256: async () => '' },
      dpopNonces: new Map(),
    };
    const session = new OAuthSession(server, SUB, sessionGetter);
    session.dpopFetch = async (_url, init) => {
      counts.pdsCalls++;
      await wait(5, 25);
      if (hooks.beforePds) {
        const hook = hooks.beforePds;
        hooks.beforePds = null;
        hook();
      }
      const token = new Headers(init && init.headers)
        .get('Authorization')
        .split(' ')[1];
      if (pds.dead || token !== pds.current) {
        counts.pds401++;
        return new Response('{}', {
          status: 401,
          headers: { 'WWW-Authenticate': 'DPoP error="invalid_token"' },
        });
      }
      return new Response('{"count":1}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    if (fastPath) trackTokenUse(session);
    return new Agent(session);
  }

  return {
    counts,
    pds,
    hooks,
    tokenSet,
    rand,
    wait,
    instance,
    setStored(value) {
      stored = value;
    },
  };
}

const unreadCount = (agent) => agent.app.bsky.notification.getUnreadCount();

describe('fastPathRequested', () => {
  it('is on only for an explicit true', () => {
    expect(fastPathRequested({ OAUTH_LOCK_FAST_PATH: 'true' })).toBe(true);
    expect(fastPathRequested({ OAUTH_LOCK_FAST_PATH: 'TRUE' })).toBe(true);
    for (const value of [undefined, '', 'false', '0', '1', 'yes']) {
      expect(
        fastPathRequested({ OAUTH_LOCK_FAST_PATH: value }),
        String(value),
      ).toBe(false);
    }
  });
});

describe('hasTimeLeft', () => {
  const at = (msLeft) => ({
    tokenSet: { expires_at: new Date(now + msLeft).toISOString() },
  });

  it('needs more than the margin', () => {
    expect(hasTimeLeft(at(FAST_PATH_MARGIN_MS + 1000))).toBe(true);
    expect(hasTimeLeft(at(FAST_PATH_MARGIN_MS - 1000))).toBe(false);
    expect(hasTimeLeft(at(-1000))).toBe(false);
  });

  it('treats a token without an expiry as one the library never refreshes', () => {
    expect(hasTimeLeft({ tokenSet: { expires_at: null } })).toBe(true);
  });

  it('sends anything else to the locked path', () => {
    expect(hasTimeLeft({ tokenSet: { expires_at: 'not a date' } })).toBe(false);
    expect(hasTimeLeft(undefined)).toBe(false);
    expect(hasTimeLeft({})).toBe(false);
  });
});

describe('installClientHooks', () => {
  it('refuses a SessionGetter without the members it wraps, so the fast path stays off', () => {
    expect(installClientHooks(undefined)).toBe(false);
    expect(installClientHooks({ get() {} })).toBe(false);
    expect(installClientHooks({ getter() {} })).toBe(false);
  });
});

describe('createRequestLock', () => {
  it('needs to be told whether it is armed', () => {
    expect(() =>
      createRequestLock({
        lock: async () => {},
        readSession: async () => undefined,
      }),
    ).toThrow(/isArmed/);
  });
});

describe('token lookups', () => {
  it('off: every lookup takes the full lock', async () => {
    const world = createWorld();
    const agent = world.instance({ fastPath: false });
    for (let i = 0; i < 3; i++) await unreadCount(agent);
    expect(world.counts).toMatchObject({
      locks: 3,
      reads: 3,
      refreshes: 0,
      pds401: 0,
    });
  });

  it('on: a token with time left costs one store read and no lock', async () => {
    const world = createWorld();
    const agent = world.instance({ fastPath: true });
    for (let i = 0; i < 3; i++) await unreadCount(agent);
    // One read per lookup: the library's own store read reuses the fast path's.
    expect(world.counts).toMatchObject({
      locks: 0,
      reads: 3,
      refreshes: 0,
      pds401: 0,
    });
  });

  it('on: a token near expiry is refreshed under the lock', async () => {
    const world = createWorld();
    // Inside the library's refresh window however its jitter falls (10 s plus
    // up to 30 s), so the refresh is certain.
    world.setStored({
      dpopKey: null,
      authMethod: 'legacy',
      tokenSet: world.tokenSet(1, 5 * 1000),
    });
    const agent = world.instance({ fastPath: true });
    await unreadCount(agent);
    expect(world.counts).toMatchObject({
      locks: 1,
      refreshes: 1,
      writes: 1,
      pds401: 0,
      replays: 0,
    });
    expect(world.pds.current).toBe('at-2');
  });

  it('on: a refused token still in the store is rotated under the lock', async () => {
    const world = createWorld();
    world.pds.current = 'refused';
    const agent = world.instance({ fastPath: true });
    await unreadCount(agent);
    expect(world.counts).toMatchObject({
      locks: 1,
      refreshes: 1,
      pds401: 1,
      replays: 0,
    });
  });

  // Another instance rotates while this one's request is out with at-1: the
  // PDS refuses at-1, and the store already holds at-2.
  function rotateElsewhere(world) {
    world.hooks.beforePds = () => {
      world.setStored({
        dpopKey: null,
        authMethod: 'legacy',
        tokenSet: world.tokenSet(2),
      });
      Object.assign(world.pds, {
        n: 2,
        current: 'at-2',
        currentRefresh: 'rt-2',
      });
    };
  }

  it('on: a refused token already replaced in the store is adopted, not rotated again', async () => {
    const world = createWorld();
    const agent = world.instance({ fastPath: true });
    rotateElsewhere(world);
    await unreadCount(agent);
    // One 401, then the retry carries at-2; at-2 stays live for the instance
    // that wrote it.
    expect(world.counts).toMatchObject({
      locks: 1,
      refreshes: 0,
      pds401: 1,
      pdsCalls: 2,
      replays: 0,
    });
    expect(world.pds.current).toBe('at-2');
  });

  it('on without the adopt hook: the same race rotates again, invalidating at-2', async () => {
    const world = createWorld();
    const agent = world.instance({ fastPath: true, adopt: false });
    rotateElsewhere(world);
    await unreadCount(agent);
    expect(world.counts).toMatchObject({ refreshes: 1, replays: 0 });
    expect(world.pds.current).toBe('at-3');
  });
});

/**
 * Four instances of one account issuing overlapping bursts over a few virtual
 * hours, with a forced refresh injected now and then (the PDS refuses the live
 * token, as if it had been revoked under it).
 */
async function simulate({
  fastPath,
  adopt = true,
  seed,
  bursts = 150,
  injectRate = 0.02,
}) {
  const world = createWorld({ seed, latency: true });
  // The library jitters its refresh window with Math.random; seed it too, so a
  // run is the same every time.
  vi.spyOn(Math, 'random').mockImplementation(makeRandom(seed + 1000));
  const agents = [0, 1, 2, 3].map(() => world.instance({ fastPath, adopt }));
  let calls = 0;
  let failures = 0;
  let injections = 0;
  async function worker(agent) {
    for (let b = 0; b < bursts; b++) {
      now += Math.floor(world.rand() * 12000);
      if (world.rand() < injectRate) {
        injections++;
        world.pds.current = `refused-${injections}`;
      }
      const size = 1 + Math.floor(world.rand() * 5);
      await Promise.all(
        Array.from({ length: size }, () => {
          calls++;
          return unreadCount(agent).catch(() => {
            failures++;
          });
        }),
      );
      await world.wait(0, 30);
    }
  }
  await Promise.all(agents.map(worker));
  const c = world.counts;
  return {
    calls,
    failures,
    injections,
    ...c,
    storeCallsPerCall: (c.reads + c.writes + 2 * c.locks) / calls,
    refreshesPerInjection: c.refreshes / Math.max(1, injections),
  };
}

describe('four instances under load', () => {
  it('on: never replays a refresh token, and a forced refresh costs about one rotation', async () => {
    for (const seed of [11, 12, 13]) {
      const run = await simulate({ fastPath: true, seed });
      expect(run.replays, `seed ${seed}`).toBe(0);
      expect(run.injections, `seed ${seed}`).toBeGreaterThan(0);
      expect(run.refreshesPerInjection, `seed ${seed}`).toBeLessThan(2.5);
      expect(run.storeCallsPerCall, `seed ${seed}`).toBeLessThan(1.6);
    }
  }, 30000);

  it('off: the full lock, for comparison, also never replays', async () => {
    const run = await simulate({ fastPath: false, seed: 11 });
    expect(run.replays).toBe(0);
    expect(run.storeCallsPerCall).toBeGreaterThan(2.9);
  }, 30000);

  it('on without the adopt hook: the storm the hook prevents', async () => {
    // If this stops storming, the simulation no longer exercises the hazard and
    // the test above proves nothing about the hook.
    const run = await simulate({ fastPath: true, adopt: false, seed: 11 });
    expect(run.replays).toBe(0);
    expect(run.refreshesPerInjection).toBeGreaterThan(10);
  }, 30000);
});

// The hooks reach into SessionGetter, so they are checked against the next
// library line too (the one the browser client already uses), so that a move
// off the pin shows up here rather than as a 503 in production.
describe('on @atproto/oauth-client 0.6', () => {
  const next = require('@atproto/oauth-client');

  it('takes the hooks, and the fast path skips the lock with time left', async () => {
    const reads = [];
    let locks = 0;
    const stored = {
      dpopKey: null,
      authMethod: 'legacy',
      tokenSet: {
        sub: SUB,
        aud: 'https://pds.example.invalid',
        access_token: 'at-1',
        expires_at: new Date(now + HOUR).toISOString(),
      },
    };
    const store = {
      async get(sub) {
        const prefetched = prefetchedSession(sub);
        if (prefetched !== undefined) return prefetched;
        reads.push(sub);
        return structuredClone(stored);
      },
      async set() {},
      async del() {},
    };
    const requestLock = createRequestLock({
      lock: async (_key, fn) => {
        locks++;
        return fn();
      },
      readSession: async (sub) => {
        reads.push(sub);
        return structuredClone(stored);
      },
      isArmed: () => true,
    });
    const getter = new next.SessionGetter(
      store,
      {},
      { hasImplementationLock: true, usingLock: requestLock },
      {},
    );
    expect(installClientHooks(getter)).toBe(true);
    const session = await getter.get(SUB, {});
    expect(session.tokenSet.access_token).toBe('at-1');
    expect(locks).toBe(0);
    expect(reads).toEqual([SUB]);
  });
});
