import { describe, expect, it, vi } from 'vitest';
import { CANARY_CANDIDATES, CANARY_REQUIRED_AT, ScanError, canaryCandidates, readPostInput, resolvePost, runScan, scanErrorFrom, signedInProfiles } from './scan.js';
import { ScoreError } from './score.js';

const OWNER = 'did:plc:owner';
const AUTHOR = 'did:plc:author';
const CANARY = 'did:plc:canary';
const NO_WAIT = [0, 0];

describe('what was pasted', () => {
  it('reads a bsky.app link, an aturi.to link and an at:// URI', () => {
    expect(readPostInput('https://bsky.app/profile/mira.example.com/post/3abc')).toEqual({ handle: 'mira.example.com', rkey: '3abc' });
    expect(readPostInput(' https://bsky.app/profile/did:plc:abc/post/3abc?x=1 ')).toEqual({ did: 'did:plc:abc', rkey: '3abc' });
    expect(readPostInput('at://did:plc:abc/app.bsky.feed.post/3abc')).toEqual({ did: 'did:plc:abc', rkey: '3abc' });
    expect(readPostInput('https://aturi.to/did:plc:abc/app.bsky.feed.post/3abc')).toEqual({ did: 'did:plc:abc', rkey: '3abc' });
  });

  it('turns down anything that isn’t a post', () => {
    for (const bad of ['', '   ', 'hello', 'https://bsky.app/profile/mira.example.com', 'https://bsky.app/profile/mira.example.com/lists/3abc', 'at://did:plc:abc/app.bsky.feed.like/3abc', 'https://staging.bsky.app/profile/a/post/b', null, 42]) {
      expect(readPostInput(bad), String(bad)).toBeNull();
    }
  });

  it('resolves a handle to the post’s URI, and says when it can’t', async () => {
    const resolveHandle = vi.fn(async (h) => (h === 'mira.example.com' ? 'did:plc:mira' : null));
    await expect(resolvePost('https://bsky.app/profile/mira.example.com/post/3abc', { resolveHandle })).resolves.toEqual({
      uri: 'at://did:plc:mira/app.bsky.feed.post/3abc',
      authorDid: 'did:plc:mira',
    });
    await expect(resolvePost('https://bsky.app/profile/nobody.example.com/post/3abc', { resolveHandle })).rejects.toMatchObject({ code: 'author' });
    await expect(resolvePost('not a link', { resolveHandle })).rejects.toMatchObject({ code: 'link' });
    // A DID needs no lookup.
    resolveHandle.mockClear();
    await resolvePost('at://did:plc:abc/app.bsky.feed.post/3abc', { resolveHandle });
    expect(resolveHandle).not.toHaveBeenCalled();
  });
});

describe('the canary’s candidates', () => {
  const following = [
    { did: 'did:plc:old', followedAt: '2020-01-01T00:00:00Z' },
    { did: 'did:plc:new', followedAt: '2026-01-01T00:00:00Z' },
    { did: 'did:plc:mutual-quiet', followedAt: '2025-01-01T00:00:00Z' },
    { did: 'did:plc:mutual-chatty', followedAt: '2021-01-01T00:00:00Z' },
    { did: 'did:plc:mutual-quiet', followedAt: '2025-01-01T00:00:00Z' }, // a double follow record
    { did: OWNER },
  ];
  const followers = [{ did: 'did:plc:mutual-quiet' }, { did: 'did:plc:mutual-chatty' }, { did: 'did:plc:stranger' }];
  const inbound = [{ did: 'did:plc:mutual-chatty' }, { did: 'did:plc:mutual-chatty' }, { did: 'did:plc:old' }, { did: 'did:plc:stranger' }];

  it('puts the people who follow you back first, those who talk to you most leading', () => {
    expect(canaryCandidates({ following, followers, inbound }, { ownerDid: OWNER })).toEqual([
      'did:plc:mutual-chatty',
      'did:plc:mutual-quiet',
      'did:plc:old',
      'did:plc:new',
    ]);
  });

  it('offers only accounts you follow, each once, and not too many', () => {
    const many = Array.from({ length: CANARY_CANDIDATES + 40 }, (_, i) => ({ did: `did:plc:f${i}` }));
    const out = canaryCandidates({ following: many });
    expect(out).toHaveLength(CANARY_CANDIDATES);
    expect(new Set(out).size).toBe(out.length);
    expect(canaryCandidates({ followers, inbound })).toEqual([]);
    expect(canaryCandidates()).toEqual([]);
  });
});

