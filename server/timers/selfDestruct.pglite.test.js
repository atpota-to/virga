import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from '../test/pglite.js';
import * as selfDestruct from './selfDestruct.js';
import { countTimerUsage, countTimersByBucket, enforceTimerLimit, settleArmedTimer } from './timerUsage.js';

// The timers migration on a real Postgres (PGlite), and the store driven
// through it with the supabase-js stand-in: what the RPCs promise (one live
// timer per post, an exact ceiling, claims that never overlap, a reclaim that
// retires a spent row with the post still up) only holds if the SQL does.

const MIGRATION = '20261113000300_self_destruct.sql';
const DID = 'did:plc:pgliteauthor';
const OTHER = 'did:plc:pgliteother';
const uriFor = (rkey, did = DID) => `at://${did}/app.bsky.feed.post/${rkey}`;
const at = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

const { deps } = selfDestruct;
const realDeps = { ...deps };

describe('the migration on its own', () => {
  let t;
  beforeAll(async () => {
    t = await createTestDatabase({ files: [MIGRATION] });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('applies again unchanged', async () => {
    const { readMigration } = await import('../test/pglite.js');
    await expect(t.exec(readMigration(MIGRATION))).resolves.toBeDefined();
    await expect(t.exec(readMigration(MIGRATION))).resolves.toBeDefined();
  });

  it('defines exactly one arming function, so a call by argument names can only mean one', async () => {
    const { rows } = await t.query(
      `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'create_self_destruct_capped'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('lets only the service role run the functions or touch the table', async () => {
    const { rows } = await t.query(
      `SELECT p.proname AS name,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('create_self_destruct_capped', 'claim_self_destruct_posts', 'reclaim_stuck_self_destructs')
        ORDER BY 1`,
    );
    expect(rows).toEqual([
      { name: 'claim_self_destruct_posts', anon: false, authed: false, service: true },
      { name: 'create_self_destruct_capped', anon: false, authed: false, service: true },
      { name: 'reclaim_stuck_self_destructs', anon: false, authed: false, service: true },
    ]);
    const table = await t.query(
      `SELECT c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
              has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authed,
              has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS service
         FROM pg_class c WHERE c.relname = 'self_destruct_posts'`,
    );
    expect(table.rows[0]).toEqual({ rls: true, anon: false, authed: false, service: true });
    const policies = await t.query(`SELECT 1 FROM pg_policies WHERE tablename = 'self_destruct_posts'`);
    expect(policies.rows).toEqual([]);
  });

  it('holds one live timer per post, at the database itself', async () => {
    const insert = (status = 'armed') => t.query(
      `INSERT INTO self_destruct_posts (user_did, post_uri, rkey, check_at, lifespan_seconds, status)
       VALUES ($1, $2, 'u1', now(), 3600, $3)`,
      [DID, uriFor('u1'), status],
    );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key|unique/i);
    await expect(insert('checking')).rejects.toThrow(/duplicate key|unique/i);
    // A settled timer does not hold the post.
    await expect(insert('cancelled')).resolves.toBeDefined();
    await t.exec('DELETE FROM self_destruct_posts;');
  });

  it('refuses a status the code never writes', async () => {
    await expect(t.query(
      `INSERT INTO self_destruct_posts (user_did, post_uri, rkey, check_at, lifespan_seconds, status)
       VALUES ($1, $2, 'u2', now(), 3600, 'exploded')`,
      [DID, uriFor('u2')],
    )).rejects.toThrow(/check/i);
  });
});

describe('the store over real Postgres', () => {
  let t;
  beforeAll(async () => {
    // Everything up to this file, so the usage counts can read scheduled_posts.
    t = await createTestDatabase({ upTo: '20261113000300' });
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await t.exec('DELETE FROM self_destruct_posts; DELETE FROM scheduled_posts;');
    deps.getSupabaseClient = () => t.supabase;
  });
  afterEach(() => {
    Object.assign(deps, realDeps);
    delete process.env.TIMER_MAX_ACTIVE_PER_USER;
    delete process.env.POST_TIMERS_LIMIT;
    delete process.env.CONDITIONAL_TIMERS_LIMIT;
  });

  const arm = (rkey = 'p1', extra = {}) => selfDestruct.armSelfDestruct({
    userDid: DID, postUri: uriFor(rkey), postCid: 'bafy', collection: 'app.bsky.feed.post', rkey,
    snippet: 'hi', extraUris: [], lifespanSeconds: 3600, checkAt: at(60), conditions: {}, ...extra,
  });
  const live = async (rkey = 'p1') => (await t.query(
    `SELECT lifespan_seconds, status FROM self_destruct_posts WHERE post_uri = $1 AND status IN ('armed','checking')`,
    [uriFor(rkey)],
  )).rows;
  const rowOf = async (id) => (await t.query('SELECT * FROM self_destruct_posts WHERE id = $1', [id])).rows[0];

  describe('arming', () => {
    it('stores the timer as armed', async () => {
      const { row, existing } = await arm();
      expect(existing).toBe(false);
      expect(row).toMatchObject({
        user_did: DID, post_uri: uriFor('p1'), post_cid: 'bafy', rkey: 'p1', snippet: 'hi',
        status: 'armed', lifespan_seconds: 3600, attempts: 0, max_attempts: 5, extensions: 0,
      });
      expect(await live()).toEqual([{ lifespan_seconds: 3600, status: 'armed' }]);
    });

    it('rewrites an armed timer’s rule on a re-arm, and keeps one live row', async () => {
      await arm();
      const again = await arm('p1', { lifespanSeconds: 7200 });
      expect(again).toMatchObject({ existing: true, updated: true });
      expect(again.row.lifespan_seconds).toBe(7200);
      expect(await live()).toEqual([{ lifespan_seconds: 7200, status: 'armed' }]);
    });

    it('hands back a checking timer as it is', async () => {
      const { row } = await arm();
      await t.query(`UPDATE self_destruct_posts SET status = 'checking' WHERE id = $1`, [row.id]);
      const again = await arm('p1', { lifespanSeconds: 7200 });
      expect(again.existing).toBe(true);
      expect(again.updated).toBeUndefined();
      expect(await live()).toEqual([{ lifespan_seconds: 3600, status: 'checking' }]);
    });

    it('keeps a plain timer’s effects NULL and stores a custom rule’s', async () => {
      expect((await arm('p1')).row.effects).toBeNull();
      const custom = await arm('p2', { effects: [{ action: 'disableQuotes' }] });
      expect(custom.row.effects).toEqual([{ action: 'disableQuotes' }]);
    });

    it('notes a missed deadline on a fresh row', async () => {
      const { row } = await arm('p1', { note: selfDestruct.MISSED_DEADLINE_NOTE });
      expect(row.resolution).toBe(selfDestruct.MISSED_DEADLINE_NOTE);
      expect((await rowOf(row.id)).resolution).toBe(selfDestruct.MISSED_DEADLINE_NOTE);
    });

    it('holds the account to TIMER_MAX_ACTIVE_PER_USER, but still re-arms a post it has', async () => {
      process.env.TIMER_MAX_ACTIVE_PER_USER = '1';
      await arm('p1');
      await expect(arm('p2')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', limit: 1 });
      await expect(arm('p1', { lifespanSeconds: 900 })).resolves.toMatchObject({ existing: true, updated: true });
      // Another account's timers are its own.
      await expect(selfDestruct.armSelfDestruct({
        userDid: OTHER, postUri: uriFor('o1', OTHER), collection: 'app.bsky.feed.post', rkey: 'o1',
        lifespanSeconds: 3600, checkAt: at(60), conditions: {},
      })).resolves.toMatchObject({ existing: false });
    });
  });

  describe('the worker queue', () => {
    it('claims due rows as checking, spending an attempt, and leaves the rest', async () => {
      const due = (await arm('p1')).row;
      const later = (await arm('p2')).row;
      const backingOff = (await arm('p3')).row;
      await t.query(`UPDATE self_destruct_posts SET check_at = now() - interval '1 minute' WHERE id IN ($1, $2)`, [due.id, backingOff.id]);
      await t.query(`UPDATE self_destruct_posts SET next_attempt_at = now() + interval '5 minutes' WHERE id = $1`, [backingOff.id]);

      const claimed = await selfDestruct.claimDueSelfDestructs('run-1', 25);
      expect(claimed.map((r) => r.id)).toEqual([due.id]);
      expect(claimed[0]).toMatchObject({ status: 'checking', attempts: 1, locked_by: 'run-1' });
      expect((await rowOf(later.id)).status).toBe('armed');
      // A second run finds nothing left to claim.
      expect(await selfDestruct.claimDueSelfDestructs('run-2', 25)).toEqual([]);
    });

    it('hands back stuck rows, and retires a spent one with the post still up', async () => {
      const stuck = (await arm('p1')).row;
      const spent = (await arm('p2')).row;
      const fresh = (await arm('p3')).row;
      await t.query(
        `UPDATE self_destruct_posts SET status = 'checking', locked_at = now() - interval '10 minutes', attempts = 2 WHERE id = $1`,
        [stuck.id],
      );
      await t.query(
        `UPDATE self_destruct_posts SET status = 'checking', locked_at = now() - interval '10 minutes', attempts = 6 WHERE id = $1`,
        [spent.id],
      );
      await t.query(`UPDATE self_destruct_posts SET status = 'checking', locked_at = now() WHERE id = $1`, [fresh.id]);

      await expect(selfDestruct.reclaimStuck(180)).resolves.toBe(2);
      expect(await rowOf(stuck.id)).toMatchObject({ status: 'armed', locked_at: null, attempts: 2 });
      expect(await rowOf(spent.id)).toMatchObject({
        status: 'failed',
        last_error: 'the timer ran out of time before this post could be checked.',
        last_error_code: 'TIMED_OUT',
        resolution: 'the post is still up',
      });
      expect((await rowOf(spent.id)).resolved_at).not.toBeNull();
      expect((await rowOf(fresh.id)).status).toBe('checking');
    });

    it('runs a plain timer end to end: armed, claimed, deleted', async () => {
      const deletes = [];
      deps.Agent = function FakeAgent() {
        this.com = { atproto: { repo: { deleteRecord: async (params) => { deletes.push(params); return { data: {} }; } } } };
      };
      deps.restoreSession = vi.fn(async () => ({ did: DID }));
      deps.safeFetchJson = vi.fn(async () => ({ thread: { replies: [] } }));
      const { row } = await arm('p1');
      await t.query(`UPDATE self_destruct_posts SET check_at = now() - interval '1 minute' WHERE id = $1`, [row.id]);
      const [claimed] = await selfDestruct.claimDueSelfDestructs('run-1', 25);

      await expect(selfDestruct.resolveSelfDestruct(claimed)).resolves.toMatchObject({ outcome: 'deleted' });
      expect(deletes.map((d) => d.collection).sort()).toEqual(['app.bsky.feed.post', 'app.bsky.feed.postgate', 'app.bsky.feed.threadgate']);
      expect(await rowOf(row.id)).toMatchObject({ status: 'deleted', resolution: 'deleted, on time', locked_by: null });
    });

    it('stores a retry with its backoff and code', async () => {
      const { row } = await arm('p1');
      await t.query(`UPDATE self_destruct_posts SET status = 'checking', attempts = 1 WHERE id = $1`, [row.id]);
      await expect(selfDestruct.markFailedOrRetry(await rowOf(row.id), 'HTTP 429')).resolves.toBe('retry');
      const after = await rowOf(row.id);
      expect(after).toMatchObject({ status: 'armed', last_error_code: 'RATE_LIMITED' });
      expect(new Date(after.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 60 * 1000);
    });
  });

  describe('listing and calling off', () => {
    it('lists the DID’s timers, live first, and never a cancelled one', async () => {
      const soon = (await arm('p1', { checkAt: at(10) })).row;
      const late = (await arm('p2', { checkAt: at(90) })).row;
      const failed = (await arm('p3')).row;
      const gone = (await arm('p4')).row;
      await t.query(`UPDATE self_destruct_posts SET status = 'failed', resolved_at = now() WHERE id = $1`, [failed.id]);
      await t.query(`UPDATE self_destruct_posts SET status = 'cancelled' WHERE id = $1`, [gone.id]);
      await selfDestruct.armSelfDestruct({
        userDid: OTHER, postUri: uriFor('o1', OTHER), collection: 'app.bsky.feed.post', rkey: 'o1',
        lifespanSeconds: 3600, checkAt: at(5), conditions: {},
      });

      const rows = await selfDestruct.listSelfDestructs(DID);
      expect(rows.map((r) => r.id)).toEqual([soon.id, late.id, failed.id]);
      expect(Object.keys(rows[0])).not.toContain('user_did');
    });

    it('shows a recent acted rule by default and every settled row for history', async () => {
      const acted = (await arm('p1')).row;
      const oldActed = (await arm('p2')).row;
      const deleted = (await arm('p3')).row;
      await t.query(`UPDATE self_destruct_posts SET status = 'acted', resolved_at = now() - interval '1 day' WHERE id = $1`, [acted.id]);
      await t.query(`UPDATE self_destruct_posts SET status = 'acted', resolved_at = now() - interval '9 days' WHERE id = $1`, [oldActed.id]);
      await t.query(`UPDATE self_destruct_posts SET status = 'deleted', resolved_at = now() WHERE id = $1`, [deleted.id]);

      expect((await selfDestruct.listSelfDestructs(DID)).map((r) => r.id)).toEqual([acted.id]);
      expect((await selfDestruct.listSelfDestructs(DID, { includeResolved: true })).map((r) => r.id))
        .toEqual([deleted.id, acted.id, oldActed.id]);
    });

    it('calls off an armed timer once, and never someone else’s or one mid-check', async () => {
      const mine = (await arm('p1')).row;
      const checking = (await arm('p2')).row;
      await t.query(`UPDATE self_destruct_posts SET status = 'checking' WHERE id = $1`, [checking.id]);

      expect(await selfDestruct.cancelSelfDestruct(mine.id, OTHER)).toBeNull();
      const cancelled = await selfDestruct.cancelSelfDestruct(mine.id, DID);
      expect(cancelled).toMatchObject({ id: mine.id, status: 'cancelled', resolution: 'called off' });
      expect(await selfDestruct.cancelSelfDestruct(mine.id, DID)).toBeNull();
      expect(await selfDestruct.cancelSelfDestruct(checking.id, DID)).toBeNull();
      // The post is free for a new timer.
      await expect(arm('p1')).resolves.toMatchObject({ existing: false });
    });

    it('dismisses a failed timer through the same call', async () => {
      const { row } = await arm('p1');
      await t.query(`UPDATE self_destruct_posts SET status = 'failed' WHERE id = $1`, [row.id]);
      await expect(selfDestruct.cancelSelfDestruct(row.id, DID)).resolves.toMatchObject({ status: 'cancelled' });
    });
  });

  describe('usage and per-kind limits', () => {
    const conditional = { logic: 'any', sense: 'unless', onSpare: 'keep', maxExtensions: 0, clauses: [{ metric: 'likes', op: 'gte', value: 5 }] };
    const schedule = (selfDestructSpec, status = 'pending') => t.query(
      `INSERT INTO scheduled_posts (user_did, scheduled_for, status, payload) VALUES ($1, now() + interval '1 day', $2, $3)`,
      [DID, status, JSON.stringify({ posts: [{ record: { text: 'later' } }], selfDestruct: selfDestructSpec })],
    );

    it('counts live timers by kind, and nothing settled', async () => {
      await arm('p1');
      await arm('p2', { conditions: conditional });
      await arm('p3', { effects: [{ action: 'limitReplies', allow: ['follower'] }] });
      const done = (await arm('p4')).row;
      await t.query(`UPDATE self_destruct_posts SET status = 'deleted' WHERE id = $1`, [done.id]);
      await schedule({ lifespanSeconds: 3600 });
      // Live timers only: the scheduler adds its own waiting rows.
      await expect(countTimerUsage(DID)).resolves.toEqual({ postTimers: 1, conditionalTimers: 2 });
      await expect(countTimerUsage(OTHER)).resolves.toEqual({ postTimers: 0, conditionalTimers: 0 });
    });

    it('counts waiting scheduled posts that carry a timer when holding a slot', async () => {
      await arm('p1');
      await schedule({ lifespanSeconds: 3600 });
      await schedule({ lifespanSeconds: 3600, conditions: conditional });
      await schedule({ lifespanSeconds: 3600 }, 'published');
      await schedule(null);
      await expect(countTimersByBucket(DID)).resolves.toEqual({ plain: 2, conditional: 1 });
      await expect(countTimersByBucket(DID, { exceptPostUri: uriFor('p1') })).resolves.toEqual({ plain: 1, conditional: 1 });
    });

    it('lets everything through when no limit is set, without counting', async () => {
      await expect(enforceTimerLimit({ userDid: DID, conditions: {} })).resolves.toEqual({ bucket: 'plain', limit: null });
    });

    it('refuses a timer whose kind is full, naming the feature and the limit', async () => {
      process.env.POST_TIMERS_LIMIT = '1';
      await arm('p1');
      await expect(enforceTimerLimit({ userDid: DID, conditions: {} })).rejects.toMatchObject({
        code: 'QUOTA_EXCEEDED', feature: 'postTimers', limit: 1, statusCode: 409,
      });
      // The other kind is still free, and a re-arm of the same post replaces its own slot.
      await expect(enforceTimerLimit({ userDid: DID, conditions: conditional })).resolves.toEqual({ bucket: 'conditional', limit: null });
      await expect(enforceTimerLimit({ userDid: DID, conditions: {}, exceptPostUri: uriFor('p1') }))
        .resolves.toEqual({ bucket: 'plain', limit: 1 });
    });

    it('settles a race: the later of two timers past the limit is called off', async () => {
      process.env.CONDITIONAL_TIMERS_LIMIT = '1';
      const verdict = { bucket: 'conditional', limit: 1 };
      const first = (await arm('p1', { conditions: conditional })).row;
      const second = (await arm('p2', { conditions: conditional })).row;
      await t.query(`UPDATE self_destruct_posts SET created_at = now() - interval '1 minute' WHERE id = $1`, [first.id]);

      await expect(settleArmedTimer({ userDid: DID, row: first, verdict })).resolves.toBeUndefined();
      await expect(settleArmedTimer({ userDid: DID, row: second, verdict })).rejects.toMatchObject({
        code: 'QUOTA_EXCEEDED', feature: 'conditionalTimers', limit: 1,
      });
      expect((await rowOf(first.id)).status).toBe('armed');
      expect((await rowOf(second.id)).status).toBe('cancelled');
    });

    it('counts a waiting scheduled timer ahead of a live one when settling', async () => {
      const verdict = { bucket: 'plain', limit: 1 };
      await schedule({ lifespanSeconds: 3600 });
      const row = (await arm('p1')).row;
      await expect(settleArmedTimer({ userDid: DID, row, verdict })).rejects.toMatchObject({ feature: 'postTimers' });
      expect((await rowOf(row.id)).status).toBe('cancelled');
    });
  });
});
