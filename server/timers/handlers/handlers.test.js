import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReq, createRes } from '../../test/http.js';

// The HTTP side of post timers: what the endpoints hand the store, and what
// they hand back. The response shapes are the contract the client reads
// (src/posting/timers/timerService.js); the deciding is the store's job and is
// tested there.

vi.mock('../../oauth/auth.js', () => ({ resolveUserDid: vi.fn() }));
vi.mock('../selfDestruct.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    armSelfDestruct: vi.fn(),
    listSelfDestructs: vi.fn(),
    cancelSelfDestruct: vi.fn(),
    reclaimStuck: vi.fn(),
    claimDueSelfDestructs: vi.fn(),
    resolveSelfDestruct: vi.fn(),
    markFailedOrRetry: vi.fn(),
    requeueUnspent: vi.fn(),
    fetchEngagement: vi.fn(),
  };
});
vi.mock('../timerUsage.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, enforceTimerLimit: vi.fn(), settleArmedTimer: vi.fn() };
});

const { resolveUserDid } = await import('../../oauth/auth.js');
const selfDestruct = await import('../selfDestruct.js');
const timerUsage = await import('../timerUsage.js');
const { default: createHandler } = await import('./create.js');
const { default: listHandler } = await import('./list.js');
const { default: cancelHandler } = await import('./cancel.js');
const { default: runHandler, readEngagement, TIMED_OUT_ERROR } = await import('./run.js');

const DID = 'did:plc:reader';
const ID = '0b6f6c4e-7d2a-4c8e-9a51-2f0e3c1d9b7a';
const postUri = (rkey = '3kabc', did = DID) => `at://${did}/app.bsky.feed.post/${rkey}`;

const call = async (handler, opts = {}) => {
  const res = createRes();
  await handler(createReq({ method: 'POST', headers: { authorization: 'Bearer vg_x' }, ...opts }), res);
  return res;
};

const storedRow = (value, extra = {}) => ({
  id: 'row-1', post_uri: value.postUri, collection: value.collection, snippet: value.snippet ?? null,
  posted_at: '2026-11-13T00:00:00.000Z', check_at: value.checkAt, status: 'armed',
  conditions: value.conditions, lifespan_seconds: value.lifespanSeconds, extensions: 0,
  effects: null, acted: null, created_at: '2026-11-13T00:00:00.000Z', ...extra,
});

