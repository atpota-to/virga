// Phase 4's tables and functions on PGlite: linking, the list the moderator
// adds to, one named add, plans by code, and the lease the DM passes share.
// The tenancy block holds two owners in one database, as phase 3's does.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../test/pglite.js';
import { storeFor } from './store.js';
import { hashLinkCode, hashSender } from './linking.js';
import { dmState } from './dm/state.js';

const MIRA = 'did:plc:mira';
const LAB = 'did:plc:lab';
const STRANGER = 'did:plc:stranger';
const SOON = () => new Date(Date.now() + 15 * 60_000);

let t;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.close?.();
});

async function reset() {
  await t.query(`TRUNCATE defense_link, defense_dm_state, defense_dm_stranger, defense_decision, defense_job, defense_pace, defense_plan_row, defense_plan, defense_protected, defense_list CASCADE`);
}

const as = (did) => storeFor(did, { client: t.supabase });
const listFor = (did, name = 'Pile-on') =>
  as(did).addList({ holderDid: did, mode: 'own', uri: `at://${did}/app.bsky.graph.list/${name.toLowerCase().replace(/\W/g, '')}`, name, purpose: 'block' });

describe('linking', () => {
  beforeEach(reset);

  it('links the account that made the code, with that code', async () => {
    await as(MIRA).linkCode(hashLinkCode(MIRA, 'ABCDEFGH'), SOON());
    expect(await as(MIRA).link()).toMatchObject({ linked_at: null, code_expires_at: expect.any(String) });
    expect(await as(MIRA).claimLink(hashLinkCode(MIRA, 'abcd-efgh'))).toBe('linked');
    expect(await as(MIRA).link()).toMatchObject({ linked_at: expect.any(String), code_expires_at: null });
    // Spent: sending it again finds nothing waiting.
    expect(await as(MIRA).claimLink(hashLinkCode(MIRA, 'ABCDEFGH'))).toBe('none');
  });

  it('links nobody else with the same code', async () => {
    await as(MIRA).linkCode(hashLinkCode(MIRA, 'ABCDEFGH'), SOON());
    // Lab sends Mira's code: as Lab, it's a hash of Lab's DID, and Lab has no code.
    expect(await as(LAB).claimLink(hashLinkCode(LAB, 'ABCDEFGH'))).toBe('none');
    // Even had Lab got hold of the stored hash itself, it names Mira's row only.
    expect(await as(LAB).claimLink(hashLinkCode(MIRA, 'ABCDEFGH'))).toBe('none');
    expect(await as(LAB).link()).toBeNull();
    expect((await as(MIRA).link()).linked_at).toBeNull();
  });

  it('spends a code at the fifth wrong try', async () => {
    await as(MIRA).linkCode(hashLinkCode(MIRA, 'ABCDEFGH'), SOON());
    for (let i = 0; i < 4; i += 1) expect(await as(MIRA).claimLink(hashLinkCode(MIRA, `WRONG00${i}`))).toBe('wrong');
    expect(await as(MIRA).claimLink(hashLinkCode(MIRA, 'WRONG004'))).toBe('wrong');
    expect(await as(MIRA).claimLink(hashLinkCode(MIRA, 'ABCDEFGH'))).toBe('none');
  });

  it('spends a code that has expired', async () => {
    await as(MIRA).linkCode(hashLinkCode(MIRA, 'ABCDEFGH'), new Date(Date.now() - 1000));
    expect(await as(MIRA).claimLink(hashLinkCode(MIRA, 'ABCDEFGH'))).toBe('expired');
    expect(await as(MIRA).claimLink(hashLinkCode(MIRA, 'ABCDEFGH'))).toBe('none');
  });

  it('keeps a link when a new code is made, and drops it on unlink', async () => {
    await as(MIRA).linkCode(hashLinkCode(MIRA, 'ABCDEFGH'), SOON());
    await as(MIRA).claimLink(hashLinkCode(MIRA, 'ABCDEFGH'));
    await as(MIRA).linkCode(hashLinkCode(MIRA, 'HGFEDCBA'), SOON());
    expect((await as(MIRA).link()).linked_at).not.toBeNull();
    await as(MIRA).unlink();
    expect(await as(MIRA).link()).toMatchObject({ linked_at: null, code_expires_at: null });
  });

  it('adds to one of the owner’s own lists only', async () => {
    const mine = await listFor(MIRA);
    const theirs = await listFor(LAB, 'Lab');
    expect(await as(MIRA).setLinkList(theirs.id)).toBe(false);
    expect(await as(MIRA).setLinkList(mine.id)).toBe(true);
    expect((await as(MIRA).link()).list_id).toBe(mine.id);
    // A list stopped being kept can't be chosen, and clearing is allowed.
    await as(MIRA).removeList(mine.id);
    expect(await as(MIRA).setLinkList(mine.id)).toBe(false);
    expect(await as(MIRA).setLinkList(null)).toBe(true);
  });
});

