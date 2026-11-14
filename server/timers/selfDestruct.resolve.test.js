// resolveSelfDestruct: the decide-and-act core.
//
// This is the part that actually reaches someone's PDS and deletes their post.
// Each test here guards one safety property, and each was checked by mutation
// (the guard reverted, the test confirmed red): firing on a truncated count,
// trusting the AppView's silence, acting without a real session, deleting a
// thread root-first, throwing on every failed thread read, acting on a count
// nobody sent, and ignoring the sparing verdict. Every not-knowing path shares
// ENGAGEMENT_UNAVAILABLE, so these assert on the message, which names the
// guard. Please keep that habit: a test that cannot fail is worse than no test,
// because it reads as coverage.
//
// Nothing here touches the network, Supabase or a PDS: every call goes through
// the module's `deps` seam, which each test fills in.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as selfDestruct from './selfDestruct.js';

const { deps } = selfDestruct;
const realDeps = { ...deps };

// ─── The PDS, standing in for a repo that records what was written to it ────
// Every call the worker makes through `new Agent(session)` lands here in order,
// so a test can assert not just WHAT was written but in which order — the
// replies-before-root guarantee is an ordering property and cannot be checked
// any other way.
let pdsCalls = [];
let pdsBehaviour = {};

function FakeAgent(session) {
  const record = (method) => async (params) => {
    pdsCalls.push({ method, ...params });
    const hook = pdsBehaviour[method];
    // The session the agent was built with goes to the hook too, so a test
    // can answer a stale one with "Invalid token".
    if (typeof hook === 'function') return hook(params, session);
    if (method === 'getRecord') {
      // The post itself is there, and is the first post of its thread; no
      // gate has been written yet. Tests about replies or existing gates
      // say otherwise through pdsBehaviour.
      if (params.collection === 'app.bsky.feed.post') {
        return { data: { value: { $type: params.collection, text: 'a post', createdAt: '2026-01-01T00:00:00.000Z' } } };
      }
      const err = new Error('Could not locate record');
      err.error = 'RecordNotFound';
      throw err;
    }
    return { data: {} };
  };
  this.com = {
    atproto: {
      repo: {
        deleteRecord: record('deleteRecord'),
        putRecord: record('putRecord'),
        getRecord: record('getRecord'),
      },
    },
  };
}

// ─── Supabase, standing in for the row's own bookkeeping ────────────────────
let dbWrites = [];
// When set, decides whether the database refuses a write (returns an error).
// Only writes that land are recorded.
let dbRefuse = null;
const fakeSupabase = {
  from: () => ({
    update: (payload) => ({
      eq: async () => {
        const error = dbRefuse ? dbRefuse(payload) : null;
        if (!error) dbWrites.push(payload);
        return { error };
      },
    }),
  }),
};

const DID = 'did:plc:author';
const uriFor = (rkey, collection = 'app.bsky.feed.post') => `at://${DID}/${collection}/${rkey}`;

/** A due row, in the shape claim_self_destruct_posts hands back. */
function makeRow(overrides = {}) {
  return {
    id: 'row-1',
    user_did: DID,
    post_uri: uriFor('root'),
    rkey: 'root',
    collection: 'app.bsky.feed.post',
    extra_uris: [],
    conditions: null,
    effects: null,
    acted: null,
    extensions: 0,
    lifespan_seconds: 3600,
    ...overrides,
  };
}

/** The status the row ended on, and the sentence written beside it. */
const settled = () => {
  const last = dbWrites.filter((w) => w.status).pop() || {};
  return { status: last.status, resolution: last.resolution, acted: last.acted, counts: last.last_counts };
};
const deleted = () => pdsCalls.filter((c) => c.method === 'deleteRecord');
const written = () => pdsCalls.filter((c) => c.method === 'putRecord');

/**
 * Stand in for the AppView.
 *
 * `posts` keys a postView by URI (absent = the AppView answered without it);
 * `thread` is the getPostThread reply tree; `fail` throws for a path instead.
 */
function stubAppView({ posts = {}, thread = null, fail = null, quotes = [], follows = [] } = {}) {
  deps.safeFetchJson = vi.fn(async (raw) => {
    const url = new URL(raw);
    const path = url.pathname;
    if (fail && path.includes(fail.path)) {
      const err = new Error(fail.message || 'HTTP 500');
      if (fail.status) err.status = fail.status;
      if (fail.error) err.error = fail.error; // the XRPC error name safe-fetch carries
      throw err;
    }
    if (path.endsWith('getPosts')) {
      const asked = url.searchParams.getAll('uris');
      return { posts: asked.filter((u) => posts[u]).map((u) => ({ uri: u, ...posts[u] })) };
    }
    if (path.endsWith('getPostThread')) return { thread: thread || { replies: [] } };
    if (path.endsWith('getQuotes')) return { posts: quotes, cursor: undefined };
    if (path.endsWith('getFollows')) return { follows: follows.map((did) => ({ did })), cursor: undefined };
    if (path.endsWith('getProfiles')) return { profiles: [] };
    throw new Error(`unexpected AppView call: ${path}`);
  });
}


beforeEach(() => {
  pdsCalls = [];
  dbWrites = [];
  dbRefuse = null;
  pdsBehaviour = {};
  deps.Agent = FakeAgent;
  deps.getSupabaseClient = () => fakeSupabase;
  deps.safeFetchJson = vi.fn();
  deps.safeFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  // The real shape, { did, pdsEndpoint, didDoc }: a bare string would hide a
  // probe that never reached the PDS.
  deps.resolvePdsEndpoint = vi.fn(async () => ({ did: DID, pdsEndpoint: 'https://pds.example.com', didDoc: {} }));
  deps.restoreSession = vi.fn(async () => ({ did: DID }));
});
afterEach(() => {
  Object.assign(deps, realDeps);
});

