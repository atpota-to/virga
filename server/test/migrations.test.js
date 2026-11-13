import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase, listMigrations, readMigration } from './pglite.js';

// What every file in supabase/migrations must hold to, checked on the database
// they build rather than on their text: they apply in order and apply again
// unchanged (supabase db push and a pasted re-run both happen), and only the
// service role can reach anything. Supabase grants anon and authenticated
// every new table and function by default, and a function anyone may EXECUTE
// is callable through PostgREST with the public anon key, so each file has to
// take those grants back. Holds trivially while the folder is empty.

const files = listMigrations();
let t;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t?.close();
});

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

  it('leaves no SECURITY DEFINER function and no policy', async () => {
    const definers = await t.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef`,
    );
    expect(definers.rows).toEqual([]);
    expect((await t.query(`SELECT policyname FROM pg_policies WHERE schemaname = 'public'`)).rows).toEqual([]);
  });

  it('turns on RLS for every table and gives anon and authenticated nothing', async () => {
    const { rows } = await t.query(
      `SELECT c.relname AS name,
              c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
              has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authed,
              has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS service
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        ORDER BY 1`,
    );
    for (const table of rows) {
      expect(table, table.name).toMatchObject({ rls: true, anon: false, authed: false, service: true });
    }
  });

  it('lets only the service role execute the functions', async () => {
    const { rows } = await t.query(
      `SELECT p.oid::regprocedure::text AS name,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        ORDER BY 1`,
    );
    for (const fn of rows) {
      expect(fn, fn.name).toMatchObject({ anon: false, authed: false, service: true });
    }
  });

  it('pins search_path on every function', async () => {
    const { rows } = await t.query(
      `SELECT p.oid::regprocedure::text AS name, p.proconfig AS config
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'`,
    );
    for (const fn of rows) {
      expect((fn.config || []).some((c) => c.startsWith('search_path=')), fn.name).toBe(true);
    }
  });
});
