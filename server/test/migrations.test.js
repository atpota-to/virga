import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestDatabase,
  listMigrations,
  readMigration,
  DEFAULT_GRANTS_SQL,
  ROLES_SQL,
  STORAGE_SQL,
} from './pglite.js';
import { DB_SCHEMA } from '../supabase.js';

// What every file in supabase/migrations must hold to, checked on the database
// they build rather than on their text: they apply in order and apply again
// unchanged (supabase db push and a pasted re-run both happen), everything
// they make is in Virga's own schema, and only the service role can reach any
// of it. A function anyone may EXECUTE is callable through PostgREST with the
// public anon key, so each file has to take such grants back. Holds trivially
// while the folder is empty.
//
// The privilege checks run twice: on a project that granted the schema and
// everything in it to anon, authenticated and service_role, as Supabase's
// guide to exposing a schema has you do (so a missing REVOKE shows), and on
// one that granted nothing (so a missing GRANT to service_role shows; with
// the grants in place service_role has everything regardless).
//
// The last block applies them beside another app that already keeps tables,
// functions and a bucket of the same names in public, which is how Virga
// shares a Supabase project, and checks that none of those is touched.

const files = listMigrations();
let t;
let bare;

beforeAll(async () => {
  [t, bare] = await Promise.all([createTestDatabase(), createTestDatabase({ defaultGrants: false })]);
});

afterAll(async () => {
  await Promise.all([t?.close(), bare?.close()]);
});

async function tablePrivileges(db) {
  const { rows } = await db.query(
    `SELECT c.relname AS name,
            c.relrowsecurity AS rls,
            has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
            has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authed,
            has_table_privilege('service_role', c.oid, 'SELECT') AND has_table_privilege('service_role', c.oid, 'INSERT') AS service_add,
            has_table_privilege('service_role', c.oid, 'UPDATE') AND has_table_privilege('service_role', c.oid, 'DELETE') AS service_change,
            has_table_privilege('service_role', c.oid, 'UPDATE,DELETE,TRUNCATE') AS service_any_change
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
      ORDER BY 1`,
    [DB_SCHEMA],
  );
  return rows;
}

// Trigger functions are left out: Postgres checks no EXECUTE privilege when a
// trigger fires, so update_updated_at_column needs no grant to anyone.
async function functionPrivileges(db) {
  const { rows } = await db.query(
    `SELECT p.oid::regprocedure::text AS name,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
            has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1 AND p.prorettype <> 'trigger'::regtype
      ORDER BY 1`,
    [DB_SCHEMA],
  );
  return rows;
}

// A record that is only ever added to: the service role reads and inserts,
// and holds no way to rewrite or remove a row.
const APPEND_ONLY = ['terms_acceptance'];

const projects = [
  ['that granted the schema to every role', () => t],
  ['that granted nothing', () => bare],
];

