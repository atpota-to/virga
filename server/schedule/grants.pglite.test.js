// The scheduled-posts migrations on a project that grants nothing by itself,
// which is what a schema of Virga's own is: Supabase's automatic grants cover
// public only. The shared PGlite helper applies grants on the schema, which
// would hide a missing GRANT, so this database has the three roles and
// nothing else. The statements below run as each role, so they also need the
// migration to have let the service role into the schema.

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
  await db.exec(readMigration('20261114000100_scheduled_repeats.sql'));
  // For the statements below; the migrations ran without it.
  await db.exec('SET search_path TO virga, public');
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

  it('lets the service role carry a series forward, and stop one', async () => {
    const series = '11111111-1111-4111-8111-111111111111';
    const created = await asRole(
      'service_role',
      `SELECT create_scheduled_post_capped('did:plc:series', NOW() + INTERVAL '1 hour', 'bluesky',
         '{"posts":[],"media":{},"rkeys":[],"repeat":{"every":"day"}}'::jsonb, false, 50,
         '${series}'::uuid, 1) AS r`,
    );
    const id = created.rows[0].r.post.id;
    const settled = await asRole(
      'service_role',
      `SELECT settle_scheduled_occurrence('${id}'::uuid, 'published', '{}'::jsonb,
         jsonb_build_object('scheduledFor', NOW() + INTERVAL '1 day', 'occurrence', 2)) AS r`,
    );
    expect(settled.rows[0].r.ok).toBe(true);
    const nextId = settled.rows[0].r.next.id;
    const stopped = await asRole(
      'service_role',
      `SELECT stop_scheduled_repeat('${nextId}'::uuid, 'did:plc:series') AS r`,
    );
    expect(stopped.rows[0].r.id).toBe(nextId);
    expect(stopped.rows[0].r.payload).not.toHaveProperty('repeat');
  });

  it('refuses the public roles the schema, and so the table and the RPCs', async () => {
    for (const role of ['anon', 'authenticated']) {
      // Named with the schema: without it these roles can't even resolve the name.
      await expect(
        asRole(role, 'SELECT count(*) FROM virga.scheduled_posts'),
      ).rejects.toThrow(/permission denied for schema virga/);
      await expect(
        asRole(role, `SELECT * FROM virga.claim_scheduled_posts('run', 5)`),
      ).rejects.toThrow(/permission denied for schema virga/);
      await expect(
        asRole(
          role,
          `SELECT virga.settle_scheduled_occurrence('00000000-0000-4000-8000-000000000000'::uuid, 'published')`,
        ),
      ).rejects.toThrow(/permission denied for schema virga/);
      await expect(
        asRole(
          role,
          `SELECT virga.stop_scheduled_repeat('00000000-0000-4000-8000-000000000000'::uuid, 'did:plc:x')`,
        ),
      ).rejects.toThrow(/permission denied for schema virga/);
      await expect(
        asRole(role, 'SELECT count(*) FROM scheduled_posts'),
      ).rejects.toThrow(/does not exist/);
    }
  });
});
