// Defense's fixtures: the crowd on Mira's posts, the relationships, and the
// signed-in getProfiles with its known-followers counts, read by the real
// scan (src/defense/) the way it reads the network. As with world.test.js,
// these hold the fixtures to the code, not the code's own behaviour.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRouter } from './fakeNetwork.js';
import { createFakeAgent } from './fakeXrpc.js';
import { withDefense } from './harness.js';
import { LAB, ME, buildWorld } from './world.js';
import { DEFENSE_SCOPE, OAUTH_SCOPE } from '../src/config.js';
import { harvestPost } from '../src/defense/harvest.js';
import { canaryCandidates, runScan, signedInProfiles } from '../src/defense/scan.js';
import { followFromRecord } from '../src/lib/analyticsSync.js';

const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const mira = buildWorld({ now: NOW });
const lab = buildWorld({ now: NOW, account: LAB });
const worlds = [mira, lab];
const route = createRouter(worlds);
const NO_WAIT = [0, 0];

/** The real code's fetch, answered by the fake network. */
function useFakeFetch() {
  vi.stubGlobal('fetch', async (input, init) => {
    const answer = await route(typeof input === 'string' ? input : input.url, init);
    if (!answer) throw new TypeError(`no fixture for ${input}`);
    return answer;
  });
}

afterEach(() => vi.unstubAllGlobals());

/** Mira's post with the most replies and quotes. */
const loudest = [...mira.posts].sort((a, b) => b.replies + b.quotes - (a.replies + a.quotes))[0];
const LOUD_URI = `at://${ME.did}/app.bsky.feed.post/${loudest.rkey}`;

/** What the archive would hold for Mira: her follows, followers and who engages. */
const archive = {
  following: mira.follows.map(followFromRecord),
  followers: mira.followers.map((f) => ({ did: f.did })),
  inbound: mira.notifications.map((n) => ({ did: n.author.did })),
};

describe('the crowd on a post', () => {
  it('is read by the real harvest, every kind, as many as the post’s counts', async () => {
    useFakeFetch();
    const h = await harvestPost(LOUD_URI);
    expect(h.truncated).toBe(false);
    const kinds = h.totals.engagements;
    expect(kinds.reply).toBe(Math.min(320, loudest.replies));
    expect(kinds.like).toBeGreaterThan(0);
    expect(h.participants.every((p) => p.did.startsWith('did:plc:'))).toBe(true);
    // The same post meets the same crowd.
    const again = await harvestPost(LOUD_URI);
    expect(again.participants.map((p) => p.did)).toEqual(h.participants.map((p) => p.did));
  });

  it('is nobody on a post that isn’t one of the accounts’ own', async () => {
    useFakeFetch();
    const h = await harvestPost(`at://${mira.cast[0].did}/app.bsky.feed.post/3kzzzzzzzzzzz`);
    expect(h.participants).toEqual([]);
  });

  it('says who Mira follows and who follows her, without a session', async () => {
    const followed = mira.follows[0].value.subject;
    const fan = mira.followers.find((f) => f.did.includes('fan')).did;
    const params = new URLSearchParams({ actor: ME.did });
    for (const d of [followed, fan, 'did:plc:virgaharnesscrowd00001']) params.append('others', d);
    const body = await (await route(`https://public.api.bsky.app/xrpc/app.bsky.graph.getRelationships?${params}`)).json();
    const by = Object.fromEntries(body.relationships.map((r) => [r.did, r]));
    expect(by[followed].following).toBeTruthy();
    expect(by[fan].followedBy).toBeTruthy();
    expect(by[fan].following).toBeUndefined();
    expect(by['did:plc:virgaharnesscrowd00001'].following).toBeUndefined();
  });
});

