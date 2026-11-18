// The run route's pass (server/defense/run.js), on the real store over
// PGlite, against a fake PDS that can lose replies, rate-limit, refuse and
// forget a scope, and a fake public AppView for the veto. What it holds to is
// docs/DEFENSE-THREATS.md: the veto at the write, only list items on Virga's
// lists, keys chosen first so nobody is added twice, and nothing written
// unless DEFENSE_WRITES is on.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../test/pglite.js';
import { claimJobs, storeFor } from './store.js';
import { SIGNED_OUT_HOLD_MS, listIsSound, runDefense } from './run.js';
import { RATE_LIMIT_HOLD_MS } from '../../src/defense/pace.js';
import { createTidClock } from '../../src/posting/lib/tid.js';

const MIRA = 'did:plc:mira';
const LAB = 'did:plc:lab';
const ON = { DEFENSE_WRITES: 'on' };

let t;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.close?.();
});

const as = (did) => storeFor(did, { client: t.supabase });

/** A PDS for one account: its records by key, and the ways it can fail. */
function fakePds() {
  const records = new Map(); // `${repo}/${collection}/${rkey}` -> value
  const calls = [];
  const plan = { applyWrites: [], createRecord: [], deleteRecord: [], getRecord: [] }; // queued failures per method
  const fail = (method) => {
    const next = plan[method].shift();
    if (next) throw next;
  };
  const xrpc = (status, error, message = error) => Object.assign(new Error(message), { status, error });
  class Agent {
    constructor(session) {
      this.session = session;
      const key = (repo, collection, rkey) => `${repo}/${collection}/${rkey}`;
      this.com = {
        atproto: {
          repo: {
            applyWrites: async ({ repo, writes }) => {
              calls.push(['applyWrites', repo, writes.length]);
              fail('applyWrites');
              if (repo !== session.did) throw xrpc(403, 'InvalidRequest', 'not your repo');
              for (const w of writes) if (records.has(key(repo, w.collection, w.rkey))) throw xrpc(400, 'InvalidRequest', 'Record already exists');
              for (const w of writes) records.set(key(repo, w.collection, w.rkey), w.value);
              return { data: { results: writes.map((w) => ({ uri: `at://${repo}/${w.collection}/${w.rkey}` })) } };
            },
            createRecord: async ({ repo, collection, rkey, record }) => {
              calls.push(['createRecord', repo, rkey]);
              fail('createRecord');
              if (records.has(key(repo, collection, rkey))) throw xrpc(400, 'InvalidRequest', 'Record already exists');
              records.set(key(repo, collection, rkey), record);
              return { data: { uri: `at://${repo}/${collection}/${rkey}` } };
            },
            deleteRecord: async ({ repo, collection, rkey }) => {
              calls.push(['deleteRecord', repo, rkey]);
              fail('deleteRecord');
              if (!records.has(key(repo, collection, rkey))) throw xrpc(400, 'RecordNotFound', 'Could not locate record');
              records.delete(key(repo, collection, rkey));
              return { data: {} };
            },
            getRecord: async ({ repo, collection, rkey }) => {
              calls.push(['getRecord', repo, rkey]);
              fail('getRecord');
              const value = records.get(key(repo, collection, rkey));
              if (!value) throw xrpc(400, 'RecordNotFound', `Could not locate record: at://${repo}/${collection}/${rkey}`);
              return { data: { value } };
            },
          },
        },
      };
    }
  }
  return { Agent, records, calls, plan, xrpc };
}

/** The public AppView, for the veto: who Mira follows, and her lists. */
function fakeAppview({ follows = new Set(), down = false } = {}) {
  return vi.fn(async (url) => {
    const u = new URL(url);
    if (down) return new Response('down', { status: 503 });
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.pathname.endsWith('getRelationships')) {
      return json({ relationships: u.searchParams.getAll('others').map((did) => ({ did, ...(follows.has(did) ? { following: 'at://x' } : {}) })) });
    }
    if (u.pathname.endsWith('getLists')) return json({ lists: [] });
    return new Response('?', { status: 404 });
  });
}

