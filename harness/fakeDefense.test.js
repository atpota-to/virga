// The harness's Defense routes (fakeDefense.js), driven by the real client
// (src/defense/defenseService.js) through the real requester, so the fake
// answers what the page sends and in the shapes the real handlers use. The
// real routes are tested on PGlite in server/defense/.

import { describe, expect, it } from 'vitest';
import { SERVER_ORIGIN, createServer, createServerRouter } from './fakeServer.js';
import { withDefense } from './harness.js';
import { listCollection } from './repo.js';
import { LAB, ME, buildWorld } from './world.js';
import { OAUTH_SCOPE } from '../src/config.js';
import { createList, fetchHistory, fetchLists, keepAccount, planAndApprove, undoAdds } from '../src/defense/defenseService.js';
import { createBackendRequester } from '../src/session/backendClient.js';

const NOW = Date.parse('2026-11-18T12:00:00.000Z');

function setup({ level = 'lists', writes = true } = {}) {
  const mira = buildWorld({ now: NOW });
  const lab = buildWorld({ now: NOW, account: LAB });
  for (const w of [mira, lab]) w.scope = withDefense(OAUTH_SCOPE, level);
  const server = createServer({ worlds: [mira, lab], seed: false, defenseWrites: writes, now: () => NOW });
  const route = createServerRouter(server);
  const fetch = (href, init) => route(new URL(href), init);
  const req = (did) => createBackendRequester({ backendUrl: SERVER_ORIGIN, token: server.mintToken(did), did, fetch });
  return { mira, lab, server, req: req(ME.did), labReq: req(LAB.did) };
}

/** Who is on one list, by its items in the world's repo (which holds other lists' items too). */
const items = (world, uri) =>
  listCollection(world, 'app.bsky.graph.listitem')
    .filter((r) => !uri || r.value.list === uri)
    .map((r) => r.value.subject)
    .sort();

describe('Defense in the harness', () => {
  it('makes a list in the account’s repo, approves a plan and writes it on the next tick', async () => {
    const { mira, server, req } = setup();
    const list = await createList(req, { name: 'Pile-ons', purpose: 'block' });
    expect(list).toMatchObject({ name: 'Pile-ons', purpose: 'block', mode: 'own', listed: 0 });
    expect(listCollection(mira, 'app.bsky.graph.list').some((r) => r.value.name === 'Pile-ons')).toBe(true);

    const followed = mira.follows[0].value.subject;
    const out = await planAndApprove(req, {
      listId: list.id,
      postUri: null,
      rows: [
        { did: 'did:plc:virgaharnesscrowd00001', band: 'UNKNOWN', trust: 1 },
        { did: 'did:plc:virgaharnesscrowd00002', band: 'UNKNOWN', trust: 1 },
        // Followed since the scan: the veto at the write keeps them off.
        { did: followed, band: 'UNKNOWN', trust: 1 },
      ],
      bands: ['UNKNOWN'],
      note: 'the quote pile-on',
    });
    expect(out).toMatchObject({ queued: 3, kept: 0, already: 0 });
    expect((await fetchLists(req)).lists[0].waiting).toBe(3);

    await server.runCron();
    expect(items(mira, list.uri)).toEqual(['did:plc:virgaharnesscrowd00001', 'did:plc:virgaharnesscrowd00002']);
    const { decisions, plans } = await fetchHistory(req);
    expect(decisions.find((d) => d.did === followed)).toMatchObject({ state: 'vetoed', reason: 'you follow them' });
    expect(plans[0]).toMatchObject({ note: 'the quote pile-on', bands: ['UNKNOWN'] });
    expect((await fetchLists(req)).lists[0]).toMatchObject({ listed: 2, waiting: 0 });

    await undoAdds(req, { planId: plans[0].id });
    await server.runCron();
    expect(items(mira, list.uri)).toEqual([]);
  });

  it('leaves out the people kept by hand, and keeps one account’s lists from another’s', async () => {
    const { mira, lab, server, req, labReq } = setup();
    const list = await createList(req, { name: 'Pile-ons', purpose: 'mute' });
    await keepAccount(req, 'did:plc:virgaharnesscrowd00003', 'an old friend');
    const out = await planAndApprove(req, { listId: list.id, rows: [{ did: 'did:plc:virgaharnesscrowd00003', band: 'UNKNOWN' }, { did: 'did:plc:virgaharnesscrowd00004', band: 'UNKNOWN' }], bands: ['UNKNOWN'] });
    expect(out).toMatchObject({ queued: 1, kept: 1 });
    await expect(planAndApprove(labReq, { listId: list.id, rows: [{ did: 'did:plc:virgaharnesscrowd00005', band: 'UNKNOWN' }], bands: ['UNKNOWN'] })).rejects.toMatchObject({ status: 404 });
    expect((await fetchLists(labReq)).lists).toEqual([]);
    await server.runCron();
    expect(items(mira, list.uri)).toEqual(['did:plc:virgaharnesscrowd00004']);
    expect(items(lab, list.uri)).toEqual([]);
  });

  it('refuses to make a list without the permission, or while writes are off', async () => {
    await expect(createList(setup({ level: 'scan' }).req, { name: 'X', purpose: 'block' })).rejects.toMatchObject({ code: 'NO_SCOPE' });
    const off = setup({ writes: false });
    expect((await fetchLists(off.req)).writes).toBe(false);
    await expect(createList(off.req, { name: 'X', purpose: 'block' })).rejects.toMatchObject({ code: 'WRITES_OFF' });
  });
});
