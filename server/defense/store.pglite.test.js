// Defense's tables and functions, on PGlite with every migration applied, and
// the store that is the only way the server reaches them. The last block is
// the tenancy rule (docs/DEFENSE-THREATS.md, rule 4): two owners in one
// database, and nothing done as one moves the other's rows.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../test/pglite.js';
import { claimJobs, storeFor } from './store.js';

const MIRA = 'did:plc:mira';
const LAB = 'did:plc:lab';
const tid = (n) => `3l${String(n).padStart(11, '2').replace(/[^2-7a-z]/g, '2')}`;
const RKEYS = ['3lkaaaaaaaaa2', '3lkaaaaaaaaa3', '3lkaaaaaaaaa4', '3lkaaaaaaaaa5', '3lkaaaaaaaaa6', '3lkaaaaaaaaa7'];

let t;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.close?.();
});

async function reset() {
  await t.query(`TRUNCATE defense_decision, defense_job, defense_pace, defense_plan_row, defense_plan, defense_protected, defense_list CASCADE`);
}

/** A store for `did` over the test database. */
const as = (did) => storeFor(did, { client: t.supabase });

async function listFor(did, name = 'Pile-on') {
  return as(did).addList({ holderDid: did, mode: 'own', uri: `at://${did}/app.bsky.graph.list/${name.toLowerCase().replace(/\W/g, '')}`, name, purpose: 'block' });
}

const rows = (dids, band = 'UNKNOWN') => dids.map((did, i) => ({ did, band, trust: i }));

describe('a list', () => {
  beforeEach(reset);

  it('is kept for its owner, in its holder’s repo', async () => {
    const list = await listFor(MIRA);
    expect(list).toMatchObject({ owner_did: MIRA, holder_did: MIRA, mode: 'own', purpose: 'block' });
    expect((await as(MIRA).lists()).map((l) => l.name)).toEqual(['Pile-on']);
    expect(await as(MIRA).list(list.id)).toMatchObject({ id: list.id });
  });

  it('can’t name a record in another repo, nor be "own" and held by someone else', async () => {
    await expect(as(MIRA).addList({ holderDid: MIRA, mode: 'own', uri: `at://${LAB}/app.bsky.graph.list/x`, name: 'X', purpose: 'block' })).rejects.toThrow();
    await expect(as(MIRA).addList({ holderDid: LAB, mode: 'own', uri: `at://${LAB}/app.bsky.graph.list/x`, name: 'X', purpose: 'block' })).rejects.toThrow();
    await expect(as(MIRA).addList({ holderDid: MIRA, mode: 'own', uri: `at://${MIRA}/app.bsky.feed.post/x`, name: 'X', purpose: 'block' })).rejects.toThrow();
  });

  it('stops being kept when removed', async () => {
    const list = await listFor(MIRA);
    await as(MIRA).removeList(list.id);
    expect(await as(MIRA).lists()).toEqual([]);
    expect(await as(MIRA).list(list.id)).toBeNull();
  });
});