describe('one account, named', () => {
  beforeEach(reset);

  it('queues an add with no band, once', async () => {
    const list = await listFor(MIRA);
    const out = await as(MIRA).addNamed(list.id, STRANGER, { note: 'block @stranger.test' });
    expect(out).toMatchObject({ outcome: 'queued', job_id: expect.any(String), decision_id: expect.any(Number) });
    const [d] = await as(MIRA).history();
    expect(d).toMatchObject({ subject_did: STRANGER, action: 'add', band: null, via: 'dm', state: 'queued', note: 'block @stranger.test' });
    expect((await as(MIRA).addNamed(list.id, STRANGER)).outcome).toBe('already');
    expect(await as(MIRA).liveAdds(STRANGER)).toHaveLength(1);
    expect(await as(MIRA).lastAdd()).toMatchObject({ subject_did: STRANGER });
  });

  it('refuses the owner, anyone kept by hand, and another owner’s list', async () => {
    const list = await listFor(MIRA);
    const theirs = await listFor(LAB, 'Lab');
    expect((await as(MIRA).addNamed(list.id, MIRA)).outcome).toBe('self');
    await as(MIRA).keep(STRANGER, 'my sister');
    expect((await as(MIRA).addNamed(list.id, STRANGER)).outcome).toBe('kept');
    expect((await as(MIRA).addNamed(theirs.id, 'did:plc:other')).outcome).toBe('list');
    expect(await as(LAB).history()).toEqual([]);
  });

  it('is undone like any other add', async () => {
    const list = await listFor(MIRA);
    const out = await as(MIRA).addNamed(list.id, STRANGER);
    expect(await as(MIRA).undo({ ids: [out.decision_id], via: 'dm' })).toMatchObject({ cancelled: 1 });
    expect(await as(MIRA).liveAdds(STRANGER)).toEqual([]);
    expect(await as(MIRA).lastAdd()).toBeNull();
  });
});

describe('plans by code', () => {
  beforeEach(reset);

  it('finds the owner’s plan by the start of its id, and only theirs', async () => {
    const list = await listFor(MIRA);
    const id = await as(MIRA).createPlan({ listId: list.id, rows: [{ did: STRANGER, band: 'UNKNOWN', trust: 3 }] });
    const code = id.replace(/-/g, '').slice(0, 8);
    expect((await as(MIRA).plansByCode(code)).map((p) => p.id)).toEqual([id]);
    expect(await as(LAB).plansByCode(code)).toEqual([]);
    expect(await as(MIRA).plansByCode('nothex!!')).toEqual([]);
    expect(await as(MIRA).planRows(id)).toEqual([{ did: STRANGER, band: 'UNKNOWN', trust: 3 }]);
    expect(await as(LAB).planRows(id)).toEqual([]);
  });

  it('cancels a plan nothing was approved from, and nobody else’s', async () => {
    const list = await listFor(MIRA);
    const id = await as(MIRA).createPlan({ listId: list.id, rows: [{ did: STRANGER, band: 'UNKNOWN', trust: 3 }] });
    expect(await as(LAB).cancelPlan(id)).toBe(false);
    expect(await as(MIRA).plan(id)).not.toBeNull();
    const approved = await as(MIRA).createPlan({ listId: list.id, rows: [{ did: 'did:plc:b', band: 'UNKNOWN', trust: 3 }] });
    await as(MIRA).approvePlan(approved, { bands: ['UNKNOWN'] });
    expect(await as(MIRA).cancelPlan(approved)).toBe(false);
    expect(await as(MIRA).cancelPlan(id)).toBe(true);
    expect(await as(MIRA).plan(id)).toBeNull();
  });
});

