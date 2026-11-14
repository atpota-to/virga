// The /api/schedule/* handlers the client calls, over the real store on
// PGlite, with the session token resolved by a stand-in: every status, code
// and row field the client reads (client-contract §2.7).

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
import { createTestDatabase, readMigration } from '../../test/pglite.js';
import { createReq, createRes } from '../../test/http.js';
import {
  setSupabaseClientForTests,
  resetSupabaseClientForTests,
} from '../../supabase.js';
import {
  DID,
  OTHER_DID,
  HOUR,
  DAY,
  MINUTE,
  iso,
  inHours,
  PNG_BASE64,
  createBody,
} from '../testing/fixtures.js';

const auth = vi.hoisted(() => ({ resolveUserDid: vi.fn() }));
vi.mock('../../oauth/auth.js', () => auth);

const { default: create, resetCreateLimiterForTests } =
  await import('./create.js');
const { default: list } = await import('./list.js');
const { default: get } = await import('./get.js');
const { default: media } = await import('./media.js');
const { default: update } = await import('./update.js');
const { default: reorder } = await import('./reorder.js');
const { default: cancel } = await import('./cancel.js');
const { DELETE_TIME_TOO_EARLY_ERROR } = await import('../scheduledPosts.js');

let t;
beforeAll(async () => {
  t = await createTestDatabase({ upTo: '20261113000300' });
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.exec('TRUNCATE scheduled_posts; TRUNCATE self_destruct_posts');
  t.supabase.storage.reset();
  t.supabase.storage.clearFailures();
  setSupabaseClientForTests(t.supabase);
  resetCreateLimiterForTests();
  auth.resolveUserDid.mockReset();
  auth.resolveUserDid.mockResolvedValue({
    userDid: DID,
    status: 200,
    error: null,
    code: null,
  });
});
afterEach(() => {
  resetSupabaseClientForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function call(handler, { method = 'POST', body, query = {} } = {}) {
  const req = createReq({
    method,
    body,
    query,
    headers: { authorization: 'Bearer vg_test' },
  });
  const res = createRes();
  await handler(req, res);
  return res;
}
const post = (handler, body) => call(handler, { body });
const getQ = (handler, query) => call(handler, { method: 'GET', query });

async function insertRow(fields = {}) {
  const row = {
    user_did: DID,
    scheduled_for: inHours(1),
    status: 'pending',
    payload: {
      posts: [{ record: { text: 'hello' } }],
      gates: { threadgate: null, postgate: null },
      media: {},
      rkeys: ['3kaaaaaaaaaa2'],
    },
    progress: [],
    ...fields,
  };
  const { rows } = await t.query(
    `INSERT INTO scheduled_posts (user_did, scheduled_for, status, payload, progress, last_error, last_error_code, result_uri, attempts)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, COALESCE($9, 0)) RETURNING *`,
    [
      row.user_did,
      row.scheduled_for,
      row.status,
      JSON.stringify(row.payload),
      JSON.stringify(row.progress),
      row.last_error ?? null,
      row.last_error_code ?? null,
      row.result_uri ?? null,
      row.attempts ?? null,
    ],
  );
  return rows[0];
}
const readRow = async (id) =>
  (await t.query('SELECT * FROM scheduled_posts WHERE id = $1', [id])).rows[0];
const countRows = async () =>
  (await t.query('SELECT COUNT(*)::int AS n FROM scheduled_posts')).rows[0].n;

const ROW_KEYS = [
  'attempts',
  'clientKey',
  'createdAt',
  'id',
  'lastError',
  'lastErrorCode',
  'maxAttempts',
  'payload',
  'queued',
  'resultUri',
  'scheduledFor',
  'status',
  'target',
];

describe('every schedule handler', () => {
  const handlers = { create, list, get, media, update, reorder, cancel };
  const methods = {
    create: 'POST',
    list: 'GET',
    get: 'GET',
    media: 'GET',
    update: 'POST',
    reorder: 'POST',
    cancel: 'POST',
  };

  it('answers OPTIONS 204 and a wrong method 405', async () => {
    for (const [name, handler] of Object.entries(handlers)) {
      const options = await call(handler, { method: 'OPTIONS' });
      expect(options.statusCode, name).toBe(204);
      const wrong = await call(handler, {
        method: methods[name] === 'GET' ? 'POST' : 'GET',
      });
      expect(wrong.statusCode, name).toBe(405);
      expect(wrong.body).toEqual({
        success: false,
        error: 'Method not allowed',
      });
    }
  });

  it('passes the session check’s 401 and its code through', async () => {
    auth.resolveUserDid.mockResolvedValue({
      userDid: null,
      status: 401,
      error: 'Invalid or expired session',
      code: 'FRONTEND_SESSION_INVALID',
    });
    for (const [name, handler] of Object.entries(handlers)) {
      const res = await call(handler, {
        method: methods[name],
        body: createBody(),
        query: { id: 'x' },
      });
      expect(res.statusCode, name).toBe(401);
      expect(res.body, name).toEqual({
        success: false,
        error: 'Invalid or expired session',
        code: 'FRONTEND_SESSION_INVALID',
      });
    }
    expect(await countRows()).toBe(0);
  });

  it('passes a 503 from the token store through', async () => {
    auth.resolveUserDid.mockResolvedValue({
      userDid: null,
      status: 503,
      error: 'Session validation temporarily unavailable, please retry',
      code: 'VALIDATION_TRANSIENT_ERROR',
    });
    const res = await getQ(list);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('VALIDATION_TRANSIENT_ERROR');
  });

  it('says scheduling is unavailable without Supabase; the list answers empty', async () => {
    setSupabaseClientForTests(null);
    const listed = await getQ(list);
    expect(listed.statusCode).toBe(200);
    expect(listed.body).toEqual({ success: true, data: [], unavailable: true });
    for (const [name, handler] of Object.entries(handlers)) {
      if (name === 'list') continue;
      const res = await call(handler, {
        method: methods[name],
        body: createBody(),
        query: { id: 'x' },
      });
      expect(res.statusCode, name).toBe(503);
      expect(res.body, name).toEqual({
        success: false,
        error: "scheduling isn't set up on Virga's server yet.",
        code: 'UNAVAILABLE',
      });
    }
  });
});

describe('POST /api/schedule/create', () => {
  it('answers 201 with the row, keys reserved and clientKey virga', async () => {
    const body = createBody({
      texts: ['root', 'reply'],
      gates: { threadgate: [], postgate: null },
      queued: true,
    });
    const res = await post(create, body);
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const data = res.body.data;
    expect(Object.keys(data).sort()).toEqual(ROW_KEYS);
    expect(data).toMatchObject({
      status: 'pending',
      target: 'bluesky',
      queued: true,
      clientKey: 'virga',
      resultUri: null,
      attempts: 0,
      maxAttempts: 5,
      lastError: null,
      lastErrorCode: null,
    });
    expect(new Date(data.scheduledFor).toISOString()).toBe(body.scheduledFor);
    expect(data.payload).toMatchObject({
      gates: { threadgate: [], postgate: null },
      media: {},
      tz: 'Europe/Paris',
      selfDestruct: null,
    });
    expect(data.payload.rkeys).toHaveLength(2);
    expect(data.payload).not.toHaveProperty('mediaBytes');
    expect((await readRow(data.id)).user_did).toBe(DID);
  });

  it('stashes the images and records where', async () => {
    const res = await post(create, createBody({ images: 2 }));
    expect(res.statusCode).toBe(201);
    const { id, payload } = res.body.data;
    expect(payload.media).toEqual({
      'p0-img0': { storagePath: `${id}/p0-img0.png`, encoding: 'image/png' },
      'p0-img1': { storagePath: `${id}/p0-img1.png`, encoding: 'image/png' },
    });
    expect(
      t.supabase.storage.read('scheduled-media', `${id}/p0-img0.png`),
    ).toEqual(Buffer.from(PNG_BASE64, 'base64'));
  });

  it('refuses a target other than bluesky before reserving anything', async () => {
    const res = await post(create, { ...createBody(), target: 'other-app' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'target must be one of: bluesky',
    });
    expect(await countRows()).toBe(0);
  });

  it('answers a time that passed in transit as 400 SCHEDULE_PAST, so the client words it', async () => {
    const res = await post(
      create,
      createBody({ scheduledFor: iso(Date.now() - MINUTE) }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'scheduledFor must be in the future',
      code: 'SCHEDULE_PAST',
    });
    const far = await post(
      create,
      createBody({ scheduledFor: iso(Date.now() + 100 * DAY) }),
    );
    expect(far.body.code).toBe('SCHEDULE_TOO_FAR');
  });

  it('answers any other validation failure as a 400 sentence without a code', async () => {
    const body = createBody();
    body.payload.posts = [];
    const res = await post(create, body);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'payload.posts must be a non-empty array',
    });
  });

  it('refuses an image named without its bytes', async () => {
    const body = createBody({ images: 1 });
    body.payload.mediaBytes = {};
    const res = await post(create, body);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'missing bytes for media "p0-img0"',
    });
    expect(await countRows()).toBe(0);
  });

  it('refuses more image than the client may send, 413', async () => {
    const body = createBody({ images: 1 });
    body.payload.mediaBytes['p0-img0'].base64 = 'A'.repeat(4_000_001);
    const res = await post(create, body);
    expect(res.statusCode).toBe(413);
    expect(res.body.code).toBe('MEDIA_TOO_LARGE');
    expect(await countRows()).toBe(0);
  });

  it('answers 409 QUOTA_EXCEEDED with the feature and limit at the cap', async () => {
    vi.stubEnv('SCHEDULE_MAX_PENDING', '1');
    await insertRow();
    const res = await post(create, createBody());
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: 'you can have at most 1 scheduled posts',
      code: 'QUOTA_EXCEEDED',
      feature: 'scheduledPosts',
      limit: 1,
    });
  });

  it('answers 429 RATE_LIMITED with Retry-After past the burst limit', async () => {
    vi.stubEnv('SCHEDULE_CREATE_PER_MIN', '1');
    expect((await post(create, createBody())).statusCode).toBe(201);
    const res = await post(create, createBody());
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({
      success: false,
      error: 'that is a lot of posts at once. wait a moment and try again.',
      code: 'RATE_LIMITED',
    });
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(res.headers['retry-after']).toBe(String(res.body.retryAfter));
  });

  it('refuses a timer at a configured timer limit, counting scheduled timers', async () => {
    vi.stubEnv('POST_TIMERS_LIMIT', '1');
    const timer = {
      lifespanSeconds: 3600,
      deleteAt: null,
      conditions: {},
      effects: [],
    };
    expect(
      (await post(create, createBody({ selfDestruct: timer }))).statusCode,
    ).toBe(201);
    const res = await post(create, createBody({ selfDestruct: timer }));
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'QUOTA_EXCEEDED',
      feature: 'postTimers',
      limit: 1,
    });
    // A post without a timer still goes in.
    expect((await post(create, createBody())).statusCode).toBe(201);
  });

  it('carries a normalized timer on the row', async () => {
    const res = await post(
      create,
      createBody({ selfDestruct: { lifespanSeconds: 3600.5, effects: [] } }),
    );
    expect(res.statusCode).toBe(201);
    expect(res.body.data.payload.selfDestruct).toMatchObject({
      lifespanSeconds: 3600,
      deleteAt: null,
    });
  });

  it('keeps the keys the create settled when it records the images', async () => {
    const body = createBody({ images: 1 });
    // A concurrent create already holds these keys at the same time; this
    // one minted them too before it could see that row.
    const scheduled = await import('../scheduledPosts.js');
    const keys = await scheduled.assignRkeys({
      userDid: DID,
      scheduledFor: body.scheduledFor,
      postCount: 1,
    });
    await t.query(
      `INSERT INTO scheduled_posts (user_did, scheduled_for, payload, created_at)
       VALUES ($1, $2, $3::jsonb, NOW() - INTERVAL '1 second')`,
      [
        DID,
        body.scheduledFor,
        JSON.stringify({
          posts: [{ record: { text: 'first' } }],
          gates: {},
          media: {},
          rkeys: keys,
        }),
      ],
    );
    vi.spyOn(scheduled, 'assignRkeys').mockResolvedValueOnce(keys);
    const res = await post(create, body);
    expect(res.statusCode).toBe(201);
    expect(Object.keys(res.body.data.payload.media)).toEqual(['p0-img0']);
    expect(res.body.data.payload.rkeys).not.toEqual(keys);
    const { rows } = await t.query(
      `SELECT payload->'rkeys' AS k FROM scheduled_posts ORDER BY created_at`,
    );
    expect(rows.map((r) => r.k)).toEqual([keys, res.body.data.payload.rkeys]);
  });

  it('retires the row and removes stored bytes when stashing fails partway', async () => {
    const real = t.supabase.storage.from;
    let uploads = 0;
    vi.spyOn(t.supabase.storage, 'from').mockImplementation((bucket) => {
      const b = real(bucket);
      const upload = b.upload;
      b.upload = async (...args) => {
        uploads += 1;
        if (uploads === 2)
          return { data: null, error: { message: 'bucket full of secrets' } };
        return upload(...args);
      };
      return b;
    });
    const res = await post(create, createBody({ images: 2 }));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: "couldn't save that scheduled post. please try again.",
      code: 'INTERNAL',
    });
    const { rows } = await t.query(
      'SELECT status, payload FROM scheduled_posts',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('cancelled');
    expect(Object.keys(rows[0].payload.media)).toEqual(['p0-img0']);
    expect(t.supabase.storage.objects.size).toBe(0);
  });

  it('never leaks a database message', async () => {
    vi.spyOn(t.supabase, 'from').mockImplementation(() => {
      throw new Error('column scheduled_posts.secret does not exist');
    });
    const res = await post(create, createBody());
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|scheduled_posts/);
  });
});