describe('the signed-in read', () => {
  it('asks Bluesky’s AppView, as the owner, and hands back the profiles', async () => {
    const getProfiles = vi.fn(async () => ({ data: { profiles: [{ did: 'did:plc:a' }] } }));
    const proxied = { app: { bsky: { actor: { getProfiles } } } };
    const agent = { withProxy: vi.fn(() => proxied) };
    const signal = new AbortController().signal;
    expect(await signedInProfiles(agent)(['did:plc:a'], { signal })).toEqual([{ did: 'did:plc:a' }]);
    expect(agent.withProxy).toHaveBeenCalledWith('bsky_appview', 'did:web:api.bsky.app');
    expect(getProfiles).toHaveBeenCalledWith({ actors: ['did:plc:a'] }, { signal });
    getProfiles.mockResolvedValueOnce({ data: {} });
    expect(await signedInProfiles(agent)(['did:plc:a'])).toEqual([]);
  });
});

describe('what went wrong', () => {
  it('names a missing permission, a stop and the vouches that never came', () => {
    const scope = Object.assign(new Error('Missing required scope "rpc:app.bsky.actor.getProfiles"'), { status: 403 });
    expect(scanErrorFrom(new ScoreError('x', { code: 'read', cause: scope })).code).toBe('permission');
    expect(scanErrorFrom(scope).code).toBe('permission');
    expect(scanErrorFrom(new ScoreError('no counts', { code: 'vouches' }))).toMatchObject({ code: 'vouches', message: 'no counts' });
    expect(scanErrorFrom(new ScoreError('down', { code: 'read' })).code).toBe('read');
    const stopped = new AbortController();
    stopped.abort();
    expect(scanErrorFrom(new Error('anything'), stopped.signal).code).toBe('aborted');
    expect(scanErrorFrom(new Error('Constellation didn’t answer')).code).toBe('harvest');
    const own = new ScanError('x', { code: 'link' });
    expect(scanErrorFrom(own)).toBe(own);
  });
});

/** A harvest of `dids` liking a post, with the owner and author among them. */
function fakeHarvest(dids) {
  return vi.fn(async (uri, { onProgress }) => {
    onProgress?.({ done: 1, total: 1 });
    const participants = [...dids, OWNER, AUTHOR].map((did) => ({ did, engagements: { like: 1 }, records: [], total: 1, primary: 'like' }));
    return { uri, harvestedAt: '2026-11-17T00:00:00Z', sources: [], participants, totals: { participants: participants.length, engagements: { like: participants.length }, records: participants.length }, truncated: false, unread: [] };
  });
}

/** The AppView as the owner sees it: `known` is did -> count; `failOpen` drops every count. */
function fakeAppview({ known = {}, failOpen = false } = {}) {
  return vi.fn(async (dids) =>
    dids.map((did) => {
      const n = failOpen ? 0 : did === CANARY ? 4 : known[did] || 0;
      return { did, handle: `${did.slice(8)}.test`, followersCount: 10, viewer: n ? { knownFollowers: { count: n, followers: [] } } : {} };
    }),
  );
}

const relationships = vi.fn(async (_owner, dids) => dids.map((did) => ({ did, following: did === 'did:plc:friend' })));

