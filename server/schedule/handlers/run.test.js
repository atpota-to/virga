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
  CIDS,
  DID,
  MINUTE,
  HOUR,
  DAY,
  iso,
  fakePds,
  json,
  PNG_BASE64,
} from '../testing/fixtures.js';

const oauth = vi.hoisted(() => ({ restoreSession: vi.fn() }));
vi.mock('../../oauth/client.js', () => ({ getOAuthClient: () => oauth }));

// The worker refuses to run without a usable OAuth client; these tests give
// it one unless a test says otherwise.
const oauthConfig = vi.hoisted(() => ({ unavailableReason: vi.fn() }));
vi.mock('../../oauth/config.js', async (importOriginal) => ({
  ...(await importOriginal()),
  unavailableReason: oauthConfig.unavailableReason,
}));

const timers = vi.hoisted(() => ({ armForPublishedSchedule: vi.fn() }));
vi.mock('../../timers/selfDestruct.js', async (importOriginal) => ({
  ...(await importOriginal()),
  armForPublishedSchedule: timers.armForPublishedSchedule,
}));

const { default: run, TIMED_OUT_ERROR } = await import('./run.js');
const scheduled = await import('../scheduledPosts.js');
const { deps: replyDeps } = await import('../replyTarget.js');
const realReplyDeps = { ...replyDeps };

const SECRET = 'cron-secret-for-tests';

let t;
let pds;
beforeAll(async () => {
  t = await createTestDatabase({ upTo: '20261114000100' });
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
  oauthConfig.unavailableReason.mockReset();
  oauthConfig.unavailableReason.mockReturnValue(null);
  timers.armForPublishedSchedule.mockReset();
  timers.armForPublishedSchedule.mockResolvedValue({ id: 'timer-1' });
});
afterEach(() => {
  resetSupabaseClientForTests();
  Object.assign(replyDeps, realReplyDeps);
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
    `INSERT INTO scheduled_posts (user_did, scheduled_for, status, payload, progress, attempts, created_at, updated_at, series_id, occurrence)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, COALESCE($8, NOW()), $9, $10) RETURNING *`,
    [
      DID,
      row.scheduled_for,
      row.status,
      JSON.stringify(row.payload),
      JSON.stringify(row.progress),
      row.attempts,
      row.created_at,
      row.updated_at ?? null,
      row.series_id ?? null,
      row.series_id ? (row.occurrence ?? 1) : null,
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

  it('claims nothing while the OAuth client cannot start, so due posts keep their attempts', async () => {
    const row = await insertDue();
    oauthConfig.unavailableReason.mockReturnValue(
      'OAUTH_PRIVATE_KEY_1 is not set',
    );
    const res = await tick();
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('VIRGA_CLIENT_UNAVAILABLE');
    expect(await readRow(row.id)).toMatchObject({
      status: 'pending',
      attempts: 0,
      locked_at: null,
    });
    expect(oauth.restoreSession).not.toHaveBeenCalled();

    oauthConfig.unavailableReason.mockReturnValue(null);
    expect((await tick()).body.published).toBe(1);
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
      errors: [],
    });
    // (mediaReclaimed is null on every minute but the sweep's, which the
    // sweep's own tests pin; this one runs on the real clock.)
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
    expect(t.supabase.storage.read('virga-scheduled-media', path)).toBeUndefined();
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
    expect(t.supabase.storage.read('virga-scheduled-media', path)).toBeUndefined();
  });

  it('stays out of every other minute', async () => {
    const { path } = await staleFailedRowWithMedia();
    at(18);
    expect((await tick()).body.mediaReclaimed).toBeNull();
    expect(t.supabase.storage.read('virga-scheduled-media', path)).toBeTruthy();
  });
});