describe('supabase/migrations', () => {
  it('uses Supabase CLI names, so db push applies them in order', () => {
    for (const name of files) expect(name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(new Set(files.map((f) => f.slice(0, 14))).size).toBe(files.length);
  });

  it('applies every file a second time without error', async () => {
    for (const name of files) {
      await expect(t.exec(readMigration(name)), name).resolves.toBeDefined();
    }
  });

  it('builds something, all of it in Virga’s schema and none of it in public', async () => {
    for (const db of [t, bare]) {
      const { rows } = await db.query(
        `SELECT n.nspname AS schema, count(*)::int AS n
           FROM (SELECT relnamespace AS ns FROM pg_class WHERE relkind IN ('r', 'p', 'i', 'S', 'v', 'm')
                 UNION ALL SELECT pronamespace FROM pg_proc
                 UNION ALL SELECT typnamespace FROM pg_type WHERE typtype IN ('e', 'd')) o
           JOIN pg_namespace n ON n.oid = o.ns
          WHERE n.nspname IN ('public', $1)
          GROUP BY 1`,
        [DB_SCHEMA],
      );
      const counts = Object.fromEntries(rows.map((r) => [r.schema, r.n]));
      expect(counts.public ?? 0).toBe(0);
      if (files.length) expect(counts[DB_SCHEMA]).toBeGreaterThan(0);
    }
  });

  it('leaves no SECURITY DEFINER function and no policy', async () => {
    const definers = await t.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1 AND p.prosecdef`,
      [DB_SCHEMA],
    );
    expect(definers.rows).toEqual([]);
    expect((await t.query(`SELECT policyname FROM pg_policies WHERE schemaname = $1`, [DB_SCHEMA])).rows).toEqual([]);
  });

  it('pins search_path on every function, to Virga’s schema and never to public', async () => {
    const { rows } = await t.query(
      `SELECT p.oid::regprocedure::text AS name, p.proconfig AS config
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1`,
      [DB_SCHEMA],
    );
    for (const fn of rows) {
      const path = (fn.config || []).find((c) => c.startsWith('search_path='));
      expect(path, fn.name).toBe(`search_path=${DB_SCHEMA}, pg_temp`);
    }
  });
});

describe.each(projects)('supabase/migrations on a project %s', (_label, db) => {
  it('lets the service role into the schema, and not anon, authenticated or PUBLIC', async () => {
    if (!files.length) return;
    const { rows } = await db().query(
      `SELECT has_schema_privilege('service_role', $1, 'USAGE') AS service,
              has_schema_privilege('anon', $1, 'USAGE') AS anon,
              has_schema_privilege('authenticated', $1, 'USAGE') AS authed,
              has_schema_privilege('anon', $1, 'CREATE') OR has_schema_privilege('authenticated', $1, 'CREATE') AS can_create`,
      [DB_SCHEMA],
    );
    expect(rows[0]).toEqual({ service: true, anon: false, authed: false, can_create: false });
  });

  it('turns on RLS for every table, gives anon and authenticated nothing and service_role read and write', async () => {
    for (const table of await tablePrivileges(db())) {
      expect(table, table.name).toMatchObject({ rls: true, anon: false, authed: false, service_add: true });
      if (!APPEND_ONLY.includes(table.name)) expect(table.service_change, table.name).toBe(true);
    }
  });

  it('leaves service_role no way to change or remove a row of an append-only table', async () => {
    const tables = await tablePrivileges(db());
    for (const name of APPEND_ONLY) {
      const table = tables.find((row) => row.name === name);
      expect(table, name).toMatchObject({ service_add: true, service_any_change: false });
    }
  });

  it('lets only the service role execute the functions', async () => {
    for (const fn of await functionPrivileges(db())) {
      expect(fn, fn.name).toMatchObject({ anon: false, authed: false, service: true });
    }
  });

  it('leaves no trigger function callable by anon or authenticated', async () => {
    const { rows } = await db().query(
      `SELECT p.oid::regprocedure::text AS name,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1 AND p.prorettype = 'trigger'::regtype`,
      [DB_SCHEMA],
    );
    for (const fn of rows) expect(fn, fn.name).toMatchObject({ anon: false, authed: false });
  });
});

// Another app's objects in public, with the names Virga's would have had
// there: tables of other shapes, the index one migration drops and remakes, a
// trigger and its function, RPCs (one with the same arguments, one with an
// extra), all open to anon the way public is, and a bucket.
const NEIGHBOUR_SQL = `
CREATE TABLE public.scheduled_posts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_did           TEXT NOT NULL,
  note               TEXT,
  status             TEXT NOT NULL DEFAULT 'pending',
  media_reclaimed_at TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX scheduled_posts_media_reclaim_idx ON public.scheduled_posts (updated_at);
CREATE INDEX scheduled_posts_due_idx ON public.scheduled_posts (status);
CREATE TABLE public.oauth_sessions (
  sub          TEXT PRIMARY KEY,
  session_data JSONB NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.self_destruct_posts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), theirs TEXT);
CREATE TABLE public.ai_rate_limit (did TEXT PRIMARY KEY, theirs INTEGER);

CREATE FUNCTION public.update_updated_at_column() RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at = NOW() + INTERVAL '10 years';
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER update_oauth_sessions_updated_at
  BEFORE UPDATE ON public.oauth_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE FUNCTION public.claim_scheduled_posts(p_run_id TEXT, p_limit INTEGER DEFAULT 20)
RETURNS SETOF public.scheduled_posts LANGUAGE sql AS $fn$ SELECT * FROM public.scheduled_posts LIMIT 0 $fn$;
CREATE FUNCTION public.create_scheduled_post_capped(
  p_user_did TEXT, p_scheduled_for TIMESTAMPTZ, p_target TEXT, p_payload JSONB,
  p_queued BOOLEAN DEFAULT false, p_max_active INTEGER DEFAULT 50, p_tier_limit INTEGER DEFAULT NULL
) RETURNS JSONB LANGUAGE sql AS $fn$ SELECT '{"theirs": true}'::jsonb $fn$;
CREATE FUNCTION public.acquire_oauth_lock(p_key TEXT, p_holder TEXT, p_ttl_seconds INTEGER)
RETURNS BOOLEAN LANGUAGE sql AS $fn$ SELECT false $fn$;
CREATE FUNCTION public.consume_ai_daily(p_did TEXT, p_day TEXT, p_limit INTEGER)
RETURNS TABLE (allowed BOOLEAN, used INTEGER) LANGUAGE sql AS $fn$ SELECT false, -1 $fn$;

INSERT INTO public.scheduled_posts (user_did, note) VALUES ('did:plc:neighbour', 'theirs');
INSERT INTO public.oauth_sessions (sub, session_data) VALUES ('did:plc:neighbour', '{"theirs": true}');
INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('scheduled-media', 'scheduled-media', false, 1);
`;

// Everything in public, and every bucket, down to definitions, grants and rows.
async function neighbourSnapshot(db) {
  const { rows } = await db.query(
    `SELECT 'table' AS kind, c.relname::text AS name,
            (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
               FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
              || ' rls=' || c.relrowsecurity || ' acl=' || COALESCE(c.relacl::text, '') AS detail
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     UNION ALL
     SELECT 'index', indexname::text, indexdef FROM pg_indexes WHERE schemaname = 'public'
     UNION ALL
     SELECT 'function', p.oid::regprocedure::text,
            md5(p.prosrc) || ' config=' || COALESCE(p.proconfig::text, '') || ' acl=' || COALESCE(p.proacl::text, '')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
     UNION ALL
     SELECT 'trigger', g.tgname::text, pg_get_triggerdef(g.oid)
       FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT g.tgisinternal
     UNION ALL
     SELECT 'rows', 'scheduled_posts', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)::text FROM public.scheduled_posts s)
     UNION ALL
     SELECT 'rows', 'oauth_sessions', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sub)::text FROM public.oauth_sessions s)
     UNION ALL
     SELECT 'bucket', b.id, b.name || ' public=' || b.public || ' limit=' || b.file_size_limit
       FROM storage.buckets b WHERE b.id = 'scheduled-media'
     ORDER BY 1, 2`,
  );
  return rows;
}

describe('supabase/migrations beside another app in the same project', () => {
  let db;
  let before;

  beforeAll(async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    db = await PGlite.create();
    await db.exec(ROLES_SQL);
    await db.exec(DEFAULT_GRANTS_SQL);
    await db.exec(STORAGE_SQL);
    await db.exec(NEIGHBOUR_SQL);
    before = await neighbourSnapshot(db);
    // Twice, in order, with the search_path a Supabase session has.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const name of files) await db.exec(readMigration(name));
    }
  });

  afterAll(async () => {
    await db?.close();
  });

  it('leaves every table, index, trigger, function, grant, row and bucket of theirs as it was', async () => {
    expect(before.map((r) => r.kind)).toEqual(expect.arrayContaining(['table', 'index', 'function', 'trigger', 'rows', 'bucket']));
    expect(await neighbourSnapshot(db)).toEqual(before);
    // The neighbour's functions were open to anon, as public is; they still are.
    const { rows } = await db.query(
      `SELECT has_function_privilege('anon', 'public.claim_scheduled_posts(text, integer)', 'EXECUTE') AS theirs`,
    );
    expect(rows[0].theirs).toBe(true);
  });

  it('runs its own functions on its own tables', async () => {
    if (!files.length) return;
    const created = await db.query(
      `SELECT virga.create_scheduled_post_capped('did:plc:virga', NOW() - INTERVAL '1 minute', 'bluesky', '{"posts":[]}'::jsonb) AS r`,
    );
    expect(created.rows[0].r.ok).toBe(true);
    const claimed = await db.query(`SELECT user_did, status FROM virga.claim_scheduled_posts('run', 5)`);
    expect(claimed.rows).toEqual([{ user_did: 'did:plc:virga', status: 'publishing' }]);
    expect((await db.query(`SELECT virga.acquire_oauth_lock('k', 'a', 20) AS ok`)).rows[0].ok).toBe(true);
    expect((await db.query(`SELECT allowed, used FROM virga.consume_ai_daily('did:plc:virga', '2026-11-14', 5)`)).rows).toEqual([
      { allowed: true, used: 1 },
    ]);
    const counts = await db.query(
      `SELECT (SELECT count(*)::int FROM virga.scheduled_posts) AS ours,
              (SELECT count(*)::int FROM public.scheduled_posts) AS theirs,
              (SELECT count(*)::int FROM public.ai_rate_limit) AS their_limits`,
    );
    expect(counts.rows[0]).toEqual({ ours: 1, theirs: 1, their_limits: 0 });
  });

  it('fires its own trigger function, not the one of the same name in public', async () => {
    if (!files.length) return;
    await db.exec(
      `INSERT INTO virga.oauth_sessions (sub, session_data, updated_at) VALUES ('did:plc:virga', '{}', NOW() - INTERVAL '1 day');
       UPDATE virga.oauth_sessions SET session_data = '{"a":1}' WHERE sub = 'did:plc:virga';`,
    );
    const { rows } = await db.query(
      `SELECT updated_at > NOW() - INTERVAL '1 minute' AND updated_at < NOW() + INTERVAL '1 minute' AS now_ish
         FROM virga.oauth_sessions WHERE sub = 'did:plc:virga'`,
    );
    expect(rows[0].now_ish).toBe(true);
  });

  it('makes a bucket of its own beside theirs', async () => {
    if (!files.length) return;
    const { rows } = await db.query(`SELECT id FROM storage.buckets ORDER BY id`);
    expect(rows.map((r) => r.id)).toEqual(['scheduled-media', 'virga-scheduled-media']);
  });
});