describe('a scan', () => {
  it('goes through each stage and sorts everyone but you and the author', async () => {
    const stages = [];
    const result = await runScan({
      input: `at://${AUTHOR}/app.bsky.feed.post/3abc`,
      ownerDid: OWNER,
      getProfiles: fakeAppview({ known: { 'did:plc:close': 5, 'did:plc:near': 1 } }),
      getRelationships: relationships,
      candidates: [CANARY],
      harvest: fakeHarvest(['did:plc:close', 'did:plc:near', 'did:plc:friend', 'did:plc:far']),
      onStage: (s) => stages.push(s.stage),
      retryDelaysMs: NO_WAIT,
      now: () => Date.parse('2026-11-17T01:00:00Z'),
    });
    expect([...new Set(stages)]).toEqual(['post', 'harvest', 'canary', 'score']);
    expect(result.post).toEqual({ uri: `at://${AUTHOR}/app.bsky.feed.post/3abc`, authorDid: AUTHOR });
    expect(result.canary).toBe(CANARY);
    expect(result.vouchCheck).toBe('canary');
    const band = Object.fromEntries(result.rows.map((r) => [r.did, r.band]));
    expect(band).toEqual({ 'did:plc:close': 'CONNECTED', 'did:plc:near': 'PERIPHERAL', 'did:plc:friend': 'PROTECTED', 'did:plc:far': 'UNKNOWN' });
    expect(result.totals.participants).toBe(4);
    expect(result.requiresReview.map((r) => r.did)).toEqual(['did:plc:friend', 'did:plc:close', 'did:plc:near']);
    expect(result.finishedAt).toBe('2026-11-17T01:00:00.000Z');
  });

  it('scores nothing when the AppView leaves every count off after the canary was found', async () => {
    // The canary is found, then the lookup times out on every batch after.
    let calls = 0;
    const getProfiles = vi.fn(async (dids) => {
      const counted = calls++ === 0;
      return dids.map((did) => ({ did, viewer: counted && did === CANARY ? { knownFollowers: { count: 4 } } : {} }));
    });
    await expect(
      runScan({
        input: `at://${AUTHOR}/app.bsky.feed.post/3abc`,
        ownerDid: OWNER,
        getProfiles,
        getRelationships: relationships,
        candidates: [CANARY],
        harvest: fakeHarvest(['did:plc:close']),
        retryDelaysMs: NO_WAIT,
      }),
    ).rejects.toMatchObject({ name: 'ScanError', code: 'vouches' });
  });

  it('looks for a canary a second time before scoring without one', async () => {
    // The lookup fails open on the first pass through the candidates.
    let calls = 0;
    const getProfiles = vi.fn(async (dids) => {
      calls += 1;
      return dids.map((did) => ({ did, viewer: calls > 1 && did === CANARY ? { knownFollowers: { count: 4 } } : {} }));
    });
    const result = await runScan({
      input: `at://${AUTHOR}/app.bsky.feed.post/3abc`,
      ownerDid: OWNER,
      getProfiles,
      getRelationships: relationships,
      candidates: [CANARY],
      harvest: fakeHarvest(['did:plc:far']),
      retryDelaysMs: NO_WAIT,
    });
    expect(result.canary).toBe(CANARY);
    expect(result.vouchCheck).toBe('canary');
  });

  it('says when vouches couldn’t be checked at all, and leans on who follows you', async () => {
    const result = await runScan({
      input: `at://${AUTHOR}/app.bsky.feed.post/3abc`,
      ownerDid: OWNER,
      getProfiles: fakeAppview({ failOpen: true }),
      getRelationships: vi.fn(async (_o, dids) => dids.map((did) => ({ did, followedBy: did === 'did:plc:fan' }))),
      candidates: [CANARY],
      harvest: fakeHarvest(['did:plc:fan', 'did:plc:far']),
      retryDelaysMs: NO_WAIT,
    });
    expect(result.canary).toBeNull();
    expect(result.vouchCheck).toBe('unavailable');
    expect(result.rows.find((r) => r.did === 'did:plc:fan').band).toBe('CONNECTED');
    // Without the count, "no connection" is a guess: nothing is eligible on it.
    expect(result.autoEligible).toEqual([]);
  });

  it('stops rather than scoring without vouches when you follow plenty of people', async () => {
    const many = Array.from({ length: CANARY_REQUIRED_AT }, (_, i) => `did:plc:follow${i}`);
    await expect(
      runScan({
        input: `at://${AUTHOR}/app.bsky.feed.post/3abc`,
        ownerDid: OWNER,
        getProfiles: fakeAppview({ failOpen: true }),
        getRelationships: relationships,
        candidates: many,
        harvest: fakeHarvest(['did:plc:far']),
        retryDelaysMs: NO_WAIT,
      }),
    ).rejects.toMatchObject({ code: 'vouches' });
  });

  it('stops when asked to, and says so', async () => {
    const controller = new AbortController();
    const harvest = vi.fn(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(
      runScan({ input: `at://${AUTHOR}/app.bsky.feed.post/3abc`, ownerDid: OWNER, getProfiles: fakeAppview(), harvest, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('turns down a link that isn’t a post before reading anything', async () => {
    const harvest = vi.fn();
    await expect(runScan({ input: 'https://example.com', ownerDid: OWNER, getProfiles: fakeAppview(), harvest })).rejects.toMatchObject({ code: 'link' });
    expect(harvest).not.toHaveBeenCalled();
  });
});