describe('resolveSelfDestruct: a plain timer', () => {
  it('deletes the post and retires the row saying so', async () => {
    stubAppView();
    const result = await selfDestruct.resolveSelfDestruct(makeRow());
    expect(result.outcome).toBe('deleted');
    expect(deleted().map((c) => c.collection)).toContain('app.bsky.feed.post');
    expect(settled().status).toBe('deleted');
  });

  it('takes the replies down before the root', async () => {
    // Either order leaves the PDS correct, but only this one never shows a
    // thread whose root is missing while its replies still stand — a shape that
    // reads as a moderator removal rather than the author's own deletion.
    stubAppView();
    await selfDestruct.resolveSelfDestruct(makeRow({
      extra_uris: [
        { uri: uriFor('reply1'), collection: 'app.bsky.feed.post', rkey: 'reply1' },
        { uri: uriFor('reply2'), collection: 'app.bsky.feed.post', rkey: 'reply2' },
      ],
    }));
    // Deepest first, root last. The reversal is not decoration: the row lists
    // a thread in the order it was written, so walking it forwards would take
    // a reply down before the replies hanging off it.
    const order = deleted().filter((c) => c.collection === 'app.bsky.feed.post').map((c) => c.rkey);
    expect(order).toEqual(['reply2', 'reply1', 'root']);
  });
});

const withClause = (clause, extra = {}) => ({
  logic: 'any', sense: 'unless', onSpare: 'keep', maxExtensions: 0,
  clauses: [clause], ...extra,
});

describe('resolveSelfDestruct: conditions decide', () => {
  it('spares a post that earned its keep, and never touches the PDS', async () => {
    stubAppView({ posts: { [uriFor('root')]: { likeCount: 9, replyCount: 0, repostCount: 0, quoteCount: 0 } } });
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({ metric: 'likes', op: 'gte', value: 5 }),
    }));
    expect(result.outcome).toBe('spared');
    expect(pdsCalls).toEqual([]);
    expect(settled().status).toBe('spared');
  });

  it('deletes a post that did not', async () => {
    stubAppView({ posts: { [uriFor('root')]: { likeCount: 1, replyCount: 0, repostCount: 0, quoteCount: 0 } } });
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({ metric: 'likes', op: 'gte', value: 5 }),
    }));
    expect(result.outcome).toBe('deleted');
    expect(deleted()).not.toHaveLength(0);
  });

  it('hands a spared post its window again when the rule says extend', async () => {
    stubAppView({ posts: { [uriFor('root')]: { likeCount: 9, replyCount: 0, repostCount: 0, quoteCount: 0 } } });
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({ metric: 'likes', op: 'gte', value: 5 }, { onSpare: 'extend', maxExtensions: 3 }),
    }));
    expect(result.outcome).toBe('extended');
    const write = dbWrites.pop();
    expect(write.status).toBe('armed');
    expect(write.extensions).toBe(1);
    // A fresh window is a fresh start: an attempt spent on the last evaluation
    // must not count against the next one.
    expect(write.attempts).toBe(0);
    expect(pdsCalls).toEqual([]);
  });

  it('stops extending at the ceiling and simply keeps the post', async () => {
    stubAppView({ posts: { [uriFor('root')]: { likeCount: 9, replyCount: 0, repostCount: 0, quoteCount: 0 } } });
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      extensions: 3,
      conditions: withClause({ metric: 'likes', op: 'gte', value: 5 }, { onSpare: 'extend', maxExtensions: 3 }),
    }));
    expect(result.outcome).toBe('spared');
  });
});

describe('resolveSelfDestruct: the safety bias', () => {
  // Every one of these is a case where the worker does NOT know something it
  // was told to check. A post can be un-deleted by nobody, so not knowing must
  // never be spent as knowledge: the row goes back in the queue and the post
  // stays up. The assertion that matters in each is `pdsCalls` being empty.

  it('retries rather than deletes when the engagement read fails', async () => {
    stubAppView({ fail: { path: 'getPosts', message: 'HTTP 500', status: 500 } });
    await expect(selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({ metric: 'likes', op: 'gte', value: 5 }),
    }))).rejects.toThrow(/read the counts/);
    expect(pdsCalls).toEqual([]);
  });

  it('retries rather than deletes when the session cannot be restored', async () => {
    // Null covers both a revoked grant and a momentary store hiccup, so it
    // must not be terminal.
    stubAppView();
    deps.restoreSession = vi.fn(async () => null);
    await expect(selfDestruct.resolveSelfDestruct(makeRow()))
      .rejects.toMatchObject({ code: 'SESSION_UNAVAILABLE' });
    expect(pdsCalls).toEqual([]);
  });

  it('retries rather than deletes on a count the AppView never sent', async () => {
    // Every count on app.bsky.feed.defs#postView is optional. An answer that
    // omits one is silence, and a rule must not fire on silence.
    stubAppView({ posts: { [uriFor('root')]: { likeCount: 3, repostCount: 0, quoteCount: 0 } } }); // no replyCount
    await expect(selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({ metric: 'replies', op: 'gte', value: 2 }),
    }))).rejects.toThrow(/came back without replies/);
    expect(pdsCalls).toEqual([]);
  });

  it('acts normally on a count no clause depends on', async () => {
    stubAppView({ posts: { [uriFor('root')]: { likeCount: 1, repostCount: 0, quoteCount: 0 } } }); // no replyCount
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({ metric: 'likes', op: 'gte', value: 5 }),
    }));
    expect(result.outcome).toBe('deleted');
  });

  it('SPARES on an absent count rather than holding the post back', async () => {
    // The guard sits below the spare branch, beside the truncation check, for
    // the reason that check gives: firing on a number we are unsure of is a
    // guess, but sparing on one errs toward the post. Checked earlier, a rule
    // about to keep a post became a retry and eventually a 'failed' row.
    stubAppView({ posts: { [uriFor('root')]: { likeCount: 9, repostCount: 0, quoteCount: 0 } } }); // no replyCount
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      conditions: { logic: 'any', sense: 'unless', onSpare: 'keep', maxExtensions: 0, clauses: [
        { metric: 'likes', op: 'gte', value: 5 },
        { metric: 'replies', op: 'gte', value: 2 },
      ] },
    }));
    expect(result.outcome).toBe('spared');
    expect(pdsCalls).toEqual([]);
  });
});

