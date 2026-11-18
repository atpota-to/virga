// /api/defense/*, the handlers, in-process over PGlite. The caller's DID comes
// from the token (mocked here as the session store's answer); nothing in a
// body is taken for who the caller is, and one owner naming another's list,
// plan or decisions gets nothing.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../test/pglite.js';
import { createReq, createRes } from '../test/http.js';
import { resetSupabaseClientForTests, setSupabaseClientForTests } from '../supabase.js';
import { signWorkerRequest } from './workerAuth.js';

const auth = vi.hoisted(() => ({ resolveUserDid: vi.fn() }));
vi.mock('../oauth/auth.js', () => auth);

const { default: lists } = await import('./handlers/lists.js');
const { default: listCreate } = await import('./handlers/listCreate.js');
const { default: keep } = await import('./handlers/keep.js');
const { default: unkeep } = await import('./handlers/unkeep.js');
const { default: plan } = await import('./handlers/plan.js');
const { default: approve } = await import('./handlers/approve.js');
const { default: history } = await import('./handlers/history.js');
const { default: undo } = await import('./handlers/undo.js');
const { default: run } = await import('./handlers/run.js');

const MIRA = 'did:plc:mira';
const LAB = 'did:plc:lab';
const TOKEN = { authorization: `Bearer vg_${'a'.repeat(64)}` };

let t;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  resetSupabaseClientForTests();
  await t?.close?.();
});

beforeEach(async () => {
  await t.query(`TRUNCATE defense_decision, defense_job, defense_pace, defense_plan_row, defense_plan, defense_protected, defense_list CASCADE`);
  setSupabaseClientForTests(t.supabase);
  vi.unstubAllEnvs();
  vi.stubEnv('DEFENSE_WRITES', 'on');
  signInAs(MIRA);
});

function signInAs(did) {
  auth.resolveUserDid.mockReset();
  auth.resolveUserDid.mockResolvedValue(did ? { userDid: did, status: 200, error: null, code: null } : { userDid: null, status: 401, error: 'Invalid or expired session', code: 'FRONTEND_SESSION_INVALID' });
}

async function call(handler, { method = 'POST', body, query, headers = TOKEN, url } = {}, ...extra) {
  const res = createRes();
  await handler(createReq({ method, body, query, headers, url }), res, ...extra);
  return { status: res.statusCode, body: res.body };
}

/** A fake PDS for making a list: records the create, or refuses it. */
function listDeps({ refuse = null, signedOut = false } = {}) {
  const made = [];
  class Agent {
    constructor(session) {
      this.com = {
        atproto: {
          repo: {
            createRecord: async (input) => {
              if (refuse) throw refuse;
              if (input.repo !== session.did) throw new Error('not your repo');
              made.push(input);
              return { data: { uri: `at://${input.repo}/${input.collection}/${input.rkey}` } };
            },
          },
        },
      };
    }
  }
  return { made, deps: { restore: async (did) => (signedOut ? null : { did }), Agent, newKey: () => '3lkaaaaaaaaa2' } };
}

async function makeList(did = MIRA) {
  signInAs(did);
  const { deps } = listDeps();
  const r = await call(listCreate, { body: { name: 'Pile-on', purpose: 'block' } }, { ...deps, newKey: () => `3lk${did === MIRA ? 'm' : 'l'}aaaaaaaa2` });
  signInAs(MIRA);
  return r.body.data.list;
}