describe('the passes’ lease', () => {
  beforeEach(reset);
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';
  const state = () => dmState({ client: t.supabase });

  it('is held by one pass at a time', async () => {
    expect(await state().lease(A, 60)).toMatchObject({ log_cursor: null, seeded: false, session: null });
    expect(await state().lease(B, 60)).toBeNull();
    // The holder may renew it.
    expect(await state().lease(A, 60)).not.toBeNull();
    await state().release(A);
    expect(await state().lease(B, 60)).not.toBeNull();
  });

  it('moves the cursor and keeps the session only for the holder', async () => {
    await state().lease(A, 60);
    expect(await state().advance(A, 'rev-1')).toBe(true);
    expect(await state().advance(B, 'rev-x')).toBe(false);
    expect(await state().saveSession(A, 'v1:sealed', 'did:plc:moderator')).toBe(true);
    expect(await state().saveSession(B, 'v1:other', 'did:plc:other')).toBe(false);
    await state().release(A);
    expect(await state().lease(B, 60)).toMatchObject({ log_cursor: 'rev-1', seeded: true, session: 'v1:sealed', session_did: 'did:plc:moderator' });
  });

  it('passes to the next once it lapses', async () => {
    await state().lease(A, 60);
    await t.query(`UPDATE defense_dm_state SET lease_until = NOW() - INTERVAL '1 second'`);
    expect(await state().advance(A, 'rev-2')).toBe(false);
    expect(await state().lease(B, 60)).not.toBeNull();
  });

  it('answers a stranger at most once a day', async () => {
    const h = hashSender(STRANGER);
    expect(await state().strangerDue(h)).toBe(true);
    expect(await state().strangerDue(h)).toBe(false);
    await t.query(`UPDATE defense_dm_stranger SET answered_at = NOW() - INTERVAL '25 hours'`);
    expect(await state().strangerDue(h)).toBe(true);
    // Nobody's DID is kept: only its hash.
    const { rows } = await t.query(`SELECT sender_hash FROM defense_dm_stranger`);
    expect(rows.map((r) => r.sender_hash)).toEqual([h]);
  });
});

describe('tenancy', () => {
  beforeEach(reset);

  it('nothing Lab does as Lab moves Mira’s link, lists or adds', async () => {
    const mira = await listFor(MIRA);
    await as(MIRA).linkCode(hashLinkCode(MIRA, 'ABCDEFGH'), SOON());
    await as(MIRA).claimLink(hashLinkCode(MIRA, 'ABCDEFGH'));
    await as(MIRA).setLinkList(mira.id);
    const add = await as(MIRA).addNamed(mira.id, STRANGER);
    const before = await t.query(`SELECT * FROM defense_link WHERE owner_did = $1`, [MIRA]);

    await as(LAB).unlink();
    await as(LAB).setLinkList(mira.id);
    await as(LAB).addNamed(mira.id, 'did:plc:victim');
    await as(LAB).undo({ ids: [add.decision_id], via: 'dm' });
    await as(LAB).linkCode(hashLinkCode(LAB, 'ZZZZZZZZ'), SOON());

    const after = await t.query(`SELECT * FROM defense_link WHERE owner_did = $1`, [MIRA]);
    expect(after.rows).toEqual(before.rows);
    expect(await as(MIRA).liveAdds(STRANGER)).toHaveLength(1);
    expect((await as(MIRA).history()).map((d) => d.subject_did)).toEqual([STRANGER]);
  });
});