let errorSpy;
beforeEach(() => {
  vi.clearAllMocks();
  resolveUserDid.mockResolvedValue({ userDid: DID, status: 200, error: null, code: null });
  selfDestruct.armSelfDestruct.mockImplementation(async (value) => ({ row: storedRow(value), existing: false }));
  timerUsage.enforceTimerLimit.mockResolvedValue({ bucket: 'plain', limit: null });
  timerUsage.settleArmedTimer.mockResolvedValue(undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SELF_DESTRUCT_CREATE_PER_MIN;
});

describe('every timer endpoint', () => {
  const routes = [
    [createHandler, 'POST'], [listHandler, 'GET'], [cancelHandler, 'POST'],
  ];

  it('answers a preflight and refuses another method', async () => {
    for (const [handler, method] of routes) {
      const pre = await call(handler, { method: 'OPTIONS' });
      expect(pre.statusCode).toBe(204);
      const wrong = await call(handler, { method: method === 'GET' ? 'POST' : 'GET' });
      expect(wrong.statusCode).toBe(405);
      expect(wrong.body).toEqual({ success: false, error: 'Method not allowed' });
    }
    expect(resolveUserDid).not.toHaveBeenCalled();
  });

  it('passes the sign-in answer through, code included, and touches nothing', async () => {
    for (const [handler, method] of routes) {
      resolveUserDid.mockResolvedValueOnce({ userDid: null, status: 401, error: 'Invalid or expired session', code: 'FRONTEND_SESSION_INVALID' });
      const res = await call(handler, { method, body: { id: ID } });
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ success: false, error: 'Invalid or expired session', code: 'FRONTEND_SESSION_INVALID' });
      resolveUserDid.mockResolvedValueOnce({ userDid: null, status: 503, error: 'Session validation temporarily unavailable, please retry', code: 'VALIDATION_TRANSIENT_ERROR' });
      expect((await call(handler, { method, body: { id: ID } })).statusCode).toBe(503);
    }
    expect(selfDestruct.armSelfDestruct).not.toHaveBeenCalled();
    expect(selfDestruct.listSelfDestructs).not.toHaveBeenCalled();
    expect(selfDestruct.cancelSelfDestruct).not.toHaveBeenCalled();
  });

  it('never caches an answer', async () => {
    selfDestruct.listSelfDestructs.mockResolvedValue([]);
    const res = await call(listHandler, { method: 'GET' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('POST /api/self-destruct/create', () => {
  const body = (extra = {}) => ({ postUri: postUri(), lifespanSeconds: 600, ...extra });

  it('refuses a deleteAt more than a minute in the past, and arms nothing', async () => {
    const res = await call(createHandler, { body: body({ deleteAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() }) });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/already passed/);
    expect(selfDestruct.armSelfDestruct).not.toHaveBeenCalled();
  });

  it('takes a deleteAt in the near future and floors it to five minutes', async () => {
    const res = await call(createHandler, { body: body({ deleteAt: new Date(Date.now() + 60 * 1000).toISOString() }) });
    expect(res.statusCode).toBe(201);
    const fromNow = (new Date(res.body.data.checkAt).getTime() - Date.now()) / 1000;
    expect(fromNow).toBeGreaterThanOrEqual(selfDestruct.MIN_LIFESPAN_SECONDS - 1);
  });

  it('answers a new timer 201 in the shape the client reads, as this app’s row', async () => {
    const res = await call(createHandler, { body: body({ snippet: 'hello', postCid: 'bafy' }) });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body.data).sort()).toEqual([
      'acted', 'checkAt', 'clientKey', 'collection', 'conditions', 'createdAt', 'effects', 'extensions', 'id',
      'lifespanSeconds', 'postUri', 'postedAt', 'snippet', 'status',
    ]);
    expect(res.body.data).toMatchObject({ id: 'row-1', postUri: postUri(), clientKey: 'virga', status: 'armed', snippet: 'hello' });
    expect(selfDestruct.armSelfDestruct).toHaveBeenCalledWith(expect.objectContaining({
      userDid: DID, postUri: postUri(), postCid: 'bafy', collection: 'app.bsky.feed.post', rkey: '3kabc', lifespanSeconds: 600,
    }));
    expect(timerUsage.settleArmedTimer).toHaveBeenCalledWith(expect.objectContaining({ userDid: DID }));
  });

  it('answers a timer that was already there 200, without settling a slot for it', async () => {
    selfDestruct.armSelfDestruct.mockImplementation(async (value) => ({ row: storedRow(value), existing: true, updated: true }));
    const res = await call(createHandler, { body: body() });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.clientKey).toBe('virga');
    expect(timerUsage.settleArmedTimer).not.toHaveBeenCalled();
  });

  it('reads a body that arrives as a string', async () => {
    const res = await call(createHandler, { body: JSON.stringify(body()) });
    expect(res.statusCode).toBe(201);
  });

  it('refuses a timer on a record that is not a Bluesky post', async () => {
    const res = await call(createHandler, { body: body({ postUri: `at://${DID}/app.bsky.graph.follow/3kabc` }) });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'a timer can only be set on a Bluesky post here' });
  });

  it('refuses a timer on someone else’s post', async () => {
    const res = await call(createHandler, { body: body({ postUri: postUri('3kabc', 'did:plc:someoneelse') }) });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/your own post/);
  });

  it('checks the slot with the post a re-arm replaces left out', async () => {
    await call(createHandler, { body: body({ conditions: { clauses: [{ metric: 'likes', value: 5 }] } }) });
    expect(timerUsage.enforceTimerLimit).toHaveBeenCalledWith(expect.objectContaining({
      userDid: DID, exceptPostUri: postUri(), conditions: expect.objectContaining({ clauses: [{ metric: 'likes', op: 'gte', value: 5 }] }),
    }));
  });

  it('answers a full kind of timer 409, naming the feature and the limit', async () => {
    timerUsage.enforceTimerLimit.mockRejectedValue(new timerUsage.TimerLimitError('conditional', 1));
    const res = await call(createHandler, { body: body() });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: 'this account can keep one conditional timer at a time, counting scheduled posts.',
      code: 'QUOTA_EXCEEDED',
      feature: 'conditionalTimers',
      limit: 1,
    });
    expect(selfDestruct.armSelfDestruct).not.toHaveBeenCalled();
  });

  it('answers a race lost at settling the same way', async () => {
    timerUsage.settleArmedTimer.mockRejectedValue(new timerUsage.TimerLimitError('plain', 2));
    const res = await call(createHandler, { body: body() });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED', feature: 'postTimers', limit: 2 });
  });

  it('answers the flat ceiling 409 with its limit and no feature', async () => {
    selfDestruct.armSelfDestruct.mockRejectedValue(
      Object.assign(new Error('you can have at most 200 posts on a timer'), { code: 'QUOTA_EXCEEDED', limit: 200 }),
    );
    const res = await call(createHandler, { body: body() });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ success: false, error: 'you can have at most 200 posts on a timer', code: 'QUOTA_EXCEEDED', limit: 200 });
  });

  it('answers 503 UNAVAILABLE when timers are not set up here', async () => {
    selfDestruct.armSelfDestruct.mockRejectedValue(new selfDestruct.SelfDestructUnavailableError());
    const res = await call(createHandler, { body: body() });
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, code: 'UNAVAILABLE' });
  });

  it('answers anything else 500 without the database’s words', async () => {
    selfDestruct.armSelfDestruct.mockRejectedValue(new Error('relation "self_destruct_posts" violates something'));
    const res = await call(createHandler, { body: body() });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: "couldn't set that timer. the post is up, but it won't delete itself.",
      code: 'INTERNAL',
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('slows a burst of creates down with 429, Retry-After and retryAfter', async () => {
    process.env.SELF_DESTRUCT_CREATE_PER_MIN = '2';
    resolveUserDid.mockResolvedValue({ userDid: 'did:plc:bursty', status: 200, error: null, code: null });
    const make = () => call(createHandler, { body: body({ postUri: postUri('3kabc', 'did:plc:bursty') }) });
    expect((await make()).statusCode).toBe(201);
    expect((await make()).statusCode).toBe(201);
    const third = await make();
    expect(third.statusCode).toBe(429);
    expect(third.body).toMatchObject({ success: false, code: 'RATE_LIMITED', retryAfter: expect.any(Number) });
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('GET /api/self-destruct/list', () => {
  const row = {
    id: 'r1', post_uri: postUri('3k'), collection: 'app.bsky.feed.post', snippet: 'hi',
    posted_at: 'p', check_at: 'c', status: 'armed', conditions: {}, lifespan_seconds: 600, extensions: 0,
    last_counts: null, effects: null, acted: null, resolution: null, resolved_at: null, attempts: 0,
    max_attempts: 5, last_error: null, last_error_code: null, created_at: 'k',
  };

  it('maps rows to the fields the timers page reads, and passes history through', async () => {
    selfDestruct.listSelfDestructs.mockResolvedValue([row]);
    const res = await call(listHandler, { method: 'GET', query: { history: '1' } });
    expect(res.statusCode).toBe(200);
    expect(selfDestruct.listSelfDestructs).toHaveBeenCalledWith(DID, { includeResolved: true });
    expect(Object.keys(res.body.data[0]).sort()).toEqual([
      'acted', 'attempts', 'checkAt', 'clientKey', 'collection', 'conditions', 'createdAt', 'effects', 'extensions', 'id',
      'lastCounts', 'lastError', 'lastErrorCode', 'lifespanSeconds', 'maxAttempts', 'postUri', 'postedAt',
      'resolution', 'resolvedAt', 'snippet', 'status',
    ]);
    expect(res.body.data[0]).toMatchObject({ id: 'r1', postUri: postUri('3k'), clientKey: 'virga', maxAttempts: 5 });
  });

  it('lists the default page without history, and takes history=true as well as 1', async () => {
    selfDestruct.listSelfDestructs.mockResolvedValue([]);
    await call(listHandler, { method: 'GET' });
    expect(selfDestruct.listSelfDestructs).toHaveBeenLastCalledWith(DID, { includeResolved: false });
    await call(listHandler, { method: 'GET', query: { history: 'true' } });
    expect(selfDestruct.listSelfDestructs).toHaveBeenLastCalledWith(DID, { includeResolved: true });
    await call(listHandler, { method: 'GET', query: { history: 'yes' } });
    expect(selfDestruct.listSelfDestructs).toHaveBeenLastCalledWith(DID, { includeResolved: false });
  });

  it('answers an empty, unavailable list when timers are not set up here', async () => {
    selfDestruct.listSelfDestructs.mockRejectedValue(new selfDestruct.SelfDestructUnavailableError());
    const res = await call(listHandler, { method: 'GET' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: [], unavailable: true });
  });

  it('answers a failed read 500', async () => {
    selfDestruct.listSelfDestructs.mockRejectedValue(new Error('connection failure'));
    const res = await call(listHandler, { method: 'GET' });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: "couldn't load your post timers. please try again.", code: 'INTERNAL' });
  });
});

describe('POST /api/self-destruct/cancel', () => {
  it('calls the timer off and says so', async () => {
    selfDestruct.cancelSelfDestruct.mockResolvedValue({ id: ID, status: 'cancelled', user_did: DID });
    const res = await call(cancelHandler, { body: { id: ID } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: ID, status: 'cancelled' } });
    expect(selfDestruct.cancelSelfDestruct).toHaveBeenCalledWith(ID, DID);
  });

  it('takes the id from the query too', async () => {
    selfDestruct.cancelSelfDestruct.mockResolvedValue({ id: ID, status: 'cancelled' });
    const res = await call(cancelHandler, { query: { id: ID } });
    expect(res.statusCode).toBe(200);
  });

  it('asks for an id when there is none', async () => {
    const res = await call(cancelHandler, { body: {} });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Missing id' });
  });

  it('answers 409 NOT_CANCELLABLE for a timer that is running, settled, or not the caller’s', async () => {
    selfDestruct.cancelSelfDestruct.mockResolvedValue(null);
    const res = await call(cancelHandler, { body: { id: ID } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: 'that timer is no longer waiting. it is running now, or it has already settled.',
      code: 'NOT_CANCELLABLE',
    });
  });

  it('answers an id that names no timer the same way, without asking the database', async () => {
    for (const id of ['not-a-uuid', 42, { id: ID }]) {
      const res = await call(cancelHandler, { body: { id } });
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe('NOT_CANCELLABLE');
    }
    expect(selfDestruct.cancelSelfDestruct).not.toHaveBeenCalled();
  });

  it('answers 503 UNAVAILABLE without the table, and 500 for anything else', async () => {
    selfDestruct.cancelSelfDestruct.mockRejectedValueOnce(new selfDestruct.SelfDestructUnavailableError());
    let res = await call(cancelHandler, { body: { id: ID } });
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('UNAVAILABLE');
    selfDestruct.cancelSelfDestruct.mockRejectedValueOnce(new Error('connection failure'));
    res = await call(cancelHandler, { body: { id: ID } });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: "couldn't call off that timer. please try again.", code: 'INTERNAL' });
  });
});

