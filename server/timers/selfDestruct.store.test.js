// The Supabase side of self-destructing posts: arming, re-arming and listing.
//
// selfDestruct.test.js covers the pure functions and selfDestruct.resolve.test.js
// covers the decide-and-act core against a fake PDS. This file covers what is
// left between them — the rows themselves. What a timer is armed WITH (its
// check_at, its rule), what a re-arm clears, and which rows the timers page is
// handed. Every one of those has been wrong in a way that only shows up in the
// row: a deadline measured from the wrong clock, a stale verdict surviving a
// new rule, a live timer pushed off the end of the list.
//
// The fake below goes in through the module's `deps` seam.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as selfDestruct from './selfDestruct.js';

const { deps } = selfDestruct;
const realDeps = { ...deps };

// ─── A chainable stand-in for the Supabase query builder ────────────────────
// Every query is recorded when it is awaited, with its table, operation,
// payload, filters, ordering and limit, and answered by `onQuery`. RPCs are
// recorded and answered by `onRpc`. Tests script the two handlers.
let rpcCalls = [];
let queries = [];
let onRpc = async () => ({ data: null, error: null });
let onQuery = () => ({ data: [], error: null });

function builder(table) {
  const q = { table, op: null, payload: null, columns: null, filters: [], orders: [], limit: null, single: false };
  const chain = {
    select(columns) { if (!q.op) q.op = 'select'; q.columns = columns; return chain; },
    update(payload) { q.op = 'update'; q.payload = payload; return chain; },
    eq(column, value) { q.filters.push(['eq', column, value]); return chain; },
    in(column, values) { q.filters.push(['in', column, values]); return chain; },
    gte(column, value) { q.filters.push(['gte', column, value]); return chain; },
    order(column, opts) { q.orders.push([column, opts]); return chain; },
    limit(n) { q.limit = n; return chain; },
    single() { q.single = true; return chain; },
    then(resolve, reject) {
      // A snapshot, so a payload the code mutates for its retry is recorded as
      // it was actually sent.
      queries.push({ ...q, payload: q.payload ? { ...q.payload } : null, filters: [...q.filters] });
      return Promise.resolve().then(() => onQuery(q)).then(resolve, reject);
    },
  };
  return chain;
}

const fakeSupabase = {
  from: (table) => builder(table),
  rpc: async (name, params) => {
    rpcCalls.push({ name, params: { ...params } });
    return onRpc(name, params);
  },
};

const DID = 'did:plc:author';
const uriFor = (rkey) => `at://${DID}/app.bsky.feed.post/${rkey}`;
const secondsFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / 1000;

/** An RPC that inserts whatever it was asked to and hands the row back. */
const insertingRpc = async (name, params) => ({
  data: { ok: true, row: { id: 'new-row', status: 'armed', check_at: params.p_check_at } },
  error: null,
});

beforeEach(() => {
  rpcCalls = [];
  queries = [];
  onRpc = insertingRpc;
  onQuery = () => ({ data: [], error: null });
  deps.getSupabaseClient = () => fakeSupabase;
});
afterEach(() => {
  Object.assign(deps, realDeps);
  delete process.env.TIMER_MAX_ACTIVE_PER_USER;
  vi.useRealTimers();
});

// ─── A scheduled post armed after it published ──────────────────────────────