/** The author's own PDS answering about a record the AppView did not show. */
let probeUrls = [];
const stubProbe = (answer) => {
  probeUrls = [];
  const xrpcError = (error) => new Response(JSON.stringify({ error }), {
    status: 400, headers: { 'content-type': 'application/json' },
  });
  deps.safeFetch = vi.fn(async (raw) => {
    probeUrls.push(raw);
    return answer === 'exists' ? new Response('{}', { status: 200 })
      : answer === 'gone' ? xrpcError('RecordNotFound')
        : xrpcError('AccountDeactivated');
  });
};

describe('resolveSelfDestruct: a post the AppView will not show', () => {
  const conditional = { conditions: withClause({ metric: 'likes', op: 'gte', value: 5 }) };

  it("retires as gone when the author's own repo confirms it", async () => {
    stubAppView({ posts: {} });
    stubProbe('gone');
    const result = await selfDestruct.resolveSelfDestruct(makeRow(conditional));
    expect(result.outcome).toBe('gone');
    // The question went to the author's own PDS, not to "[object Object]".
    expect(probeUrls).toHaveLength(1);
    expect(new URL(probeUrls[0]).origin).toBe('https://pds.example.com');
    expect(new URL(probeUrls[0]).pathname).toBe('/xrpc/com.atproto.repo.getRecord');
    // Nothing to delete, so nothing is sent.
    expect(pdsCalls).toEqual([]);
    expect(settled().status).toBe('deleted');
  });

  it('retries when the repo says the record is still there', async () => {
    // The AppView's silence also covers a deactivated or taken-down ACCOUNT,
    // whose posts all still stand. Only the repo's own word retires the timer.
    stubAppView({ posts: {} });
    stubProbe('exists');
    await expect(selfDestruct.resolveSelfDestruct(makeRow(conditional)))
      .rejects.toThrow(/really gone/);
    expect(pdsCalls).toEqual([]);
  });

  it('retries when the repo will not say either way', async () => {
    stubAppView({ posts: {} });
    stubProbe('unknown');
    await expect(selfDestruct.resolveSelfDestruct(makeRow(conditional)))
      .rejects.toThrow(/really gone/);
    expect(pdsCalls).toEqual([]);
  });
});

describe('resolveSelfDestruct: effects that are not a deletion', () => {
  it('narrows replies and leaves the post standing', async () => {
    stubAppView();
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      effects: [{ action: 'limitReplies', allow: ['follower'] }],
    }));
    expect(result.outcome).toBe('acted');
    expect(deleted()).toEqual([]);
    const gate = written().find((c) => c.collection === 'app.bsky.feed.threadgate');
    expect(gate.rkey).toBe('root'); // a threadgate shares its post's record key
    expect(gate.record.allow).toEqual([{ $type: 'app.bsky.feed.threadgate#followerRule' }]);
    expect(settled().status).toBe('acted');
  });

  it('turns quoting off and leaves the post standing', async () => {
    stubAppView();
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      effects: [{ action: 'disableQuotes' }],
    }));
    expect(result.outcome).toBe('acted');
    expect(deleted()).toEqual([]);
    const gate = written().find((c) => c.collection === 'app.bsky.feed.postgate');
    expect(gate.record.embeddingRules).toEqual([{ $type: 'app.bsky.feed.postgate#disableRule' }]);
  });

  it('gates before it deletes, so a run cut short has done the reversible half', async () => {
    stubAppView();
    await selfDestruct.resolveSelfDestruct(makeRow({
      effects: [{ action: 'limitReplies', allow: ['follower'] }, { action: 'delete' }],
    }));
    const gateAt = pdsCalls.findIndex((c) => c.collection === 'app.bsky.feed.threadgate' && c.method === 'putRecord');
    const deleteAt = pdsCalls.findIndex((c) => c.method === 'deleteRecord' && c.rkey === 'root');
    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(gateAt);
    expect(settled().status).toBe('deleted');
  });

  it("never widens a gate the author already set", async () => {
    // The hazard in the whole feature: a threadgate is one record per post, so
    // writing one REPLACES it. A rule writing followerRule over an author's
    // mentionRule would not narrow anything, it would open the replies up.
    stubAppView();
    pdsBehaviour.getRecord = async () => ({
      data: { value: { allow: [{ $type: 'app.bsky.feed.threadgate#mentionRule' }] } },
    });
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      effects: [{ action: 'limitReplies', allow: ['follower'] }],
    }));
    expect(result.outcome).toBe('acted');
    expect(written().filter((c) => c.collection === 'app.bsky.feed.threadgate')).toEqual([]);
    expect(settled().acted[0].ok).toBe(false);
    expect(settled().acted[0].detail).toMatch(/left the reply settings alone/);
  });

});

describe('resolveSelfDestruct: a verdict already reached', () => {
  // Deleting a thread's replies shrinks the very numbers a verdict came from,
  // so an attempt cut short partway must resume its OWN decision rather than
  // re-derive one from counts its half-applied effects have since changed. The
  // marker lives in `acted`.
  const pinned = { acted: { pending: true, counts: { likes: 1 }, reason: '1 like, 0 replies, 0 reposts' } };

  it('resumes without reading anything, and finishes the deletion', async () => {
    stubAppView();
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      ...pinned,
      conditions: withClause({ metric: 'likes', op: 'gte', value: 5 }),
    }));
    expect(result.outcome).toBe('deleted');
    // No engagement read: the decision was made last time.
    const paths = deps.safeFetchJson.mock.calls.map(([u]) => new URL(u).pathname);
    expect(paths.some((p) => p.endsWith('getPosts'))).toBe(false);
    expect(settled().resolution).toMatch(/1 like/);
  });

  it('completes even though the root it half-deleted is already gone', async () => {
    // The case this guards. A resumed row reads the thread
    // to catch replies added after arming — and getPostThread answers 400 for
    // a root the last attempt already deleted. Throwing there burned the row's
    // attempts and retired it as "failed — the post is still up", for a post
    // that was gone, with its replies left standing under it.
    stubAppView({ fail: { path: 'getPostThread', message: 'HTTP 400', status: 400, error: 'NotFound' } });
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      ...pinned,
      extra_uris: [{ uri: uriFor('reply1'), collection: 'app.bsky.feed.post', rkey: 'reply1' }],
    }));
    expect(result.outcome).toBe('deleted');
    // The row's own extra_uris are still correct, so the rest of the thread
    // comes down even though the thread read told us nothing.
    expect(deleted().map((c) => c.rkey)).toEqual(expect.arrayContaining(['reply1', 'root']));
    expect(settled().status).toBe('deleted');
  });

  it('still refuses to guess when the thread read fails for a reason that is not an answer', async () => {
    // A 5xx, a timeout, a socket hang-up: not knowing. Spending that as
    // knowledge is what leaves replies standing under a deleted root.
    stubAppView({ fail: { path: 'getPostThread', message: 'HTTP 503', status: 503 } });
    await expect(selfDestruct.resolveSelfDestruct(makeRow(pinned)))
      .rejects.toThrow(/read this thread/);
    expect(pdsCalls).toEqual([]);
  });
});

