// The scheduled-posts migration on a project without Supabase's automatic
// grants on new public tables (the default Supabase is moving to). The shared
// PGlite helper applies the legacy grants, which would hide a missing GRANT,
// so this database has the three roles and nothing else.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { STORAGE_SQL, readMigration } from '../test/pglite.js';

const BARE_ROLES_SQL = `
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END
$$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- As on Supabase: the service role skips RLS, but not privileges.
ALTER ROLE service_role BYPASSRLS;
`;

let db;
beforeAll(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = await PGlite.create();
  await db.exec(BARE_ROLES_SQL);
  await db.exec(STORAGE_SQL);
  await db.exec(readMigration('20261113000200_scheduled_posts.sql'));
});
afterAll(async () => {
  await db?.close();
});

async function asRole(role, sql) {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec('RESET ROLE');
  }
}

describe('scheduled_posts without default grants', () => {
  it('gives the service role the table and nobody else', async () => {
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const { rows } = await db.query(
        `SELECT has_table_privilege('service_role', 'scheduled_posts', '${priv}') AS service,
                has_table_privilege('anon', 'scheduled_posts', '${priv}') AS anon,
                has_table_privilege('authenticated', 'scheduled_posts', '${priv}') AS authed`,
      );
      expect(rows[0]).toEqual({ service: true, anon: false, authed: false });
    }
  });

  it('lets the service role run every RPC, which run as the caller', async () => {
    const created = await asRole(
      'service_role',
      `SELECT create_scheduled_post_capped('did:plc:grants', NOW() - INTERVAL '1 minute', 'bluesky',
         '{"posts":[],"media":{},"rkeys":[]}'::jsonb, false, 50) AS r`,
    );
    expect(created.rows[0].r.ok).toBe(true);
    const claimed = await asRole(
      'service_role',
      `SELECT id FROM claim_scheduled_posts('run', 5)`,
    );
    expect(claimed.rows).toHaveLength(1);
    await asRole('service_role', 'SELECT reclaim_stuck_scheduled_posts(600)');
    await asRole(
      'service_role',
      'SELECT * FROM reclaim_failed_scheduled_media(30)',
    );
    const moved = await asRole(
      'service_role',
      `SELECT reorder_scheduled_posts('did:plc:grants', '[]'::jsonb) AS r`,
    );
    expect(moved.rows[0].r.code).toBe('BAD_REQUEST');
  });

  it('refuses the public roles the table and the RPCs', async () => {
    for (const role of ['anon', 'authenticated']) {
      await expect(
        asRole(role, 'SELECT count(*) FROM scheduled_posts'),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asRole(role, `SELECT * FROM claim_scheduled_posts('run', 5)`),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
