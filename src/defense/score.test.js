import { describe, expect, it, vi } from 'vitest';
import {
  PROFILE_BATCH,
  ScoreError,
  assignBand,
  createScorer,
  findCanary,
  knownFollowersOf,
  summarise,
  trustScore,
  withoutSelves,
} from './score.js';

const OWNER = 'did:plc:owner';
const CANARY = 'did:plc:canary';
const NO_WAIT = [0, 0];

/** A profile as the signed-in getProfiles returns it. */
function prof(did, { known = 0, followers = 10, viewer = {} } = {}) {
  return {
    did,
    handle: `${did.slice(8)}.test`,
    followersCount: followers,
    followsCount: 5,
    postsCount: 10,
    createdAt: '2024-01-01T00:00:00.000Z',
    viewer: {
      ...viewer,
      ...(known ? { knownFollowers: { count: known, followers: [{ did: 'did:plc:someone' }] } } : {}),
    },
  };
}

/**
 * A getProfiles that answers from `known` (did -> count), with the canary at
 * `canaryKnown`, and drops every count for the calls listed in `failOpen`
 * (by call number, from 0), the way the AppView does when its lookup times out.
 */
function appview({ known = {}, canaryKnown = 4, failOpen = [], missing = [] } = {}) {
  let call = 0;
  return vi.fn(async (dids) => {
    const n = call++;
    const counted = !failOpen.includes(n);
    return dids
      .filter((d) => !missing.includes(d))
      .map((d) => prof(d, { known: counted ? (d === CANARY ? canaryKnown : known[d] || 0) : 0 }));
  });
}

const noRelationships = vi.fn(async (_owner, dids) => dids.map((did) => ({ did })));

const dids = (n, prefix = 'p') => Array.from({ length: n }, (_, i) => `did:plc:${prefix}${i}`);

describe('bands', () => {
  it('reads vouches in one direction only', () => {
    expect(assignBand({ vouches: 3 })).toBe('CONNECTED');
    expect(assignBand({ vouches: 1, followers: 6000 })).toBe('CONNECTED');
    expect(assignBand({ vouches: 1 })).toBe('PERIPHERAL');
    expect(assignBand({ vouches: 0, followers: 20000 })).toBe('NOTABLE');
    expect(assignBand({ vouches: 0, followers: 3000, postsPerDay: 25 })).toBe('NOTABLE');
    expect(assignBand({ vouches: 0, followers: 50 })).toBe('UNKNOWN');
  });

  it('lets a veto win over everything', () => {
    expect(assignBand({ vouches: 0, protectedReason: 'you follow them' })).toBe('PROTECTED');
  });

  it('never calls someone who follows you a stranger, and counts them as close only when asked to', () => {
    expect(assignBand({ followsYou: true })).toBe('PERIPHERAL');
    expect(assignBand({ followsYou: true, followers: 50_000 })).toBe('PERIPHERAL');
    expect(assignBand({ followsYou: true }, { followsYouConnects: true })).toBe('CONNECTED');
    expect(assignBand({ followsYou: true }, { followsYouPeripheral: false })).toBe('UNKNOWN');
  });

  it('keeps the trust key between 0 and 99', () => {
    expect(trustScore({})).toBe(0);
    expect(trustScore({ vouches: 500, followers: 1e7, ageDays: 9999, mutual: true })).toBe(99);
    expect(trustScore({ ageDays: 'not a number' })).toBe(0);
  });
});

describe('knownFollowersOf', () => {
  it('tells an absent count apart from a count', () => {
    expect(knownFollowersOf(prof('did:plc:a'))).toBeNull();
    expect(knownFollowersOf(prof('did:plc:a', { known: 7 }))).toBe(7);
    expect(knownFollowersOf(null)).toBeNull();
    expect(knownFollowersOf({ viewer: { knownFollowers: { followers: [{}, {}] } } })).toBe(2);
  });
});