describe('resolveSelfDestruct: a count that was never finished', () => {
  it('refuses to fire on a filtered scan that stopped early', async () => {
    // readFilteredQuotes flags a count it could not finish. A floor is not an
    // answer, and firing an irreversible effect on one would be a guess.
    stubAppView({
      posts: { [uriFor('root')]: { likeCount: 0, replyCount: 0, repostCount: 0, quoteCount: 0 } },
      quotes: Array.from({ length: 100 }, (_, i) => ({ author: { did: `did:plc:q${i}` } })),
      follows: [],
    });
    // Every page full and matching nothing the rule wants, so the scan runs to
    // its cap with the target unmet and says so.
    deps.safeFetchJson = vi.fn(async (raw) => {
      const url = new URL(raw);
      if (url.pathname.endsWith('getPosts')) {
        return { posts: [{ uri: uriFor('root'), likeCount: 0, replyCount: 0, repostCount: 0, quoteCount: 0 }] };
      }
      if (url.pathname.endsWith('getFollows')) return { follows: [], cursor: undefined };
      if (url.pathname.endsWith('getQuotes')) {
        return { posts: [{ author: { did: 'did:plc:friend' } }], cursor: 'more' };
      }
      if (url.pathname.endsWith('getProfiles')) return { profiles: [] };
      // Answered, so that removing the truncation guard lets the run reach the
      // deletion rather than tripping over an unstubbed call and throwing the
      // same code for a different reason. Asserting on the MESSAGE below is the
      // other half of that: 'ENGAGEMENT_UNAVAILABLE' is shared by every
      // not-knowing path in this function, so the code alone does not say which
      // guard held the post back.
      if (url.pathname.endsWith('getPostThread')) return { thread: { replies: [] } };
      throw new Error(`unexpected: ${url.pathname}`);
    });
    await expect(selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({
        metric: 'quotes', op: 'gte', value: 50,
        from: { match: 'any', notFollowed: false, followersOver: 10000 },
      }),
    }))).rejects.toThrow(/finish counting/);
    expect(pdsCalls).toEqual([]);
  });
});

// ─── The thread walk: the author's continuation chain, and nothing else ─────
// readSelfReplies feeds both the selfReplies metric and the deletion.
// Collecting every post of the author's anywhere below the root would take the
// author's answers inside OTHER people's sub-threads down with the root and
// count them as "finishing the thread". Only a descendant whose every ancestor
// up to the root is the author's own is a continuation.

const STRANGER = 'did:plc:stranger';
/** One #threadViewPost node. */
const node = (did, rkey, replies = []) => ({
  post: { uri: `at://${did}/app.bsky.feed.post/${rkey}`, author: { did } },
  replies,
});

/**
 *   root (author)
 *   ├── a1 (author)
 *   │   ├── a2 (author)              continuation → collected
 *   │   └── s2 (stranger)
 *   │       └── a3 (author)          inside a stranger's branch → NOT collected
 *   └── s1 (stranger)
 *       └── a4 (author)              answering a stranger → NOT collected
 */
const mixedThread = () => ({
  ...node(DID, 'root'),
  replies: [
    node(DID, 'a1', [
      node(DID, 'a2'),
      node(STRANGER, 's2', [node(DID, 'a3')]),
    ]),
    node(STRANGER, 's1', [node(DID, 'a4')]),
  ],
});

describe('readSelfReplies walks only the continuation chain', () => {
  it("collects root → author → author, and none of the author's answers to other people", async () => {
    stubAppView({ thread: mixedThread() });
    const result = await selfDestruct.readSelfReplies(DID, uriFor('root'));
    expect(result.uris).toEqual([uriFor('a1'), uriFor('a2')]);
    expect(result.count).toBe(2);
    // The author's DIRECT replies to the root are still what the replies
    // clause subtracts from the counter — the stranger's reply is not one.
    expect(result.ownDirect).toBe(1);
  });

  it("does not collect root → stranger → author", async () => {
    stubAppView({ thread: { ...node(DID, 'root'), replies: [node(STRANGER, 's1', [node(DID, 'a4')])] } });
    const result = await selfDestruct.readSelfReplies(DID, uriFor('root'));
    expect(result.uris).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.ownDirect).toBe(0);
  });

  it('does not collect root → author → stranger → author', async () => {
    stubAppView({
      thread: { ...node(DID, 'root'), replies: [node(DID, 'a1', [node(STRANGER, 's2', [node(DID, 'a3')])])] },
    });
    const result = await selfDestruct.readSelfReplies(DID, uriFor('root'));
    expect(result.uris).toEqual([uriFor('a1')]);
  });

  it("leaves the author's answers to other people standing when the thread is deleted", async () => {
    stubAppView({ thread: mixedThread() });
    const result = await selfDestruct.resolveSelfDestruct(makeRow());
    expect(result.outcome).toBe('deleted');
    const posts = deleted().filter((c) => c.collection === 'app.bsky.feed.post').map((c) => c.rkey);
    expect(posts).toEqual(['a2', 'a1', 'root']);
    expect(posts).not.toContain('a3');
    expect(posts).not.toContain('a4');
  });

  it('counts only continuations toward a selfReplies clause', async () => {
    // Two continuations and two answers to strangers. "Unless I continued it at
    // least three times" is not met: the answers are conversations, not thread.
    stubAppView({
      posts: { [uriFor('root')]: { likeCount: 0, replyCount: 3, repostCount: 0, quoteCount: 0 } },
      thread: mixedThread(),
    });
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({ metric: 'selfReplies', op: 'gte', value: 3 }),
    }));
    expect(result.outcome).toBe('deleted');
    expect(result.counts.selfReplies).toBe(2);
  });
});

