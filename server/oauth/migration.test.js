// supabase/migrations/20261113000100_oauth.sql, read as text and then run on
// an in-process Postgres (PGlite) with Supabase's roles and default
// privileges, applied twice, so its behaviour is tested and so is re-applying
// it. Then the real stores run against the real schema.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createTestDatabase, readMigration } from '../test/pglite.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../supabase.js';
import {
  FrontendSessionStore,
  SessionStore,
  StateStore,
  SupabaseLock,
  tokenKey,
} from './storage.js';

const FILE = '20261113000100_oauth.sql';
const TABLES = [
  'frontend_sessions',
  'oauth_locks',
  'oauth_sessions',
  'oauth_state',
];

const executable = (sql) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
const normalized = (sql) => executable(sql).replace(/\s+/g, ' ').toLowerCase();

describe('the migration as text', () => {
  const sql = normalized(readMigration(FILE));

  it('creates the four tables, idempotently, with RLS on and nothing for anon or authenticated', () => {
    for (const table of TABLES) {
      expect(sql).toContain(`create table if not exists ${table} (`);
      expect(sql).toMatch(
        new RegExp(`alter table ${table} +enable row level security;`),
      );
      expect(sql).toMatch(
        new RegExp(`revoke all on table ${table} +from anon, authenticated;`),
      );
    }
    expect(sql).toContain('sub text primary key');
    expect(sql).toContain('token_hash text primary key');
    expect(sql).not.toMatch(/create policy/);
    expect(sql).not.toMatch(/security definer/);
    expect(sql).not.toMatch(/drop table|truncate/);
  });

  it('pins search_path on every function and revokes each from the public roles', () => {
    const functions = sql.match(/create or replace function/g) || [];
    expect(functions).toHaveLength(3);
    expect((sql.match(/set search_path = public, pg_temp/g) || []).length).toBe(
      functions.length,
    );
    for (const fn of [
      'acquire_oauth_lock(text, text, integer)',
      'release_oauth_lock(text, text)',
      'update_updated_at_column()',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function ${fn.replace(/[()]/g, '\\$&')} +from public, anon, authenticated;`,
        ),
      );
    }
  });

  it('indexes what the stores filter on and keeps updated_at current', () => {
    expect(sql).toContain(
      'create index if not exists idx_oauth_state_expires on oauth_state(expires_at);',
    );
    expect(sql).toContain(
      'create index if not exists idx_frontend_sessions_expires on frontend_sessions(expires_at);',
    );
    expect(sql).toContain(
      'create index if not exists idx_frontend_sessions_user_did on frontend_sessions(user_did, expires_at);',
    );
    expect(sql).toContain(
      'drop trigger if exists update_oauth_sessions_updated_at on oauth_sessions;',
    );
    expect(sql).toContain('execute function update_updated_at_column();');
  });

  it('keeps one set of tables, with no per-client columns or functions', () => {
    expect(sql).not.toMatch(/client_key|virga_|_v2/);
  });
});

describe('the migration, run', () => {
  let t;

  beforeAll(async () => {
    t = await createTestDatabase({ upTo: FILE });
    // Re-applied on top of itself.
    await t.exec(readMigration(FILE));
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(async () => {
    await t.exec(
      'DELETE FROM oauth_locks; DELETE FROM oauth_sessions; DELETE FROM oauth_state; DELETE FROM frontend_sessions;',
    );
  });

  const acquire = (key, holder, ttl = 20) =>
    t.supabase.rpc('acquire_oauth_lock', {
      p_key: key,
      p_holder: holder,
      p_ttl_seconds: ttl,
    });
  const release = (key, holder) =>
    t.supabase.rpc('release_oauth_lock', { p_key: key, p_holder: holder });

  it('turns RLS on for every table', async () => {
    const { rows } = await t.query(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind = 'r' ORDER BY relname`,
      [TABLES],
    );
    expect(rows).toEqual(
      TABLES.map((relname) => ({ relname, relrowsecurity: true })),
    );
  });

  it('leaves anon and authenticated no privilege on a table or a function', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const table of TABLES) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const { rows } = await t.query(
            `SELECT has_table_privilege($1, $2, $3) AS ok`,
            [role, table, privilege],
          );
          expect(rows[0].ok, `${role} ${privilege} ${table}`).toBe(false);
        }
      }
      for (const fn of [
        'acquire_oauth_lock(text, text, integer)',
        'release_oauth_lock(text, text)',
        'update_updated_at_column()',
      ]) {
        const { rows } = await t.query(
          `SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`,
          [role, fn],
        );
        expect(rows[0].ok, `${role} ${fn}`).toBe(false);
      }
    }
    const { rows } = await t.query(
      `SELECT has_function_privilege('service_role', 'acquire_oauth_lock(text, text, integer)', 'EXECUTE') AS ok`,
    );
    expect(rows[0].ok).toBe(true);
  });

  it('gives the lock to one holder at a time', async () => {
    expect(await acquire('k', 'a')).toEqual({ data: true, error: null });
    expect((await acquire('k', 'b')).data).toBe(false);
    // Taking it again as the same holder is not a second holder.
    expect((await acquire('k', 'a')).data).toBe(true);
  });

  it('lets a lock expire, and another holder take it then', async () => {
    expect((await acquire('k', 'a', 0)).data).toBe(true);
    // A zero TTL is already past by the time the next statement runs.
    await t.exec(
      `UPDATE oauth_locks SET expires_at = NOW() - INTERVAL '1 second' WHERE key = 'k'`,
    );
    expect((await acquire('k', 'b')).data).toBe(true);
    const { rows } = await t.query(
      `SELECT holder FROM oauth_locks WHERE key = 'k'`,
    );
    expect(rows).toEqual([{ holder: 'b' }]);
  });

  it('releases only for the holder', async () => {
    await acquire('k', 'a');
    await release('k', 'b');
    expect((await acquire('k', 'b')).data).toBe(false);
    await release('k', 'a');
    expect((await acquire('k', 'b')).data).toBe(true);
  });

  it('bumps updated_at on an update', async () => {
    await t.exec(
      `INSERT INTO oauth_sessions (sub, session_data, updated_at) VALUES ('did:plc:x', '{}', NOW() - INTERVAL '1 day')`,
    );
    const before = (
      await t.query(
        `SELECT updated_at FROM oauth_sessions WHERE sub = 'did:plc:x'`,
      )
    ).rows[0].updated_at;
    await t.exec(
      `UPDATE oauth_sessions SET session_data = '{"a":1}' WHERE sub = 'did:plc:x'`,
    );
    const after = (
      await t.query(
        `SELECT updated_at FROM oauth_sessions WHERE sub = 'did:plc:x'`,
      )
    ).rows[0].updated_at;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  describe('with the real stores', () => {
    const DID = 'did:plc:virgapglite00000000000000';

    beforeAll(() => setSupabaseClientForTests(t.supabase));
    afterAll(() => resetSupabaseClientForTests());

    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('saves, reads and deletes a session', async () => {
      const store = new SessionStore();
      const session = {
        dpopJwk: { kty: 'EC' },
        tokenSet: {
          sub: DID,
          aud: 'https://pds.example',
          scope: 'atproto',
          access_token: 'a',
        },
      };
      await store.set(DID, session);
      await store.set(DID, {
        ...session,
        tokenSet: { ...session.tokenSet, access_token: 'b' },
      });
      expect((await new SessionStore().get(DID)).tokenSet.access_token).toBe(
        'b',
      );
      expect(await new SessionStore().get('did:plc:nobody')).toBeUndefined();
      expect(await store.forceDelete(DID)).toBe(true);
      expect(await store.get(DID)).toBeUndefined();
    });

    it('keeps and clears sign-in state', async () => {
      const store = new StateStore();
      await store.set('state-1', { iss: 'https://as.example', appState: '{}' });
      expect(await store.get('state-1')).toEqual({
        iss: 'https://as.example',
        appState: '{}',
      });
      await store.del('state-1');
      expect(await store.get('state-1')).toBeUndefined();
    });

    it('mints, validates, counts and deletes tokens', async () => {
      const store = new FrontendSessionStore();
      const a = await store.create(DID);
      const b = await store.create(DID);
      expect(await store.validateWithDetails(a)).toEqual({
        userDid: DID,
        error: null,
      });
      expect(await store.countForUser(DID)).toBe(2);
      await t.exec(
        `UPDATE frontend_sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = '${tokenKey(b)}'`,
      );
      expect(await store.countForUser(DID)).toBe(1);
      expect(await new FrontendSessionStore().validateWithDetails(b)).toEqual({
        userDid: null,
        error: null,
      });
      expect(await store.deleteToken(a)).toBe(true);
      expect(await store.countForUser(DID)).toBe(0);
      expect(await new FrontendSessionStore().validateWithDetails(a)).toEqual({
        userDid: null,
        error: null,
      });
    });

    it('slides a token near expiry forward', async () => {
      const store = new FrontendSessionStore();
      const token = await store.create(DID, 2);
      await new FrontendSessionStore().validateWithDetails(token);
      const { rows } = await t.query(
        `SELECT expires_at FROM frontend_sessions WHERE token_hash = $1`,
        [tokenKey(token)],
      );
      expect(rows[0].expires_at.getTime() - Date.now()).toBeGreaterThan(
        29 * 24 * 60 * 60 * 1000,
      );
    });

    it('locks and unlocks through the RPCs', async () => {
      const lock = new SupabaseLock();
      let inside;
      await lock.lock('@atproto-oauth-client-did:plc:x', async () => {
        inside = (await t.query(`SELECT count(*)::int AS n FROM oauth_locks`))
          .rows[0].n;
      });
      expect(inside).toBe(1);
      expect(
        (await t.query(`SELECT count(*)::int AS n FROM oauth_locks`)).rows[0].n,
      ).toBe(0);
    });
  });
});