describe('a scheduled reply', () => {
  const PARENT = {
    uri: 'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3lwcs2m4ock2z',
    cid: CIDS[3],
  };
  const ROOT = {
    uri: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3lwcrzq3bbc2y',
    cid: CIDS[4],
  };
  const replyPayload = (texts = ['a reply']) => ({
    posts: posts(texts),
    gates: { threadgate: null, postgate: null },
    media: {},
    rkeys: texts.map((_, i) => `3kreply00000${i + 2}`),
    reply: { root: ROOT, parent: PARENT },
    replyTo: { handle: 'ada.example.com', displayName: 'Ada', text: 'the post' },
  });
  /** What the parent's PDS says about the post being replied to. */
  function parentPds(answer) {
    replyDeps.resolvePdsEndpoint = vi.fn(async (did) => ({
      did,
      pdsEndpoint: 'https://their-pds.example',
    }));
    replyDeps.safeFetch = vi.fn(async () => answer());
  }
  const there = () => json({ uri: PARENT.uri, cid: PARENT.cid, value: {} });
  const gone = () => json({ error: 'RecordNotFound', message: 'Could not locate record' }, 400);
  const down = () => json({ error: 'InternalServerError', message: 'boom' }, 500);

  it('goes out as a reply to its parent, under the parent’s root', async () => {
    parentPds(there);
    const row = await insertDue({ payload: replyPayload(['first', 'second']) });
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 1, published: 1, failed: 0 });
    const [first, second] = pds.posts();
    expect(first.record.reply).toEqual({ root: ROOT, parent: PARENT });
    expect(second.record.reply).toEqual({
      root: ROOT,
      parent: { uri: `at://${DID}/app.bsky.feed.post/${first.rkey}`, cid: CIDS[0] },
    });
    expect(pds.writes.every((w) => w.collection === 'app.bsky.feed.post')).toBe(true);
    expect(await readRow(row.id)).toMatchObject({
      status: 'published',
      result_uri: `at://${DID}/app.bsky.feed.post/3kreply000002`,
    });
  });

  it('is not posted when the parent is gone: the row fails at once, saying why', async () => {
    parentPds(gone);
    const row = await insertDue({ payload: replyPayload() });
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 1, published: 0, retried: 0, failed: 1 });
    expect(res.body.errors).toEqual([
      {
        id: row.id,
        error:
          'the post this replies to has been deleted, so the reply was not posted.',
        terminal: true,
      },
    ]);
    expect(pds.writes).toEqual([]);
    expect(await readRow(row.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      last_error:
        'the post this replies to has been deleted, so the reply was not posted.',
      last_error_code: 'REPLY_TARGET_GONE',
    });
    // It stays in the list, to be read and dismissed.
    expect((await scheduled.listScheduledPosts(DID)).map((r) => r.id)).toEqual([row.id]);
  });

  it('is held back, not posted blind, when the parent can’t be checked, and retried with backoff', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    parentPds(down);
    const row = await insertDue({ payload: replyPayload() });
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 1, published: 0, retried: 1, failed: 0 });
    expect(pds.writes).toEqual([]);
    const after = await readRow(row.id);
    expect(after).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error_code: 'REPLY_TARGET_UNCHECKED',
      last_error:
        "couldn't check that the post this replies to is still there, so the reply was held back.",
    });
    expect(after.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + MINUTE);

    // The PDS is back by the next attempt: the reply goes out then.
    parentPds(there);
    await t.query(`UPDATE scheduled_posts SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [row.id]);
    expect((await tick()).body.published).toBe(1);
    expect(pds.posts()[0].record.reply).toEqual({ root: ROOT, parent: PARENT });
    expect(await readRow(row.id)).toMatchObject({
      status: 'published',
      attempts: 2,
      last_error: null,
      last_error_code: null,
    });
  });

  it('fails for good once its attempts are spent without ever being able to check', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    parentPds(down);
    const row = await insertDue({ payload: replyPayload(), attempts: 4 });
    expect((await tick()).body).toMatchObject({ failed: 1, retried: 0 });
    expect(pds.writes).toEqual([]);
    expect(await readRow(row.id)).toMatchObject({
      status: 'failed',
      attempts: 5,
      last_error_code: 'REPLY_TARGET_UNCHECKED',
    });
  });

  it('finishes a thread that was part-way out without asking again', async () => {
    parentPds(gone);
    const first = { uri: `at://${DID}/app.bsky.feed.post/3kreply000002`, cid: CIDS[2] };
    await insertDue({
      payload: replyPayload(['first', 'second']),
      progress: [first],
      attempts: 1,
    });
    expect((await tick()).body.published).toBe(1);
    expect(replyDeps.safeFetch).not.toHaveBeenCalled();
    expect(pds.posts()).toHaveLength(1);
    expect(pds.posts()[0].record.reply).toEqual({ root: ROOT, parent: first });
  });
});

