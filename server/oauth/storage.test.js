// The session and state stores: what they write, what they note about a
// session (its PDS and granted scope), encryption at rest, and the library
// delete that is deliberately ignored.

import crypto from 'node:crypto';
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
import {
  SessionStore,
  StateStore,
  getStorage,
  normalizePds,
  resetStorageForTests,
} from './storage.js';
import { isEncrypted } from './sessionCrypto.js';

const DID = 'did:plc:virgastore00000000000000';
const PDS = 'https://morel.us-east.host.bsky.network';
const saved = (over = {}) => ({
  dpopJwk: { kty: 'EC' },
  authMethod: { method: 'private_key_jwt', kid: 'k' },
  tokenSet: {
    sub: DID,
    aud: PDS,
    scope: 'atproto repo:app.bsky.feed.post',
    access_token: 'at',
    refresh_token: 'rt',
    ...over,
  },
});

const db = createFakeSupabase();

beforeAll(() => setSupabaseClientForTests(db));
afterAll(() => {
  resetStorageForTests();
  resetSupabaseClientForTests();
});

beforeEach(() => {
  db.reset();
  delete process.env.SESSION_ENCRYPTION_KEY;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.SESSION_ENCRYPTION_KEY;
  vi.restoreAllMocks();
});

describe('normalizePds', () => {
  it('keeps an http(s) origin plus path, without a trailing slash', () => {
    expect(normalizePds(`${PDS}/`)).toBe(PDS);
    expect(normalizePds('https://pds.example.test/base/')).toBe(
      'https://pds.example.test/base',
    );
    expect(normalizePds('http://localhost:2583')).toBe('http://localhost:2583');
  });

  it.each([
    ['not a URL', 'pds'],
    ['another scheme', 'wss://pds.example.test'],
    ['credentials', 'https://user:pass@pds.example.test'],
    ['a query', 'https://pds.example.test/?x=1'],
    ['a fragment', 'https://pds.example.test/#x'],
    ['no audience', null],
  ])('refuses %s', (_label, aud) => {
    expect(normalizePds(aud)).toBeNull();
  });
});