describe('making a list', () => {
  it('writes a moderation list in the caller’s own repo, and keeps it', async () => {
    const { made, deps } = listDeps();
    const r = await call(listCreate, { body: { name: '  Pile-on\n', purpose: 'block' } }, deps);
    expect(r.status).toBe(200);
    expect(made[0]).toMatchObject({ repo: MIRA, collection: 'app.bsky.graph.list', rkey: '3lkaaaaaaaaa2', record: { purpose: 'app.bsky.graph.defs#modlist', name: 'Pile-on' } });
    expect(r.body.data.list).toMatchObject({ name: 'Pile-on', purpose: 'block', mode: 'own', holderDid: MIRA, uri: `at://${MIRA}/app.bsky.graph.list/3lkaaaaaaaaa2` });
    const listed = await call(lists, { method: 'GET' });
    expect(listed.body.data).toMatchObject({ writes: true, kept: [] });
    expect(listed.body.data.lists.map((l) => l.name)).toEqual(['Pile-on']);
  });

  it('is refused while writes are off, without a name, signed out or without the permission', async () => {
    vi.stubEnv('DEFENSE_WRITES', '');
    expect((await call(listCreate, { body: { name: 'x', purpose: 'block' } }, listDeps().deps)).body.code).toBe('WRITES_OFF');
    vi.stubEnv('DEFENSE_WRITES', 'on');
    expect((await call(listCreate, { body: { purpose: 'block' } }, listDeps().deps)).status).toBe(400);
    expect((await call(listCreate, { body: { name: 'x', purpose: 'delete everything' } }, listDeps().deps)).status).toBe(400);
    expect((await call(listCreate, { body: { name: 'x', purpose: 'block' } }, listDeps({ signedOut: true }).deps)).body.code).toBe('SIGNED_OUT');
    const scope = Object.assign(new Error('Missing required scope "repo:app.bsky.graph.list?action=create"'), { status: 403 });
    expect((await call(listCreate, { body: { name: 'x', purpose: 'block' } }, listDeps({ refuse: scope }).deps)).body.code).toBe('NO_SCOPE');
    expect((await call(lists, { method: 'GET' })).body.data.lists).toEqual([]);
  });

  it('needs a session', async () => {
    signInAs(null);
    expect((await call(lists, { method: 'GET' })).status).toBe(401);
    expect((await call(listCreate, { body: { name: 'x', purpose: 'block' } }, listDeps().deps)).status).toBe(401);
  });
});

describe('a plan, approved and undone', () => {
  const rows = [
    { did: 'did:plc:a', band: 'UNKNOWN', trust: 2 },
    { did: 'did:plc:b', band: 'UNKNOWN', trust: 1 },
    { did: 'did:plc:n', band: 'NOTABLE', trust: 40 },
  ];

  it('is kept, approved by band, listed in the history, and undone', async () => {
    const list = await makeList();
    const made = await call(plan, { body: { listId: list.id, postUri: 'at://did:plc:x/app.bsky.feed.post/3abc', rows, totals: { participants: 9, UNKNOWN: 2, foo: 'bar' } } });
    expect(made.body.data).toMatchObject({ rows: 3 });
    const ok = await call(approve, { body: { planId: made.body.data.planId, bands: ['UNKNOWN', 'PROTECTED'], note: 'the quote pile-on' } });
    expect(ok.body.data).toMatchObject({ queued: 2, kept: 0, already: 0 });
    const h = await call(history, { method: 'GET' });
    expect(h.body.data.decisions.map((d) => [d.did, d.action, d.state, d.note])).toEqual([
      ['did:plc:b', 'add', 'queued', 'the quote pile-on'],
      ['did:plc:a', 'add', 'queued', 'the quote pile-on'],
    ]);
    expect(h.body.data.plans[0]).toMatchObject({
      bands: ['UNKNOWN'],
      note: 'the quote pile-on',
      totals: { participants: 9, UNKNOWN: 2 },
      counts: { added: 0, waiting: 2, kept: 0, failed: 0, undone: 0, live: 2 },
    });
    const back = await call(undo, { body: { planId: made.body.data.planId, note: 'wrong post' } });
    expect(back.body.data).toMatchObject({ cancelled: 2, queued: 0 });
  });

  it('refuses a plan naming anyone protected, a row that isn’t a DID, or no rows', async () => {
    const list = await makeList();
    expect((await call(plan, { body: { listId: list.id, rows: [{ did: 'did:plc:f', band: 'PROTECTED' }] } })).status).toBe(400);
    expect((await call(plan, { body: { listId: list.id, rows: [{ did: 'mira.example.com', band: 'UNKNOWN' }] } })).status).toBe(400);
    expect((await call(plan, { body: { listId: list.id, rows: [] } })).status).toBe(400);
    expect((await call(plan, { body: { listId: 'not-a-uuid', rows } })).status).toBe(400);
    expect((await call(approve, { body: { planId: '00000000-0000-0000-0000-000000000000', bands: [] } })).status).toBe(400);
  });

  it('queues nothing while writes are off', async () => {
    const list = await makeList();
    const made = await call(plan, { body: { listId: list.id, rows } });
    vi.stubEnv('DEFENSE_WRITES', 'off');
    expect((await call(approve, { body: { planId: made.body.data.planId, bands: ['UNKNOWN'] } })).body.code).toBe('WRITES_OFF');
    expect((await call(undo, { body: { planId: made.body.data.planId } })).body.code).toBe('WRITES_OFF');
  });

  it('gives one owner nothing of another’s', async () => {
    const theirs = await makeList(LAB);
    signInAs(LAB);
    const labPlan = (await call(plan, { body: { listId: theirs.id, rows } })).body.data.planId;
    await call(approve, { body: { planId: labPlan, bands: ['UNKNOWN'] } });
    await call(keep, { body: { did: 'did:plc:labfriend', reason: 'a friend' } });
    signInAs(MIRA);
    expect((await call(plan, { body: { listId: theirs.id, rows } })).status).toBe(404);
    expect((await call(approve, { body: { planId: labPlan, bands: ['UNKNOWN', 'NOTABLE'] } })).status).toBe(404);
    expect((await call(undo, { body: { planId: labPlan } })).body.data).toMatchObject({ cancelled: 0, queued: 0 });
    expect((await call(history, { method: 'GET' })).body.data).toEqual({ decisions: [], plans: [] });
    expect((await call(lists, { method: 'GET' })).body.data).toMatchObject({ lists: [], kept: [] });
    await call(unkeep, { body: { did: 'did:plc:labfriend' } });
    signInAs(LAB);
    const labView = await call(history, { method: 'GET' });
    expect(labView.body.data.decisions.map((d) => d.state)).toEqual(['queued', 'queued']);
    expect((await call(lists, { method: 'GET' })).body.data.kept).toHaveLength(1);
  });
});