describe('the signed-in getProfiles', () => {
  const canary = canaryCandidates(archive, { ownerDid: ME.did })[0];

  it('needs Defense’s permission', async () => {
    const without = createFakeAgent(mira, { worlds, scope: OAUTH_SCOPE });
    await expect(signedInProfiles(without)([canary])).rejects.toMatchObject({ status: 403 });
    const withIt = createFakeAgent(mira, { worlds, scope: DEFENSE_SCOPE });
    expect(await signedInProfiles(withIt)([canary])).toHaveLength(1);
  });

  it('counts known followers as the asker sees them', async () => {
    const asMira = signedInProfiles(createFakeAgent(mira, { worlds, scope: DEFENSE_SCOPE }));
    const asLab = signedInProfiles(createFakeAgent(lab, { worlds, scope: DEFENSE_SCOPE }));
    const [m] = await asMira([canary]);
    expect(m.viewer.knownFollowers.count).toBeGreaterThan(0);
    expect(m.viewer.following).toBeTruthy();
    const counted = 'did:plc:virgaharnesscrowd00007';
    expect((await asMira([counted]))[0].viewer.knownFollowers.count).toBeGreaterThanOrEqual(3);
    expect((await asLab([counted]))[0].viewer.knownFollowers).toBeUndefined();
  });

  it('leaves the counts off when the AppView fails open, every time or the first time', async () => {
    const open = signedInProfiles(createFakeAgent(mira, { worlds, scope: DEFENSE_SCOPE, appview: 'failopen' }));
    expect((await open([canary]))[0].viewer.knownFollowers).toBeUndefined();
    expect((await open([canary]))[0].viewer.knownFollowers).toBeUndefined();
    const flaky = signedInProfiles(createFakeAgent(mira, { worlds, scope: DEFENSE_SCOPE, appview: 'flaky' }));
    expect((await flaky([canary]))[0].viewer.knownFollowers).toBeUndefined();
    expect((await flaky([canary]))[0].viewer.knownFollowers.count).toBeGreaterThan(0);
  });

  it('turns down more than 25 at once', async () => {
    const asMira = signedInProfiles(createFakeAgent(mira, { worlds, scope: DEFENSE_SCOPE }));
    const many = Array.from({ length: 26 }, (_, i) => `did:plc:virgaharnesscrowd${String(i).padStart(5, '0')}`);
    await expect(asMira(many)).rejects.toMatchObject({ status: 400 });
  });

  it('follows a grant that changes, as turning Defense on does', async () => {
    let scope = OAUTH_SCOPE;
    const agent = createFakeAgent(mira, { worlds, scope: () => scope });
    await expect(signedInProfiles(agent)([canary])).rejects.toMatchObject({ status: 403 });
    scope = withDefense(scope, true);
    expect(scope).toBe(DEFENSE_SCOPE);
    expect(await signedInProfiles(agent)([canary])).toHaveLength(1);
    expect(withDefense(DEFENSE_SCOPE, false)).toBe(OAUTH_SCOPE);
  });
});

describe('a scan against the fixtures', () => {
  const scan = (appview) =>
    runScan({
      input: `https://bsky.app/profile/${ME.did}/post/${loudest.rkey}`,
      ownerDid: ME.did,
      getProfiles: signedInProfiles(createFakeAgent(mira, { worlds, scope: DEFENSE_SCOPE, appview })),
      candidates: canaryCandidates(archive, { ownerDid: ME.did }),
      retryDelaysMs: NO_WAIT,
    });

  it('finds every band, with a few near Mira and most of the crowd strangers', async () => {
    useFakeFetch();
    const result = await scan('ok');
    expect(result.vouchCheck).toBe('canary');
    expect(result.canary).toBeTruthy();
    const { byBand } = result.totals;
    for (const band of ['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN']) expect(byBand[band], band).toBeGreaterThan(0);
    expect(byBand.UNKNOWN).toBeGreaterThan(result.requiresReview.length);
    // Everyone Mira follows is protected, whatever else is true of them.
    const follows = new Set(archive.following.map((f) => f.did));
    for (const row of result.rows) if (follows.has(row.did)) expect(row.band).toBe('PROTECTED');
    expect(result.rows.some((r) => r.blocksYou)).toBe(true);
  });

  it('gets there when the AppView misses every other time', async () => {
    useFakeFetch();
    const result = await scan('flaky');
    expect(result.vouchCheck).toBe('canary');
    expect(result.totals.byBand.CONNECTED).toBeGreaterThan(0);
  });

  it('scores nobody when the AppView always fails open, rather than calling them strangers', async () => {
    useFakeFetch();
    // Mira follows dozens of people who follow her back: no canary among them
    // means the counts are missing, not that nobody is connected.
    await expect(scan('failopen')).rejects.toMatchObject({ name: 'ScanError', code: 'vouches' });
  });

  it('never calls someone who follows Mira a stranger', async () => {
    useFakeFetch();
    const result = await scan('ok');
    const fans = new Set(mira.followers.map((f) => f.did));
    for (const row of result.rows) if (fans.has(row.did)) expect(row.band, row.did).not.toBe('UNKNOWN');
  });
});