describe('armForPublishedSchedule measures from the real publish, not the slot', () => {
  /** A scheduled row whose slot passed `lateMs` ago. */
  const lateRow = (lateMs, selfDestruct) => ({
    id: 'sched-1',
    user_did: DID,
    scheduled_for: new Date(Date.now() - lateMs).toISOString(),
    payload: { posts: [{ record: { text: 'hello' } }], selfDestruct },
  });

  it('gives a fifteen-minute timer its fifteen minutes on a post that went out fourteen minutes late', async () => {
    // Measured from the slot, this post was due in sixty seconds — and the
    // floor, measured from the same slot, waved it through.
    const row = lateRow(14 * 60 * 1000, { lifespanSeconds: 15 * 60 });
    await selfDestruct.armForPublishedSchedule(row, [{ uri: uriFor('root'), cid: 'c1' }]);
    const fromNow = secondsFromNow(rpcCalls[0].params.p_check_at);
    expect(fromNow).toBeGreaterThan(15 * 60 - 5);
    expect(fromNow).toBeLessThanOrEqual(15 * 60 + 1);
  });

  // ── A pinned deadline the post missed ────────────────────────────────────
  // Flooring would turn a deadline already gone by when the post went out into
  // "five minutes from now", a length nobody picked. The worker gives the post
  // the window the writer was shown instead: lifespanSeconds, which the
  // composer sets to slot → picked time.

  it('gives a missed pin its original window, not five minutes', async () => {
    // The frontend pins deleteAt at slot + 15 minutes. The post published 14
    // minutes late, so that deadline is one minute away.
    const lateMs = 14 * 60 * 1000;
    const slot = Date.now() - lateMs;
    const row = lateRow(lateMs, {
      lifespanSeconds: 15 * 60,
      deleteAt: new Date(slot + 15 * 60 * 1000).toISOString(),
    });
    await selfDestruct.armForPublishedSchedule(row, [{ uri: uriFor('root'), cid: 'c1' }]);
    const fromNow = secondsFromNow(rpcCalls[0].params.p_check_at);
    expect(fromNow).toBeGreaterThan(15 * 60 - 5);
    expect(fromNow).toBeLessThanOrEqual(15 * 60 + 1);
  });

  it('runs a queued post moved a day later for its original length, not until 9:05', async () => {
    // Queued for Thursday 9am with a delete time of Thursday 6pm (a nine-hour
    // window), dragged to Friday 9am, published then. The pin is fifteen hours
    // gone; the post stands until Friday 6pm.
    const dayMs = 24 * 60 * 60 * 1000;
    const thursday9 = Date.now() - dayMs;
    const row = lateRow(dayMs, {
      lifespanSeconds: 9 * 60 * 60,
      deleteAt: new Date(thursday9 + 9 * 60 * 60 * 1000).toISOString(),
    });
    const armed = await selfDestruct.armForPublishedSchedule(row, [{ uri: uriFor('root'), cid: 'c1' }]);
    expect(armed).toBeTruthy();
    const fromNow = secondsFromNow(rpcCalls[0].params.p_check_at);
    expect(fromNow).toBeGreaterThan(9 * 3600 - 5);
    expect(fromNow).toBeLessThanOrEqual(9 * 3600 + 1);
  });

  it('records on the row that the picked time had passed', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const row = lateRow(dayMs, {
      lifespanSeconds: 9 * 60 * 60,
      deleteAt: new Date(Date.now() - dayMs + 9 * 60 * 60 * 1000).toISOString(),
    });
    onQuery = (q) => ({ data: { id: 'new-row', status: 'armed', ...q.payload }, error: null });
    const armed = await selfDestruct.armForPublishedSchedule(row, [{ uri: uriFor('root'), cid: 'c1' }]);
    const note = queries.find((q) => q.op === 'update' && q.payload && q.payload.resolution);
    expect(note.payload.resolution).toBe(selfDestruct.MISSED_DEADLINE_NOTE);
    expect(note.filters).toEqual(expect.arrayContaining([['eq', 'id', 'new-row'], ['eq', 'status', 'armed']]));
    expect(armed.resolution).toMatch(/had passed before this post went out/);
  });

  it('writes no note when the pin was kept', async () => {
    const row = lateRow(60 * 1000, {
      lifespanSeconds: 60 * 60,
      deleteAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });
    await selfDestruct.armForPublishedSchedule(row, [{ uri: uriFor('root'), cid: 'c1' }]);
    expect(queries.filter((q) => q.op === 'update')).toEqual([]);
  });

  it('keeps a pinned deadline that is still comfortably ahead exactly where it was put', async () => {
    const row = lateRow(60 * 1000, {
      lifespanSeconds: 60 * 60,
      deleteAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });
    const deleteAt = row.payload.selfDestruct.deleteAt;
    await selfDestruct.armForPublishedSchedule(row, [{ uri: uriFor('root'), cid: 'c1' }]);
    expect(rpcCalls[0].params.p_check_at).toBe(deleteAt);
  });

  it('measures from the publish time a caller passes, when it knows one', async () => {
    const row = lateRow(30 * 60 * 1000, { lifespanSeconds: 60 * 60 });
    const publishedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await selfDestruct.armForPublishedSchedule(row, [{ uri: uriFor('root'), cid: 'c1' }], { publishedAt });
    // Ten minutes of the hour already spent since it actually went up.
    const fromNow = secondsFromNow(rpcCalls[0].params.p_check_at);
    expect(fromNow).toBeGreaterThan(50 * 60 - 5);
    expect(fromNow).toBeLessThan(50 * 60 + 5);
  });
});

