// The cron worker over the real store on PGlite, with a stand-in PDS behind
// the restored session and the timer arming stubbed: who may run it, what a
// tick publishes, retries and retires, and when it sweeps.

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
import { createTestDatabase } from '../../test/pglite.js';
import { createReq, createRes } from '../../test/http.js';
import {
  setSupabaseClientForTests,
  resetSupabaseClientForTests,
} from '../../supabase.js';
import {
  DID,
  MINUTE,
  DAY,
  iso,
  fakePds,
  PNG_BASE64,
} from '../testing/fixtures.js';

const oauth = vi.hoisted(() => ({ restoreSession: vi.fn() }));
vi.mock('../../oauth/client.js', () => ({ getOAuthClient: () => oauth }));

const timers = vi.hoisted(() => ({ armForPublishedSchedule: vi.fn() }));
vi.mock('../../timers/selfDestruct.js', async (importOriginal) => ({
  ...(await importOriginal()),
  armForPublishedSchedule: timers.armForPublishedSchedule,
}));

const { default: run, TIMED_OUT_ERROR } = await import('./run.js');
const scheduled = await import('../scheduledPosts.js');

const SECRET = 'cron-secret-for-tests';

let t;
let pds;
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
  vi.stubEnv('CRON_SECRET', SECRET);
  pds = fakePds();
  oauth.restoreSession.mockReset();
  oauth.restoreSession.mockResolvedValue(pds.session);
  timers.armForPublishedSchedule.mockReset();
  timers.armForPublishedSchedule.mockResolvedValue({ id: 'timer-1' });
});
afterEach(() => {
  resetSupabaseClientForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function tick({
  method = 'GET',
  authorization = `Bearer ${SECRET}`,
} = {}) {
  const req = createReq({
    method,
    headers: authorization ? { authorization } : {},
  });
  const res = createRes();
  await run(req, res);
  return res;
}

const posts = (texts) => texts.map((text) => ({ record: { text } }));

async function insertDue(fields = {}) {
  const row = {
    scheduled_for: iso(Date.now() - MINUTE),
    status: 'pending',
    payload: {
      posts: posts(['due now']),
      gates: {},
      media: {},
      rkeys: ['3kaaaaaaaaaa2'],
    },
    progress: [],
    attempts: 0,
    created_at: iso(Date.now() - DAY),
    ...fields,
  };
  const { rows } = await t.query(
    `INSERT INTO scheduled_posts (user_did, scheduled_for, status, payload, progress, attempts, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, COALESCE($8, NOW())) RETURNING *`,
    [
      DID,
      row.scheduled_for,
      row.status,
      JSON.stringify(row.payload),
      JSON.stringify(row.progress),
      row.attempts,
      row.created_at,
      row.updated_at ?? null,
    ],
  );
  return rows[0];
}
const readRow = async (id) =>
  (await t.query('SELECT * FROM scheduled_posts WHERE id = $1', [id])).rows[0];

describe('who may run the worker', () => {
  it('refuses a missing or wrong secret', async () => {
    await insertDue();
    for (const authorization of [null, 'Bearer wrong', SECRET]) {
      const res = await tick({ authorization });
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ success: false, error: 'Unauthorized' });
    }
    expect(pds.writes).toEqual([]);
  });

  it('runs for the cron’s bearer on GET or POST', async () => {
    expect((await tick()).statusCode).toBe(200);
    expect((await tick({ method: 'POST' })).statusCode).toBe(200);
  });

  it('refuses everything in production without a secret', async () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect((await tick({ authorization: null })).statusCode).toBe(401);
  });

  it('answers 503 UNAVAILABLE without Supabase', async () => {
    setSupabaseClientForTests(null);
    const res = await tick();
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('UNAVAILABLE');
  });
});