describe('SessionStore', () => {
  it('upserts by DID and notes the PDS and scope as it saves', async () => {
    const store = new SessionStore();
    await store.set(DID, saved());
    expect(db.rowsOf('oauth_sessions')).toEqual([
      expect.objectContaining({ sub: DID, session_data: saved() }),
    ]);
    expect(db.ops[0]).toMatchObject({
      table: 'oauth_sessions',
      verb: 'upsert',
    });
    expect(store.pdsFor(DID)).toBe(PDS);
    expect(store.scopeFor(DID)).toBe('atproto repo:app.bsky.feed.post');
  });

  it('notes them as it reads, so a new instance knows them after one read', async () => {
    db.rowsOf('oauth_sessions').push({ sub: DID, session_data: saved() });
    const store = new SessionStore();
    expect(store.pdsFor(DID)).toBeNull();
    expect(await store.get(DID)).toEqual(saved());
    expect(store.pdsFor(DID)).toBe(PDS);
  });

  it('takes nothing from a token set issued to another DID, and never throws while noting', async () => {
    const store = new SessionStore();
    store.noteSession(DID, saved({ sub: 'did:plc:someoneelse' }));
    expect(store.pdsFor(DID)).toBeNull();
    for (const session of [
      undefined,
      {},
      {
        get tokenSet() {
          throw new Error('boom');
        },
      },
    ]) {
      expect(() => store.noteSession(DID, session)).not.toThrow();
    }
    expect(store.scopeFor(DID)).toBeNull();
  });

  it('replaces an older note when a new sign-in saves', async () => {
    const store = new SessionStore();
    store.noteSession(DID, saved({ aud: 'https://old.example.test' }));
    await store.set(DID, saved());
    expect(store.pdsFor(DID)).toBe(PDS);
  });

  it('answers undefined for a missing row or a failed read', async () => {
    const store = new SessionStore();
    expect(await store.get(DID)).toBeUndefined();
    db.rowsOf('oauth_sessions').push({ sub: DID, session_data: saved() });
    db.failNext('oauth_sessions', 'select');
    expect(await store.get(DID)).toBeUndefined();
  });

  it('throws when a save fails, so the library knows', async () => {
    db.failNext('oauth_sessions', 'upsert');
    await expect(new SessionStore().set(DID, saved())).rejects.toMatchObject({
      code: 'XX000',
    });
  });

  it('ignores the library asking to delete, and deletes for real on forceDelete', async () => {
    db.rowsOf('oauth_sessions').push({ sub: DID, session_data: saved() });
    const store = new SessionStore();
    await store.get(DID);
    await store.del(DID);
    expect(db.rowsOf('oauth_sessions')).toHaveLength(1);
    expect(await store.forceDelete(DID)).toBe(true);
    expect(db.rowsOf('oauth_sessions')).toEqual([]);
    expect(store.pdsFor(DID)).toBeNull();
  });

  it('says whether a row exists without reading it, and null when it cannot say', async () => {
    const store = new SessionStore();
    expect(await store.exists(DID)).toBe(false);
    db.rowsOf('oauth_sessions').push({ sub: DID, session_data: saved() });
    expect(await store.exists(DID)).toBe(true);
    db.failNext('oauth_sessions', 'select');
    expect(await store.exists(DID)).toBeNull();
  });

  it('stores an envelope when SESSION_ENCRYPTION_KEY is set, and reads it back', async () => {
    process.env.SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    const store = new SessionStore();
    // Tokens long and distinctive enough that random ciphertext can't contain them.
    const secret = {
      access_token: 'access-token-that-must-not-be-stored-in-clear',
      refresh_token: 'refresh-token-that-must-not-be-stored-in-clear',
    };
    await store.set(DID, saved(secret));
    const stored = db.rowsOf('oauth_sessions')[0].session_data;
    expect(isEncrypted(stored)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(secret.access_token);
    expect(JSON.stringify(stored)).not.toContain(secret.refresh_token);
    expect(await new SessionStore().get(DID)).toEqual(saved(secret));
  });

  it('reads an envelope it cannot decrypt as missing, not as a crash', async () => {
    process.env.SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    await new SessionStore().set(DID, saved());
    delete process.env.SESSION_ENCRYPTION_KEY;
    expect(await new SessionStore().get(DID)).toBeUndefined();
  });
});

describe('StateStore', () => {
  it('keeps a state for an hour and hands it back', async () => {
    const store = new StateStore();
    const now = Date.now();
    await store.set('k1', { iss: 'https://as.example', appState: '{}' });
    const row = db.rowsOf('oauth_state')[0];
    expect(row.key).toBe('k1');
    expect(Date.parse(row.expires_at) - now).toBeGreaterThan(59 * 60 * 1000);
    expect(await store.get('k1')).toEqual({
      iss: 'https://as.example',
      appState: '{}',
    });
    await store.del('k1');
    expect(db.rowsOf('oauth_state')).toEqual([]);
  });

  it('drops an expired state on read', async () => {
    db.rowsOf('oauth_state').push({
      key: 'old',
      state_data: {},
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await new StateStore().get('old')).toBeUndefined();
    expect(db.rowsOf('oauth_state')).toEqual([]);
  });

  it('clears expired rows as it writes, at most once a minute', async () => {
    let now = Date.parse('2026-11-13T12:00:00Z');
    const iso = (ms) => new Date(ms).toISOString();
    // Sign-ins started and never finished.
    db.rowsOf('oauth_state').push(
      { key: 'abandoned', state_data: {}, expires_at: iso(now - 1000) },
      { key: 'in-flight', state_data: {}, expires_at: iso(now + 1000) },
    );
    const store = new StateStore({ now: () => now });
    await store.set('k1', {});
    expect(
      db
        .rowsOf('oauth_state')
        .map((r) => r.key)
        .sort(),
    ).toEqual(['in-flight', 'k1']);

    db.rowsOf('oauth_state').push({
      key: 'later',
      state_data: {},
      expires_at: iso(now - 1),
    });
    now += 30 * 1000;
    await store.set('k2', {});
    expect(db.rowsOf('oauth_state').map((r) => r.key)).toContain('later');
    now += 31 * 1000;
    await store.set('k3', {});
    expect(db.rowsOf('oauth_state').map((r) => r.key)).not.toContain('later');
  });

  it('still saves when the sweep fails', async () => {
    db.failNext('oauth_state', 'delete');
    await new StateStore().set('k', {});
    expect(db.rowsOf('oauth_state').map((r) => r.key)).toEqual(['k']);
  });

  it('answers undefined for an unknown key, and throws when a save fails', async () => {
    expect(await new StateStore().get('nope')).toBeUndefined();
    db.failNext('oauth_state', 'upsert');
    await expect(new StateStore().set('k', {})).rejects.toBeTruthy();
  });
});

describe('getStorage', () => {
  it('is one set of stores per instance until reset', () => {
    const a = getStorage();
    expect(getStorage()).toBe(a);
    expect(a.sessionStore.table).toBe('oauth_sessions');
    expect(a.stateStore.table).toBe('oauth_state');
    expect(a.frontendSessionStore.table).toBe('frontend_sessions');
    expect(a.fastPath.armed).toBe(false);
    resetStorageForTests();
    expect(getStorage()).not.toBe(a);
  });
});