describe('GET /api/schedule/list', () => {
  it('answers the queue in time order with partial, lastErrorCode and clientKey', async () => {
    const partial = await insertRow({
      scheduled_for: inHours(2),
      progress: [{ uri: 'at://x/app.bsky.feed.post/1', cid: 'c' }],
    });
    const failed = await insertRow({
      scheduled_for: inHours(1),
      status: 'failed',
      last_error:
        'the images for this scheduled post are missing. edit it and re-attach them.',
      last_error_code: 'MEDIA_MISSING',
      attempts: 5,
    });
    const note = await insertRow({
      scheduled_for: inHours(3),
      status: 'published',
      last_error_code: 'TIMER_NOT_ARMED',
      last_error:
        'this post published, but its self-destruct timer could not be set',
      result_uri: 'at://x/app.bsky.feed.post/2',
    });
    await insertRow({ status: 'published' });
    await insertRow({ user_did: OTHER_DID });

    const res = await getQ(list);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.map((r) => r.id)).toEqual([
      failed.id,
      partial.id,
      note.id,
    ]);
    for (const row of res.body.data)
      expect(Object.keys(row).sort()).toEqual([...ROW_KEYS, 'partial'].sort());
    expect(res.body.data[0]).toMatchObject({
      status: 'failed',
      partial: false,
      lastErrorCode: 'MEDIA_MISSING',
      attempts: 5,
      clientKey: 'virga',
    });
    expect(res.body.data[1]).toMatchObject({
      status: 'pending',
      partial: true,
    });
    expect(res.body.data[2]).toMatchObject({
      status: 'published',
      lastErrorCode: 'TIMER_NOT_ARMED',
      resultUri: 'at://x/app.bsky.feed.post/2',
    });
  });

  it('answers an empty list marked unavailable when the table is missing', async () => {
    const bare = await createTestDatabase({ upTo: '20261113000100' });
    setSupabaseClientForTests(bare.supabase);
    try {
      const res = await getQ(list);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true, data: [], unavailable: true });
    } finally {
      await bare.close();
    }
  });

  it('answers a database failure as 500 INTERNAL without its words', async () => {
    vi.spyOn(t.supabase, 'from').mockImplementation(() => {
      throw new Error('permission denied for table scheduled_posts');
    });
    const res = await getQ(list);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: "couldn't load your scheduled posts. please try again.",
      code: 'INTERNAL',
    });
  });
});