describe('scoring with a canary', () => {
  it('counts vouches from the AppView and puts the canary in every batch', async () => {
    const getProfiles = appview({ known: { 'did:plc:p0': 5, 'did:plc:p1': 1 } });
    const scorer = createScorer({
      ownerDid: OWNER,
      getProfiles,
      getRelationships: noRelationships,
      canary: CANARY,
      retryDelaysMs: NO_WAIT,
    });
    const { scores, vouchCheck } = await scorer.score(dids(60));
    expect(vouchCheck).toBe('canary');
    expect(scores.get('did:plc:p0').band).toBe('CONNECTED');
    expect(scores.get('did:plc:p1').band).toBe('PERIPHERAL');
    expect(scores.get('did:plc:p2').band).toBe('UNKNOWN');
    // 60 accounts at 24 a batch, each with the canary riding along.
    expect(getProfiles).toHaveBeenCalledTimes(3);
    for (const [batch] of getProfiles.mock.calls) {
      expect(batch.length).toBeLessThanOrEqual(PROFILE_BATCH);
      expect(batch).toContain(CANARY);
    }
    // The canary is a passenger, not one of the scored.
    expect(scores.has(CANARY)).toBe(false);
  });

  it('asks again when a batch came back uncounted, instead of reading it as strangers', async () => {
    const getProfiles = appview({ known: { 'did:plc:p0': 5 }, failOpen: [0] });
    const scorer = createScorer({
      ownerDid: OWNER,
      getProfiles,
      getRelationships: noRelationships,
      canary: CANARY,
      retryDelaysMs: NO_WAIT,
    });
    const { scores } = await scorer.score(dids(3));
    expect(getProfiles).toHaveBeenCalledTimes(2);
    expect(scores.get('did:plc:p0').band).toBe('CONNECTED');
  });

  it('scores nothing when the count never comes back', async () => {
    const getProfiles = appview({ known: { 'did:plc:p0': 5 }, failOpen: [0, 1, 2, 3, 4, 5] });
    const scorer = createScorer({
      ownerDid: OWNER,
      getProfiles,
      getRelationships: noRelationships,
      canary: CANARY,
      retryDelaysMs: NO_WAIT,
    });
    const err = await scorer.score(dids(3)).catch((e) => e);
    expect(err).toBeInstanceOf(ScoreError);
    expect(err.code).toBe('vouches');
  });

  it('picks the canary again once when it stops answering, in case it was unfollowed', async () => {
    // The old canary has lost its known followers for good; a new one has some.
    const NEW = 'did:plc:newcanary';
    const getProfiles = vi.fn(async (batch) =>
      batch.map((d) => prof(d, { known: d === NEW ? 2 : d === 'did:plc:p0' ? 4 : 0 })),
    );
    const refindCanary = vi.fn(async () => NEW);
    const scorer = createScorer({
      ownerDid: OWNER,
      getProfiles,
      getRelationships: noRelationships,
      canary: CANARY,
      refindCanary,
      retryDelaysMs: NO_WAIT,
    });
    const { scores } = await scorer.score(dids(2));
    expect(refindCanary).toHaveBeenCalledTimes(1);
    expect(getProfiles.mock.calls.at(-1)[0]).toContain(NEW);
    expect(scores.get('did:plc:p0').band).toBe('CONNECTED');
  });

  it("doesn't count the canary's own count as a vouch when it is also being scored", async () => {
    const getProfiles = appview({ canaryKnown: 9 });
    const scorer = createScorer({
      ownerDid: OWNER,
      getProfiles,
      getRelationships: noRelationships,
      canary: CANARY,
      retryDelaysMs: NO_WAIT,
    });
    const { scores } = await scorer.score([CANARY, 'did:plc:p0']);
    expect(getProfiles.mock.calls[0][0].filter((d) => d === CANARY)).toHaveLength(1);
    expect(scores.get(CANARY).vouches).toBe(9);
  });
});

