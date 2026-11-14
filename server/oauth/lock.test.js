// The refresh lock as the client uses it: the key the library locks under,
// the two tiers, the fast path armed only once the client's own hooks are in,
// and the per-instance session cache.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../supabase.js';
import { createStorage, MemoryLock, SupabaseLock } from './storage.js';
import {
  OAuthClientWrapper,
  getOAuthClient,
  resetOAuthForTests,
} from './client.js';
import { installClientHooks } from './lockFastPath.js';
import { installOAuthEnv } from './testing/env.js';

const DID = 'did:plc:virgalock00000000000000';
const LIBRARY_KEY = `@atproto-oauth-client-${DID}`;
const HOUR = 60 * 60 * 1000;

const row = (accessToken, msLeft = HOUR) => ({
  dpopJwk: {},
  tokenSet: {
    sub: DID,
    aud: 'https://pds.example',
    scope: 'atproto',
    access_token: accessToken,
    token_type: 'DPoP',
    expires_at: new Date(Date.now() + msLeft).toISOString(),
  },
});

const db = createFakeSupabase();
let env;

beforeAll(async () => {
  env = await installOAuthEnv();
  setSupabaseClientForTests(db);
});

afterAll(() => {
  resetOAuthForTests();
  resetSupabaseClientForTests();
  env.restore();
});