let pds;
let clock;
let now;
function deps(extra = {}) {
  return {
    claimJobs: (o) => claimJobs({ ...o, client: t.supabase }),
    storeFor: (did) => storeFor(did, { client: t.supabase }),
    restore: async (did) => ({ did }),
    Agent: pds.Agent,
    fetchImpl: fakeAppview(),
    newKey: () => clock(),
    ...extra,
  };
}
const pass = (extra, env = ON) => runDefense({ env, now: () => now, deps: deps(extra) });

/** Let the paced holder and its job be claimed again, as the next pass after the gap would. */
async function afterTheGap() {
  await t.query(`UPDATE defense_pace SET next_at = NOW() - INTERVAL '1 second'`);
  await t.query(`UPDATE defense_job SET next_at = NOW() - INTERVAL '1 second' WHERE state = 'pending'`);
}

async function approved(did, dids, { name = 'Pile-on' } = {}) {
  const list = await as(did).addList({ holderDid: did, mode: 'own', uri: `at://${did}/app.bsky.graph.list/${name.toLowerCase().replace(/\W/g, '')}`, name, purpose: 'block' });
  const planId = await as(did).createPlan({ listId: list.id, rows: dids.map((d) => ({ did: d, band: 'UNKNOWN', trust: 1 })) });
  const out = await as(did).approvePlan(planId, { bands: ['UNKNOWN'], note: 'pile-on' });
  return { list, planId, jobId: out.job_id };
}

const states = async (did) => Object.fromEntries((await as(did).history()).map((d) => [`${d.action}:${d.subject_did}`, d.state]));
const itemsIn = (repo) => [...pds.records.entries()].filter(([k]) => k.startsWith(`${repo}/app.bsky.graph.listitem/`)).map(([, v]) => v.subject).sort();

beforeEach(async () => {
  await t.query(`TRUNCATE defense_decision, defense_job, defense_pace, defense_plan_row, defense_plan, defense_protected, defense_list CASCADE`);
  pds = fakePds();
  clock = createTidClock();
  now = Date.now();
});