// ─── "Limit replies" on a post that is itself a reply ───────────────────────
// A threadgate is keyed by the thread ROOT's rkey. Written at a reply's rkey it
// is ignored by the AppView, and the row would record "replies limited to your
// followers" over replies that were as open as ever.

describe('resolveSelfDestruct: limiting replies on a reply', () => {
  const replyRecord = {
    $type: 'app.bsky.feed.post',
    text: 'replying',
    reply: {
      root: { uri: 'at://did:plc:stranger/app.bsky.feed.post/theirs', cid: 'c0' },
      parent: { uri: 'at://did:plc:stranger/app.bsky.feed.post/theirs', cid: 'c0' },
    },
  };
  const asReply = () => {
    pdsBehaviour.getRecord = async (params) => {
      if (params.collection === 'app.bsky.feed.post') return { data: { value: replyRecord } };
      const err = new Error('Could not locate record');
      err.error = 'RecordNotFound';
      throw err;
    };
  };

  it('writes no threadgate, and records that it could not limit them and why', async () => {
    stubAppView();
    asReply();
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      effects: [{ action: 'limitReplies', allow: ['follower'] }],
    }));
    expect(result.outcome).toBe('acted');
    expect(written().filter((c) => c.collection === 'app.bsky.feed.threadgate')).toEqual([]);
    expect(settled().acted).toEqual([
      expect.objectContaining({ action: 'limitReplies', ok: false, detail: expect.stringMatching(/first post of a thread/) }),
    ]);
  });

  it('still turns quoting off on a reply — a postgate is keyed by its own post', async () => {
    stubAppView();
    asReply();
    await selfDestruct.resolveSelfDestruct(makeRow({
      effects: [{ action: 'limitReplies', allow: ['follower'] }, { action: 'disableQuotes' }],
    }));
    expect(written().filter((c) => c.collection === 'app.bsky.feed.threadgate')).toEqual([]);
    expect(written().filter((c) => c.collection === 'app.bsky.feed.postgate')).toHaveLength(1);
    expect(settled().acted.map((a) => [a.action, a.ok])).toEqual([['limitReplies', false], ['disableQuotes', true]]);
  });

  it('still deletes a reply whose rule also asked to delete', async () => {
    stubAppView();
    asReply();
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      effects: [{ action: 'limitReplies', allow: ['follower'] }, { action: 'delete' }],
    }));
    expect(result.outcome).toBe('deleted');
    expect(deleted().map((c) => c.rkey)).toContain('root');
  });

  it('retries, writing nothing, when the post cannot be read', async () => {
    // Not knowing whether it is a reply is not a reason to write a gate.
    stubAppView();
    pdsBehaviour.getRecord = async () => {
      const err = new Error('Internal Server Error');
      err.status = 500;
      throw err;
    };
    await expect(selfDestruct.resolveSelfDestruct(makeRow({
      effects: [{ action: 'limitReplies', allow: ['follower'] }],
    }))).rejects.toThrow(/couldn't read this post/);
    expect(written()).toEqual([]);
    expect(dbWrites.filter((w) => w.status)).toEqual([]);
  });

  it('says the post was gone, rather than retrying, when the repo has no such record', async () => {
    stubAppView();
    pdsBehaviour.getRecord = async () => {
      const err = new Error('Could not locate record');
      err.error = 'RecordNotFound';
      throw err;
    };
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      effects: [{ action: 'limitReplies', allow: ['follower'] }],
    }));
    expect(result.outcome).toBe('acted');
    expect(written()).toEqual([]);
    expect(settled().acted[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/already gone/) });
  });
});

describe('resolveSelfDestruct: what a narrowed gate says it did', () => {
  it('describes the rules actually written, not the ones asked for', async () => {
    // The author's gate allows followers and mentions; the rule asks for
    // followers and people they follow. Both agree only on followers, so that
    // is what goes on the gate — and what the row has to say.
    stubAppView();
    pdsBehaviour.getRecord = async (params) => {
      if (params.collection === 'app.bsky.feed.post') return { data: { value: { text: 'root' } } };
      return {
        data: {
          value: {
            allow: [
              { $type: 'app.bsky.feed.threadgate#followerRule' },
              { $type: 'app.bsky.feed.threadgate#mentionRule' },
            ],
          },
        },
      };
    };
    await selfDestruct.resolveSelfDestruct(makeRow({
      effects: [{ action: 'limitReplies', allow: ['follower', 'following'] }],
    }));
    const gate = written().find((c) => c.collection === 'app.bsky.feed.threadgate');
    expect(gate.record.allow).toEqual([{ $type: 'app.bsky.feed.threadgate#followerRule' }]);
    expect(settled().acted[0]).toMatchObject({ ok: true, detail: 'replies limited to your followers' });
  });

  it('names a list it narrowed to by count, as before', async () => {
    const list = `at://${DID}/app.bsky.graph.list/moots`;
    stubAppView();
    await selfDestruct.resolveSelfDestruct(makeRow({
      effects: [{ action: 'limitReplies', allow: ['follower', { list }] }],
    }));
    expect(settled().acted[0].detail).toBe('replies limited to your followers and people in a list you chose');
  });
});