describe('GET /api/schedule/get and /media', () => {
  it('needs an id', async () => {
    expect((await getQ(get, {})).body).toEqual({
      success: false,
      error: 'Missing id',
    });
    expect((await getQ(media, {})).statusCode).toBe(400);
  });

  it('answers 404 for another account’s row or a malformed id', async () => {
    const theirs = await insertRow({ user_did: OTHER_DID });
    for (const id of [theirs.id, 'not-a-uuid']) {
      expect((await getQ(get, { id })).statusCode).toBe(404);
      const m = await getQ(media, { id });
      expect(m.statusCode).toBe(404);
      expect(m.body).toEqual({ success: false, error: 'Not found' });
    }
  });

  it('answers the row without partial', async () => {
    const row = await insertRow();
    const res = await getQ(get, { id: row.id });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(ROW_KEYS);
    expect(res.body.data).toMatchObject({
      id: row.id,
      clientKey: 'virga',
      status: 'pending',
    });
  });

  it('answers the stored images by mediaId', async () => {
    const created = await post(create, createBody({ images: 1 }));
    const res = await getQ(media, { id: created.body.data.id });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { 'p0-img0': { base64: PNG_BASE64, encoding: 'image/png' } },
    });
  });
});

describe('POST /api/schedule/update', () => {
  it('needs an id', async () => {
    expect((await post(update, { scheduledFor: inHours(2) })).body).toEqual({
      success: false,
      error: 'Missing id',
    });
  });

  it('moves a pending row (time only)', async () => {
    const row = await insertRow();
    const when = inHours(5);
    const res = await post(update, { id: row.id, scheduledFor: when });
    expect(res.statusCode).toBe(200);
    expect(new Date(res.body.data.scheduledFor).toISOString()).toBe(when);
    expect(res.body.data.clientKey).toBe('virga');
  });

  it('refuses a move into the past as 400 SCHEDULE_PAST', async () => {
    const row = await insertRow();
    const res = await post(update, {
      id: row.id,
      scheduledFor: iso(Date.now() - MINUTE),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'scheduledFor must be in the future',
      code: 'SCHEDULE_PAST',
    });
  });

  it('refuses a move past the pinned delete time: 409 DELETE_TIME_TOO_EARLY with deleteAt', async () => {
    const slot = Date.now() + DAY;
    const row = await insertRow({
      scheduled_for: iso(slot),
      payload: {
        posts: [{ record: { text: 't' } }],
        selfDestruct: { lifespanSeconds: 3600, deleteAt: iso(slot + 9 * HOUR) },
      },
    });
    const res = await post(update, {
      id: row.id,
      scheduledFor: iso(slot + 24 * HOUR),
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: DELETE_TIME_TOO_EARLY_ERROR,
      code: 'DELETE_TIME_TOO_EARLY',
      deleteAt: iso(slot + 9 * HOUR),
    });
    expect((await readRow(row.id)).scheduled_for.toISOString()).toBe(iso(slot));
    expect(
      (await post(update, { id: row.id, scheduledFor: iso(slot + 3 * HOUR) }))
        .statusCode,
    ).toBe(200);
  });

  it('refuses a part-published thread with the sentence for its status', async () => {
    const progress = [{ uri: 'at://x/app.bsky.feed.post/1', cid: 'c' }];
    const pending = await insertRow({ progress });
    const failed = await insertRow({ progress, status: 'failed' });
    const a = await post(update, { id: pending.id, scheduledFor: inHours(4) });
    expect(a.statusCode).toBe(409);
    expect(a.body).toEqual({
      success: false,
      code: 'PARTIALLY_PUBLISHED',
      error:
        'part of this thread is already posted. the rest will follow on its own — cancel it here if you would rather finish by hand.',
    });
    const b = await post(update, { id: failed.id, ...createBody() });
    expect(b.statusCode).toBe(409);
    expect(b.body.error).toBe(
      'part of this thread posted before it failed. retry it to publish the rest, or cancel it here and finish by hand.',
    );
  });

  it('answers NOT_RESCHEDULABLE for a row it can’t move', async () => {
    const publishing = await insertRow({ status: 'publishing' });
    const theirs = await insertRow({ user_did: OTHER_DID });
    for (const id of [publishing.id, theirs.id, 'not-a-uuid']) {
      const res = await post(update, { id, scheduledFor: inHours(4) });
      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual({
        success: false,
        error:
          'This post can no longer be rescheduled — it may already be publishing.',
        code: 'NOT_RESCHEDULABLE',
      });
    }
  });

  it('rewrites a row from the composer, and refuses missing bytes', async () => {
    const created = await post(create, createBody({ images: 1 }));
    const id = created.body.data.id;
    const body = createBody({ texts: ['edited'], images: 1 });
    const missing = { ...body, payload: { ...body.payload, mediaBytes: {} } };
    const refused = await post(update, { id, ...missing });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toEqual({
      success: false,
      error: 'missing bytes for media "p0-img0"',
    });

    const res = await post(update, { id, ...body });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.payload.posts[0].record.text).toBe('edited');
    expect(res.body.data.payload.media['p0-img0'].storagePath).toMatch(
      new RegExp(`^${id}/e-`),
    );
    expect(res.body.data.clientKey).toBe('virga');
  });

  it('refuses a rewrite to another target', async () => {
    const row = await insertRow();
    const res = await post(update, {
      id: row.id,
      ...createBody(),
      target: 'other-app',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('target must be one of: bluesky');
  });

  it('revives a failed row on rewrite, but answers QUOTA_EXCEEDED at the cap', async () => {
    const failed = await insertRow({
      status: 'failed',
      last_error_code: 'REFUSED',
    });
    const res = await post(update, { id: failed.id, ...createBody() });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'pending',
      lastErrorCode: null,
    });

    vi.stubEnv('SCHEDULE_MAX_PENDING', '1');
    const other = await insertRow({ status: 'failed' });
    const capped = await post(update, { id: other.id, ...createBody() });
    expect(capped.statusCode).toBe(409);
    expect(capped.body).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      feature: 'scheduledPosts',
      limit: 1,
    });
  });

  it('retries a failed row, and answers NOT_RETRIABLE otherwise', async () => {
    const failed = await insertRow({ status: 'failed', attempts: 5 });
    const ok = await post(update, { id: failed.id, retry: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'pending', attempts: 0 });
    const again = await post(update, { id: failed.id, retry: true });
    expect(again.statusCode).toBe(409);
    expect(again.body).toEqual({
      success: false,
      error:
        'this post can no longer be retried — it may have been dismissed, or already be back in the queue.',
      code: 'NOT_RETRIABLE',
    });
  });

  it('refuses a retry the media sweep left without images: 409 MEDIA_MISSING', async () => {
    const failed = await insertRow({
      status: 'failed',
      attempts: 5,
      payload: {
        posts: [
          {
            record: { text: 'pictures' },
            embed: { type: 'images', images: [{ mediaId: 'p0-img0' }] },
          },
        ],
        gates: {},
        media: { 'p0-img0': { storagePath: 'x/p0-img0.png' } },
        rkeys: ['3kaaaaaaaaaa2'],
      },
    });
    await t.query(
      'UPDATE scheduled_posts SET media_reclaimed_at = NOW() WHERE id = $1',
      [failed.id],
    );
    const res = await post(update, { id: failed.id, retry: true });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error:
        'the images for this post were cleared after 30 days. edit it and add them again.',
      code: 'MEDIA_MISSING',
    });
    expect((await readRow(failed.id)).status).toBe('failed');
  });

  it('refuses a retry whose timer has no slot', async () => {
    vi.stubEnv('CONDITIONAL_TIMERS_LIMIT', '1');
    const conditional = {
      lifespanSeconds: 3600,
      conditions: {
        sense: 'unless',
        clauses: [{ metric: 'likes', op: 'gte', value: 5 }],
      },
      effects: [],
    };
    await insertRow({
      payload: {
        posts: [{ record: { text: 'a' } }],
        selfDestruct: conditional,
      },
    });
    const failed = await insertRow({
      status: 'failed',
      payload: {
        posts: [{ record: { text: 'b' } }],
        selfDestruct: conditional,
      },
    });
    const res = await post(update, { id: failed.id, retry: true });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      feature: 'conditionalTimers',
      limit: 1,
    });
  });

  it('acknowledges a timer note once, then answers NOT_ACKNOWLEDGEABLE', async () => {
    const note = await insertRow({
      status: 'published',
      last_error_code: 'TIMER_NOT_ARMED',
      last_error: 'x',
    });
    const ok = await post(update, { id: note.id, acknowledgeTimer: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.data).toMatchObject({
      status: 'published',
      lastErrorCode: null,
      lastError: null,
    });
    const again = await post(update, { id: note.id, acknowledgeTimer: true });
    expect(again.statusCode).toBe(409);
    expect(again.body).toEqual({
      success: false,
      error: 'there is no timer note on that post to clear.',
      code: 'NOT_ACKNOWLEDGEABLE',
    });
  });

  it('checks acknowledgeTimer before retry before a rewrite', async () => {
    const failed = await insertRow({ status: 'failed' });
    const res = await post(update, {
      id: failed.id,
      acknowledgeTimer: true,
      retry: true,
      ...createBody(),
    });
    expect(res.body.code).toBe('NOT_ACKNOWLEDGEABLE');
    expect((await readRow(failed.id)).status).toBe('failed');
  });
});