describe('a pass of the run route', () => {
  it('writes nothing unless DEFENSE_WRITES is on', async () => {
    await approved(MIRA, ['did:plc:a']);
    expect(await pass({}, {})).toMatchObject({ ran: false });
    expect(await pass({}, { DEFENSE_WRITES: 'yes' })).toMatchObject({ ran: false });
    expect(pds.calls).toEqual([]);
  });

  it('adds the approved, under keys chosen first, and finishes the job', async () => {
    const { list } = await approved(MIRA, ['did:plc:a', 'did:plc:b']);
    const out = await pass();
    expect(out).toMatchObject({ ran: true, jobs: 1, written: 2 });
    expect(pds.calls).toEqual([['applyWrites', MIRA, 2]]);
    expect(itemsIn(MIRA)).toEqual(['did:plc:a', 'did:plc:b']);
    const [value] = [...pds.records.values()];
    expect(value).toMatchObject({ $type: 'app.bsky.graph.listitem', list: list.uri });
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'done', 'add:did:plc:b': 'done' });
    // Nothing left: the next pass finds no job.
    await afterTheGap();
    expect((await pass()).jobs).toBe(0);
  });

  it('never writes anyone followed since the plan was made, kept by hand, or the owner', async () => {
    await approved(MIRA, ['did:plc:a', 'did:plc:friend', 'did:plc:sister']);
    // Kept after approving: the veto at the write still catches it.
    await as(MIRA).keep('did:plc:sister', 'my sister');
    const out = await pass({ fetchImpl: fakeAppview({ follows: new Set(['did:plc:friend']) }) });
    expect(out).toMatchObject({ written: 1, vetoed: 2 });
    expect(itemsIn(MIRA)).toEqual(['did:plc:a']);
    const history = await as(MIRA).history();
    expect(history.find((d) => d.subject_did === 'did:plc:friend')).toMatchObject({ state: 'vetoed', reason: 'you follow them' });
    expect(history.find((d) => d.subject_did === 'did:plc:sister')).toMatchObject({ state: 'vetoed', reason: 'my sister' });
  });

  it('writes nothing when the veto can’t be read, and tries again later', async () => {
    await approved(MIRA, ['did:plc:a']);
    const out = await pass({ fetchImpl: fakeAppview({ down: true }) });
    expect(out.held).toHaveLength(1);
    expect(pds.calls).toEqual([]);
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'queued' });
    const [summary] = await as(MIRA).lists();
    expect(summary.last_error).toMatch(/so nothing was written/);
  });

  it('holds the job for an hour when the PDS rate-limits, with nothing lost', async () => {
    await approved(MIRA, ['did:plc:a', 'did:plc:b']);
    pds.plan.applyWrites.push(pds.xrpc(429, 'RateLimitExceeded', 'Rate Limit Exceeded'));
    await pass();
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'queued', 'add:did:plc:b': 'queued' });
    const [summary] = await as(MIRA).lists();
    expect(new Date(summary.held_until).getTime()).toBeGreaterThanOrEqual(now + RATE_LIMIT_HOLD_MS - 60_000);
  });

  it('finds what a lost reply wrote, and adds nobody twice', async () => {
    await approved(MIRA, ['did:plc:a', 'did:plc:b']);
    // The PDS commits, then the connection drops.
    const realApply = pds.Agent.prototype;
    let committedOnce = false;
    const Lossy = class extends pds.Agent {
      constructor(s) {
        super(s);
        const apply = this.com.atproto.repo.applyWrites;
        this.com.atproto.repo.applyWrites = async (input) => {
          const res = await apply(input);
          if (!committedOnce) {
            committedOnce = true;
            throw Object.assign(new Error('socket hang up'), { status: 0 });
          }
          return res;
        };
      }
    };
    expect(realApply).toBeTruthy();
    await pass({ Agent: Lossy });
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'sent', 'add:did:plc:b': 'sent' });
    expect(itemsIn(MIRA)).toEqual(['did:plc:a', 'did:plc:b']);
    await afterTheGap();
    const out = await pass();
    expect(out.written).toBe(2);
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'done', 'add:did:plc:b': 'done' });
    // Read by key, not written again.
    expect(pds.calls.filter(([m]) => m === 'getRecord')).toHaveLength(2);
    expect(itemsIn(MIRA)).toEqual(['did:plc:a', 'did:plc:b']);
  });

  it('tries a refused batch an item at a time, so one bad item holds back nobody else', async () => {
    await approved(MIRA, ['did:plc:a', 'did:plc:b', 'did:plc:c']);
    pds.plan.applyWrites.push(pds.xrpc(400, 'InvalidRequest', 'Invalid record'));
    pds.plan.createRecord.push(undefined, pds.xrpc(400, 'InvalidRequest', 'Invalid subject'));
    const out = await pass();
    expect(out).toMatchObject({ written: 2, failed: 1 });
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'done', 'add:did:plc:b': 'failed', 'add:did:plc:c': 'done' });
  });

  it('holds the job when the sign-in can’t write lists, or the holder is signed out', async () => {
    await approved(MIRA, ['did:plc:a']);
    pds.plan.applyWrites.push(pds.xrpc(403, 'ScopeMissingError', 'Missing required scope "repo:app.bsky.graph.listitem?action=create"'));
    await pass();
    expect((await as(MIRA).lists())[0].last_error).toMatch(/Sign in again/);
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'queued' });

    await afterTheGap();
    const out = await pass({ restore: async () => null });
    expect(out.held[0].why).toMatch(/isn’t signed in/);
    const [summary] = await as(MIRA).lists();
    expect(new Date(summary.held_until).getTime()).toBeGreaterThanOrEqual(now + SIGNED_OUT_HOLD_MS - 60_000);
  });

  it('removes on undo by the key the add wrote, and an item already gone is fine', async () => {
    const { planId } = await approved(MIRA, ['did:plc:a', 'did:plc:b']);
    await pass();
    expect(itemsIn(MIRA)).toEqual(['did:plc:a', 'did:plc:b']);
    // Someone removed b in their client meanwhile.
    for (const [k, v] of pds.records) if (v.subject === 'did:plc:b') pds.records.delete(k);
    await as(MIRA).undo({ planId, note: 'wrong post' });
    await afterTheGap();
    const out = await pass();
    expect(out).toMatchObject({ written: 1, already: 1 });
    expect(itemsIn(MIRA)).toEqual([]);
    const history = await as(MIRA).history();
    expect(history.filter((d) => d.action === 'add').every((d) => d.undone_at)).toBe(true);
  });

  it('paces each holder, and keeps one owner’s writes in their own repo', async () => {
    await approved(MIRA, ['did:plc:a']);
    await approved(LAB, ['did:plc:x']);
    const out = await pass();
    expect(out.jobs).toBe(2);
    expect(itemsIn(MIRA)).toEqual(['did:plc:a']);
    expect(itemsIn(LAB)).toEqual(['did:plc:x']);
    // A second list of Mira's waits for her gap.
    await approved(MIRA, ['did:plc:b'], { name: 'Second' });
    expect((await pass()).jobs).toBe(0);
  });
});