describe('resolveSelfDestruct: an unfiltered quotes clause', () => {
  it("still reads the AppView's quoteCount, and never walks the quotes", async () => {
    // Filtered clauses count people; a clause with nobody in it is a question
    // about the number shown beside the post, and stays one.
    stubAppView({ posts: { [uriFor('root')]: { likeCount: 0, replyCount: 0, repostCount: 0, quoteCount: 3 } } });
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({ metric: 'quotes', op: 'gte', value: 3 }),
    }));
    expect(result.outcome).toBe('spared');
    const paths = deps.safeFetchJson.mock.calls.map(([u]) => new URL(u).pathname);
    expect(paths.some((p) => p.endsWith('getQuotes'))).toBe(false);
  });
});

describe('resolveSelfDestruct: a thread read the AppView rate-limited', () => {
  it('leaves the whole thread up and retries, rather than deleting the root without its replies', async () => {
    // A plain timer's first read is the thread. A 429 read as "no thread"
    // would delete the root and the armed replies and orphan any self-reply
    // added since.
    stubAppView({ fail: { path: 'getPostThread', message: 'HTTP 429', status: 429, error: 'RateLimitExceeded' } });
    await expect(selfDestruct.resolveSelfDestruct(makeRow({
      extra_uris: [{ uri: uriFor('reply1'), collection: 'app.bsky.feed.post', rkey: 'reply1' }],
    }))).rejects.toMatchObject({ code: 'ENGAGEMENT_UNAVAILABLE' });
    expect(deleted()).toEqual([]);
  });

  it('takes the named records down when the AppView says the root is not found', async () => {
    stubAppView({ fail: { path: 'getPostThread', message: 'HTTP 400', status: 400, error: 'NotFound' } });
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      extra_uris: [{ uri: uriFor('reply1'), collection: 'app.bsky.feed.post', rkey: 'reply1' }],
    }));
    expect(result.outcome).toBe('deleted');
    expect(deleted().filter((c) => c.collection === 'app.bsky.feed.post').map((c) => c.rkey)).toEqual(['reply1', 'root']);
  });
});

// ─── Long threads inside a sixty-second function ────────────────────────────
// Three proxied writes per record, one record after the other, did not fit a
// hundred-post thread into the worker's sixty seconds, and every retry started
// again from the top. A record's three deletes now go together, a thread goes a
// few records at a time from the deep end, and the worker's budget stops a
// deletion between batches and puts the row back — progress pinned, no attempt
// spent — to finish on the next run.

/** A thread of n replies under the root, in written order. */
const threadOf = (n) => Array.from({ length: n }, (_, i) => ({
  uri: uriFor(`r${i + 1}`), collection: 'app.bsky.feed.post', rkey: `r${i + 1}`,
}));

/** deleteRecord that takes a tick, and logs when each one starts and ends. */
function slowDeletes(log, { onStart } = {}) {
  let inFlight = 0;
  let peak = 0;
  pdsBehaviour.deleteRecord = async (params) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    log.push(['start', params.collection, params.rkey]);
    if (onStart) onStart(params);
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight -= 1;
    log.push(['end', params.collection, params.rkey]);
    return { data: {} };
  };
  return () => peak;
}

describe('deleting a long thread', () => {
  it("sends a record's own delete and its two gates together", async () => {
    stubAppView();
    const log = [];
    slowDeletes(log);
    await selfDestruct.resolveSelfDestruct(makeRow());
    // All three start before any of them finishes.
    expect(log.slice(0, 3).map((e) => e[0])).toEqual(['start', 'start', 'start']);
    expect(log.slice(0, 3).map((e) => e[1]).sort()).toEqual([
      'app.bsky.feed.post', 'app.bsky.feed.postgate', 'app.bsky.feed.threadgate',
    ]);
  });

  it('takes replies down a few at a time, deepest batch first, root last', async () => {
    stubAppView({ thread: { replies: [] } });
    const log = [];
    slowDeletes(log);
    await selfDestruct.resolveSelfDestruct(makeRow({ extra_uris: threadOf(12) }));

    const posts = log.filter((e) => e[1] === 'app.bsky.feed.post');
    const starts = posts.filter((e) => e[0] === 'start').map((e) => e[2]);
    expect(starts).toEqual(['r12', 'r11', 'r10', 'r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3', 'r2', 'r1', 'root']);

    // Each batch finishes before the next starts, so a run cut off between
    // batches leaves the shallowest posts standing, never a gap above a reply.
    const position = (kind, rkey) => posts.findIndex((e) => e[0] === kind && e[2] === rkey);
    for (const deep of ['r12', 'r11', 'r10', 'r9', 'r8']) {
      expect(position('end', deep)).toBeLessThan(position('start', 'r7'));
    }
    for (const reply of threadOf(12).map((p) => p.rkey)) {
      expect(position('end', reply)).toBeLessThan(position('start', 'root'));
    }
    // And never more than five posts in flight at once.
    let inFlight = 0;
    let peak = 0;
    for (const [kind] of posts) {
      inFlight += kind === 'start' ? 1 : -1;
      peak = Math.max(peak, inFlight);
    }
    expect(peak).toBe(5);
  });

  it('stops between batches when the budget runs out, and puts the row back unspent', async () => {
    stubAppView({ thread: { replies: [] } });
    let clock = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const log = [];
      // The first batch takes the clock past the deadline.
      slowDeletes(log, { onStart: () => { clock += 1000; } });
      const row = makeRow({ extra_uris: threadOf(12), attempts: 2 });
      const result = await selfDestruct.resolveSelfDestruct(row, { deadline: clock + 2000 });

      expect(result.outcome).toBe('deferred');
      const posts = log.filter((e) => e[0] === 'start' && e[1] === 'app.bsky.feed.post').map((e) => e[2]);
      expect(posts).toEqual(['r12', 'r11', 'r10', 'r9', 'r8']); // one batch, root untouched

      const write = dbWrites.filter((w) => w.status).pop();
      expect(write.status).toBe('armed');
      // The claim's attempt is given back: running out of time is not failing.
      expect(write.attempts).toBe(1);
      expect(write.next_attempt_at).toBeNull();
      expect(write.acted).toMatchObject({ pending: true });
      expect(write.acted.deleted).toEqual(['r12', 'r11', 'r10', 'r9', 'r8'].map((r) => uriFor(r)));
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('picks up where the last run stopped, without re-deleting what it took down', async () => {
    stubAppView({ thread: { replies: [] } });
    const log = [];
    slowDeletes(log);
    const gone = ['r12', 'r11', 'r10', 'r9', 'r8'].map((r) => uriFor(r));
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      extra_uris: threadOf(12),
      acted: { pending: true, counts: null, reason: 'on time', deleted: gone },
    }));
    expect(result.outcome).toBe('deleted');
    const posts = log.filter((e) => e[0] === 'start' && e[1] === 'app.bsky.feed.post').map((e) => e[2]);
    expect(posts).toEqual(['r7', 'r6', 'r5', 'r4', 'r3', 'r2', 'r1', 'root']);
    expect(settled().status).toBe('deleted');
  });

  it('defers without deleting anything when the budget is already spent', async () => {
    stubAppView({ thread: { replies: [] } });
    const result = await selfDestruct.resolveSelfDestruct(makeRow({ extra_uris: threadOf(3), attempts: 1 }), {
      deadline: Date.now() - 1,
    });
    expect(result.outcome).toBe('deferred');
    expect(deleted()).toEqual([]);
    expect(dbWrites.filter((w) => w.status).pop()).toMatchObject({ status: 'armed', attempts: 0 });
  });

  it('stops giving free passes to a row that never gets anywhere', async () => {
    // A row cut off before its first batch, again and again, would otherwise
    // cycle forever with its attempts untouched.
    stubAppView({ thread: { replies: [] } });
    const stuck = { pending: true, counts: null, reason: 'on time', idleDeferrals: 3 };
    await expect(selfDestruct.resolveSelfDestruct(makeRow({ extra_uris: threadOf(3), acted: stuck }), {
      deadline: Date.now() - 1,
    })).rejects.toMatchObject({ code: 'TIMED_OUT' });
    expect(dbWrites.filter((w) => w.status === 'armed')).toEqual([]);
  });

  it('says part of the thread came down when a later batch fails, and pins what did', async () => {
    stubAppView({ thread: { replies: [] } });
    const log = [];
    slowDeletes(log);
    const base = pdsBehaviour.deleteRecord;
    pdsBehaviour.deleteRecord = async (params) => {
      if (params.collection === 'app.bsky.feed.post' && params.rkey === 'r5') {
        const err = new Error('Upstream Failure');
        err.status = 502;
        throw err;
      }
      return base(params);
    };
    const err = await selfDestruct.resolveSelfDestruct(makeRow({ extra_uris: threadOf(7) })).catch((e) => e);
    expect(err.partialDeletion).toBe(true);
    expect(err.message).toMatch(/came down, but the first post is still up/);
    expect(err.status).toBe(502); // classifyFailure still sees what went wrong
    // The root was never touched.
    expect(deleted().filter((c) => c.rkey === 'root')).toEqual([]);
    // What did come down is pinned, so the retry skips it.
    const pin = dbWrites.filter((w) => w.acted && w.acted.pending).pop();
    expect(pin.acted.deleted).toEqual(expect.arrayContaining(['r7', 'r6', 'r4', 'r3'].map((r) => uriFor(r))));
    expect(pin.acted.deleted).not.toContain(uriFor('r5'));
  });
});