describe('a plan, approved', () => {
  beforeEach(reset);

  it('queues an add for everyone in the approved bands, in one job', async () => {
    const list = await listFor(MIRA);
    const planId = await as(MIRA).createPlan({ listId: list.id, postUri: 'at://did:plc:x/app.bsky.feed.post/1', rows: [...rows(['did:plc:a', 'did:plc:b']), ...rows(['did:plc:n'], 'NOTABLE')] });
    const out = await as(MIRA).approvePlan(planId, { bands: ['UNKNOWN'], note: 'the quote pile-on' });
    expect(out).toMatchObject({ queued: 2, kept: 0, already: 0 });
    expect(out.job_id).toBeTruthy();
    const history = await as(MIRA).history();
    expect(history.map((d) => [d.subject_did, d.action, d.state, d.band, d.note])).toEqual([
      ['did:plc:b', 'add', 'queued', 'UNKNOWN', 'the quote pile-on'],
      ['did:plc:a', 'add', 'queued', 'UNKNOWN', 'the quote pile-on'],
    ]);
    // Something will be written from it, so it is kept.
    expect((await as(MIRA).plan(planId)).expires_at).toBeNull();
  });

  it('leaves out the people kept by hand and anyone already on the list', async () => {
    const list = await listFor(MIRA);
    await as(MIRA).keep('did:plc:sister', 'my sister');
    const first = await as(MIRA).createPlan({ listId: list.id, rows: rows(['did:plc:a']) });
    await as(MIRA).approvePlan(first, { bands: ['UNKNOWN'] });
    const second = await as(MIRA).createPlan({ listId: list.id, rows: rows(['did:plc:a', 'did:plc:sister', 'did:plc:c']) });
    expect(await as(MIRA).approvePlan(second, { bands: ['UNKNOWN'] })).toMatchObject({ queued: 1, kept: 1, already: 1 });
  });

  it('never holds anyone PROTECTED, and never approves a band it couldn’t hold', async () => {
    const list = await listFor(MIRA);
    await expect(as(MIRA).createPlan({ listId: list.id, rows: [{ did: 'did:plc:friend', band: 'PROTECTED', trust: 100 }] })).rejects.toThrow();
    const planId = await as(MIRA).createPlan({ listId: list.id, rows: rows(['did:plc:a']) });
    expect(await as(MIRA).approvePlan(planId, { bands: ['PROTECTED'] })).toMatchObject({ queued: 0, job_id: null });
  });

  it('is refused for a list that isn’t the owner’s, gone or expired', async () => {
    const theirs = await listFor(LAB);
    expect(await as(MIRA).createPlan({ listId: theirs.id, rows: rows(['did:plc:a']) })).toBeNull();
    const mine = await listFor(MIRA);
    const planId = await as(MIRA).createPlan({ listId: mine.id, rows: rows(['did:plc:a']) });
    await t.query(`UPDATE defense_plan SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [planId]);
    expect(await as(MIRA).approvePlan(planId, { bands: ['UNKNOWN'] })).toBeNull();
  });
});

describe('the work', () => {
  beforeEach(reset);

  async function approved(did, dids) {
    const list = await listFor(did);
    const planId = await as(did).createPlan({ listId: list.id, rows: rows(dids) });
    const { job_id: jobId } = await as(did).approvePlan(planId, { bands: ['UNKNOWN'] });
    return { list, planId, jobId };
  }

  it('is claimed a holder at a time, then paced', async () => {
    const { jobId } = await approved(MIRA, ['did:plc:a']);
    const claimed = await claimJobs({ client: t.supabase, gapSeconds: 120 });
    expect(claimed).toEqual([expect.objectContaining({ id: jobId, owner_did: MIRA, holder_did: MIRA, kind: 'add', list_mode: 'own' })]);
    // The holder's gap hasn't passed.
    expect(await claimJobs({ client: t.supabase, gapSeconds: 120 })).toEqual([]);
    await t.query(`UPDATE defense_pace SET next_at = NOW() - INTERVAL '1 second'`);
    await t.query(`UPDATE defense_job SET next_at = NOW() - INTERVAL '1 second'`);
    expect(await claimJobs({ client: t.supabase })).toHaveLength(1);
  });

  it('is sent under record keys chosen first, settled, and finished', async () => {
    const { jobId, list } = await approved(MIRA, ['did:plc:a', 'did:plc:b']);
    const batch = await as(MIRA).jobDecisions(jobId, 50);
    const marked = await as(MIRA).markSent(jobId, batch.map((d) => d.id), RKEYS.slice(0, 2));
    expect(marked.map((d) => [d.state, d.rkey])).toEqual([
      ['sent', RKEYS[0]],
      ['sent', RKEYS[1]],
    ]);
    // A resend keeps the first key.
    const again = await as(MIRA).markSent(jobId, [batch[0].id], [RKEYS[5]]);
    expect(again[0].rkey).toBe(RKEYS[0]);
    expect(await as(MIRA).jobDecisions(jobId, 50)).toHaveLength(2);
    await as(MIRA).settle(jobId, [
      { id: batch[0].id, state: 'done' },
      { id: batch[1].id, state: 'vetoed', reason: 'you follow them' },
    ]);
    const [summary] = await as(MIRA).lists();
    expect(summary).toMatchObject({ id: list.id, listed: 1, waiting: 0 });
    const { rows: jobs } = await t.query(`SELECT state FROM defense_job WHERE id = $1`, [jobId]);
    expect(jobs[0].state).toBe('done');
  });

  it('goes back to wait when the PDS refused it, and is held with a reason', async () => {
    const { jobId } = await approved(MIRA, ['did:plc:a']);
    const [d] = await as(MIRA).jobDecisions(jobId, 50);
    await as(MIRA).markSent(jobId, [d.id], [RKEYS[0]]);
    await as(MIRA).settle(jobId, [{ id: d.id, state: 'queued' }]);
    await as(MIRA).holdJob(jobId, Date.now() + 3_600_000, 'rate limited');
    const [summary] = await as(MIRA).lists();
    expect(summary.waiting).toBe(1);
    expect(summary.last_error).toBe('rate limited');
    expect(new Date(summary.held_until).getTime()).toBeGreaterThan(Date.now() + 3_000_000);
  });

  it('is undone: the unsent cancelled, the written removed under their own keys', async () => {
    const { jobId, planId } = await approved(MIRA, ['did:plc:a', 'did:plc:b']);
    const [a] = await as(MIRA).jobDecisions(jobId, 1);
    await as(MIRA).markSent(jobId, [a.id], [RKEYS[0]]);
    await as(MIRA).settle(jobId, [{ id: a.id, state: 'done' }]);
    const undo = await as(MIRA).undo({ planId, note: 'wrong post' });
    expect(undo).toMatchObject({ cancelled: 1, queued: 1 });
    const removal = (await as(MIRA).jobDecisions(undo.job_id, 50))[0];
    expect(removal).toMatchObject({ action: 'remove', subject_did: 'did:plc:a', rkey: RKEYS[0], undoes: a.id, note: 'wrong post' });
    // Undone twice is still one removal.
    expect(await as(MIRA).undo({ planId })).toMatchObject({ queued: 0 });
    await as(MIRA).markSent(undo.job_id, [removal.id], [RKEYS[0]]);
    await as(MIRA).settle(undo.job_id, [{ id: removal.id, state: 'done' }]);
    const added = (await as(MIRA).history()).find((d) => d.id === a.id);
    expect(added.undone_at).toBeTruthy();
    expect((await as(MIRA).lists())[0].listed).toBe(0);
  });
});

describe('two owners in one database', () => {
  beforeEach(reset);

  async function snapshot(did) {
    const out = {};
    for (const table of ['defense_list', 'defense_protected', 'defense_plan', 'defense_job', 'defense_decision']) {
      const { rows: r } = await t.query(`SELECT * FROM ${table} WHERE owner_did = $1 ORDER BY 1`, [did]);
      out[table] = JSON.stringify(r);
    }
    const { rows: pr } = await t.query(`SELECT r.* FROM defense_plan_row r JOIN defense_plan p ON p.id = r.plan_id WHERE p.owner_did = $1 ORDER BY 1, 2`, [did]);
    out.defense_plan_row = JSON.stringify(pr);
    return out;
  }

  it('leaves one owner’s rows as they were, whatever is done as the other', async () => {
    // Lab's world: a list, a plan, a job half done, someone kept.
    const labList = await listFor(LAB);
    const labPlan = await as(LAB).createPlan({ listId: labList.id, rows: rows(['did:plc:x', 'did:plc:y']) });
    const { job_id: labJob } = await as(LAB).approvePlan(labPlan, { bands: ['UNKNOWN'] });
    const [labFirst] = await as(LAB).jobDecisions(labJob, 1);
    await as(LAB).markSent(labJob, [labFirst.id], [RKEYS[3]]);
    await as(LAB).keep('did:plc:labfriend', 'a friend');
    const before = await snapshot(LAB);

    // Everything Mira can do, aimed at Lab's ids wherever an id is taken.
    const mira = as(MIRA);
    expect(await mira.list(labList.id)).toBeNull();
    expect(await mira.plan(labPlan)).toBeNull();
    expect(await mira.createPlan({ listId: labList.id, rows: rows(['did:plc:z']) })).toBeNull();
    expect(await mira.approvePlan(labPlan, { bands: ['UNKNOWN'] })).toBeNull();
    expect(await mira.markSent(labJob, [labFirst.id], [RKEYS[4]])).toEqual([]);
    expect(await mira.settle(labJob, [{ id: labFirst.id, state: 'done' }])).toBe(0);
    await mira.holdJob(labJob, Date.now() + 9e6, 'not yours');
    expect(await mira.undo({ planId: labPlan, ids: [labFirst.id] })).toMatchObject({ cancelled: 0, queued: 0 });
    expect(await mira.jobDecisions(labJob, 50)).toEqual([]);
    expect(await mira.removeList(labList.id)).toBeNull();
    await mira.unkeep('did:plc:labfriend');
    expect(await mira.history()).toEqual([]);
    expect(await mira.lists()).toEqual([]);
    expect(await mira.kept()).toEqual([]);

    // And Mira's own work goes on beside Lab's without touching it.
    const miraList = await listFor(MIRA);
    const miraPlan = await mira.createPlan({ listId: miraList.id, rows: rows(['did:plc:x']) });
    const { job_id: miraJob } = await mira.approvePlan(miraPlan, { bands: ['UNKNOWN'] });
    const [m] = await mira.jobDecisions(miraJob, 1);
    await mira.markSent(miraJob, [m.id], [RKEYS[0]]);
    await mira.settle(miraJob, [{ id: m.id, state: 'done' }]);
    await mira.undo({ planId: miraPlan });
    await mira.keep('did:plc:x', 'changed my mind');

    expect(await snapshot(LAB)).toEqual(before);
  });

  it('refuses a store without an owner', () => {
    expect(() => storeFor(null, { client: t.supabase })).toThrow();
    expect(() => storeFor('', { client: t.supabase })).toThrow();
    expect(() => storeFor('mira', { client: t.supabase })).toThrow();
    expect(tid(1)).toMatch(/^3l/);
  });
});
