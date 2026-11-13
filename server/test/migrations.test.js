import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase, listMigrations, readMigration } from './pglite.js';

// What every file in supabase/migrations must hold to, checked on the database
// they build rather than on their text: they apply in order and apply again
// unchanged (supabase db push and a pasted re-run both happen), and only the
// service role can reach anything. Supabase grants anon and authenticated
// every new table and function by default, and a function anyone may EXECUTE
// is callable through PostgREST with the public anon key, so each file has to
// take those grants back. Holds trivially while the folder is empty.
//
// The privilege checks run twice: on a project with Supabase's automatic
// grants (so a missing REVOKE shows) and on one without them, as Supabase now
// makes new projects (so a missing GRANT to service_role shows; with the
// automatic grants in place service_role has everything regardless).

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
            has_table_privilege('service_role', c.oid, 'SELECT') AND has_table_privilege('service_role', c.oid, 'INSERT')
              AND has_table_privilege('service_role', c.oid, 'UPDATE') AND has_table_privilege('service_role', c.oid, 'DELETE') AS service
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY 1`,
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
      WHERE n.nspname = 'public' AND p.prorettype <> 'trigger'::regtype
      ORDER BY 1`,
  );
  return rows;
}

const projects = [
  ['with Supabase’s automatic grants', () => t],
  ['without automatic grants', () => bare],
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

  it('leaves no SECURITY DEFINER function and no policy', async () => {
    const definers = await t.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef`,
    );
    expect(definers.rows).toEqual([]);
    expect((await t.query(`SELECT policyname FROM pg_policies WHERE schemaname = 'public'`)).rows).toEqual([]);
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

describe.each(projects)('supabase/migrations on a project %s', (_label, db) => {
  it('turns on RLS for every table, gives anon and authenticated nothing and service_role read and write', async () => {
    for (const table of await tablePrivileges(db())) {
      expect(table, table.name).toMatchObject({ rls: true, anon: false, authed: false, service: true });
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
        WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype`,
    );
    for (const fn of rows) expect(fn, fn.name).toMatchObject({ anon: false, authed: false });
  });
});
