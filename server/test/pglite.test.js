import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, listMigrations, MIGRATIONS_DIR, selectMigrations, supabaseAdapter } from './pglite.js';

// The helper is tested on fixture migrations of its own, so it is pinned
// whatever the real migrations folder holds at the moment.

const FIXTURE_A = `
CREATE TABLE IF NOT EXISTS things (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  score      INTEGER,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE things ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE things FROM anon, authenticated;

CREATE OR REPLACE FUNCTION count_things(p_owner TEXT) RETURNS INTEGER
LANGUAGE sql SET search_path = public, pg_temp
AS $$ SELECT count(*)::int FROM things WHERE owner = p_owner $$;

CREATE OR REPLACE FUNCTION claim_things(p_owner TEXT, p_limit INTEGER DEFAULT 10) RETURNS SETOF things
LANGUAGE sql SET search_path = public, pg_temp
AS $$ UPDATE things SET status = 'claimed' WHERE id IN (
  SELECT id FROM things WHERE owner = p_owner AND status = 'pending' ORDER BY id LIMIT p_limit
) RETURNING * $$;

CREATE OR REPLACE FUNCTION touch_things(p_ids TEXT[]) RETURNS VOID
LANGUAGE sql SET search_path = public, pg_temp
AS $$ UPDATE things SET score = COALESCE(score, 0) + 1 WHERE id = ANY(p_ids) $$;

CREATE OR REPLACE FUNCTION echo_json(p_value JSONB) RETURNS JSONB
LANGUAGE sql SET search_path = public, pg_temp
AS $$ SELECT p_value $$;

REVOKE ALL ON FUNCTION count_things(TEXT) FROM PUBLIC, anon, authenticated;
`;

const FIXTURE_B = `
CREATE TABLE IF NOT EXISTS later (id INTEGER PRIMARY KEY);
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE WARNING 'no storage.buckets table; the bucket was not created';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('scheduled-media', 'scheduled-media', false, 10485760)
  ON CONFLICT (id) DO NOTHING;
END
$$;
`;

let dir;
let emptyDir;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'virga-pglite-'));
  writeFileSync(join(dir, '20260101000200_b.sql'), FIXTURE_B);
  writeFileSync(join(dir, '20260101000100_a.sql'), FIXTURE_A);
  writeFileSync(join(dir, 'README.md'), 'not a migration');
  emptyDir = join(dir, 'empty');
  mkdirSync(emptyDir);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('listing and selecting migrations', () => {
  it('lists .sql files in name order', () => {
    expect(listMigrations(dir)).toEqual(['20260101000100_a.sql', '20260101000200_b.sql']);
  });

  it('is empty for an empty or missing folder', () => {
    expect(listMigrations(emptyDir)).toEqual([]);
    expect(listMigrations(join(dir, 'nope'))).toEqual([]);
  });

  it('stops at upTo, by file name or version prefix', () => {
    expect(selectMigrations({ dir, upTo: '20260101000100' })).toEqual(['20260101000100_a.sql']);
    expect(selectMigrations({ dir, upTo: '20260101000200_b.sql' })).toEqual(['20260101000100_a.sql', '20260101000200_b.sql']);
    expect(() => selectMigrations({ dir, upTo: '1999' })).toThrow(/No migration/);
  });

  it('points at supabase/migrations by default', () => {
    expect(MIGRATIONS_DIR.replace(/\\/g, '/')).toMatch(/\/supabase\/migrations\/$/);
  });
});

describe('createTestDatabase', () => {
  it('starts on an empty migrations folder, with the roles and storage in place', async () => {
    const t = await createTestDatabase({ dir: emptyDir });
    try {
      expect(t.applied).toEqual([]);
      const { rows } = await t.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') ORDER BY 1`);
      expect(rows.map((r) => r.rolname)).toEqual(['anon', 'authenticated', 'service_role']);
      expect((await t.query(`SELECT to_regclass('storage.buckets') IS NOT NULL AS ok`)).rows[0].ok).toBe(true);
    } finally {
      await t.close();
    }
  });

  it('applies the real migrations folder, whatever it holds', async () => {
    const t = await createTestDatabase();
    try {
      expect(t.applied).toEqual(listMigrations());
    } finally {
      await t.close();
    }
  });

  it('applies Supabase’s default grants, so a table without a REVOKE stays open to anon', async () => {
    const t = await createTestDatabase({ dir });
    try {
      const { rows } = await t.query(
        `SELECT has_table_privilege('anon', 'public.later', 'SELECT') AS later,
                has_table_privilege('anon', 'public.things', 'SELECT') AS things,
                has_function_privilege('anon', 'public.count_things(text)', 'EXECUTE') AS revoked_fn,
                has_function_privilege('anon', 'public.echo_json(jsonb)', 'EXECUTE') AS open_fn`,
      );
      expect(rows[0]).toEqual({ later: true, things: false, revoked_fn: false, open_fn: true });
    } finally {
      await t.close();
    }
  });

  it('applies up to a migration, and a guarded bucket insert runs or skips', async () => {
    const first = await createTestDatabase({ dir, upTo: '20260101000100' });
    try {
      expect(first.applied).toEqual(['20260101000100_a.sql']);
      expect((await first.query(`SELECT to_regclass('public.later') AS t`)).rows[0].t).toBeNull();
    } finally {
      await first.close();
    }
    const withStorage = await createTestDatabase({ dir });
    try {
      expect((await withStorage.query(`SELECT id, public FROM storage.buckets`)).rows).toEqual([{ id: 'scheduled-media', public: false }]);
      // Re-applying is a no-op.
      await withStorage.exec(FIXTURE_A + FIXTURE_B);
    } finally {
      await withStorage.close();
    }
    const withoutStorage = await createTestDatabase({ dir, storage: false });
    try {
      expect((await withoutStorage.query(`SELECT to_regclass('storage.buckets') AS t`)).rows[0].t).toBeNull();
    } finally {
      await withoutStorage.close();
    }
  });

  it('names the file that failed', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'virga-pglite-bad-'));
    try {
      writeFileSync(join(bad, '0001_bad.sql'), 'CREATE TABLE broken (');
      await expect(createTestDatabase({ dir: bad })).rejects.toThrow(/^0001_bad\.sql: /);
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  });
});