beforeEach(() => {
  db.reset();
  resetOAuthForTests();
  db.rowsOf('oauth_sessions').push({
    sub: DID,
    session_data: row('stored-at'),
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.OAUTH_LOCK_FAST_PATH;
  vi.restoreAllMocks();
});

const acquired = () =>
  db.rpcs
    .filter((r) => r.name === 'acquire_oauth_lock')
    .map((r) => r.args.p_key);
const released = () =>
  db.rpcs
    .filter((r) => r.name === 'release_oauth_lock')
    .map((r) => r.args.p_key);

describe('the full lock', () => {
  it("locks under the library's own key, acquire and release paired", async () => {
    const storage = createStorage();
    expect(await storage.requestLock(LIBRARY_KEY, async () => 'v')).toBe('v');
    expect(acquired()).toEqual([LIBRARY_KEY]);
    expect(released()).toEqual([LIBRARY_KEY]);
    const [acquire, release] = db.rpcs;
    expect(acquire.args).toMatchObject({ p_ttl_seconds: 20 });
    expect(release.args.p_holder).toBe(acquire.args.p_holder);
  });

  it('is what every lookup takes while the fast path is not armed', async () => {
    const storage = createStorage();
    await storage.requestLock(LIBRARY_KEY, async () => {});
    await storage.requestLock(LIBRARY_KEY, async () => {});
    expect(acquired()).toHaveLength(2);
  });

  it('takes the lock for a forced refresh even when armed', async () => {
    const storage = createStorage();
    storage.fastPath.armed = true;
    // A SessionGetter shaped enough for the hooks: a forced lookup (noCache)
    // runs inside the hooks' forced context, which always takes the lock.
    const getter = {
      get: (sub, options) =>
        storage.requestLock(
          `@atproto-oauth-client-${sub}`,
          async () => options,
        ),
      getter: async () => undefined,
    };
    expect(installClientHooks(getter)).toBe(true);
    await getter.get(DID, {});
    expect(acquired()).toEqual([]);
    await getter.get(DID, { noCache: true });
    expect(acquired()).toEqual([LIBRARY_KEY]);
  });

  it('runs anyway when the lock RPC fails, and releases nothing it never held', async () => {
    const failing = createFakeSupabase({
      rpcAnswer: () => ({
        data: null,
        error: { code: 'PGRST202', message: 'no such function' },
      }),
    });
    setSupabaseClientForTests(failing);
    try {
      expect(
        await new SupabaseLock().lock(LIBRARY_KEY, async () => 'ran'),
      ).toBe('ran');
      expect(failing.rpcs.map((r) => r.name)).toEqual(['acquire_oauth_lock']);
    } finally {
      setSupabaseClientForTests(db);
    }
  });

  it('waits for a held lock, then runs after the deadline without it', async () => {
    const held = createFakeSupabase({
      rpcAnswer: () => ({ data: false, error: null }),
    });
    setSupabaseClientForTests(held);
    try {
      const lock = new SupabaseLock({
        maxWaitMs: 60,
        pollMinMs: 5,
        pollMaxMs: 10,
      });
      expect(await lock.lock(LIBRARY_KEY, async () => 'ran')).toBe('ran');
      expect(held.rpcs.length).toBeGreaterThan(1);
      expect(held.rpcs.every((r) => r.name === 'acquire_oauth_lock')).toBe(
        true,
      );
    } finally {
      setSupabaseClientForTests(db);
    }
  });

  it('runs without a cross-instance lock when Supabase is not configured', async () => {
    setSupabaseClientForTests(null);
    try {
      expect(
        await new SupabaseLock().lock(LIBRARY_KEY, async () => 'ran'),
      ).toBe('ran');
    } finally {
      setSupabaseClientForTests(db);
    }
  });

  it('serializes one key within an instance', async () => {
    const lock = new MemoryLock();
    const order = [];
    const slow = lock.lock('k', async () => {
      order.push('a:start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('a:end');
    });
    const fast = lock.lock('k', async () => {
      order.push('b');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a:start', 'a:end', 'b']);
  });
});

describe('the fast path', () => {
  it('reads oauth_sessions once and takes no lock for a token with time left', async () => {
    const storage = createStorage();
    storage.fastPath.armed = true;
    let seen;
    await storage.requestLock(LIBRARY_KEY, async () => {
      seen = await storage.sessionStore.get(DID);
    });
    expect(seen.tokenSet.access_token).toBe('stored-at');
    expect(acquired()).toEqual([]);
    // The fast path's own read; the store's get inside it reused that read.
    expect(db.ops.map((o) => `${o.table}:${o.verb}`)).toEqual([
      'oauth_sessions:select',
    ]);
  });

  it('still locks a token near expiry', async () => {
    db.tables.set('oauth_sessions', [
      { sub: DID, session_data: row('stored-at', 60 * 1000) },
    ]);
    const storage = createStorage();
    storage.fastPath.armed = true;
    await storage.requestLock(LIBRARY_KEY, async () => {});
    expect(acquired()).toEqual([LIBRARY_KEY]);
  });

  it('arms a wrapper only once its own client took the hooks', async () => {
    const unrequested = new OAuthClientWrapper({ storage: createStorage() });
    await unrequested.initPromise;
    expect(unrequested.fastPathArmed).toBe(false);

    process.env.OAUTH_LOCK_FAST_PATH = 'true';
    const storage = createStorage();
    const wrapper = new OAuthClientWrapper({ storage });
    await wrapper.initPromise;
    // The real NodeOAuthClient's SessionGetter took the hooks.
    expect(wrapper.fastPathArmed).toBe(true);
    expect(storage.fastPath.armed).toBe(true);

    const hookless = new OAuthClientWrapper({ storage: createStorage() });
    await hookless.initPromise;
    hookless.storage.fastPath.armed = false;
    hookless.client = { sessionGetter: {} };
    expect(hookless.armFastPathIfHooked()).toBe(false);
    expect(hookless.fastPathArmed).toBe(false);
  });
});

describe('the session cache', () => {
  it('answers a second restore from the cache, and a fresh one from the client', async () => {
    const wrapper = getOAuthClient();
    const client = await wrapper.ensureInitialized();
    const restore = vi
      .spyOn(client, 'restore')
      .mockResolvedValue({
        did: DID,
        fetchHandler: async () => new Response('{}'),
      });
    const first = await wrapper.restoreSession(DID);
    expect(await wrapper.restoreSession(DID)).toBe(first);
    expect(restore).toHaveBeenCalledTimes(1);
    await wrapper.restoreSession(DID, { fresh: true });
    expect(restore).toHaveBeenCalledTimes(2);
    wrapper.evictSession(DID);
    await wrapper.restoreSession(DID);
    expect(restore).toHaveBeenCalledTimes(3);
  });

  it('answers null, and caches nothing, when the library has no session or throws', async () => {
    const wrapper = getOAuthClient();
    const client = await wrapper.ensureInitialized();
    const restore = vi
      .spyOn(client, 'restore')
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('TokenRefreshError'));
    expect(await wrapper.restoreSession(DID)).toBeNull();
    expect(await wrapper.restoreSession(DID)).toBeNull();
    expect(restore).toHaveBeenCalledTimes(2);
  });
});