describe('markFailedOrRetry on a thread that partly came down', () => {
  const exhausted = (extra = {}) => ({ id: 'row-1', attempts: 5, max_attempts: 5, ...extra });

  it('does not claim the post is simply still up', async () => {
    await selfDestruct.markFailedOrRetry(exhausted(), 'nope', { partial: true });
    expect(settled()).toMatchObject({ status: 'failed', resolution: 'part of the thread was deleted, but the first post is still up' });
  });

  it('remembers an earlier attempt took part of it down', async () => {
    await selfDestruct.markFailedOrRetry(exhausted({
      acted: { pending: true, deleted: [uriFor('r1')] },
    }), 'nope');
    expect(settled().resolution).toMatch(/part of the thread was deleted/);
  });

  it('still says the post is up when nothing came down', async () => {
    await selfDestruct.markFailedOrRetry(exhausted(), 'nope');
    expect(settled().resolution).toBe('the post is still up');
  });
});

describe('a token that rotated under several deletes at once', () => {
  it('is refreshed once, not once per request', async () => {
    stubAppView();
    const oauth = deps;
    const stale = { did: DID, id: 'stale' };
    const fresh = { did: DID, id: 'fresh' };
    oauth.restoreSession = vi.fn(async (did, opts) => (opts && opts.fresh ? fresh : stale));
    pdsBehaviour.deleteRecord = async (params, session) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (session && session.id === 'stale') {
        const err = new Error('Invalid token');
        err.error = 'InvalidToken';
        throw err;
      }
      return { data: {} };
    };
    const result = await selfDestruct.resolveSelfDestruct(makeRow({ extra_uris: threadOf(4) }));
    expect(result.outcome).toBe('deleted');
    const refreshes = oauth.restoreSession.mock.calls.filter(([, opts]) => opts && opts.fresh);
    expect(refreshes).toHaveLength(1);
  });
});

// ─── A root that is already gone, with a thread still under it ──────────────
// The 'gone' path is reached BEFORE the rule is evaluated — the counts went
// with the root — so no rule that arrives there has fired. It briefly deleted
// the row's extra_uris (and the root again) whenever the rule WOULD delete if
// it fired, which took an "only if" rule's replies down on a condition that
// never matched. It deletes nothing now, for every rule.