describe('supabaseAdapter', () => {
  let t;
  let sb;

  beforeAll(async () => {
    t = await createTestDatabase({ dir });
    sb = t.supabase;
    expect(typeof supabaseAdapter).toBe('function');
  });

  afterAll(async () => {
    await t?.close();
  });

  it('inserts and reads rows through the builder', async () => {
    const { error } = await sb.from('things').insert([
      { id: 'a', owner: 'did:plc:a', score: 3, payload: { text: 'hi', tags: ['x'] } },
      { id: 'b', owner: 'did:plc:a', score: 7 },
      { id: 'c', owner: 'did:plc:b' },
    ]);
    expect(error).toBeNull();
    const { data } = await sb.from('things').select('id, payload').eq('id', 'a').single();
    expect(data).toEqual({ id: 'a', payload: { text: 'hi', tags: ['x'] } });
    expect((await sb.from('things').select('id').in('id', ['a', 'c']).order('id', { ascending: false })).data).toEqual([{ id: 'c' }, { id: 'a' }]);
    expect((await sb.from('things').select('id').gt('score', 3)).data).toEqual([{ id: 'b' }]);
    expect((await sb.from('things').select('id').is('score', null)).data).toEqual([{ id: 'c' }]);
    expect((await sb.from('things').select('id').eq('id', 'zzz').maybeSingle()).data).toBeNull();
    expect((await sb.from('things').select('id').eq('id', 'zzz').single()).error.code).toBe('PGRST116');
  });

  it('counts with head, and alongside a limited page', async () => {
    expect(await sb.from('things').select('id', { count: 'exact', head: true }).eq('owner', 'did:plc:a')).toEqual({ data: null, error: null, count: 2 });
    const page = await sb.from('things').select('id', { count: 'exact' }).order('id').limit(1);
    expect(page.data).toEqual([{ id: 'a' }]);
    expect(page.count).toBe(3);
    expect((await sb.from('things').select('id').order('id').range(1, 2)).data).toEqual([{ id: 'b' }, { id: 'c' }]);
  });

  it('applies or() and not() filters', async () => {
    const { data } = await sb.from('things').select('id').or('id.eq.c,and(owner.eq.did:plc:a,score.gte.7)').order('id');
    expect(data).toEqual([{ id: 'b' }, { id: 'c' }]);
    expect((await sb.from('things').select('id').not('id', 'in', '(a,b)')).data).toEqual([{ id: 'c' }]);
  });

  it('updates, upserts and deletes, with returning', async () => {
    expect((await sb.from('things').update({ status: 'done' }).eq('id', 'c').select()).data[0]).toMatchObject({ id: 'c', status: 'done' });
    await sb.from('things').upsert({ id: 'c', owner: 'did:plc:b', score: 1 }, { onConflict: 'id' });
    expect((await sb.from('things').select('score').eq('id', 'c').single()).data).toEqual({ score: 1 });
    expect((await sb.from('things').delete().eq('id', 'c').select()).data.map((r) => r.id)).toEqual(['c']);
  });

  it('calls functions by named arguments and answers like PostgREST', async () => {
    expect(await sb.rpc('count_things', { p_owner: 'did:plc:a' })).toEqual({ data: 2, error: null });
    const claimed = await sb.rpc('claim_things', { p_owner: 'did:plc:a', p_limit: 1 });
    expect(claimed.data.map((r) => [r.id, r.status])).toEqual([['a', 'claimed']]);
    expect(await sb.rpc('touch_things', { p_ids: ['a', 'b'] })).toEqual({ data: null, error: null });
    expect((await sb.rpc('echo_json', { p_value: { a: [1, 2] } })).data).toEqual({ a: [1, 2] });
  });

  it('gives PostgREST’s codes for what is missing', async () => {
    expect((await sb.rpc('nope', { p_x: 1 })).error.code).toBe('PGRST202');
    expect((await sb.rpc('count_things', { p_wrong: 1 })).error.code).toBe('PGRST202');
    expect((await sb.from('missing_table').select('*')).error.code).toBe('PGRST205');
    expect((await sb.from('things').insert({ id: 'z', owner: 'x', nope: 1 })).error.code).toBe('PGRST204');
    expect((await sb.from('things').insert({ id: 'a', owner: 'x' })).error.code).toBe('23505');
  });

  it('has an in-memory storage', async () => {
    await sb.storage.from('scheduled-media').upload('x/y', Buffer.from('ok'));
    expect(sb.storage.read('scheduled-media', 'x/y').toString()).toBe('ok');
  });
});