describe('a tick', () => {
  it('publishes a due thread, saves progress and reports the summary', async () => {
    const row = await insertDue({
      payload: {
        posts: posts(['root', 'reply']),
        gates: {},
        media: {},
        rkeys: ['3kroot0000002', '3kroot0000003'],
      },
    });
    await insertDue({ scheduled_for: iso(Date.now() + DAY) }); // not due
    const res = await tick();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      reclaimed: 0,
      claimed: 1,
      published: 1,
      retried: 0,
      failed: 0,
      armed: 0,
      armFailed: 0,
      mediaReclaimed: null,
      errors: [],
    });
    expect(res.body.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body).not.toHaveProperty('ledger');
    const after = await readRow(row.id);
    expect(after).toMatchObject({
      status: 'published',
      result_uri: `at://${DID}/app.bsky.feed.post/3kroot0000002`,
      locked_at: null,
      attempts: 1,
    });
    expect(after.progress).toHaveLength(2);
    expect(pds.posts().map((w) => w.rkey)).toEqual([
      '3kroot0000002',
      '3kroot0000003',
    ]);
    expect(timers.armForPublishedSchedule).not.toHaveBeenCalled();
  });

  it('removes a published row’s stashed images', async () => {
    const row = await insertDue();
    const path = await scheduled.storeMedia(
      row.id,
      'p0-img0',
      PNG_BASE64,
      'image/png',
    );
    await scheduled.updatePayload(row.id, {
      posts: [
        {
          record: { text: 'pic' },
          embed: { type: 'images', images: [{ mediaId: 'p0-img0' }] },
        },
      ],
      gates: {},
      media: { 'p0-img0': { storagePath: path, encoding: 'image/png' } },
      rkeys: ['3kaaaaaaaaaa2'],
    });
    expect((await tick()).body.published).toBe(1);
    expect(pds.blobs).toHaveLength(1);
    expect(t.supabase.storage.read('scheduled-media', path)).toBeUndefined();
  });

  it('arms the timer over every post the thread wrote', async () => {
    const selfDestruct = {
      lifespanSeconds: 3600,
      deleteAt: null,
      conditions: { sense: 'any', clauses: [] },
      effects: null,
    };
    const row = await insertDue({
      payload: {
        posts: posts(['root', 'reply']),
        gates: {},
        media: {},
        rkeys: ['3kroot0000002', '3kroot0000003'],
        selfDestruct,
      },
    });
    const res = await tick();
    expect(res.body).toMatchObject({ published: 1, armed: 1, armFailed: 0 });
    const [armedRow, refs] = timers.armForPublishedSchedule.mock.calls[0];
    expect(armedRow.id).toBe(row.id);
    expect(refs.map((r) => r.uri)).toEqual([
      `at://${DID}/app.bsky.feed.post/3kroot0000002`,
      `at://${DID}/app.bsky.feed.post/3kroot0000003`,
    ]);
  });

  it('leaves a TIMER_NOT_ARMED note on a published row whose timer couldn’t be set', async () => {
    timers.armForPublishedSchedule.mockRejectedValue(
      new Error('the timer for this post was refused: ' + 'x'.repeat(400)),
    );
    const row = await insertDue({
      payload: {
        posts: posts(['root']),
        gates: {},
        media: {},
        rkeys: ['3kroot0000002'],
        selfDestruct: { lifespanSeconds: 3600 },
      },
    });
    const res = await tick();
    expect(res.body).toMatchObject({ published: 1, armed: 0, armFailed: 1 });
    expect(res.body.errors[0].error).toMatch(/^self-destruct: /);
    const after = await readRow(row.id);
    expect(after.status).toBe('published');
    expect(after.last_error_code).toBe('TIMER_NOT_ARMED');
    expect(after.last_error).toMatch(
      /^this post published, but its self-destruct timer could not be set: the timer for this post was refused/,
    );
    expect(after.last_error).toMatch(
      /set a timer by hand from the post if you still want it to come down\.$/,
    );
    const cause = after.last_error
      .slice(
        'this post published, but its self-destruct timer could not be set: '
          .length,
      )
      .split('. set a timer')[0];
    expect(cause.length).toBe(300);
    // The note shows in the list until it's acknowledged.
    expect((await scheduled.listScheduledPosts(DID)).map((r) => r.id)).toEqual([
      row.id,
    ]);
  });

  it('requeues a retriable failure with backoff', async () => {
    oauth.restoreSession.mockResolvedValue(null);
    const row = await insertDue();
    const res = await tick();
    expect(res.body).toMatchObject({
      claimed: 1,
      published: 0,
      retried: 1,
      failed: 0,
    });
    expect(res.body.errors).toEqual([
      {
        id: row.id,
        error:
          "couldn't reach your account session. reconnect your account if this keeps happening.",
        terminal: false,
      },
    ]);
    const after = await readRow(row.id);
    expect(after).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error_code: 'SESSION_UNAVAILABLE',
    });
    expect(after.next_attempt_at.getTime()).toBeGreaterThan(
      Date.now() + MINUTE,
    );
    // Backing off: the next tick leaves it alone.
    expect((await tick()).body.claimed).toBe(0);
  });

  it('gives a fresh row’s missing images a retry, and fails an older one', async () => {
    const pictures = {
      posts: [
        {
          record: { text: 'pic' },
          embed: { type: 'images', images: [{ mediaId: 'p0-img0' }] },
        },
      ],
      gates: {},
      media: {},
      rkeys: ['3kaaaaaaaaaa2'],
    };
    const fresh = await insertDue({
      payload: pictures,
      created_at: iso(Date.now() - MINUTE),
    });
    const old = await insertDue({
      payload: { ...pictures, rkeys: ['3kbbbbbbbbbb2'] },
      created_at: iso(Date.now() - 10 * MINUTE),
    });
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 2, retried: 1, failed: 1 });
    expect(await readRow(fresh.id)).toMatchObject({
      status: 'pending',
      last_error_code: 'MEDIA_MISSING',
    });
    expect(await readRow(old.id)).toMatchObject({
      status: 'failed',
      last_error_code: 'MEDIA_MISSING',
    });
  });

  it('fails a row on its last attempt', async () => {
    oauth.restoreSession.mockResolvedValue(null);
    const row = await insertDue({ attempts: 4 });
    expect((await tick()).body).toMatchObject({ failed: 1, retried: 0 });
    expect(await readRow(row.id)).toMatchObject({
      status: 'failed',
      attempts: 5,
      last_error_code: 'SESSION_UNAVAILABLE',
    });
  });

  it('finishes a spent row whose thread is all out, and arms its timer', async () => {
    const progress = [
      { uri: `at://${DID}/app.bsky.feed.post/3kroot0000002`, cid: 'c1' },
      { uri: `at://${DID}/app.bsky.feed.post/3kroot0000003`, cid: 'c2' },
    ];
    const row = await insertDue({
      attempts: 5,
      progress,
      payload: {
        posts: posts(['root', 'reply']),
        gates: {},
        media: {},
        rkeys: [],
        selfDestruct: { lifespanSeconds: 3600 },
      },
    });
    const res = await tick();
    expect(res.body).toMatchObject({
      claimed: 1,
      published: 1,
      failed: 0,
      armed: 1,
    });
    expect(await readRow(row.id)).toMatchObject({
      status: 'published',
      result_uri: progress[0].uri,
    });
    expect(timers.armForPublishedSchedule.mock.calls[0][1]).toEqual(progress);
    expect(pds.writes).toEqual([]);
  });

  it('retires a spent row that is only part out as TIMED_OUT', async () => {
    const row = await insertDue({
      attempts: 5,
      progress: [
        { uri: `at://${DID}/app.bsky.feed.post/3kroot0000002`, cid: 'c1' },
      ],
      payload: {
        posts: posts(['root', 'reply']),
        gates: {},
        media: {},
        rkeys: [],
      },
    });
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 1, published: 0, failed: 1 });
    expect(await readRow(row.id)).toMatchObject({
      status: 'failed',
      last_error: TIMED_OUT_ERROR,
      last_error_code: 'TIMED_OUT',
    });
    expect(pds.writes).toEqual([]);
  });

  it('reclaims a row stuck publishing and publishes it the same tick', async () => {
    const row = await insertDue({ status: 'publishing', attempts: 1 });
    await t.query(
      `UPDATE scheduled_posts SET locked_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
      [row.id],
    );
    const res = await tick();
    expect(res.body).toMatchObject({ reclaimed: 1, claimed: 1, published: 1 });
  });

  it('claims at most SCHEDULE_CLAIM_LIMIT rows', async () => {
    vi.stubEnv('SCHEDULE_CLAIM_LIMIT', '2');
    for (let i = 0; i < 3; i++)
      await insertDue({
        payload: {
          posts: posts([`p${i}`]),
          gates: {},
          media: {},
          rkeys: [`3kclaim${i}00002`],
        },
      });
    expect((await tick()).body.claimed).toBe(2);
  });

  it('keeps one row’s bookkeeping failure that row’s problem', async () => {
    oauth.restoreSession.mockResolvedValue(null);
    const row = await insertDue();
    const realFrom = t.supabase.from;
    vi.spyOn(t.supabase, 'from').mockImplementation((table) => {
      const builder = realFrom(table);
      const update = builder.update.bind(builder);
      builder.update = (patch) =>
        patch.next_attempt_at
          ? { eq: async () => ({ error: { message: 'write refused' } }) }
          : update(patch);
      return builder;
    });
    const res = await tick();
    expect(res.statusCode).toBe(200);
    expect(res.body.errors).toContainEqual({
      id: row.id,
      error: 'bookkeeping: write refused',
      terminal: false,
    });
    expect((await readRow(row.id)).status).toBe('publishing');
  });
});

describe('the failed-media sweep', () => {
  async function staleFailedRowWithMedia() {
    const row = await insertDue({ status: 'failed' });
    const path = await scheduled.storeMedia(
      row.id,
      'm',
      PNG_BASE64,
      'image/png',
    );
    await t.query(
      `UPDATE scheduled_posts SET payload = $2::jsonb, updated_at = NOW() - INTERVAL '40 days' WHERE id = $1`,
      [
        row.id,
        JSON.stringify({
          posts: posts(['x']),
          media: { m: { storagePath: path, encoding: 'image/png' } },
        }),
      ],
    );
    return { row, path };
  }

  function at(minute) {
    const now = new Date();
    now.setUTCMinutes(minute, 5, 0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  }

  it('runs at minute 17 of the hour', async () => {
    const { row, path } = await staleFailedRowWithMedia();
    at(17);
    const res = await tick();
    expect(res.body.mediaReclaimed).toEqual({
      swept: 1,
      failed: 0,
      unavailable: false,
    });
    expect((await readRow(row.id)).media_reclaimed_at).not.toBeNull();
    expect(t.supabase.storage.read('scheduled-media', path)).toBeUndefined();
  });

  it('stays out of every other minute', async () => {
    const { path } = await staleFailedRowWithMedia();
    at(18);
    expect((await tick()).body.mediaReclaimed).toBeNull();
    expect(t.supabase.storage.read('scheduled-media', path)).toBeTruthy();
  });
});