describe('keeping by hand', () => {
  it('keeps and lets go, by DID only', async () => {
    expect((await call(keep, { body: { did: 'did:plc:sister', reason: 'my sister' } })).body.data).toMatchObject({ did: 'did:plc:sister', reason: 'my sister' });
    expect((await call(keep, { body: { did: '@sister.example.com' } })).status).toBe(400);
    expect((await call(lists, { method: 'GET' })).body.data.kept.map((k) => k.did)).toEqual(['did:plc:sister']);
    await call(unkeep, { body: { did: 'did:plc:sister' } });
    expect((await call(lists, { method: 'GET' })).body.data.kept).toEqual([]);
  });
});

describe('the run route', () => {
  const runner = () => vi.fn(async () => ({ ran: true, jobs: 0, written: 0, already: 0, vetoed: 0, failed: 0, held: [], errors: [] }));
  const URL_PATH = '/api/defense/run';

  it('runs for the worker’s signed call, and for the cron’s secret', async () => {
    vi.stubEnv('DEFENSE_WORKER_SECRET', 'w-secret');
    vi.stubEnv('CRON_SECRET', 'c-secret');
    const r1 = runner();
    const signed = { 'x-virga-worker': signWorkerRequest({ secret: 'w-secret', method: 'POST', path: URL_PATH }) };
    expect((await call(run, { url: URL_PATH, headers: signed }, { run: r1 })).status).toBe(200);
    expect(r1).toHaveBeenCalledTimes(1);
    const r2 = runner();
    expect((await call(run, { method: 'GET', url: URL_PATH, headers: { authorization: 'Bearer c-secret' } }, { run: r2 })).status).toBe(200);
    expect(r2).toHaveBeenCalledTimes(1);
  });

  it('refuses a call that is unsigned, signed with another secret, for another path, or stale', async () => {
    vi.stubEnv('DEFENSE_WORKER_SECRET', 'w-secret');
    vi.stubEnv('CRON_SECRET', 'c-secret');
    const r = runner();
    const tries = [
      {},
      { 'x-virga-worker': signWorkerRequest({ secret: 'other', path: URL_PATH }) },
      { 'x-virga-worker': signWorkerRequest({ secret: 'w-secret', path: '/api/defense/approve' }) },
      { 'x-virga-worker': signWorkerRequest({ secret: 'w-secret', path: URL_PATH, now: Date.now() - 10 * 60_000 }) },
      { 'x-virga-worker': 't=1,v1=zz' },
      { authorization: 'Bearer wrong' },
    ];
    for (const headers of tries) expect((await call(run, { url: URL_PATH, headers }, { run: r })).status, JSON.stringify(headers)).toBe(401);
    expect(r).not.toHaveBeenCalled();
  });
});