describe('a repeating post', () => {
  const SERIES = '11111111-1111-4111-8111-111111111111';
  const minute = (ms) => Math.floor(ms / MINUTE) * MINUTE;
  const pad = (v) => String(v).padStart(2, '0');
  /** A weekly rule in UTC whose first occurrence is at `at`. */
  const weekly = (at, extra = {}) => {
    const d = new Date(at);
    return {
      every: 'week',
      tz: 'UTC',
      until: null,
      count: null,
      anchor: {
        date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
        time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
        occurrence: 1,
      },
      ...extra,
    };
  };
  async function insertRepeating({ at = minute(Date.now() - MINUTE), rule = {}, payload = {}, ...fields } = {}) {
    return insertDue({
      scheduled_for: iso(at),
      series_id: SERIES,
      occurrence: 1,
      ...fields,
      payload: {
        posts: posts(['every Monday']),
        gates: {},
        media: {},
        rkeys: ['3kweekly00002'],
        repeat: weekly(at, rule),
        ...payload,
      },
    });
  }
  const series = async () =>
    (await t.query('SELECT * FROM scheduled_posts WHERE series_id = $1 ORDER BY occurrence', [SERIES])).rows;

  it('publishes the occurrence that is due and leaves the next one waiting, a week on', async () => {
    const at = minute(Date.now() - MINUTE);
    const row = await insertRepeating({ at });
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 1, published: 1, failed: 0, errors: [] });
    const [first, second] = await series();
    expect(first).toMatchObject({ id: row.id, status: 'published', occurrence: 1 });
    expect(second).toMatchObject({ status: 'pending', occurrence: 2, attempts: 0 });
    expect(second.scheduled_for.getTime()).toBe(at + 7 * DAY);
    expect(second.payload.repeat).toEqual(row.payload.repeat);
    expect(second.payload.posts).toEqual(row.payload.posts);
    expect(second.payload.rkeys).toHaveLength(1);
    expect(second.payload.rkeys[0]).not.toBe('3kweekly00002');
    // Not due for a week: the next tick leaves it where it is.
    expect((await tick()).body.claimed).toBe(0);
    expect(pds.posts()).toHaveLength(1);
  });

  it('gives every occurrence its own record, at its own key and time', async () => {
    const at = minute(Date.now() - MINUTE);
    await insertRepeating({ at, rule: { count: 3 } });
    for (let n = 0; n < 5; n++) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(at + n * 7 * DAY + 2 * MINUTE));
      await tick();
    }
    vi.useRealTimers();
    const written = pds.posts();
    expect(written).toHaveLength(3);
    expect(new Set(written.map((w) => w.rkey)).size).toBe(3);
    expect(written.map((w) => w.record.createdAt)).toEqual(
      [0, 1, 2].map((n) => iso(at + n * 7 * DAY)),
    );
    expect(written.every((w) => w.record.text === 'every Monday')).toBe(true);
    // "After 3 times": the series is over, with nothing left waiting.
    expect((await series()).map((r) => r.status)).toEqual(['published', 'published', 'published']);
  });

  it('never posts twice or forks the series when two runs overlap', async () => {
    // A first run claimed the row and is slow, not dead: long enough for
    // the row to be reclaimed and a second run to take it up.
    const row = await insertRepeating({ status: 'publishing', attempts: 1 });
    await t.query(
      `UPDATE scheduled_posts SET locked_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
      [row.id],
    );
    const held = await readRow(row.id);
    const res = await tick();
    expect(res.body).toMatchObject({ reclaimed: 1, claimed: 1, published: 1 });
    // Then the first run finishes after all, with the row as it claimed it.
    const result = await scheduled.publishScheduledPost(held);
    await scheduled.markPublished(held.id, result, held.payload.media, held);

    // putRecord at the reserved key both times: one record, written over
    // itself, never a second post.
    expect(pds.posts().map((w) => w.rkey)).toEqual([
      '3kweekly00002',
      '3kweekly00002',
    ]);
    const rows = await series();
    expect(rows.map((r) => [r.occurrence, r.status])).toEqual([
      [1, 'published'],
      [2, 'pending'],
    ]);
  });

  it('loses nothing to a run that died between writing the post and recording it', async () => {
    const at = minute(Date.now() - MINUTE);
    const ref = { uri: `at://${DID}/app.bsky.feed.post/3kweekly00002`, cid: CIDS[0] };
    const row = await insertRepeating({
      at,
      status: 'publishing',
      attempts: 1,
      progress: [ref],
    });
    await t.query(`UPDATE scheduled_posts SET locked_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`, [row.id]);
    const res = await tick();
    expect(res.body).toMatchObject({ reclaimed: 1, claimed: 1, published: 1 });
    // Nothing is written again; the series picks up where the run left it.
    expect(pds.writes).toEqual([]);
    const rows = await series();
    expect(rows.map((r) => [r.occurrence, r.status])).toEqual([
      [1, 'published'],
      [2, 'pending'],
    ]);
    expect(rows[1].scheduled_for.getTime()).toBe(at + 7 * DAY);
  });

  it('carries the series past a spent row whose thread is all out', async () => {
    const ref = { uri: `at://${DID}/app.bsky.feed.post/3kweekly00002`, cid: CIDS[0] };
    await insertRepeating({ attempts: 5, progress: [ref] });
    expect((await tick()).body).toMatchObject({ claimed: 1, published: 1 });
    expect((await series()).map((r) => r.status)).toEqual(['published', 'pending']);
  });

  it('goes on from its schedule when an occurrence fails for good, keeping the failure to retry', async () => {
    oauth.restoreSession.mockResolvedValue(null);
    const at = minute(Date.now() - MINUTE);
    const row = await insertRepeating({ at, attempts: 4 });
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 1, published: 0, failed: 1 });
    const [first, second] = await series();
    expect(first).toMatchObject({
      id: row.id,
      status: 'failed',
      last_error_code: 'SESSION_UNAVAILABLE',
    });
    expect(second).toMatchObject({ status: 'pending', occurrence: 2 });
    expect(second.scheduled_for.getTime()).toBe(at + 7 * DAY);

    // Retried once the account is back, it goes out; the series still has
    // exactly one occurrence waiting.
    oauth.restoreSession.mockResolvedValue(pds.session);
    await scheduled.retryFailedScheduledPost({ id: row.id, userDid: DID });
    expect((await tick()).body.published).toBe(1);
    expect((await series()).map((r) => [r.occurrence, r.status])).toEqual([
      [1, 'published'],
      [2, 'pending'],
    ]);
  });

  it('does not let failures pile up while the account can’t post', async () => {
    oauth.restoreSession.mockResolvedValue(null);
    const at = minute(Date.now() - MINUTE);
    await insertRepeating({ at, attempts: 4 });
    for (let n = 0; n < 4; n++) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(at + n * 7 * DAY + 2 * MINUTE));
      await t.query(`UPDATE scheduled_posts SET attempts = 4 WHERE status = 'pending'`);
      await tick();
    }
    vi.useRealTimers();
    const listed = await scheduled.listScheduledPosts(DID);
    expect(listed.map((r) => r.status).sort()).toEqual(['failed', 'pending']);
    expect(listed.find((r) => r.status === 'failed').occurrence).toBe(4);
  });

  it('uploads its picture again for each occurrence, and keeps the stashed copy between them', async () => {
    const at = minute(Date.now() - MINUTE);
    const row = await insertRepeating({ at, rule: { count: 2 } });
    const path = await scheduled.storeMedia(row.id, 'p0-img0', PNG_BASE64, 'image/png');
    await scheduled.updatePayload(row.id, {
      ...row.payload,
      posts: [
        {
          record: { text: 'pic' },
          embed: { type: 'images', images: [{ mediaId: 'p0-img0' }] },
        },
      ],
      media: { 'p0-img0': { storagePath: path, encoding: 'image/png' } },
    });
    expect((await tick()).body.published).toBe(1);
    expect(pds.blobs).toHaveLength(1);
    expect(t.supabase.storage.read('virga-scheduled-media', path)).toBeTruthy();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at + 7 * DAY + 2 * MINUTE));
    expect((await tick()).body.published).toBe(1);
    vi.useRealTimers();
    expect(pds.blobs).toHaveLength(2);
    expect(pds.posts().map((w) => w.record.embed.$type)).toEqual([
      'app.bsky.embed.images',
      'app.bsky.embed.images',
    ]);
    // The series is over ("after 2 times"): the stashed copy goes with it.
    expect(t.supabase.storage.read('virga-scheduled-media', path)).toBeUndefined();
  });

  it('arms each occurrence’s timer on the records that occurrence wrote', async () => {
    const selfDestruct = {
      lifespanSeconds: HOUR / 1000,
      deleteAt: null,
      conditions: { sense: 'any', clauses: [] },
      effects: null,
    };
    const at = minute(Date.now() - MINUTE);
    await insertRepeating({ at, payload: { selfDestruct } });
    expect((await tick()).body).toMatchObject({ published: 1, armed: 1 });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at + 7 * DAY + 2 * MINUTE));
    expect((await tick()).body).toMatchObject({ published: 1, armed: 1 });
    vi.useRealTimers();
    const armed = timers.armForPublishedSchedule.mock.calls.map(([, refs]) => refs[0].uri);
    expect(new Set(armed).size).toBe(2);
  });
});