describe('POST /api/schedule/reorder', () => {
  it('moves the whole queue and answers moved', async () => {
    const a = await insertRow({ scheduled_for: inHours(1) });
    const b = await insertRow({ scheduled_for: inHours(2) });
    const res = await post(reorder, {
      moves: [
        { id: a.id, scheduledFor: inHours(2) },
        { id: b.id, scheduledFor: inHours(1) },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, moved: 2 });
  });

  it('answers 400 BAD_REQUEST for no list, and for the lib’s reasons', async () => {
    const none = await post(reorder, {});
    expect(none.statusCode).toBe(400);
    expect(none.body).toEqual({
      success: false,
      error: 'a reorder needs a list of posts to move.',
      code: 'BAD_REQUEST',
    });
    const bad = await post(reorder, {
      moves: [{ id: 'x', scheduledFor: inHours(1) }],
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toEqual({
      success: false,
      error: 'a post id in that reorder could not be read.',
      code: 'BAD_REQUEST',
    });
    const empty = await post(reorder, { moves: [] });
    expect(empty.body.error).toBe(
      'a reorder carries between one and 50 posts.',
    );
  });

  it('answers 409 NOT_REORDERABLE and writes nothing', async () => {
    const a = await insertRow();
    const publishing = await insertRow({ status: 'publishing' });
    const res = await post(reorder, {
      moves: [
        { id: a.id, scheduledFor: inHours(3) },
        { id: publishing.id, scheduledFor: inHours(4) },
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error:
        'one of these posts can no longer be moved — it may already be publishing, or part of it may already be posted. your queue is unchanged.',
      code: 'NOT_REORDERABLE',
    });
  });

  it('answers 409 DELETE_TIME_TOO_EARLY naming the post', async () => {
    const slot = Date.now() + DAY;
    const a = await insertRow({
      scheduled_for: iso(slot),
      payload: {
        posts: [
          { record: { text: 'thursday thoughts on moths and porch lamps' } },
        ],
        selfDestruct: { lifespanSeconds: 3600, deleteAt: iso(slot + 9 * HOUR) },
      },
    });
    const b = await insertRow({ scheduled_for: iso(slot + DAY) });
    const res = await post(reorder, {
      moves: [
        { id: a.id, scheduledFor: iso(slot + DAY) },
        { id: b.id, scheduledFor: iso(slot) },
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      code: 'DELETE_TIME_TOO_EARLY',
      id: a.id,
      deleteAt: iso(slot + 9 * HOUR),
      error:
        'the delete time on "thursday thoughts on moths and porch lam…" would come before it goes out in this order, or within five minutes of it. move it earlier, or change its lifespan first. your queue is unchanged.',
    });
    expect((await readRow(b.id)).scheduled_for.toISOString()).toBe(
      iso(slot + DAY),
    );
  });

  it('answers 404 UNAVAILABLE without the reorder function, so the client moves rows one by one', async () => {
    const a = await insertRow();
    await t.exec('DROP FUNCTION reorder_scheduled_posts(TEXT, JSONB)');
    try {
      const res = await post(reorder, {
        moves: [{ id: a.id, scheduledFor: inHours(3) }],
      });
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: 'reordering the whole queue at once is not available here yet.',
        code: 'UNAVAILABLE',
      });
    } finally {
      await t.exec(readMigration('20261113000200_scheduled_posts.sql'));
    }
  });

  it('answers a failure as 500 INTERNAL without its words', async () => {
    const a = await insertRow();
    vi.spyOn(t.supabase, 'rpc').mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'scheduled_posts is on fire' },
    });
    const res = await post(reorder, {
      moves: [{ id: a.id, scheduledFor: inHours(3) }],
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: "couldn't reorder your queue. please try again.",
      code: 'INTERNAL',
    });
  });
});