describe('a list Virga may write to', () => {
  const job = { owner_did: MIRA, holder_did: MIRA, list_mode: 'own', list_uri: `at://${MIRA}/app.bsky.graph.list/3kx` };

  it('is a record in its holder’s repo, held by the owner when it is their own', () => {
    expect(listIsSound(job)).toBe(true);
    expect(listIsSound({ ...job, list_uri: `at://${LAB}/app.bsky.graph.list/3kx` })).toBe(false);
    expect(listIsSound({ ...job, holder_did: LAB, list_uri: `at://${LAB}/app.bsky.graph.list/3kx` })).toBe(false);
    expect(listIsSound({ ...job, holder_did: LAB, list_mode: 'helper', list_uri: `at://${LAB}/app.bsky.graph.list/3kx` })).toBe(true);
    expect(listIsSound({ ...job, list_uri: `at://${MIRA}/app.bsky.feed.post/3kx` })).toBe(false);
    expect(listIsSound({ ...job, list_uri: `at://${MIRA}/app.bsky.graph.list/3kx/../x` })).toBe(false);
    expect(listIsSound({ ...job, list_mode: 'held' })).toBe(false);
    expect(listIsSound(null)).toBe(false);
  });
});

// The phase 3 review's cases (docs/DEFENSE.md, "Phase 3, reviewed"). Each
// starts from a reply the PDS committed and never sent back, which leaves
// decisions `sent`, and holds what must happen next.
describe('after a lost reply', () => {
  /** An agent whose first applyWrites commits and then loses its reply. */
  const lossy = () => {
    let lost = 0;
    return class extends pds.Agent {
      constructor(s) {
        super(s);
        const apply = this.com.atproto.repo.applyWrites;
        this.com.atproto.repo.applyWrites = async (input) => {
          const res = await apply(input);
          if (lost++ === 0) throw Object.assign(new Error('socket hang up'), { status: 0 });
          return res;
        };
      }
    };
  };
  /** Time passing as it does: every due time moves back a gap, keeping their order. */
  const later = () =>
    Promise.all([
      t.query(`UPDATE defense_pace SET next_at = next_at - INTERVAL '125 seconds'`),
      t.query(`UPDATE defense_job SET next_at = next_at - INTERVAL '125 seconds' WHERE state = 'pending'`),
    ]);

  it('an undo can’t be overtaken by the add it takes back', async () => {
    const { planId } = await approved(MIRA, ['did:plc:a']);
    await pass({ Agent: lossy() });
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'sent' });
    expect(await as(MIRA).undo({ planId })).toMatchObject({ queued: 1 });
    for (let i = 0; i < 4; i += 1) {
      await later();
      await pass();
    }
    // Off the list, and the record says so: added, then taken off.
    expect(itemsIn(MIRA)).toEqual([]);
    const h = await as(MIRA).history();
    expect(h.find((d) => d.action === 'add')).toMatchObject({ state: 'done', undone_at: expect.any(String) });
    expect(h.find((d) => d.action === 'remove')).toMatchObject({ state: 'done' });
    // Nothing waits, and nobody is put back.
    expect((await as(MIRA).lists())[0]).toMatchObject({ listed: 0, waiting: 0 });
  });

  it('an undo of an add that never landed cancels it, and never writes it', async () => {
    const { planId } = await approved(MIRA, ['did:plc:a']);
    // Refused with no answer at all: nothing was committed, but nobody knows that yet.
    pds.plan.applyWrites.push(Object.assign(new Error('socket hang up'), { status: 0 }));
    await pass();
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'sent' });
    await as(MIRA).undo({ planId });
    for (let i = 0; i < 3; i += 1) {
      await later();
      await pass();
    }
    expect(itemsIn(MIRA)).toEqual([]);
    expect(pds.calls.filter(([m]) => m === 'applyWrites' || m === 'createRecord')).toHaveLength(1);
    const add = (await as(MIRA).history()).find((d) => d.action === 'add');
    expect(add).toMatchObject({ state: 'cancelled', undone_at: expect.any(String) });
  });

  it('someone found on the list who is kept off now is taken off again, and the record says why', async () => {
    await approved(MIRA, ['did:plc:friend', 'did:plc:sister', 'did:plc:stranger']);
    await pass({ Agent: lossy() });
    expect(itemsIn(MIRA)).toEqual(['did:plc:friend', 'did:plc:sister', 'did:plc:stranger']);
    await as(MIRA).keep('did:plc:sister', 'my sister');
    await afterTheGap();
    await pass({ fetchImpl: fakeAppview({ follows: new Set(['did:plc:friend']) }) });
    for (let i = 0; i < 2; i += 1) {
      await later();
      await pass({ fetchImpl: fakeAppview({ follows: new Set(['did:plc:friend']) }) });
    }
    expect(itemsIn(MIRA)).toEqual(['did:plc:stranger']);
    const h = await as(MIRA).history();
    const removal = (did) => h.find((d) => d.action === 'remove' && d.subject_did === did);
    expect(removal('did:plc:friend')).toMatchObject({ state: 'done', note: 'Taken off at the write: you follow them.' });
    expect(removal('did:plc:sister')).toMatchObject({ state: 'done', note: 'Taken off at the write: my sister.' });
    expect(h.find((d) => d.action === 'add' && d.subject_did === 'did:plc:stranger')).toMatchObject({ state: 'done', undone_at: null });
  });

  it('a veto that can’t be read leaves a sent batch as it was, and the next pass finds what landed', async () => {
    await approved(MIRA, ['did:plc:a']);
    await pass({ Agent: lossy() });
    await afterTheGap();
    await pass({ fetchImpl: fakeAppview({ down: true }) });
    // Not sent back to the queue: it may well be on the list.
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'sent' });
    await afterTheGap();
    await pass();
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'done' });
    expect(itemsIn(MIRA)).toEqual(['did:plc:a']);
  });

  it('a signed-out holder leaves a sent batch as it was', async () => {
    await approved(MIRA, ['did:plc:a']);
    await pass({ Agent: lossy() });
    await afterTheGap();
    await pass({ restore: async () => null });
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'sent' });
    await afterTheGap();
    await pass();
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'done' });
  });

  it('reads a key the PDS says is taken, and counts what is there as written', async () => {
    const { jobId } = await approved(MIRA, ['did:plc:a', 'did:plc:b']);
    // As if an earlier write landed under a's key and its decision went back to the queue.
    const [a] = await as(MIRA).markSent(jobId, [(await as(MIRA).history()).find((d) => d.subject_did === 'did:plc:a').id], [clock()]);
    pds.records.set(`${MIRA}/app.bsky.graph.listitem/${a.rkey}`, { $type: 'app.bsky.graph.listitem', subject: 'did:plc:a', list: (await as(MIRA).lists())[0].uri });
    await t.query(`UPDATE defense_decision SET state = 'queued', sent_at = NULL WHERE id = $1`, [a.id]);
    await pass();
    expect(await states(MIRA)).toEqual({ 'add:did:plc:a': 'done', 'add:did:plc:b': 'done' });
    expect(itemsIn(MIRA)).toEqual(['did:plc:a', 'did:plc:b']);
  });
});

describe('a rate limit', () => {
  it('holds every list of the holder, not only the one that met it', async () => {
    await approved(MIRA, ['did:plc:a'], { name: 'One' });
    await approved(MIRA, ['did:plc:b'], { name: 'Two' });
    pds.plan.applyWrites.push(pds.xrpc(429, 'RateLimitExceeded', 'Rate Limit Exceeded'));
    await pass();
    await t.query(`UPDATE defense_job SET next_at = NOW() - INTERVAL '1 second' WHERE state = 'pending' AND last_error IS NULL`);
    // The other list's job is due, but its holder waits out the hour.
    expect(await claimJobs({ client: t.supabase })).toEqual([]);
    const { rows } = await t.query(`SELECT next_at FROM defense_pace WHERE holder_did = $1`, [MIRA]);
    expect(new Date(rows[0].next_at).getTime()).toBeGreaterThan(Date.now() + RATE_LIMIT_HOLD_MS - 120_000);
  });
});