describe('scoring without a canary', () => {
  it('says vouches went unchecked and lets following you stand in for closeness', async () => {
    const getProfiles = appview({ known: { 'did:plc:p1': 4 } });
    const getRelationships = vi.fn(async (_o, batch) =>
      batch.map((did) => ({ did, followedBy: did === 'did:plc:p0' ? 'at://x' : undefined })),
    );
    const scorer = createScorer({ ownerDid: OWNER, getProfiles, getRelationships, retryDelaysMs: NO_WAIT });
    const { scores, vouchCheck } = await scorer.score(dids(3));
    expect(vouchCheck).toBe('unavailable');
    expect(scores.get('did:plc:p0').band).toBe('CONNECTED');
    // A count that did come back is still evidence.
    expect(scores.get('did:plc:p1').band).toBe('CONNECTED');
    expect(scores.get('did:plc:p2').band).toBe('UNKNOWN');
    expect(getProfiles.mock.calls[0][0]).toHaveLength(3);
  });
});

describe('the veto', () => {
  it('protects anyone you follow, even when their profile is missing', async () => {
    const getProfiles = appview({ missing: ['did:plc:p0'] });
    const getRelationships = vi.fn(async (_o, batch) =>
      batch.map((did) => ({ did, following: did === 'did:plc:p0' ? 'at://x' : undefined })),
    );
    const scorer = createScorer({
      ownerDid: OWNER,
      getProfiles,
      getRelationships,
      canary: CANARY,
      retryDelaysMs: NO_WAIT,
    });
    const { scores } = await scorer.score(dids(2));
    expect(scores.get('did:plc:p0')).toMatchObject({ band: 'PROTECTED', missing: true, trust: 100 });
  });

  it('protects the owner, Virga’s own accounts and the protected set', async () => {
    const scorer = createScorer({
      ownerDid: OWNER,
      getProfiles: appview(),
      getRelationships: noRelationships,
      canary: CANARY,
      selves: ['did:plc:holder'],
      protectedSet: new Map([['did:plc:friend', 'on your list “Friends”']]),
      retryDelaysMs: NO_WAIT,
    });
    const { scores } = await scorer.score([OWNER, 'did:plc:holder', 'did:plc:friend']);
    expect(scores.get(OWNER).protectedReason).toBe('your own account');
    expect(scores.get('did:plc:holder').band).toBe('PROTECTED');
    expect(scores.get('did:plc:friend').protectedReason).toBe('on your list “Friends”');
  });

  it('scores nothing when who you follow cannot be read', async () => {
    const getRelationships = vi.fn(async () => {
      const err = new Error('HTTP 502');
      err.status = 502;
      throw err;
    });
    const scorer = createScorer({
      ownerDid: OWNER,
      getProfiles: appview(),
      getRelationships,
      canary: CANARY,
      retryDelaysMs: NO_WAIT,
    });
    await expect(scorer.score(dids(2))).rejects.toMatchObject({ code: 'read' });
    expect(getRelationships).toHaveBeenCalledTimes(3);
  });

  it('stops reading profiles once who you follow has failed', async () => {
    const getProfiles = vi.fn(async (batch) => {
      await new Promise((r) => setTimeout(r, 5));
      return batch.map((d) => prof(d, { known: d === CANARY ? 3 : 0 }));
    });
    const getRelationships = vi.fn(async () => {
      const err = new Error('HTTP 400');
      err.status = 400;
      throw err;
    });
    const scorer = createScorer({
      ownerDid: OWNER,
      getProfiles,
      getRelationships,
      canary: CANARY,
      concurrency: 1,
      retryDelaysMs: NO_WAIT,
    });
    await expect(scorer.score(dids(240))).rejects.toMatchObject({ code: 'read' });
    await new Promise((r) => setTimeout(r, 30));
    expect(getProfiles.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('stops asking an uncounted batch again once the score is abandoned', async () => {
    const controller = new AbortController();
    const getProfiles = vi.fn(async (batch) => {
      controller.abort(new Error('the reader left the page'));
      return batch.map((d) => prof(d));
    });
    const scorer = createScorer({
      ownerDid: OWNER,
      getProfiles,
      getRelationships: noRelationships,
      canary: CANARY,
      retryDelaysMs: NO_WAIT,
    });
    await expect(scorer.score(dids(3), { signal: controller.signal })).rejects.toThrow('the reader left the page');
    expect(getProfiles).toHaveBeenCalledTimes(1);
  });

  it("doesn't retry a request Bluesky refused outright", async () => {
    const getProfiles = vi.fn(async () => {
      const err = new Error('Missing required scope');
      err.status = 403;
      throw err;
    });
    const scorer = createScorer({
      ownerDid: OWNER,
      getProfiles,
      getRelationships: noRelationships,
      canary: CANARY,
      retryDelaysMs: NO_WAIT,
    });
    await expect(scorer.score(dids(2))).rejects.toBeInstanceOf(ScoreError);
    expect(getProfiles).toHaveBeenCalledTimes(1);
  });
});

describe('findCanary', () => {
  it('takes the follow with the most known followers', async () => {
    const getProfiles = vi.fn(async (batch) =>
      batch.map((d) => prof(d, { known: { 'did:plc:f3': 2, 'did:plc:f7': 6 }[d] || 0 })),
    );
    const did = await findCanary({ ownerDid: OWNER, candidates: dids(10, 'f'), getProfiles, retryDelaysMs: NO_WAIT });
    expect(did).toBe('did:plc:f7');
  });

  it('reads a few batches and then gives up', async () => {
    const getProfiles = vi.fn(async (batch) => batch.map((d) => prof(d)));
    const did = await findCanary({
      ownerDid: OWNER,
      candidates: dids(500, 'f'),
      getProfiles,
      maxBatches: 3,
      retryDelaysMs: NO_WAIT,
    });
    expect(did).toBeNull();
    expect(getProfiles).toHaveBeenCalledTimes(3);
  });

  it('never picks the owner', async () => {
    const getProfiles = vi.fn(async (batch) => batch.map((d) => prof(d, { known: 3 })));
    const did = await findCanary({ ownerDid: OWNER, candidates: [OWNER, 'did:plc:f1'], getProfiles });
    expect(did).toBe('did:plc:f1');
    expect(getProfiles.mock.calls[0][0]).not.toContain(OWNER);
  });
});

describe('summarise', () => {
  it('counts the bands and keeps the review list to the people near you', () => {
    const harvest = {
      uri: 'at://did:plc:a/app.bsky.feed.post/1',
      participants: [
        { did: 'did:plc:a', engagements: { reply: 1 } },
        { did: 'did:plc:b', engagements: { like: 1 } },
        { did: OWNER, engagements: { reply: 2 } },
      ],
      totals: { participants: 3, engagements: { reply: 3, like: 1 } },
    };
    const scores = new Map([
      ['did:plc:a', { band: 'PERIPHERAL', trust: 40, followers: 100 }],
      ['did:plc:b', { band: 'UNKNOWN', trust: 5 }],
    ]);
    const s = summarise(withoutSelves(harvest, [OWNER]), scores, { vouchCheck: 'canary' });
    expect(s.totals.participants).toBe(2);
    expect(s.totals.engagements).toEqual({ reply: 1, like: 1 });
    expect(s.totals.byBand).toMatchObject({ PERIPHERAL: 1, UNKNOWN: 1 });
    expect(s.requiresReview.map((r) => r.did)).toEqual(['did:plc:a']);
    expect(s.autoEligible.map((r) => r.did)).toEqual(['did:plc:b']);
    expect(s.vouchCheck).toBe('canary');
  });
});
