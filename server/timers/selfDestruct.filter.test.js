// Reading a filtered count is the one part of a rule that costs more than a
// single call, so what it asks for, when it stops asking, and what it says when
// it had to stop early are all worth pinning down. Everything here runs against
// a stubbed AppView: no network, no session, no PDS.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Every AppView read goes through the module's `deps` seam, so replacing
// deps.safeFetchJson steers them with no network.
import {
  deps,
  readFilteredQuotes,
  readFollowSet,
  readFilteredCounts,
  collectThreadRecords,
  normalizeConditions,
  clauseCountKey,
  _resetFollowsCache,
} from './selfDestruct.js';

const stranger = (n) => `did:plc:stranger${n}`;
const friend = (n) => `did:plc:friend${n}`;

/**
 * Stand in for the AppView.
 *
 * `quotes` is a list of pages, each a list of quoting DIDs; `follows` is who
 * the author follows; `followers` is a DID -> follower count. Anyone missing
 * from `followers` is a profile the AppView would not describe.
 */
function stubAppView({ quotes = [], follows = [], followers = {} } = {}) {
  deps.safeFetchJson = vi.fn(async (raw) => {
    const url = new URL(raw);
    if (url.pathname.endsWith('getQuotes')) {
      const page = Number(url.searchParams.get('cursor') || 0);
      const dids = quotes[page] || [];
      return {
        posts: dids.map((did, i) => ({ uri: `at://${did}/app.bsky.feed.post/q${page}${i}`, author: { did } })),
        cursor: page + 1 < quotes.length ? String(page + 1) : undefined,
      };
    }
    if (url.pathname.endsWith('getProfiles')) {
      const asked = url.searchParams.getAll('actors');
      return {
        profiles: asked
          .filter((did) => did in followers)
          .map((did) => ({ did, followersCount: followers[did] })),
      };
    }
    if (url.pathname.endsWith('getFollows')) {
      const page = Number(url.searchParams.get('cursor') || 0);
      const size = 100;
      const slice = follows.slice(page * size, (page + 1) * size);
      return {
        follows: slice.map((did) => ({ did })),
        cursor: (page + 1) * size < follows.length ? String(page + 1) : undefined,
      };
    }
    throw new Error(`unexpected call: ${url.pathname}`);
  });
}

/** Every AppView path this read asked for, in order. */
const calledPaths = () =>
  deps.safeFetchJson.mock.calls.map(([u]) => new URL(u).pathname);

let seq = 0;
// The follow set is cached per account, so every test gets its own DID rather
// than reading a set some earlier test warmed.
const freshRow = () => {
  seq += 1;
  const did = `did:plc:author${seq}`;
  return { user_did: did, post_uri: `at://${did}/app.bsky.feed.post/root`, rkey: 'root' };
};

const realFetchJson = deps.safeFetchJson;

beforeEach(() => {
  _resetFollowsCache();
  deps.safeFetchJson = vi.fn();
});
afterEach(() => {
  deps.safeFetchJson = realFetchJson;
});

