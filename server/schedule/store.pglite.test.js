// The scheduled-posts migration and the store over it, on a real Postgres
// (PGlite): the capped create, the claim, the reclaim, the reorder, the media
// sweep, and the guarded writes that keep a worker and a writer from undoing
// each other.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { createTestDatabase } from '../test/pglite.js';
import {
  setSupabaseClientForTests,
  resetSupabaseClientForTests,
} from '../supabase.js';
import * as scheduled from './scheduledPosts.js';
import {
  DID,
  OTHER_DID,
  HOUR,
  MINUTE,
  DAY,
  iso,
  inHours,
  PNG_BASE64,
} from './testing/fixtures.js';

let t;
beforeAll(async () => {
  t = await createTestDatabase({ upTo: '20261113000200' });
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.exec('TRUNCATE scheduled_posts');
  t.supabase.storage.reset();
  setSupabaseClientForTests(t.supabase);
});
afterEach(() => {
  resetSupabaseClientForTests();
  vi.unstubAllEnvs();
});

/** Insert a row directly, in any state, and answer it. */
async function insertRow(fields = {}) {
  const row = {
    user_did: DID,
    scheduled_for: inHours(1),
    status: 'pending',
    payload: {
      posts: [{ record: { text: 'hello' } }],
      gates: {},
      media: {},
      rkeys: ['3kaaaaaaaaaa2'],
    },
    progress: [],
    attempts: 0,
    ...fields,
  };
  const { rows } = await t.query(
    `INSERT INTO scheduled_posts (user_did, scheduled_for, status, payload, progress, attempts, max_attempts,
                                  locked_at, last_error, last_error_code, updated_at, created_at, next_attempt_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, COALESCE($7, 5), $8, $9, $10, COALESCE($11, NOW()), COALESCE($12, NOW()), $13)
     RETURNING *`,
    [
      row.user_did,
      row.scheduled_for,
      row.status,
      JSON.stringify(row.payload),
      JSON.stringify(row.progress),
      row.attempts,
      row.max_attempts ?? null,
      row.locked_at ?? null,
      row.last_error ?? null,
      row.last_error_code ?? null,
      row.updated_at ?? null,
      row.created_at ?? null,
      row.next_attempt_at ?? null,
    ],
  );
  return rows[0];
}

async function readRow(id) {
  const { rows } = await t.query(
    'SELECT * FROM scheduled_posts WHERE id = $1',
    [id],
  );
  return rows[0];
}

const payload = (texts = ['hello'], extra = {}) => ({
  posts: texts.map((text) => ({ record: { text } })),
  gates: { threadgate: null, postgate: null },
  media: {},
  rkeys: [],
  ...extra,
});