describe('resolveSelfDestruct: a root confirmed gone', () => {
  const conditional = { conditions: withClause({ metric: 'likes', op: 'gte', value: 5 }) };

  it('retires as done and leaves the rest of the thread standing, saying so', async () => {
    stubAppView({ posts: {} });
    stubProbe('gone');
    const result = await selfDestruct.resolveSelfDestruct(makeRow({ ...conditional, extra_uris: threadOf(3) }));
    expect(result.outcome).toBe('gone');
    // Nothing at all: not the replies, and not the root a second time (if the
    // probe was wrong, that would delete a post that was standing).
    expect(pdsCalls).toEqual([]);
    expect(settled().status).toBe('deleted');
    expect(settled().resolution).toBe('the first post was already gone, and the rest of its thread was left as it is');
    // And no pending marker: no verdict was reached.
    expect(dbWrites.some((w) => w.acted && w.acted.pending)).toBe(false);
  });

  it('deletes nothing for an "only if" rule that never matched', async () => {
    // "Delete it only if more than fifty people replied", root deleted by hand.
    // The rule never fired; its replies must not come down.
    stubAppView({ posts: {} });
    stubProbe('gone');
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({ metric: 'replies', op: 'gt', value: 50 }, { sense: 'onlyIf' }),
      extra_uris: threadOf(4),
    }));
    expect(result.outcome).toBe('gone');
    expect(pdsCalls).toEqual([]);
    expect(deleted()).toEqual([]);
  });

  it('never restores a session, since there is nothing to write', async () => {
    stubAppView({ posts: {} });
    stubProbe('gone');
    const oauth = deps;
    oauth.restoreSession = vi.fn(async () => null);
    const result = await selfDestruct.resolveSelfDestruct(makeRow({ ...conditional, extra_uris: threadOf(2) }));
    expect(result.outcome).toBe('gone');
    expect(oauth.restoreSession).not.toHaveBeenCalled();
  });

  it('says only that the post was gone when there was no thread under it', async () => {
    stubAppView({ posts: {} });
    stubProbe('gone');
    await selfDestruct.resolveSelfDestruct(makeRow(conditional));
    expect(settled().resolution).toBe('the post was already gone');
  });
});

// ─── A pending marker that is not a verdict ─────────────────────────────────
// { pending, counts: null, reason: 'the post was already gone' } records no
// decision. Resumed as a fire verdict it would skip the read and the probe and
// go straight to the effects, including a delete of the root. A row carrying
// one is re-evaluated instead.

describe('resolveSelfDestruct: a countless "already gone" marker', () => {
  const goneMarker = {
    pending: true, counts: null, reason: 'the post was already gone', deleted: [uriFor('r3')],
  };

  it('is not resumed: a root still confirmed gone is retired with nothing deleted', async () => {
    stubAppView({ posts: {} });
    stubProbe('gone');
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({ metric: 'replies', op: 'gt', value: 50 }, { sense: 'onlyIf' }),
      extra_uris: threadOf(3),
      acted: goneMarker,
    }));
    expect(result.outcome).toBe('gone');
    expect(pdsCalls).toEqual([]);
    // It was evaluated afresh: the counts were asked for.
    const paths = deps.safeFetchJson.mock.calls.map(([u]) => new URL(u).pathname);
    expect(paths.some((p) => p.endsWith('getPosts'))).toBe(true);
  });

  it('is not resumed when the probe was wrong and the root is standing: the rule decides', async () => {
    // The post is there after all, and the "only if" rule is nowhere near
    // matching. Resumed as a verdict, this deleted the root.
    stubAppView({ posts: { [uriFor('root')]: { likeCount: 0, replyCount: 1, repostCount: 0, quoteCount: 0 } } });
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({ metric: 'replies', op: 'gt', value: 50 }, { sense: 'onlyIf' }),
      extra_uris: threadOf(3),
      acted: goneMarker,
    }));
    expect(result.outcome).toBe('spared');
    expect(deleted()).toEqual([]);
    // And the stale marker does not ride along on the settled row.
    expect(settled().acted).toBeNull();
  });

  it('a real verdict, with its counts, is still resumed', async () => {
    stubAppView({ thread: { replies: [] } });
    const result = await selfDestruct.resolveSelfDestruct(makeRow({
      conditions: withClause({ metric: 'likes', op: 'gte', value: 5 }),
      acted: { pending: true, counts: { likes: 1 }, reason: '1 like' },
    }));
    expect(result.outcome).toBe('deleted');
    const paths = deps.safeFetchJson.mock.calls.map(([u]) => new URL(u).pathname);
    expect(paths.some((p) => p.endsWith('getPosts'))).toBe(false);
  });
});

describe('pinnedVerdict', () => {
  const rule = withClause({ metric: 'likes', op: 'gte', value: 5 });

  it('refuses a countless marker on a rule with clauses', () => {
    expect(selfDestruct.pinnedVerdict(makeRow({
      conditions: rule, acted: { pending: true, counts: null, reason: 'on time' },
    }))).toBeNull();
  });

  it("refuses the gone path's marker whatever the rule", () => {
    expect(selfDestruct.pinnedVerdict(makeRow({
      acted: { pending: true, counts: null, reason: 'the post was already gone' },
    }))).toBeNull();
  });

  it("accepts a plain timer's countless progress marker", () => {
    const marker = { pending: true, counts: null, reason: 'on time', deleted: [uriFor('r1')] };
    expect(selfDestruct.pinnedVerdict(makeRow({ acted: marker }))).toBe(marker);
  });

  it('accepts a verdict with its counts', () => {
    const marker = { pending: true, counts: { likes: 1 }, reason: '1 like' };
    expect(selfDestruct.pinnedVerdict(makeRow({ conditions: rule, acted: marker }))).toBe(marker);
  });

  it('ignores anything that is not a pending marker', () => {
    expect(selfDestruct.pinnedVerdict(makeRow({ acted: [{ action: 'delete', ok: true }] }))).toBeNull();
    expect(selfDestruct.pinnedVerdict(makeRow({ acted: null }))).toBeNull();
  });
});

describe('resolveSelfDestruct: a timer armed after its pinned deadline had passed', () => {
  it('says so in the sentence it settles with', async () => {
    stubAppView();
    await selfDestruct.resolveSelfDestruct(makeRow({ resolution: selfDestruct.MISSED_DEADLINE_NOTE }));
    expect(settled().status).toBe('deleted');
    expect(settled().resolution).toBe(`deleted, on time. ${selfDestruct.MISSED_DEADLINE_NOTE}`);
  });

  it('adds nothing to a row that carries no note', async () => {
    stubAppView();
    await selfDestruct.resolveSelfDestruct(makeRow({ resolution: 'kept for now' }));
    expect(settled().resolution).toBe('deleted, on time');
  });
});