describe('readFilteredQuotes', () => {
  it('counts only quotes from people the author does not follow', async () => {
    const row = freshRow();
    stubAppView({
      quotes: [[friend(1), stranger(1), friend(2), stranger(2), stranger(3)]],
      follows: [friend(1), friend(2)],
    });

    const clause = { metric: 'quotes', op: 'gte', value: 10, from: { match: 'any', notFollowed: true, followersOver: null } };
    const result = await readFilteredQuotes(row, clause);
    expect(result.count).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('never asks for a profile when only the follow test is on', async () => {
    const row = freshRow();
    stubAppView({ quotes: [[stranger(1)]], follows: [] });

    const clause = { metric: 'quotes', op: 'gte', value: 10, from: { match: 'any', notFollowed: true, followersOver: null } };
    await readFilteredQuotes(row, clause);
    expect(calledPaths().some((p) => p.endsWith('getProfiles'))).toBe(false);
  });

  it('counts by follower size when that is what the rule asks', async () => {
    const row = freshRow();
    stubAppView({
      quotes: [[stranger(1), stranger(2), stranger(3)]],
      followers: { [stranger(1)]: 50000, [stranger(2)]: 12, [stranger(3)]: 10001 },
    });

    const clause = { metric: 'quotes', op: 'gte', value: 10, from: { match: 'any', notFollowed: false, followersOver: 10000 } };
    expect((await readFilteredQuotes(row, clause)).count).toBe(2);
  });

  it('leaves out a quoter the AppView will not describe', async () => {
    // A blocked or deleted account must not be able to push a rule over its
    // threshold by being unreadable.
    const row = freshRow();
    stubAppView({ quotes: [[stranger(1), stranger(2)]], followers: { [stranger(1)]: 90000 } });

    const clause = { metric: 'quotes', op: 'gte', value: 10, from: { match: 'any', notFollowed: false, followersOver: 10000 } };
    expect((await readFilteredQuotes(row, clause)).count).toBe(1);
  });

  it('takes either test under "any"', async () => {
    const row = freshRow();
    stubAppView({
      quotes: [[friend(1), stranger(1)]],
      follows: [friend(1)],
      followers: { [friend(1)]: 90000, [stranger(1)]: 3 },
    });

    const clause = { metric: 'quotes', op: 'gte', value: 10, from: { match: 'any', notFollowed: true, followersOver: 10000 } };
    // The friend is big, the stranger is not followed. Both count.
    expect((await readFilteredQuotes(row, clause)).count).toBe(2);
  });

  it('needs both tests under "all"', async () => {
    const row = freshRow();
    stubAppView({
      quotes: [[friend(1), stranger(1), stranger(2)]],
      follows: [friend(1)],
      followers: { [friend(1)]: 90000, [stranger(1)]: 3, [stranger(2)]: 90000 },
    });

    const clause = { metric: 'quotes', op: 'gte', value: 10, from: { match: 'all', notFollowed: true, followersOver: 10000 } };
    // Only stranger 2 is both unfollowed and large.
    expect((await readFilteredQuotes(row, clause)).count).toBe(1);
  });

  it('stops as soon as the rule has its answer', async () => {
    const row = freshRow();
    const page = () => Array.from({ length: 100 }, (_, i) => stranger(`${i}`));
    stubAppView({ quotes: [page(), page(), page()], follows: [] });

    const clause = { metric: 'quotes', op: 'gte', value: 3, from: { match: 'any', notFollowed: true, followersOver: null } };
    const result = await readFilteredQuotes(row, clause);
    expect(result.count).toBeGreaterThanOrEqual(3);
    expect(result.truncated).toBe(false);
    expect(calledPaths().filter((p) => p.endsWith('getQuotes'))).toHaveLength(1);
  });

  it('says it stopped early rather than letting a floor read as a total', async () => {
    // Six pages of quotes, none of them matching, against a five-page cap. The
    // count is a floor, and the row has to say so: "the rule did not fire" and
    // "we did not finish looking" must not look the same to a reader.
    const row = freshRow();
    const page = () => Array.from({ length: 100 }, (_, i) => friend(`${i}`));
    stubAppView({
      quotes: [page(), page(), page(), page(), page(), page()],
      follows: Array.from({ length: 100 }, (_, i) => friend(`${i}`)),
    });

    const clause = { metric: 'quotes', op: 'gte', value: 50, from: { match: 'any', notFollowed: true, followersOver: null } };
    const result = await readFilteredQuotes(row, clause);
    expect(result.count).toBe(0);
    expect(result.truncated).toBe(true);
  });

  it('says it stopped early when the AppView empties a page but keeps paging', async () => {
    // The AppView answers a page with no posts and a cursor when it hid
    // everything on it — blocked, muted or taken-down quoters — and there is
    // more behind. The walk stops there, which is right; calling the count
    // finished is not. Three strangers exist and the rule wanted three, so
    // reading this as a complete "1" is the difference between sparing the
    // post and deleting it.
    const row = freshRow();
    stubAppView({
      quotes: [[stranger(1)], [], [stranger(2), stranger(3)]],
      follows: [],
    });

    const clause = { metric: 'quotes', op: 'gte', value: 3, from: { match: 'any', notFollowed: true, followersOver: null } };
    const result = await readFilteredQuotes(row, clause);
    expect(result.count).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it('is finished, not truncated, when the last page is simply the last', async () => {
    // The other half of the pair: an empty final page with NO cursor is the
    // AppView saying there is nothing more. That count is complete, and a
    // rule is allowed to fire on it.
    const row = freshRow();
    stubAppView({ quotes: [[stranger(1)], []], follows: [] });

    const clause = { metric: 'quotes', op: 'gte', value: 3, from: { match: 'any', notFollowed: true, followersOver: null } };
    const result = await readFilteredQuotes(row, clause);
    expect(result.count).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('reads "more than" as one past the number', async () => {
    const row = freshRow();
    stubAppView({ quotes: [[stranger(1), stranger(2)]], follows: [] });

    const gt = { metric: 'quotes', op: 'gt', value: 2, from: { match: 'any', notFollowed: true, followersOver: null } };
    // Two strangers is not more than two, so the scan runs out rather than
    // stopping at the target.
    expect((await readFilteredQuotes(row, gt)).count).toBe(2);
  });
});

describe('collectThreadRecords when the thread cannot be read', () => {
  // The root is already gone, and a plain unconditional timer reaches the
  // delete with no earlier existence check — so this read is the first thing
  // it does. Answering that with an empty list is right: there are no replies
  // to walk, and the deletes that follow are idempotent no-ops. Throwing wedges
  // the row instead, burning its attempts until it lands on 'failed' with the
  // thread half-collected.
  const row = () => ({
    user_did: 'did:plc:author', post_uri: 'at://did:plc:author/app.bsky.feed.post/root',
    rkey: 'root', collection: 'app.bsky.feed.post', extra_uris: [],
  });

  it('answers with an empty list when the AppView says there is no such thread', async () => {
    // getPostThread's one declared error, as the reference AppView sends it
    // for a root it cannot find — and as safe-fetch now carries it.
    deps.safeFetchJson = vi.fn(async () => {
      const err = new Error('HTTP 400');
      err.status = 400;
      err.error = 'NotFound';
      throw err;
    });
    await expect(collectThreadRecords(row())).resolves.toEqual([]);
  });

  it('throws on a rate limit — a 429 is a 4xx, and says nothing about the thread', async () => {
    // Read as "no thread", this took the root and the armed replies down and
    // left any late self-reply standing under nothing.
    deps.safeFetchJson = vi.fn(async () => {
      const err = new Error('HTTP 429');
      err.status = 429;
      err.error = 'RateLimitExceeded';
      throw err;
    });
    await expect(collectThreadRecords(row())).rejects.toMatchObject({ code: 'ENGAGEMENT_UNAVAILABLE' });
  });

  it('throws on a 400 that is not NotFound', async () => {
    deps.safeFetchJson = vi.fn(async () => {
      const err = new Error('HTTP 400');
      err.status = 400;
      err.error = 'InvalidRequest';
      throw err;
    });
    await expect(collectThreadRecords(row())).rejects.toThrow(/left up/);
  });

  it('throws on a 4xx that carries no error name at all', async () => {
    // A bare status cannot tell an answer from a failure.
    deps.safeFetchJson = vi.fn(async () => {
      const err = new Error('HTTP 400');
      err.status = 400;
      throw err;
    });
    await expect(collectThreadRecords(row())).rejects.toThrow(/left up/);
  });

  it('throws when the read failed for a reason that is not an answer', async () => {
    // A 5xx, a timeout, a network error: not knowing. Spending that as
    // knowledge is what leaves replies standing under a deleted root.
    deps.safeFetchJson = vi.fn(async () => {
      const err = new Error('HTTP 503');
      err.status = 503;
      throw err;
    });
    await expect(collectThreadRecords(row())).rejects.toThrow(/left up/);
  });

  it('throws on an error carrying no status at all', async () => {
    deps.safeFetchJson = vi.fn(async () => { throw new Error('socket hang up'); });
    await expect(collectThreadRecords(row())).rejects.toThrow(/left up/);
  });

  it('never reads the thread when the caller already has it', async () => {
    deps.safeFetchJson = vi.fn(async () => { throw new Error('should not be called'); });
    const parts = await collectThreadRecords(row(), { selfReplyUris: [] });
    expect(parts).toEqual([]);
    expect(deps.safeFetchJson).not.toHaveBeenCalled();
  });
});

describe('readFollowSet', () => {
  it('pages through the whole list', async () => {
    const row = freshRow();
    const follows = Array.from({ length: 250 }, (_, i) => friend(`${i}`));
    stubAppView({ follows });

    const set = await readFollowSet(row.user_did);
    expect(set.dids.size).toBe(250);
    expect(set.truncated).toBe(false);
  });

  it('reads it once and holds on to it', async () => {
    const row = freshRow();
    stubAppView({ follows: [friend(1)] });

    await readFollowSet(row.user_did);
    const first = calledPaths().length;
    await readFollowSet(row.user_did);
    expect(calledPaths()).toHaveLength(first);
  });
});

describe('readFilteredCounts', () => {
  it('files each clause under its own key', async () => {
    const row = freshRow();
    stubAppView({
      quotes: [[friend(1), stranger(1), stranger(2)]],
      follows: [friend(1)],
      followers: { [friend(1)]: 90000, [stranger(1)]: 4, [stranger(2)]: 7 },
    });

    const conditions = normalizeConditions({
      logic: 'any',
      clauses: [
        { metric: 'quotes', op: 'gte', value: 9, from: { notFollowed: true } },
        { metric: 'quotes', op: 'gte', value: 9, from: { followersOver: 10000 } },
      ],
    });
    const counts = await readFilteredCounts(row, conditions);
    expect(counts[clauseCountKey(conditions.clauses[0])]).toBe(2);
    expect(counts[clauseCountKey(conditions.clauses[1])]).toBe(1);
  });

  it('asks for nothing when no clause has a filter', async () => {
    const row = freshRow();
    stubAppView({});
    const counts = await readFilteredCounts(row, normalizeConditions({ clauses: [{ metric: 'likes', value: 5 }] }));
    expect(counts).toEqual({});
    expect(deps.safeFetchJson).not.toHaveBeenCalled();
  });

  it('turns a failed read into a retry, so the post stays up', async () => {
    const row = freshRow();
    deps.safeFetchJson = vi.fn().mockRejectedValue(new Error('the AppView timed out'));

    const conditions = normalizeConditions({
      clauses: [{ metric: 'quotes', op: 'gte', value: 5, from: { followersOver: 10000 } }],
    });
    await expect(readFilteredCounts(row, conditions)).rejects.toMatchObject({
      code: 'ENGAGEMENT_UNAVAILABLE',
    });
  });
});

describe('readFilteredQuotes counts people, not quote posts', () => {
  // A filtered clause is a question about WHO is talking about the post. One
  // stranger quoting five times is not five strangers, and the author quoting
  // their own post is not the post leaving their circle, though a bare "not
  // followed" test would count it, since nobody follows themselves.
  const notFollowed = (value) => ({
    metric: 'quotes', op: 'gte', value, from: { match: 'any', notFollowed: true, followersOver: null },
  });

  it("never counts the author's own quotes", async () => {
    const row = freshRow();
    stubAppView({ quotes: [[row.user_did, row.user_did, stranger(1)]], follows: [] });
    const result = await readFilteredQuotes(row, notFollowed(3));
    expect(result.count).toBe(1);
  });

  it('counts a person who quoted several times once', async () => {
    const row = freshRow();
    stubAppView({ quotes: [[stranger(1), stranger(1), stranger(1), stranger(2), stranger(1)]], follows: [] });
    const result = await readFilteredQuotes(row, notFollowed(5));
    expect(result.count).toBe(2);
  });

  it('counts a repeat quoter once across pages too', async () => {
    const row = freshRow();
    stubAppView({ quotes: [[stranger(1), stranger(2)], [stranger(1), stranger(3)]], follows: [] });
    const result = await readFilteredQuotes(row, notFollowed(10));
    expect(result.count).toBe(3);
  });

  it('counts a repeat quoter once when their follower count settles it', async () => {
    // The follower test goes through the batched profile lookup, which is the
    // path most likely to count one person twice.
    const row = freshRow();
    stubAppView({
      quotes: [[stranger(1), stranger(1), stranger(2)]],
      followers: { [stranger(1)]: 50000, [stranger(2)]: 50000 },
    });
    const clause = { metric: 'quotes', op: 'gte', value: 10, from: { match: 'any', notFollowed: false, followersOver: 10000 } };
    expect((await readFilteredQuotes(row, clause)).count).toBe(2);
  });

  it('reads "over" strictly: exactly the number is not over it', async () => {
    const row = freshRow();
    stubAppView({
      quotes: [[stranger(1), stranger(2), stranger(3)]],
      followers: { [stranger(1)]: 10000, [stranger(2)]: 10001, [stranger(3)]: 9999 },
    });
    const clause = { metric: 'quotes', op: 'gte', value: 10, from: { match: 'any', notFollowed: false, followersOver: 10000 } };
    expect((await readFilteredQuotes(row, clause)).count).toBe(1);
  });
});