describe('the migration', () => {
  it('applies a second time unchanged', async () => {
    const { readMigration } = await import('../test/pglite.js');
    await expect(
      t.exec(readMigration('20261113000200_scheduled_posts.sql')),
    ).resolves.toBeDefined();
  });

  it('creates the private scheduled-media bucket when Storage exists', async () => {
    const { rows } = await t.query(
      `SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'scheduled-media'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'scheduled-media', public: false });
    expect(Number(rows[0].file_size_limit)).toBe(10485760);
  });

  it('applies without a storage schema, skipping the bucket', async () => {
    const bare = await createTestDatabase({
      upTo: '20261113000200',
      storage: false,
    });
    try {
      const { rows } = await bare.query(
        `SELECT to_regclass('public.scheduled_posts') AS t`,
      );
      expect(rows[0].t).toBe('scheduled_posts');
    } finally {
      await bare.close();
    }
  });

  it('refuses a status or target outside the closed sets', async () => {
    await expect(insertRow({ status: 'sent' })).rejects.toThrow(/check/i);
    await expect(
      t.query(
        `INSERT INTO scheduled_posts (user_did, scheduled_for, payload, target) VALUES ('d', NOW(), '{}', 'other-app')`,
      ),
    ).rejects.toThrow(/check/i);
  });

  it('gives anon and authenticated no way in', async () => {
    const { rows } = await t.query(
      `SELECT has_table_privilege('anon', 'scheduled_posts', 'SELECT') AS anon,
              has_function_privilege('authenticated', 'claim_scheduled_posts(text, integer)', 'EXECUTE') AS authed,
              has_function_privilege('service_role', 'create_scheduled_post_capped(text, timestamptz, text, jsonb, boolean, integer)', 'EXECUTE') AS service`,
    );
    expect(rows[0]).toEqual({ anon: false, authed: false, service: true });
  });
});

describe('create_scheduled_post_capped and createScheduledPost', () => {
  it('writes a pending row and answers it', async () => {
    const row = await scheduled.createScheduledPost({
      userDid: DID,
      scheduledFor: inHours(2),
      payload: payload(['first'], { rkeys: ['3kzzzzzzzzzz2'] }),
      queued: true,
    });
    expect(row).toMatchObject({
      user_did: DID,
      status: 'pending',
      target: 'bluesky',
      queued: true,
      attempts: 0,
      max_attempts: 5,
    });
    expect(row.payload.posts[0].record.text).toBe('first');
    expect(row.progress).toEqual([]);
  });

  it('refuses at the cap with QUOTA_EXCEEDED, counting pending and publishing only', async () => {
    vi.stubEnv('SCHEDULE_MAX_PENDING', '2');
    await insertRow({ status: 'publishing' });
    await insertRow({ status: 'failed' });
    await insertRow({ status: 'published' });
    await insertRow({ user_did: OTHER_DID });
    await scheduled.createScheduledPost({
      userDid: DID,
      scheduledFor: inHours(2),
      payload: payload(),
    });
    const err = await scheduled
      .createScheduledPost({
        userDid: DID,
        scheduledFor: inHours(2),
        payload: payload(),
      })
      .catch((e) => e);
    expect(err).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      feature: 'scheduledPosts',
      limit: 2,
      nonRetryable: true,
    });
    expect(err.message).toBe('you can have at most 2 scheduled posts');
  });

  it('takes a lower SCHEDULED_POSTS_LIMIT as the ceiling', async () => {
    vi.stubEnv('SCHEDULED_POSTS_LIMIT', '1');
    await scheduled.createScheduledPost({
      userDid: DID,
      scheduledFor: inHours(2),
      payload: payload(),
    });
    await expect(
      scheduled.createScheduledPost({
        userDid: DID,
        scheduledFor: inHours(2),
        payload: payload(),
      }),
    ).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      feature: 'scheduledPosts',
      limit: 1,
    });
  });

  it('answers the RPC directly with the limit and count', async () => {
    await insertRow();
    const { data } = await t.supabase.rpc('create_scheduled_post_capped', {
      p_user_did: DID,
      p_scheduled_for: inHours(1),
      p_target: 'bluesky',
      p_payload: payload(),
      p_queued: false,
      p_max_active: 1,
    });
    expect(data).toEqual({
      ok: false,
      code: 'QUOTA_EXCEEDED',
      limit: 1,
      count: 1,
    });
  });

  it('serializes parallel creates for one account under the cap', async () => {
    vi.stubEnv('SCHEDULE_MAX_PENDING', '3');
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        scheduled.createScheduledPost({
          userDid: DID,
          scheduledFor: inHours(2),
          payload: payload(),
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const { rows } = await t.query(
      `SELECT COUNT(*)::int AS n FROM scheduled_posts WHERE user_did = $1`,
      [DID],
    );
    expect(rows[0].n).toBe(3);
  });

  it('re-mints the later row’s keys when two rows share one', async () => {
    const earlier = await insertRow({
      payload: payload(['a'], { rkeys: ['3kshared00002'] }),
      created_at: iso(Date.now() - MINUTE),
    });
    const later = await scheduled.createScheduledPost({
      userDid: DID,
      scheduledFor: inHours(3),
      payload: payload(['b'], { rkeys: ['3kshared00002'] }),
    });
    expect(later.payload.rkeys).toHaveLength(1);
    expect(later.payload.rkeys[0]).not.toBe('3kshared00002');
    expect((await readRow(earlier.id)).payload.rkeys).toEqual([
      '3kshared00002',
    ]);
  });

  it('says UNAVAILABLE when the function is missing', async () => {
    await t.exec(
      'DROP FUNCTION create_scheduled_post_capped(TEXT, TIMESTAMPTZ, TEXT, JSONB, BOOLEAN, INTEGER)',
    );
    try {
      await expect(
        scheduled.createScheduledPost({
          userDid: DID,
          scheduledFor: inHours(2),
          payload: payload(),
        }),
      ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    } finally {
      const { readMigration } = await import('../test/pglite.js');
      await t.exec(readMigration('20261113000200_scheduled_posts.sql'));
    }
  });
});

describe('assignRkeys', () => {
  it('mints one TID per post from the scheduled time, clear of the account’s keys', async () => {
    const when = inHours(5);
    const keys = await scheduled.assignRkeys({
      userDid: DID,
      scheduledFor: when,
      postCount: 3,
    });
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    for (const k of keys)
      expect(k).toMatch(
        /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/,
      );
    expect([...keys].sort()).toEqual(keys);
  });
});

describe('claim_scheduled_posts', () => {
  it('claims due pending rows in time order, flips them to publishing and counts the attempt', async () => {
    const later = await insertRow({ scheduled_for: iso(Date.now() - MINUTE) });
    const sooner = await insertRow({ scheduled_for: iso(Date.now() - HOUR) });
    await insertRow({ scheduled_for: inHours(1) }); // not due
    await insertRow({
      scheduled_for: iso(Date.now() - HOUR),
      next_attempt_at: inHours(1),
    }); // backing off
    await insertRow({
      scheduled_for: iso(Date.now() - HOUR),
      status: 'failed',
    });
    const claimed = await scheduled.claimDuePosts('run-1', 20);
    expect(claimed.map((r) => r.id)).toEqual([sooner.id, later.id]);
    expect(
      claimed.every(
        (r) =>
          r.status === 'publishing' &&
          r.attempts === 1 &&
          r.locked_by === 'run-1',
      ),
    ).toBe(true);
    expect(await scheduled.claimDuePosts('run-2', 20)).toEqual([]);
  });

  it('honours the limit', async () => {
    for (let i = 0; i < 3; i++)
      await insertRow({ scheduled_for: iso(Date.now() - (i + 1) * MINUTE) });
    expect(await scheduled.claimDuePosts('run-1', 2)).toHaveLength(2);
  });
});

describe('reclaim_stuck_scheduled_posts', () => {
  it('requeues a stuck row, and retires one past its attempts as TIMED_OUT', async () => {
    const stuck = await insertRow({
      status: 'publishing',
      attempts: 2,
      locked_at: iso(Date.now() - 10 * MINUTE),
    });
    const spent = await insertRow({
      status: 'publishing',
      attempts: 6,
      locked_at: iso(Date.now() - 10 * MINUTE),
    });
    const fresh = await insertRow({
      status: 'publishing',
      attempts: 1,
      locked_at: iso(Date.now() - MINUTE),
    });
    expect(await scheduled.reclaimStuck(180)).toBe(2);
    expect(await readRow(stuck.id)).toMatchObject({
      status: 'pending',
      locked_at: null,
      locked_by: null,
    });
    expect(await readRow(spent.id)).toMatchObject({
      status: 'failed',
      last_error:
        'the publisher ran out of time before this post could be written.',
      last_error_code: 'TIMED_OUT',
    });
    expect((await readRow(fresh.id)).status).toBe('publishing');
  });
});

describe('reorder_scheduled_posts and reorderScheduledPosts', () => {
  it('moves every row, re-minting keys for the new times', async () => {
    const a = await insertRow({
      scheduled_for: inHours(1),
      payload: payload(['a'], { rkeys: ['3kolda0000002'] }),
    });
    const b = await insertRow({
      scheduled_for: inHours(2),
      payload: payload(['b', 'b2'], {
        rkeys: ['3koldb0000002', '3koldb0000003'],
      }),
    });
    const result = await scheduled.reorderScheduledPosts({
      userDid: DID,
      moves: [
        { id: a.id, scheduledFor: inHours(2) },
        { id: b.id, scheduledFor: inHours(1) },
      ],
    });
    expect(result).toEqual({ ok: true, moved: 2 });
    const [ra, rb] = [await readRow(a.id), await readRow(b.id)];
    expect(ra.scheduled_for.getTime()).toBeGreaterThan(
      rb.scheduled_for.getTime(),
    );
    expect(ra.payload.rkeys).toHaveLength(1);
    expect(ra.payload.rkeys[0]).not.toBe('3kolda0000002');
    expect(rb.payload.rkeys).toHaveLength(2);
    expect(rb.payload.posts).toHaveLength(2);
  });

  it('refuses the whole reorder when any row is not pending, is part-published, or isn’t the account’s', async () => {
    const a = await insertRow();
    const publishing = await insertRow({ status: 'publishing' });
    const partial = await insertRow({
      progress: [{ uri: 'at://x/app.bsky.feed.post/1', cid: 'c' }],
    });
    const theirs = await insertRow({ user_did: OTHER_DID });
    for (const other of [publishing, partial, theirs]) {
      const result = await scheduled.reorderScheduledPosts({
        userDid: DID,
        moves: [
          { id: a.id, scheduledFor: inHours(3) },
          { id: other.id, scheduledFor: inHours(4) },
        ],
      });
      expect(result).toEqual({ ok: false, code: 'NOT_REORDERABLE' });
    }
    expect((await readRow(a.id)).scheduled_for.toISOString()).toBe(
      new Date(a.scheduled_for).toISOString(),
    );
  });

  it('refuses a move past a pinned delete time, writing nothing', async () => {
    const slot = Date.now() + DAY;
    const a = await insertRow({
      scheduled_for: iso(slot),
      payload: payload(['thursday'], {
        selfDestruct: { lifespanSeconds: 3600, deleteAt: iso(slot + 9 * HOUR) },
      }),
    });
    const result = await scheduled.reorderScheduledPosts({
      userDid: DID,
      moves: [{ id: a.id, scheduledFor: iso(slot + 24 * HOUR) }],
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'DELETE_TIME_TOO_EARLY',
      id: a.id,
      deleteAt: iso(slot + 9 * HOUR),
    });
    expect((await readRow(a.id)).scheduled_for.toISOString()).toBe(iso(slot));
  });

  it('answers malformed moves as BAD_REQUEST from the function itself', async () => {
    const rpc = (moves) =>
      t.supabase.rpc('reorder_scheduled_posts', {
        p_user_did: DID,
        p_moves: moves,
      });
    expect((await rpc([])).data).toMatchObject({
      ok: false,
      code: 'BAD_REQUEST',
      error: 'a reorder carries between one and fifty posts.',
    });
    expect((await rpc({})).data).toMatchObject({
      ok: false,
      code: 'BAD_REQUEST',
    });
    expect(
      (await rpc([{ id: 'nope', scheduledFor: inHours(1) }])).data,
    ).toMatchObject({
      code: 'BAD_REQUEST',
      error: 'a post id or time in that reorder could not be read.',
    });
    const id = (await insertRow()).id;
    expect((await rpc([{ id }])).data).toMatchObject({
      code: 'BAD_REQUEST',
      error: 'a post in that reorder has no new time.',
    });
    expect(
      (
        await rpc([
          { id, scheduledFor: inHours(1) },
          { id, scheduledFor: inHours(2) },
        ])
      ).data,
    ).toMatchObject({
      code: 'BAD_REQUEST',
      error: 'a post appears twice in that reorder.',
    });
    expect(
      (
        await t.supabase.rpc('reorder_scheduled_posts', {
          p_user_did: '',
          p_moves: [],
        })
      ).data,
    ).toMatchObject({
      error: 'the reorder did not arrive in a shape we could read.',
    });
  });

  it('keeps the payload when a move carries no keys, and merges them when it does', async () => {
    const a = await insertRow({
      payload: payload(['a'], { rkeys: ['3kkeep0000002'], tz: 'UTC' }),
    });
    const when = inHours(4);
    await t.supabase.rpc('reorder_scheduled_posts', {
      p_user_did: DID,
      p_moves: [{ id: a.id, scheduledFor: when }],
    });
    expect((await readRow(a.id)).payload.rkeys).toEqual(['3kkeep0000002']);
    await t.supabase.rpc('reorder_scheduled_posts', {
      p_user_did: DID,
      p_moves: [{ id: a.id, scheduledFor: when, rkeys: ['3knew00000002'] }],
    });
    expect((await readRow(a.id)).payload).toMatchObject({
      rkeys: ['3knew00000002'],
      tz: 'UTC',
    });
  });

  it('answers UNAVAILABLE when the function is missing', async () => {
    const a = await insertRow();
    await t.exec('DROP FUNCTION reorder_scheduled_posts(TEXT, JSONB)');
    try {
      expect(
        await scheduled.reorderScheduledPosts({
          userDid: DID,
          moves: [{ id: a.id, scheduledFor: inHours(3) }],
        }),
      ).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    } finally {
      const { readMigration } = await import('../test/pglite.js');
      await t.exec(readMigration('20261113000200_scheduled_posts.sql'));
    }
  });
});

describe('rescheduleScheduledPost', () => {
  it('moves a pending row and re-mints its keys', async () => {
    const a = await insertRow({
      payload: payload(['a'], { rkeys: ['3kolda0000002'] }),
      next_attempt_at: inHours(1),
    });
    const when = inHours(6);
    const row = await scheduled.rescheduleScheduledPost({
      id: a.id,
      userDid: DID,
      scheduledFor: when,
    });
    expect(new Date(row.scheduled_for).toISOString()).toBe(when);
    expect(row.payload.rkeys[0]).not.toBe('3kolda0000002');
    expect(row.next_attempt_at).toBeNull();
  });

  it('refuses another account’s row, a non-pending row and a malformed id', async () => {
    const theirs = await insertRow({ user_did: OTHER_DID });
    const failed = await insertRow({ status: 'failed' });
    expect(
      await scheduled.rescheduleScheduledPost({
        id: theirs.id,
        userDid: DID,
        scheduledFor: inHours(3),
      }),
    ).toBeNull();
    expect(
      await scheduled.rescheduleScheduledPost({
        id: failed.id,
        userDid: DID,
        scheduledFor: inHours(3),
      }),
    ).toBeNull();
    expect(
      await scheduled.rescheduleScheduledPost({
        id: 'nope',
        userDid: DID,
        scheduledFor: inHours(3),
      }),
    ).toBeNull();
  });

  it('refuses a part-published thread', async () => {
    const a = await insertRow({
      progress: [{ uri: 'at://x/app.bsky.feed.post/1', cid: 'c' }],
    });
    expect(
      await scheduled.rescheduleScheduledPost({
        id: a.id,
        userDid: DID,
        scheduledFor: inHours(3),
      }),
    ).toEqual({
      blocked: 'PARTIALLY_PUBLISHED',
      status: 'pending',
    });
  });

  it('refuses a move past the pinned delete time and writes nothing', async () => {
    const slot = Date.now() + DAY;
    const a = await insertRow({
      scheduled_for: iso(slot),
      payload: payload(['t'], {
        selfDestruct: { lifespanSeconds: 3600, deleteAt: iso(slot + 9 * HOUR) },
      }),
    });
    expect(
      await scheduled.rescheduleScheduledPost({
        id: a.id,
        userDid: DID,
        scheduledFor: iso(slot + DAY),
      }),
    ).toEqual({
      blocked: 'DELETE_TIME_TOO_EARLY',
      deleteAt: iso(slot + 9 * HOUR),
    });
    expect((await readRow(a.id)).scheduled_for.toISOString()).toBe(iso(slot));
  });

  it('loses safely to a worker that wrote part of the thread in between', async () => {
    // The guarded write the move makes, after the worker claimed the row,
    // wrote the root, failed a later post and requeued it with progress.
    const a = await insertRow();
    await t.query(
      `UPDATE scheduled_posts SET progress = '[{"uri":"at://x/app.bsky.feed.post/1","cid":"c"}]' WHERE id = $1`,
      [a.id],
    );
    const { data, error } = await t.supabase
      .from('scheduled_posts')
      .update({ scheduled_for: inHours(9) })
      .eq('id', a.id)
      .eq('status', 'pending')
      .eq('progress', '[]')
      .select()
      .single();
    expect(data).toBeNull();
    expect(error.code).toBe('PGRST116');
    // With no progress the same predicate matches.
    const b = await insertRow();
    const ok = await t.supabase
      .from('scheduled_posts')
      .update({ scheduled_for: inHours(9) })
      .eq('id', b.id)
      .eq('progress', '[]')
      .select()
      .single();
    expect(ok.error).toBeNull();
  });
});

describe('retryFailedScheduledPost', () => {
  it('puts a failed row back as it stands, keeping keys and progress', async () => {
    const progress = [{ uri: 'at://x/app.bsky.feed.post/1', cid: 'c' }];
    const a = await insertRow({
      status: 'failed',
      attempts: 5,
      progress,
      payload: payload(['a', 'b'], {
        rkeys: ['3kkeep0000002', '3kkeep0000003'],
      }),
      next_attempt_at: inHours(1),
    });
    const row = await scheduled.retryFailedScheduledPost({
      id: a.id,
      userDid: DID,
    });
    expect(row).toMatchObject({
      status: 'pending',
      attempts: 0,
      next_attempt_at: null,
      progress,
    });
    expect(row.payload.rkeys).toEqual(['3kkeep0000002', '3kkeep0000003']);
  });

  it('answers null for a row that is not failed or not the account’s', async () => {
    const pending = await insertRow();
    const theirs = await insertRow({ user_did: OTHER_DID, status: 'failed' });
    expect(
      await scheduled.retryFailedScheduledPost({
        id: pending.id,
        userDid: DID,
      }),
    ).toBeNull();
    expect(
      await scheduled.retryFailedScheduledPost({ id: theirs.id, userDid: DID }),
    ).toBeNull();
  });

  it('refuses a revival at the ceiling', async () => {
    vi.stubEnv('SCHEDULE_MAX_PENDING', '1');
    await insertRow();
    const a = await insertRow({ status: 'failed' });
    await expect(
      scheduled.retryFailedScheduledPost({ id: a.id, userDid: DID }),
    ).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      feature: 'scheduledPosts',
      limit: 1,
    });
    expect((await readRow(a.id)).status).toBe('failed');
  });
});

describe('acknowledgeTimerFailure', () => {
  it('clears only a published row’s TIMER_NOT_ARMED note', async () => {
    const noted = await insertRow({
      status: 'published',
      last_error: 'timer could not be set',
      last_error_code: 'TIMER_NOT_ARMED',
    });
    const failed = await insertRow({
      status: 'failed',
      last_error: 'x',
      last_error_code: 'TIMER_NOT_ARMED',
    });
    const row = await scheduled.acknowledgeTimerFailure(noted.id, DID);
    expect(row).toMatchObject({
      status: 'published',
      last_error: null,
      last_error_code: null,
    });
    expect(await scheduled.acknowledgeTimerFailure(noted.id, DID)).toBeNull();
    expect(await scheduled.acknowledgeTimerFailure(failed.id, DID)).toBeNull();
    expect(
      await scheduled.acknowledgeTimerFailure(noted.id, OTHER_DID),
    ).toBeNull();
  });
});

describe('listScheduledPosts and getScheduledPost', () => {
  it('lists the account’s live rows and timer notes, in time order', async () => {
    const later = await insertRow({ scheduled_for: inHours(5) });
    const failed = await insertRow({
      scheduled_for: inHours(1),
      status: 'failed',
      last_error_code: 'MEDIA_MISSING',
    });
    const publishing = await insertRow({
      scheduled_for: inHours(2),
      status: 'publishing',
    });
    const note = await insertRow({
      scheduled_for: inHours(3),
      status: 'published',
      last_error_code: 'TIMER_NOT_ARMED',
    });
    await insertRow({ status: 'published' });
    await insertRow({ status: 'cancelled' });
    await insertRow({ user_did: OTHER_DID });
    const rows = await scheduled.listScheduledPosts(DID);
    expect(rows.map((r) => r.id)).toEqual([
      failed.id,
      publishing.id,
      note.id,
      later.id,
    ]);
    expect(rows[0].last_error_code).toBe('MEDIA_MISSING');
    expect(Object.keys(rows[0])).toContain('progress');
  });

  it('gets only the account’s row, and null for a malformed id', async () => {
    const a = await insertRow();
    expect((await scheduled.getScheduledPost(a.id, DID)).id).toBe(a.id);
    expect(await scheduled.getScheduledPost(a.id, OTHER_DID)).toBeNull();
    expect(await scheduled.getScheduledPost('not-a-uuid', DID)).toBeNull();
    expect(
      await scheduled.getScheduledPost(
        '00000000-0000-4000-8000-000000000000',
        DID,
      ),
    ).toBeNull();
  });

  it('says UNAVAILABLE when the table is missing', async () => {
    const bare = await createTestDatabase({ upTo: '20261113000100' });
    setSupabaseClientForTests(bare.supabase);
    try {
      await expect(scheduled.listScheduledPosts(DID)).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
    } finally {
      await bare.close();
    }
  });
});

describe('media', () => {
  it('stores bytes under the row, reads them back, and cancel removes them', async () => {
    const a = await insertRow();
    const path = await scheduled.storeMedia(
      a.id,
      'p0-img0',
      PNG_BASE64,
      'image/png',
    );
    expect(path).toBe(`${a.id}/p0-img0.png`);
    expect(
      await scheduled.storeMedia(
        a.id,
        'odd id/../x',
        PNG_BASE64,
        undefined,
        'e-1',
      ),
    ).toBe(`${a.id}/e-1/odd_id____x.bin`);
    await scheduled.updatePayload(
      a.id,
      payload(['a'], {
        media: { 'p0-img0': { storagePath: path, encoding: 'image/png' } },
      }),
    );

    expect(await scheduled.getScheduledMediaMap(a.id, DID)).toEqual({
      'p0-img0': { base64: PNG_BASE64, encoding: 'image/png' },
    });
    expect(await scheduled.getScheduledMediaMap(a.id, OTHER_DID)).toBeNull();

    const cancelled = await scheduled.cancelScheduledPost(a.id, DID);
    expect(cancelled.status).toBe('cancelled');
    expect(t.supabase.storage.read('scheduled-media', path)).toBeUndefined();
    expect(await scheduled.cancelScheduledPost(a.id, DID)).toBeNull();
  });

  it('leaves out an image whose bytes are gone', async () => {
    const a = await insertRow({
      payload: payload(['a'], {
        media: {
          gone: { storagePath: 'x/gone.png', encoding: 'image/png' },
          nopath: { encoding: 'image/png' },
        },
      }),
    });
    expect(await scheduled.getScheduledMediaMap(a.id, DID)).toEqual({});
  });

  it('cancels pending and failed rows only', async () => {
    const failed = await insertRow({ status: 'failed' });
    const publishing = await insertRow({ status: 'publishing' });
    const theirs = await insertRow({ user_did: OTHER_DID });
    expect((await scheduled.cancelScheduledPost(failed.id, DID)).status).toBe(
      'cancelled',
    );
    expect(await scheduled.cancelScheduledPost(publishing.id, DID)).toBeNull();
    expect(await scheduled.cancelScheduledPost(theirs.id, DID)).toBeNull();
    expect(await scheduled.cancelScheduledPost('nope', DID)).toBeNull();
  });
});

describe('updateScheduledPostContent', () => {
  const edit = (id, extra = {}) =>
    scheduled.updateScheduledPostContent({
      id,
      userDid: DID,
      scheduledFor: extra.scheduledFor || inHours(4),
      posts: extra.posts || [
        {
          record: { text: 'edited' },
          embed: { type: 'images', images: [{ mediaId: 'p0-img0' }] },
        },
      ],
      gates: { threadgate: [], postgate: null },
      mediaBytes: extra.mediaBytes || {
        'p0-img0': { base64: PNG_BASE64, encoding: 'image/png' },
      },
      queued: true,
      tz: extra.tz,
      selfDestruct: null,
    });

  it('rewrites the row, stashes into a fresh folder and drops the old bytes', async () => {
    const a = await insertRow({
      payload: payload(['old'], { tz: 'Europe/Paris' }),
    });
    const oldPath = await scheduled.storeMedia(
      a.id,
      'p0-img0',
      PNG_BASE64,
      'image/png',
    );
    await scheduled.updatePayload(
      a.id,
      payload(['old'], {
        tz: 'Europe/Paris',
        media: { 'p0-img0': { storagePath: oldPath, encoding: 'image/png' } },
      }),
    );

    const row = await edit(a.id);
    const newPath = row.payload.media['p0-img0'].storagePath;
    expect(newPath).toMatch(
      new RegExp(`^${a.id}/e-[0-9a-z]+-[0-9a-f]{8}/p0-img0\\.png$`),
    );
    expect(row).toMatchObject({
      status: 'pending',
      queued: true,
      attempts: 0,
      last_error: null,
      progress: [],
    });
    expect(row.payload).toMatchObject({
      gates: { threadgate: [], postgate: null },
      tz: 'Europe/Paris',
      selfDestruct: null,
    });
    expect(row.payload.rkeys).toHaveLength(1);
    expect(t.supabase.storage.read('scheduled-media', oldPath)).toBeUndefined();
    expect(t.supabase.storage.read('scheduled-media', newPath)).toBeTruthy();
  });

  it('keeps the stored keys when the time and length hold still', async () => {
    const when = inHours(4);
    const a = await insertRow({
      scheduled_for: when,
      payload: payload(['old'], { rkeys: ['3kkeep0000002'] }),
    });
    const row = await edit(a.id, { scheduledFor: when });
    expect(row.payload.rkeys).toEqual(['3kkeep0000002']);
  });

  it('revives a failed row, but not past the ceiling', async () => {
    const a = await insertRow({
      status: 'failed',
      attempts: 5,
      last_error: 'gone',
      last_error_code: 'MEDIA_MISSING',
    });
    const row = await edit(a.id);
    expect(row).toMatchObject({
      status: 'pending',
      attempts: 0,
      last_error: null,
      last_error_code: null,
      media_reclaimed_at: null,
    });

    vi.stubEnv('SCHEDULE_MAX_PENDING', '1');
    const b = await insertRow({ status: 'failed' });
    await expect(edit(b.id)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      limit: 1,
    });
    expect(
      t.supabase.storage.ops.filter(
        (o) => o.verb === 'upload' && o.paths[0].startsWith(b.id),
      ),
    ).toEqual([]);
  });

  it('refuses a part-published thread before touching media', async () => {
    const a = await insertRow({
      status: 'failed',
      progress: [{ uri: 'at://x/app.bsky.feed.post/1', cid: 'c' }],
    });
    expect(await edit(a.id)).toEqual({
      blocked: 'PARTIALLY_PUBLISHED',
      status: 'failed',
    });
    expect(t.supabase.storage.ops).toEqual([]);
  });

  it('answers null for a publishing row, another account’s, or a missing one', async () => {
    const publishing = await insertRow({ status: 'publishing' });
    const theirs = await insertRow({ user_did: OTHER_DID });
    expect(await edit(publishing.id)).toBeNull();
    expect(await edit(theirs.id)).toBeNull();
    expect(await edit('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('removes what it stashed when the bytes run out halfway', async () => {
    const a = await insertRow();
    const posts = [
      {
        record: { text: 'x' },
        embed: {
          type: 'images',
          images: [{ mediaId: 'p0-img0' }, { mediaId: 'p0-img1' }],
        },
      },
    ];
    await expect(edit(a.id, { posts })).rejects.toThrow(
      'missing bytes for media "p0-img1"',
    );
    expect(t.supabase.storage.objects.size).toBe(0);
    expect((await readRow(a.id)).payload.posts[0].record.text).toBe('hello');
  });
});

describe('bookkeeping', () => {
  it('requeues with backoff min(2^attempts, 60) minutes, keeping media', async () => {
    const a = await insertRow({ status: 'publishing', attempts: 2 });
    const before = Date.now();
    expect(
      await scheduled.markFailedOrRetry(
        { ...a, attempts: 2, max_attempts: 5 },
        'Rate limit exceeded',
      ),
    ).toBe('retry');
    const row = await readRow(a.id);
    expect(row).toMatchObject({
      status: 'pending',
      last_error: 'Rate limit exceeded',
      last_error_code: 'RATE_LIMITED',
      locked_at: null,
    });
    const wait = row.next_attempt_at.getTime() - before;
    expect(wait).toBeGreaterThanOrEqual(4 * MINUTE - 1000);
    expect(wait).toBeLessThan(4 * MINUTE + 5000);

    await scheduled.markFailedOrRetry(
      { ...a, attempts: 9, max_attempts: 50 },
      'x',
    );
    const capped = (await readRow(a.id)).next_attempt_at.getTime() - Date.now();
    expect(capped).toBeGreaterThan(59 * MINUTE);
    expect(capped).toBeLessThanOrEqual(60 * MINUTE + 1000);
  });

  it('retires a row once its attempts are spent, or at once when terminal, keeping its media', async () => {
    const a = await insertRow({ status: 'publishing', attempts: 5 });
    const path = await scheduled.storeMedia(a.id, 'm', PNG_BASE64, 'image/png');
    const long = 'x'.repeat(600);
    expect(
      await scheduled.markFailedOrRetry(
        { ...a, attempts: 5, max_attempts: 5 },
        long,
        { code: 'REFUSED' },
      ),
    ).toBe('failed');
    const row = await readRow(a.id);
    expect(row).toMatchObject({ status: 'failed', last_error_code: 'REFUSED' });
    expect(row.last_error).toHaveLength(500);
    expect(t.supabase.storage.read('scheduled-media', path)).toBeTruthy();

    const b = await insertRow({ status: 'publishing', attempts: 1 });
    expect(
      await scheduled.markFailedOrRetry(
        { ...b, attempts: 1, max_attempts: 5 },
        'gone',
        { terminal: true, code: 'BOGUS' },
      ),
    ).toBe('failed');
    expect((await readRow(b.id)).last_error_code).toBe('UNKNOWN');
  });

  it('marks a row published and removes its media', async () => {
    const a = await insertRow({
      status: 'publishing',
      last_error: 'earlier',
      last_error_code: 'RATE_LIMITED',
    });
    const path = await scheduled.storeMedia(a.id, 'm', PNG_BASE64, 'image/png');
    await scheduled.markPublished(
      a.id,
      { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' },
      { m: { storagePath: path } },
    );
    expect(await readRow(a.id)).toMatchObject({
      status: 'published',
      result_uri: 'at://x/app.bsky.feed.post/1',
      result_cid: 'c',
      last_error: null,
      last_error_code: null,
    });
    expect(t.supabase.storage.read('scheduled-media', path)).toBeUndefined();
  });

  it('saves progress', async () => {
    const a = await insertRow({ status: 'publishing' });
    const progress = [{ uri: 'at://x/app.bsky.feed.post/1', cid: 'c' }];
    await scheduled.markProgress(a.id, progress);
    expect((await readRow(a.id)).progress).toEqual(progress);
  });
});

describe('reclaimFailedMedia', () => {
  it('sweeps only failed rows past the window that still have media, and stamps them', async () => {
    const old = iso(Date.now() - 40 * DAY);
    const sweep = await insertRow({ status: 'failed', updated_at: old });
    const path = await scheduled.storeMedia(
      sweep.id,
      'm',
      PNG_BASE64,
      'image/png',
    );
    await t.query(
      `UPDATE scheduled_posts SET payload = $2::jsonb, updated_at = $3 WHERE id = $1`,
      [
        sweep.id,
        JSON.stringify(
          payload(['a'], {
            media: { m: { storagePath: path, encoding: 'image/png' } },
          }),
        ),
        old,
      ],
    );
    const recent = await insertRow({
      status: 'failed',
      payload: payload(['b'], { media: { m: { storagePath: 'r/m.png' } } }),
    });
    const noMedia = await insertRow({ status: 'failed', updated_at: old });
    const pending = await insertRow({
      updated_at: old,
      payload: payload(['c'], { media: { m: { storagePath: 'p/m.png' } } }),
    });

    expect(await scheduled.reclaimFailedMedia()).toEqual({
      swept: 1,
      failed: 0,
      unavailable: false,
    });
    expect((await readRow(sweep.id)).media_reclaimed_at).not.toBeNull();
    expect(t.supabase.storage.read('scheduled-media', path)).toBeUndefined();
    for (const r of [recent, noMedia, pending])
      expect((await readRow(r.id)).media_reclaimed_at).toBeNull();
    // Stamped rows aren't handed out again.
    expect(await scheduled.reclaimFailedMedia()).toEqual({
      swept: 0,
      failed: 0,
      unavailable: false,
    });
  });

  it('leaves a row unstamped when its delete fails', async () => {
    const old = iso(Date.now() - 40 * DAY);
    const a = await insertRow({
      status: 'failed',
      payload: payload(['a'], { media: { m: { storagePath: 'a/m.png' } } }),
      updated_at: old,
    });
    await t.query(`UPDATE scheduled_posts SET updated_at = $2 WHERE id = $1`, [
      a.id,
      old,
    ]);
    t.supabase.storage.failNext('scheduled-media', 'remove');
    expect(await scheduled.reclaimFailedMedia()).toEqual({
      swept: 0,
      failed: 1,
      unavailable: false,
    });
    expect((await readRow(a.id)).media_reclaimed_at).toBeNull();
  });
});

describe('without Supabase', () => {
  it('throws UNAVAILABLE', async () => {
    setSupabaseClientForTests(null);
    await expect(scheduled.listScheduledPosts(DID)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });
});