// ─── Re-arming a timer that is already counting down ────────────────────────

describe('armSelfDestruct re-arming an armed timer', () => {
  // The row the RPC hands back when the post already has a live timer: an
  // earlier attempt pinned a verdict, then failed partway, and the row went
  // back in the queue with that verdict and its spent attempts still on it.
  const staleRow = {
    id: 'row-1', status: 'armed', attempts: 3, next_attempt_at: new Date(Date.now() + 8 * 60 * 1000).toISOString(),
    last_error: 'the PDS timed out', last_error_code: 'TIMED_OUT',
    acted: { pending: true, counts: { likes: 1 }, reason: '1 like, 0 replies, 0 reposts' },
  };
  const arm = (extra = {}) => selfDestruct.armSelfDestruct({
    userDid: DID, postUri: uriFor('root'), collection: 'app.bsky.feed.post', rkey: 'root',
    lifespanSeconds: 3600, checkAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    conditions: { logic: 'any', sense: 'unless', onSpare: 'keep', maxExtensions: 0, clauses: [{ metric: 'likes', op: 'gte', value: 50 }] },
    ...extra,
  });
  const reArms = () => queries.filter((q) => q.op === 'update' && q.table === 'self_destruct_posts');

  beforeEach(() => {
    onRpc = async () => ({ data: { ok: true, row: staleRow, existing: true }, error: null });
    onQuery = (q) => ({ data: { ...staleRow, ...q.payload }, error: null });
  });

  it("clears the old rule's pinned verdict, so the new rule decides for itself", async () => {
    // Left in place, the next claim resumes the pinned verdict — counts read
    // under the old rule — and deletes under the new one.
    const result = await arm();
    expect(result.updated).toBe(true);
    const [write] = reArms();
    expect(write.payload).toHaveProperty('acted', null);
    expect(result.row.acted).toBeNull();
  });

  it("clears the old rule's spent attempts and its errors", async () => {
    await arm();
    const [write] = reArms();
    expect(write.payload).toMatchObject({
      attempts: 0, next_attempt_at: null, last_error: null, last_error_code: null,
    });
  });

  it('only rewrites a row that is still armed', async () => {
    await arm();
    const [write] = reArms();
    expect(write.filters).toEqual(expect.arrayContaining([['eq', 'id', 'row-1'], ['eq', 'status', 'armed']]));
  });

});

// ─── The timers page's list ─────────────────────────────────────────────────
// One read sorted by check_at with a limit of 100 would put 'acted' rows (which
// nobody can dismiss, and whose check_at is in the past) at the top, where they
// would accumulate until a live timer fell off the end of the page.