describe('POST /api/schedule/cancel', () => {
  it('needs an id', async () => {
    expect((await post(cancel, {})).body).toEqual({
      success: false,
      error: 'Missing id',
    });
  });

  it('cancels a pending row and drops its images, then answers NOT_CANCELLABLE', async () => {
    const created = await post(create, createBody({ images: 1 }));
    const id = created.body.data.id;
    const res = await post(cancel, { id });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { id, status: 'cancelled' },
    });
    expect(t.supabase.storage.objects.size).toBe(0);
    const again = await post(cancel, { id });
    expect(again.statusCode).toBe(409);
    expect(again.body).toEqual({
      success: false,
      error:
        'that post can no longer be cancelled. it may already be publishing.',
      code: 'NOT_CANCELLABLE',
    });
  });

  it('takes the id from the query, and dismisses a failed row', async () => {
    const failed = await insertRow({ status: 'failed' });
    const res = await call(cancel, {
      method: 'POST',
      query: { id: failed.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  it('leaves a publishing row and another account’s row alone', async () => {
    const publishing = await insertRow({ status: 'publishing' });
    const theirs = await insertRow({ user_did: OTHER_DID });
    expect((await post(cancel, { id: publishing.id })).statusCode).toBe(409);
    expect((await post(cancel, { id: theirs.id })).statusCode).toBe(409);
    expect((await readRow(theirs.id)).status).toBe('pending');
  });
});
