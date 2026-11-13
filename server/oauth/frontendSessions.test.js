// The browser's session tokens: their shape, the per-instance cache, sliding
// expiry, the live-only count per-device sign-out depends on, single-token
// delete, and resolveUserDid, which every other area authenticates with.

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
import { FrontendSessionStore } from './storage.js';
import { resetOAuthForTests } from './client.js';
import { resolveUserDid } from './auth.js';
import { TOKEN, tokenOf } from './testing/env.js';

const DID = 'did:plc:virgatokens0000000000000';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-12T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

const db = createFakeSupabase();

beforeAll(() => setSupabaseClientForTests(db));
afterAll(() => {
  resetOAuthForTests();
  resetSupabaseClientForTests();
});

beforeEach(() => {
  db.reset();
  resetOAuthForTests();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// A fresh store per test, so no cache carries over.
const store = () => new FrontendSessionStore();
const verbs = () => db.ops.map((o) => o.verb);

describe('tokens', () => {
  it('are minted as vg_ + 64 lowercase hex, one row each', async () => {
    const s = store();
    const a = await s.create(DID);
    const b = await s.create(DID);
    expect(a).toMatch(/^vg_[0-9a-f]{64}$/);
    expect(b).not.toBe(a);
    expect(db.rowsOf('frontend_sessions').map((r) => r.token)).toEqual([a, b]);
    expect(db.rowsOf('frontend_sessions')[0]).toMatchObject({
      user_did: DID,
      expires_at: iso(NOW + 30 * DAY),
    });
  });

  it('throws when a token cannot be stored', async () => {
    db.failNext('frontend_sessions', 'insert');
    await expect(store().create(DID)).rejects.toMatchObject({ code: 'XX000' });
  });

  it.each([
    'b'.repeat(64),
    `VG_${'b'.repeat(64)}`,
    `vg_${'B'.repeat(64)}`,
    `vg_${'b'.repeat(63)}`,
    '',
    undefined,
    { token: TOKEN },
  ])('answers %s as not found, without a read', async (token) => {
    expect(await store().validateWithDetails(token)).toEqual({
      userDid: null,
      error: null,
    });
    expect(db.ops).toEqual([]);
  });

  it('reads a token once, then answers from the cache', async () => {
    db.rowsOf('frontend_sessions').push({
      token: TOKEN,
      user_did: DID,
      expires_at: iso(NOW + 20 * DAY),
    });
    const s = store();
    expect(await s.validateWithDetails(TOKEN)).toEqual({
      userDid: DID,
      error: null,
    });
    expect(await s.validateWithDetails(TOKEN)).toEqual({
      userDid: DID,
      error: null,
    });
    expect(db.ops).toHaveLength(1);
    expect(db.ops[0]).toMatchObject({
      table: 'frontend_sessions',
      verb: 'select',
    });
  });

  it('reads again once the cached expiry has passed, and refuses then', async () => {
    db.rowsOf('frontend_sessions').push({
      token: TOKEN,
      user_did: DID,
      expires_at: iso(NOW + 30 * 1000),
    });
    // Its renewal fails, so it keeps the expiry it had.
    db.failNext('frontend_sessions', 'update');
    const s = store();
    expect((await s.validateWithDetails(TOKEN)).userDid).toBe(DID);
    vi.setSystemTime(NOW + 31 * 1000);
    expect(await s.validateWithDetails(TOKEN)).toEqual({
      userDid: null,
      error: null,
    });
  });
});

describe('sliding expiry', () => {
  it('renews a token with under seven days left to thirty days from now', async () => {
    db.rowsOf('frontend_sessions').push({
      token: TOKEN,
      user_did: DID,
      expires_at: iso(NOW + 3 * DAY),
    });
    expect(await store().validateWithDetails(TOKEN)).toEqual({
      userDid: DID,
      error: null,
    });
    expect(db.rowsOf('frontend_sessions')[0].expires_at).toBe(
      iso(NOW + 30 * DAY),
    );
    expect(verbs()).toEqual(['select', 'update']);
    expect(db.ops[1].filters).toEqual([
      `token eq ${TOKEN}`,
      `user_did eq ${DID}`,
    ]);
  });

  it('leaves a token with a week or more alone', async () => {
    db.rowsOf('frontend_sessions').push({
      token: TOKEN,
      user_did: DID,
      expires_at: iso(NOW + 8 * DAY),
    });
    await store().validateWithDetails(TOKEN);
    expect(verbs()).toEqual(['select']);
  });

  it('tries at most once a day per token', async () => {
    db.rowsOf('frontend_sessions').push({
      token: TOKEN,
      user_did: DID,
      expires_at: iso(NOW + 3 * DAY),
    });
    const s = store();
    db.failNext('frontend_sessions', 'update');
    await s.validateWithDetails(TOKEN);
    await s.validateWithDetails(TOKEN);
    vi.setSystemTime(NOW + 20 * 60 * 60 * 1000);
    await s.validateWithDetails(TOKEN);
    expect(db.ops.filter((o) => o.verb === 'update')).toHaveLength(1);

    db.clearFailures();
    vi.setSystemTime(NOW + 25 * 60 * 60 * 1000);
    expect(await s.validateWithDetails(TOKEN)).toEqual({
      userDid: DID,
      error: null,
    });
    expect(db.ops.filter((o) => o.verb === 'update')).toHaveLength(2);
    expect(db.rowsOf('frontend_sessions')[0].expires_at).toBe(
      iso(NOW + 25 * 60 * 60 * 1000 + 30 * DAY),
    );
  });

  it('refuses an expired token and deletes it', async () => {
    db.rowsOf('frontend_sessions').push({
      token: TOKEN,
      user_did: DID,
      expires_at: iso(NOW - 1000),
    });
    expect(await store().validateWithDetails(TOKEN)).toEqual({
      userDid: null,
      error: null,
    });
    expect(verbs()).toEqual(['select', 'delete']);
    expect(db.rowsOf('frontend_sessions')).toEqual([]);
  });
});

describe('transient failures', () => {
  it('answers QUERY_ERROR after three failed reads, 300 ms and 600 ms apart', async () => {
    vi.useRealTimers();
    db.failNext('frontend_sessions', 'select');
    const started = Date.now();
    expect(await store().validateWithDetails(TOKEN)).toEqual({
      userDid: null,
      error: 'QUERY_ERROR',
    });
    expect(db.ops).toHaveLength(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(850);
  });

  it('answers SUPABASE_UNAVAILABLE when Supabase is not configured', async () => {
    vi.useRealTimers();
    setSupabaseClientForTests(null);
    try {
      expect(await store().validateWithDetails(TOKEN)).toEqual({
        userDid: null,
        error: 'SUPABASE_UNAVAILABLE',
      });
    } finally {
      setSupabaseClientForTests(db);
    }
  });

  it('recovers when a later read succeeds', async () => {
    vi.useRealTimers();
    db.rowsOf('frontend_sessions').push({
      token: TOKEN,
      user_did: DID,
      expires_at: iso(Date.now() + 20 * DAY),
    });
    db.failOnce('frontend_sessions', 'select');
    expect(await store().validateWithDetails(TOKEN)).toEqual({
      userDid: DID,
      error: null,
    });
    expect(db.ops).toHaveLength(2);
  });
});

describe('countForUser and deleteToken', () => {
  it('counts only live tokens of the DID, with exactly those filters', async () => {
    const rows = db.rowsOf('frontend_sessions');
    rows.push({ token: tokenOf(1), user_did: DID, expires_at: iso(NOW + DAY) });
    rows.push({ token: tokenOf(2), user_did: DID, expires_at: iso(NOW - DAY) });
    rows.push({
      token: tokenOf(3),
      user_did: 'did:plc:someoneelse',
      expires_at: iso(NOW + DAY),
    });
    expect(await store().countForUser(DID)).toBe(1);
    expect(db.ops.at(-1).filters).toEqual([
      `user_did eq ${DID}`,
      `expires_at gt ${iso(NOW)}`,
    ]);
  });

  it('answers null when the count cannot be read', async () => {
    db.failNext('frontend_sessions', 'select');
    expect(await store().countForUser(DID)).toBeNull();
  });

  it('deletes just the one token and forgets it', async () => {
    const other = tokenOf(4);
    db.rowsOf('frontend_sessions').push(
      { token: TOKEN, user_did: DID, expires_at: iso(NOW + 20 * DAY) },
      { token: other, user_did: DID, expires_at: iso(NOW + 20 * DAY) },
    );
    const s = store();
    await s.validateWithDetails(TOKEN);
    expect(await s.deleteToken(TOKEN)).toBe(true);
    expect(db.rowsOf('frontend_sessions').map((r) => r.token)).toEqual([other]);
    expect(await s.validateWithDetails(TOKEN)).toEqual({
      userDid: null,
      error: null,
    });
  });

  it('says so when the delete fails, and treats a malformed token as gone', async () => {
    db.failNext('frontend_sessions', 'delete');
    expect(await store().deleteToken(TOKEN)).toBe(false);
    expect(await store().deleteToken('not-a-token')).toBe(true);
  });
});

describe('resolveUserDid', () => {
  const req = (token) => ({ headers: { authorization: `Bearer ${token}` } });

  beforeEach(() => {
    db.rowsOf('frontend_sessions').push({
      token: TOKEN,
      user_did: DID,
      expires_at: iso(NOW + 20 * DAY),
    });
  });

  it('resolves a live token', async () => {
    expect(await resolveUserDid(req(TOKEN))).toEqual({
      userDid: DID,
      status: 200,
      error: null,
      code: null,
    });
    expect(db.ops.map((o) => o.table)).toEqual(['frontend_sessions']);
  });

  it('answers a missing header with the code the client reads as signed out', async () => {
    expect(await resolveUserDid({ headers: {} })).toEqual({
      userDid: null,
      status: 401,
      error: 'Missing or invalid authorization header',
      code: 'FRONTEND_SESSION_INVALID',
    });
    expect(
      await resolveUserDid({ headers: { authorization: 'Basic abc' } }),
    ).toMatchObject({ status: 401 });
  });

  it('answers an unknown token 401 FRONTEND_SESSION_INVALID', async () => {
    expect(await resolveUserDid(req(tokenOf(9)))).toEqual({
      userDid: null,
      status: 401,
      error: 'Invalid or expired session',
      code: 'FRONTEND_SESSION_INVALID',
    });
  });

  it('keeps the transient answer apart from the definitive one', async () => {
    vi.useRealTimers();
    db.failNext('frontend_sessions', 'select');
    const result = await resolveUserDid(req(tokenOf(5)));
    expect(result).toEqual({
      userDid: null,
      status: 503,
      error: 'Session validation temporarily unavailable, please retry',
      code: 'VALIDATION_TRANSIENT_ERROR',
    });
    expect(db.ops.map((o) => o.table)).toEqual([
      'frontend_sessions',
      'frontend_sessions',
      'frontend_sessions',
    ]);
  });
});