describe('listSelfDestructs keeps live timers first', () => {
  const row = (id, status, extra = {}) => ({ id, status, check_at: '2026-10-01T00:00:00.000Z', ...extra });
  const statusesOf = (q) => (q.filters.find((f) => f[0] === 'in' && f[1] === 'status') || [])[2];
  const eqStatus = (q) => (q.filters.find((f) => f[0] === 'eq' && f[1] === 'status') || [])[2];
  /** Which of the three reads this is. */
  const kind = (q) => {
    const many = statusesOf(q);
    if (many && many.includes('armed')) return 'counting';
    if (eqStatus(q) === 'failed') return 'failed';
    return 'settled';
  };
  /** Answer each read from a table of rows by kind. */
  const answer = (byKind) => (q) => ({ data: byKind[kind(q)] || [], error: null });

  it('reads counting timers, then failed ones, then a week of acted rows, each into the room left', async () => {
    onQuery = answer({
      counting: [row('a', 'armed'), row('c', 'checking')],
      failed: [row('f', 'failed')],
      settled: [row('g', 'acted')],
    });
    const rows = await selfDestruct.listSelfDestructs(DID);
    expect(rows.map((r) => r.id)).toEqual(['a', 'c', 'f', 'g']);

    const [counting, failed, acted] = queries;
    expect(statusesOf(counting)).toEqual(['armed', 'checking']);
    expect(counting.filters).toContainEqual(['eq', 'user_did', DID]);
    expect(counting.orders).toEqual([['check_at', { ascending: true }]]);
    expect(counting.limit).toBe(100);

    expect(eqStatus(failed)).toBe('failed');
    expect(failed.filters).toContainEqual(['eq', 'user_did', DID]);
    expect(failed.orders[0]).toEqual(['resolved_at', { ascending: false, nullsFirst: false }]);
    expect(failed.limit).toBe(98);

    expect(eqStatus(acted)).toBe('acted');
    expect(acted.filters).toContainEqual(['eq', 'user_did', DID]);
    const since = acted.filters.find((f) => f[0] === 'gte' && f[1] === 'resolved_at')[2];
    const days = (Date.now() - new Date(since).getTime()) / 86400000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    expect(acted.orders[0]).toEqual(['resolved_at', { ascending: false, nullsFirst: false }]);
    // Only the room the live rows left.
    expect(acted.limit).toBe(97);
  });

  it('never lets failed rows crowd out a timer that is counting down', async () => {
    // Failed rows have a check_at in the past, so in one read sorted by
    // check_at they would come first and push armed timers off the end.
    const armed = Array.from({ length: 100 }, (_, i) => row(`armed-${i}`, 'armed'));
    onQuery = answer({ counting: armed, failed: [row('f', 'failed', { check_at: '2020-01-01T00:00:00.000Z' })] });
    const rows = await selfDestruct.listSelfDestructs(DID);
    expect(rows).toHaveLength(100);
    expect(rows.every((r) => r.status === 'armed')).toBe(true);
    // Neither later read is even made.
    expect(queries).toHaveLength(1);
  });

  it('gives failed rows only the room the counting timers left', async () => {
    const armed = Array.from({ length: 60 }, (_, i) => row(`armed-${i}`, 'armed'));
    const failed = Array.from({ length: 40 }, (_, i) => row(`failed-${i}`, 'failed'));
    onQuery = answer({ counting: armed, failed, settled: [row('g', 'acted')] });
    const rows = await selfDestruct.listSelfDestructs(DID);
    expect(rows).toHaveLength(100);
    expect(queries[1].limit).toBe(40);
    // And the acted read never happens: there is no room left for it.
    expect(queries).toHaveLength(2);
  });

  it('never lets acted rows crowd out a live one', async () => {
    const live = Array.from({ length: 100 }, (_, i) => row(`live-${i}`, 'armed'));
    onQuery = answer({ counting: live, settled: [row('g', 'acted')] });
    const rows = await selfDestruct.listSelfDestructs(DID);
    expect(rows).toHaveLength(100);
    expect(rows.every((r) => r.status === 'armed')).toBe(true);
  });

  it('returns settled rows of every kind, newest first, for history', async () => {
    onQuery = answer({
      counting: [row('a', 'armed')],
      failed: [row('f', 'failed')],
      settled: [row('d', 'deleted'), row('s', 'spared'), row('old-acted', 'acted')],
    });
    const rows = await selfDestruct.listSelfDestructs(DID, { includeResolved: true });
    expect(rows.map((r) => r.id)).toEqual(['a', 'f', 'd', 's', 'old-acted']);
    const settled = queries[2];
    expect(statusesOf(settled)).toEqual(['acted', 'deleted', 'spared']);
    // History has no horizon.
    expect(settled.filters.some((f) => f[0] === 'gte')).toBe(false);
    expect(settled.orders[0]).toEqual(['resolved_at', { ascending: false, nullsFirst: false }]);
  });

  it('reports the feature as unavailable on a database without the table', async () => {
    onQuery = () => ({ data: null, error: { code: '42P01', message: 'relation "self_destruct_posts" does not exist' } });
    await expect(selfDestruct.listSelfDestructs(DID)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});

// ─── What the arming RPC is asked ───────────────────────────────────────────
// One function, one signature, every argument named: PostgREST resolves an RPC
// by its argument names, so the call never depends on which arguments happen
// to be sent.

describe('armSelfDestruct calls create_self_destruct_capped with every argument', () => {
  const arm = (extra = {}) => selfDestruct.armSelfDestruct({
    userDid: DID, postUri: uriFor('root'), postCid: 'cid1', collection: 'app.bsky.feed.post', rkey: 'root',
    snippet: 'hello', extraUris: [{ uri: uriFor('r1'), collection: 'app.bsky.feed.post', rkey: 'r1' }],
    lifespanSeconds: 3600, checkAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    conditions: {}, ...extra,
  });

  it('stores NULL effects for a plain delete, and the ceiling from the default', async () => {
    const result = await arm();
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('create_self_destruct_capped');
    expect(rpcCalls[0].params).toMatchObject({
      p_user_did: DID,
      p_post_uri: uriFor('root'),
      p_post_cid: 'cid1',
      p_collection: 'app.bsky.feed.post',
      p_rkey: 'root',
      p_snippet: 'hello',
      p_extra_uris: [{ uri: uriFor('r1'), collection: 'app.bsky.feed.post', rkey: 'r1' }],
      p_lifespan_seconds: 3600,
      p_conditions: {},
      p_max_active: 200,
      p_effects: null,
    });
    expect(Object.keys(rpcCalls[0].params)).toHaveLength(12);
    expect(result).toEqual({ row: expect.objectContaining({ id: 'new-row' }), existing: false });
  });

  it('stores a rule with effects as its normalized list, deletion last', async () => {
    await arm({ effects: [{ action: 'delete' }, { action: 'disableQuotes' }] });
    expect(rpcCalls[0].params.p_effects).toEqual([{ action: 'disableQuotes' }, { action: 'delete' }]);
  });

  it('reads the ceiling from TIMER_MAX_ACTIVE_PER_USER when it is set', async () => {
    process.env.TIMER_MAX_ACTIVE_PER_USER = '7';
    await arm();
    expect(rpcCalls[0].params.p_max_active).toBe(7);
    expect(selfDestruct.maxActivePerUser()).toBe(7);
    process.env.TIMER_MAX_ACTIVE_PER_USER = 'lots';
    expect(selfDestruct.maxActivePerUser()).toBe(200);
  });

  it('refuses at the ceiling with QUOTA_EXCEEDED and the limit', async () => {
    onRpc = async () => ({ data: { ok: false, code: 'QUOTA_EXCEEDED', limit: 200, count: 200 }, error: null });
    await expect(arm()).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      limit: 200,
      message: 'you can have at most 200 posts on a timer',
    });
  });

  it('says the feature is unavailable when the function is missing', async () => {
    onRpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.create_self_destruct_capped' } });
    await expect(arm()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('says the feature is unavailable with no database configured', async () => {
    deps.getSupabaseClient = () => null;
    await expect(arm()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(selfDestruct.listSelfDestructs(DID)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('passes any other database error on as a plain error', async () => {
    onRpc = async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    const err = await arm().catch((e) => e);
    expect(err.message).toMatch(/statement timeout/);
    expect(err.code).toBeUndefined();
  });

  it('refuses an answer with no row in it rather than reporting a timer it did not get', async () => {
    onRpc = async () => ({ data: { ok: true }, error: null });
    await expect(arm()).rejects.toThrow('the timer could not be saved');
  });

  it('hands back a checking timer untouched: it is mid-evaluation', async () => {
    const checking = { id: 'row-2', status: 'checking' };
    onRpc = async () => ({ data: { ok: true, row: checking, existing: true }, error: null });
    const result = await arm();
    expect(result).toEqual({ row: checking, existing: true });
    expect(queries.filter((q) => q.op === 'update')).toEqual([]);
  });

  it('hands back the existing row when it was claimed between the RPC and the rewrite', async () => {
    const armed = { id: 'row-3', status: 'armed' };
    onRpc = async () => ({ data: { ok: true, row: armed, existing: true }, error: null });
    onQuery = () => ({ data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } });
    const result = await arm();
    expect(result).toEqual({ row: armed, existing: true });
  });
});

// ─── Calling a timer off ────────────────────────────────────────────────────

describe('cancelSelfDestruct', () => {
  it('calls off only an armed or failed timer of the caller’s', async () => {
    onQuery = (q) => ({ data: { id: 'row-1', status: 'cancelled', ...q.payload }, error: null });
    const row = await selfDestruct.cancelSelfDestruct('row-1', DID);
    expect(row).toMatchObject({ id: 'row-1', status: 'cancelled', resolution: 'called off' });
    const [write] = queries;
    expect(write.op).toBe('update');
    expect(write.filters).toEqual([
      ['eq', 'id', 'row-1'],
      ['eq', 'user_did', DID],
      ['in', 'status', ['armed', 'failed']],
    ]);
    expect(write.single).toBe(true);
  });

  it('answers null when nothing matched', async () => {
    onQuery = () => ({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
    await expect(selfDestruct.cancelSelfDestruct('row-1', DID)).resolves.toBeNull();
  });

  it('says unavailable on a missing table, and throws on anything else', async () => {
    onQuery = () => ({ data: null, error: { code: '42P01', message: 'relation "self_destruct_posts" does not exist' } });
    await expect(selfDestruct.cancelSelfDestruct('row-1', DID)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    onQuery = () => ({ data: null, error: { code: '08006', message: 'connection failure' } });
    await expect(selfDestruct.cancelSelfDestruct('row-1', DID)).rejects.toThrow('connection failure');
  });
});

// ─── The worker's queue ─────────────────────────────────────────────────────

describe('claimDueSelfDestructs and reclaimStuck', () => {
  it('claims through the RPC with the run id and the limit', async () => {
    onRpc = async () => ({ data: [{ id: 'a' }], error: null });
    await expect(selfDestruct.claimDueSelfDestructs('run-1', 25)).resolves.toEqual([{ id: 'a' }]);
    expect(rpcCalls).toEqual([{ name: 'claim_self_destruct_posts', params: { p_run_id: 'run-1', p_limit: 25 } }]);
  });

  it('says unavailable without the function, and throws on a failed claim', async () => {
    onRpc = async () => ({ data: null, error: { code: '42883', message: 'function claim_self_destruct_posts does not exist' } });
    await expect(selfDestruct.claimDueSelfDestructs('run-1')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    onRpc = async () => ({ data: null, error: { code: '08006', message: 'connection failure' } });
    await expect(selfDestruct.claimDueSelfDestructs('run-1')).rejects.toThrow('claim failed: connection failure');
  });

  it('reclaims through the RPC, and a failed reclaim costs nothing but a warning', async () => {
    onRpc = async () => ({ data: 3, error: null });
    await expect(selfDestruct.reclaimStuck(180)).resolves.toBe(3);
    expect(rpcCalls[0]).toEqual({ name: 'reclaim_stuck_self_destructs', params: { p_older_than_seconds: 180 } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onRpc = async () => ({ data: null, error: { code: '08006', message: 'connection failure' } });
    await expect(selfDestruct.reclaimStuck(180)).resolves.toBe(0);
    warn.mockRestore();
    onRpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(selfDestruct.reclaimStuck(180)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});

describe('bookkeeping writes', () => {
  it('throw on a failed write rather than claiming an outcome that was not stored', async () => {
    onQuery = () => ({ data: null, error: { code: '08006', message: 'connection failure' } });
    await expect(selfDestruct.markDeleted('row-1', { counts: null })).rejects.toThrow('connection failure');
  });

  it('retry with backoff, then fail on the last attempt with the post still up', async () => {
    const row = { id: 'row-1', attempts: 2, max_attempts: 5, acted: null };
    await expect(selfDestruct.markFailedOrRetry(row, 'HTTP 429 rate limit')).resolves.toBe('retry');
    const retry = queries.pop().payload;
    expect(retry).toMatchObject({ status: 'armed', last_error_code: 'RATE_LIMITED', locked_at: null });
    const minutes = (new Date(retry.next_attempt_at).getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(3.9);
    expect(minutes).toBeLessThan(4.1);

    await expect(selfDestruct.markFailedOrRetry({ ...row, attempts: 5 }, 'x'.repeat(900))).resolves.toBe('failed');
    const failed = queries.pop().payload;
    expect(failed).toMatchObject({ status: 'failed', resolution: 'the post is still up', last_error_code: 'UNKNOWN' });
    expect(failed.last_error).toHaveLength(500);
  });

  it('caps the backoff at an hour', async () => {
    await selfDestruct.markFailedOrRetry({ id: 'row-1', attempts: 9, max_attempts: 20 }, 'timed out');
    const minutes = (new Date(queries.pop().payload.next_attempt_at).getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(59.9);
    expect(minutes).toBeLessThan(60.1);
  });

  it('put a row back unspent, with its progress when it has some', async () => {
    await expect(selfDestruct.requeueUnspent({ id: 'row-1', attempts: 3 })).resolves.toBe(true);
    expect(queries.pop().payload).toMatchObject({ status: 'armed', attempts: 2, next_attempt_at: null, locked_by: null });
    expect(queries).toEqual([]);
    const acted = { pending: true, counts: null, reason: 'on time', deleted: [uriFor('r1')] };
    await selfDestruct.requeueUnspent({ id: 'row-1', attempts: 0 }, { acted });
    expect(queries.pop().payload).toMatchObject({ attempts: 0, acted });
  });
});

// ─── Arming after a scheduled publish ───────────────────────────────────────

describe('armForPublishedSchedule', () => {
  const row = (selfDestructSpec) => ({
    id: 'sched-1',
    user_did: DID,
    payload: { posts: [{ record: { text: 'hello there' } }], selfDestruct: selfDestructSpec },
  });

  it('does nothing for a post that asked for no timer, or wrote nothing', async () => {
    await expect(selfDestruct.armForPublishedSchedule(row(null), [{ uri: uriFor('root') }])).resolves.toBeNull();
    await expect(selfDestruct.armForPublishedSchedule(row({ lifespanSeconds: 3600 }), [])).resolves.toBeNull();
    expect(rpcCalls).toEqual([]);
  });

  it('arms the root and covers the rest of the thread, with the first post as the snippet', async () => {
    await selfDestruct.armForPublishedSchedule(row({ lifespanSeconds: 3600 }), [
      { uri: uriFor('root'), cid: 'c1' }, { uri: uriFor('r1'), cid: 'c2' },
    ]);
    expect(rpcCalls[0].params).toMatchObject({
      p_user_did: DID,
      p_post_uri: uriFor('root'),
      p_post_cid: 'c1',
      p_snippet: 'hello there',
      p_extra_uris: [{ uri: uriFor('r1'), collection: 'app.bsky.feed.post', rkey: 'r1' }],
      p_effects: null,
    });
  });

  it('reports a refused spec rather than retrying it', async () => {
    await expect(selfDestruct.armForPublishedSchedule(row({ lifespanSeconds: 10 }), [{ uri: uriFor('root') }]))
      .rejects.toThrow('the timer for this post was refused: a post has to stand for at least 5 minutes');
    expect(rpcCalls).toEqual([]);
  });

  it('retries a transient failure, and gives up after three tries', async () => {
    vi.useFakeTimers();
    let calls = 0;
    onRpc = async () => {
      calls += 1;
      return calls < 3
        ? { data: null, error: { code: '08006', message: 'connection failure' } }
        : insertingRpc('create_self_destruct_capped', rpcCalls[rpcCalls.length - 1].params);
    };
    const armed = selfDestruct.armForPublishedSchedule(row({ lifespanSeconds: 3600 }), [{ uri: uriFor('root') }]);
    await vi.runAllTimersAsync();
    await expect(armed).resolves.toMatchObject({ id: 'new-row' });
    expect(calls).toBe(3);

    calls = 0;
    onRpc = async () => { calls += 1; return { data: null, error: { code: '08006', message: 'connection failure' } }; };
    const failed = selfDestruct.armForPublishedSchedule(row({ lifespanSeconds: 3600 }), [{ uri: uriFor('root') }]);
    const settled = expect(failed).rejects.toThrow('connection failure');
    await vi.runAllTimersAsync();
    await settled;
    expect(calls).toBe(3);
  });

  it('does not retry a missing schema or a full account', async () => {
    onRpc = async () => ({ data: { ok: false, code: 'QUOTA_EXCEEDED', limit: 200 }, error: null });
    await expect(selfDestruct.armForPublishedSchedule(row({ lifespanSeconds: 3600 }), [{ uri: uriFor('root') }]))
      .rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(rpcCalls).toHaveLength(1);
    rpcCalls = [];
    onRpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(selfDestruct.armForPublishedSchedule(row({ lifespanSeconds: 3600 }), [{ uri: uriFor('root') }]))
      .rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(rpcCalls).toHaveLength(1);
  });
});