// ─── The worker ─────────────────────────────────────────────────────────────
// The function is killed at sixty seconds mid-request, which strands rows in
// 'checking' with an attempt spent. So it stops starting rows at forty, hands
// every resolve a deadline at fifty, and puts back unspent whatever it did not
// get to.

describe('GET /api/self-destruct/run', () => {
  const SECRET = 'test-cron-secret';
  const cron = (headers = { authorization: `Bearer ${SECRET}` }) => ({ method: 'GET', headers });
  const rowsOf = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
    id: `row-${i + 1}`, user_did: DID, post_uri: postUri(`r${i + 1}`),
    collection: 'app.bsky.feed.post', rkey: `r${i + 1}`, conditions: {}, attempts: 1, max_attempts: 5, ...extra,
  }));
  const conditional = { clauses: [{ metric: 'likes', op: 'gte', value: 5 }] };

  let clock;
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    clock = 5_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    selfDestruct.reclaimStuck.mockResolvedValue(0);
    selfDestruct.claimDueSelfDestructs.mockResolvedValue([]);
    selfDestruct.markFailedOrRetry.mockResolvedValue('retry');
    selfDestruct.requeueUnspent.mockResolvedValue(true);
    selfDestruct.fetchEngagement.mockResolvedValue(new Map());
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('refuses a run without the cron secret, or with the wrong one', async () => {
    for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: SECRET }]) {
      const res = await call(runHandler, cron(headers));
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ success: false, error: 'Unauthorized' });
    }
    expect(selfDestruct.reclaimStuck).not.toHaveBeenCalled();
    expect(selfDestruct.claimDueSelfDestructs).not.toHaveBeenCalled();
  });

  it('takes POST as well as GET, and nothing else', async () => {
    expect((await call(runHandler, { ...cron(), method: 'POST' })).statusCode).toBe(200);
    expect((await call(runHandler, { ...cron(), method: 'PUT' })).statusCode).toBe(405);
  });

  it('reclaims stuck rows with the three-minute cutoff, then claims a batch of 25', async () => {
    selfDestruct.reclaimStuck.mockResolvedValue(2);
    const res = await call(runHandler, cron());
    expect(selfDestruct.reclaimStuck).toHaveBeenCalledWith(180);
    expect(selfDestruct.claimDueSelfDestructs).toHaveBeenCalledWith(expect.any(String), 25);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true, reclaimed: 2, claimed: 0, deleted: 0, acted: 0, spared: 0, extended: 0,
      gone: 0, deferred: 0, retried: 0, failed: 0, errors: [], runId: expect.any(String),
    });
  });

  it('hands every row a deadline fifty seconds from the start of the run', async () => {
    const started = clock;
    selfDestruct.claimDueSelfDestructs.mockResolvedValue(rowsOf(2));
    selfDestruct.resolveSelfDestruct.mockResolvedValue({ outcome: 'deleted' });
    const res = await call(runHandler, cron());
    expect(res.statusCode).toBe(200);
    for (const [, given] of selfDestruct.resolveSelfDestruct.mock.calls) {
      expect(given.deadline).toBe(started + 50 * 1000);
    }
    expect(res.body.deleted).toBe(2);
  });

  it('stops starting rows after forty seconds and puts the rest back unspent', async () => {
    // Eight lanes. Each resolve takes the clock past the start budget, so the
    // two rows still waiting when a lane frees up are never started.
    selfDestruct.claimDueSelfDestructs.mockResolvedValue(rowsOf(10));
    selfDestruct.resolveSelfDestruct.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      clock += 41 * 1000;
      return { outcome: 'deleted' };
    });
    const res = await call(runHandler, cron());
    expect(selfDestruct.resolveSelfDestruct).toHaveBeenCalledTimes(8);
    expect(selfDestruct.requeueUnspent.mock.calls.map(([row]) => row.id)).toEqual(['row-9', 'row-10']);
    // Not a failure: nothing went through markFailedOrRetry.
    expect(selfDestruct.markFailedOrRetry).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ deleted: 8, deferred: 2, failed: 0, retried: 0 });
  });

  it('counts each outcome, a deletion budget’s deferral included', async () => {
    const outcomes = ['deleted', 'acted', 'spared', 'extended', 'gone', 'deferred'];
    selfDestruct.claimDueSelfDestructs.mockResolvedValue(rowsOf(outcomes.length));
    selfDestruct.resolveSelfDestruct.mockImplementation(async (row) => ({ outcome: outcomes[Number(row.id.slice(4)) - 1] }));
    const res = await call(runHandler, cron());
    expect(res.body).toMatchObject({ deleted: 1, acted: 1, spared: 1, extended: 1, gone: 1, deferred: 1, retried: 0, failed: 0 });
    expect(selfDestruct.markFailedOrRetry).not.toHaveBeenCalled();
  });

  it('retires a row claimed past its attempts as TIMED_OUT, without resolving it', async () => {
    selfDestruct.claimDueSelfDestructs.mockResolvedValue([...rowsOf(1, { id: 'spent', attempts: 6 }), ...rowsOf(1)]);
    selfDestruct.resolveSelfDestruct.mockResolvedValue({ outcome: 'deleted' });
    const res = await call(runHandler, cron());
    expect(selfDestruct.markFailedOrRetry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'spent' }), TIMED_OUT_ERROR, { terminal: true, code: 'TIMED_OUT' },
    );
    expect(selfDestruct.resolveSelfDestruct.mock.calls.map(([row]) => row.id)).toEqual(['row-1']);
    expect(res.body).toMatchObject({ failed: 1, deleted: 1 });
  });

  it('reads the counts once for the conditional rows only, and hands them down', async () => {
    const counts = new Map([[postUri('r2'), { likes: 9 }]]);
    selfDestruct.fetchEngagement.mockResolvedValue(counts);
    selfDestruct.claimDueSelfDestructs.mockResolvedValue([
      ...rowsOf(1),
      { ...rowsOf(2)[1], conditions: conditional },
    ]);
    selfDestruct.resolveSelfDestruct.mockResolvedValue({ outcome: 'spared' });
    await call(runHandler, cron());
    expect(selfDestruct.fetchEngagement).toHaveBeenCalledTimes(1);
    expect(selfDestruct.fetchEngagement).toHaveBeenCalledWith([postUri('r2')]);
    const given = Object.fromEntries(selfDestruct.resolveSelfDestruct.mock.calls.map(([row, opts]) => [row.id, opts]));
    expect(given['row-1'].engagement).toBeUndefined();
    expect(given['row-2'].engagement).toBe(counts);
  });

  it('asks the AppView nothing when no row has conditions', async () => {
    await expect(readEngagement(rowsOf(3))).resolves.toEqual(new Map());
    expect(selfDestruct.fetchEngagement).not.toHaveBeenCalled();
    selfDestruct.fetchEngagement.mockRejectedValue(new Error('HTTP 503'));
    await expect(readEngagement(rowsOf(1, { conditions: conditional }))).resolves.toBeNull();
  });

  it('does not wave a non-verdict marker past a failed batch read', async () => {
    // A countless "already gone" marker is not a verdict, so a conditional row
    // carrying one needs its counts like any other: no read, no resolve.
    selfDestruct.fetchEngagement.mockRejectedValue(new Error('HTTP 503'));
    selfDestruct.claimDueSelfDestructs.mockResolvedValue([{
      ...rowsOf(1)[0],
      conditions: { clauses: [{ metric: 'replies', op: 'gt', value: 50 }], sense: 'onlyIf' },
      acted: { pending: true, counts: null, reason: 'the post was already gone' },
    }]);
    selfDestruct.resolveSelfDestruct.mockResolvedValue({ outcome: 'deleted' });
    const res = await call(runHandler, cron());
    expect(selfDestruct.resolveSelfDestruct).not.toHaveBeenCalled();
    expect(selfDestruct.markFailedOrRetry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1' }),
      expect.stringMatching(/read the counts/),
      expect.objectContaining({ code: 'ENGAGEMENT_UNAVAILABLE' }),
    );
    expect(res.body.retried).toBe(1);
  });

  it('lets a pinned verdict go ahead past a failed batch read', async () => {
    selfDestruct.fetchEngagement.mockRejectedValue(new Error('HTTP 503'));
    selfDestruct.claimDueSelfDestructs.mockResolvedValue([{
      ...rowsOf(1)[0],
      conditions: conditional,
      acted: { pending: true, counts: { likes: 1 }, reason: '1 like' },
    }]);
    selfDestruct.resolveSelfDestruct.mockResolvedValue({ outcome: 'deleted' });
    const res = await call(runHandler, cron());
    expect(selfDestruct.resolveSelfDestruct).toHaveBeenCalledTimes(1);
    expect(selfDestruct.resolveSelfDestruct.mock.calls[0][1].engagement).toBeUndefined();
    expect(res.body.deleted).toBe(1);
  });

  it('tells markFailedOrRetry the code and when part of the thread already came down', async () => {
    selfDestruct.claimDueSelfDestructs.mockResolvedValue(rowsOf(1));
    selfDestruct.resolveSelfDestruct.mockRejectedValue(
      Object.assign(new Error("couldn't finish deleting this thread"), { partialDeletion: true, status: 429 }),
    );
    selfDestruct.markFailedOrRetry.mockResolvedValue('failed');
    const res = await call(runHandler, cron());
    expect(selfDestruct.markFailedOrRetry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1' }),
      "couldn't finish deleting this thread",
      { terminal: false, code: 'RATE_LIMITED', partial: true },
    );
    expect(res.body).toMatchObject({ failed: 1, retried: 0 });
    expect(res.body.errors).toEqual([{ id: 'row-1', error: "couldn't finish deleting this thread", terminal: false }]);
  });

  it('keeps going when the bookkeeping itself fails', async () => {
    selfDestruct.claimDueSelfDestructs.mockResolvedValue(rowsOf(2));
    selfDestruct.resolveSelfDestruct.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ outcome: 'deleted' });
    selfDestruct.markFailedOrRetry.mockRejectedValue(new Error('connection failure'));
    const res = await call(runHandler, cron());
    expect(res.statusCode).toBe(200);
    expect(res.body.deleted).toBe(1);
    expect(res.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'row-1', error: 'bookkeeping: connection failure' }),
    ]));
  });

  it('answers 200 unavailable when timers are not set up here', async () => {
    selfDestruct.reclaimStuck.mockRejectedValue(new selfDestruct.SelfDestructUnavailableError());
    const res = await call(runHandler, cron());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, unavailable: true, claimed: 0 });
  });

  it('answers 500 on a failed claim', async () => {
    selfDestruct.claimDueSelfDestructs.mockRejectedValue(new Error('claim failed: connection failure'));
    const res = await call(runHandler, cron());
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ success: false, error: 'claim failed: connection failure' });
  });
});
