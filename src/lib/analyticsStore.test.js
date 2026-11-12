import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { analyticsDbName, openAnalyticsStore, resetAnalyticsStore } from './analyticsStore.js';

const DID = 'did:plc:alice';
const OTHER = 'did:plc:bob';

// Just enough IndexedDB to drive an open from the outside: each open() hands
// back a request whose events the test fires.
function fakeIndexedDB() {
  const requests = [];
  const makeDb = () => ({
    objectStoreNames: { contains: () => true },
    closed: false,
    close() {
      this.closed = true;
    },
  });
  return {
    requests,
    open(name) {
      const req = { name, result: null, error: null };
      requests.push(req);
      return req;
    },
    succeed(req) {
      req.result = makeDb();
      req.onsuccess?.();
      return req.result;
    },
  };
}

let idb;

beforeEach(() => {
  vi.useFakeTimers();
  idb = fakeIndexedDB();
  vi.stubGlobal('indexedDB', idb);
  resetAnalyticsStore();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetAnalyticsStore();
});

describe('openAnalyticsStore', () => {
  it('waits out another tab holding an older version instead of giving up', async () => {
    const opening = openAnalyticsStore(DID);
    const [req] = idb.requests;
    req.onblocked();
    await vi.advanceTimersByTimeAsync(1_000);
    // The other tab lets go; the blocked open goes through.
    idb.succeed(req);
    const store = await opening;
    expect(store.persistent).toBe(true);
  });

  it('falls back for now when the block outlasts its wait, and tries again next time', async () => {
    const opening = openAnalyticsStore(DID);
    const [first] = idb.requests;
    first.onblocked();
    await vi.advanceTimersByTimeAsync(5_000);
    const fallback = await opening;
    expect(fallback).toMatchObject({ persistent: false, blocked: true });

    // A late success on the abandoned request is closed, not kept.
    const late = idb.succeed(first);
    expect(late.closed).toBe(true);

    const retry = openAnalyticsStore(DID);
    expect(idb.requests).toHaveLength(2);
    idb.succeed(idb.requests[1]);
    expect((await retry).persistent).toBe(true);
  });

  it('steps aside when a newer build asks to upgrade', async () => {
    const opening = openAnalyticsStore(DID);
    const db = idb.succeed(idb.requests[0]);
    await opening;
    db.onversionchange();
    expect(db.closed).toBe(true);

    openAnalyticsStore(DID);
    expect(idb.requests).toHaveLength(2);
  });
});

describe('one archive per account', () => {
  it('opens a database named for the account', async () => {
    openAnalyticsStore(DID);
    expect(idb.requests[0].name).toBe(analyticsDbName(DID));
    expect(analyticsDbName(DID)).not.toBe(analyticsDbName(OTHER));
  });

  it('shares one connection per account and never one between accounts', async () => {
    const a = openAnalyticsStore(DID);
    const again = openAnalyticsStore(DID);
    const b = openAnalyticsStore(OTHER);
    expect(again).toBe(a);
    expect(b).not.toBe(a);
    expect(idb.requests.map((r) => r.name)).toEqual([
      analyticsDbName(DID),
      analyticsDbName(OTHER),
    ]);
  });

  it('keeps two accounts\u2019 rows apart in the session-only fallback too', async () => {
    vi.stubGlobal('indexedDB', undefined);
    resetAnalyticsStore();
    const alice = await openAnalyticsStore(DID);
    const bob = await openAnalyticsStore(OTHER);
    await alice.putAll('posts', [{ uri: 'at://alice/app.bsky.feed.post/1' }]);
    expect(await bob.all('posts')).toEqual([]);
    expect(await alice.all('posts')).toHaveLength(1);
  });

  it('holds nothing for nobody', async () => {
    const store = await openAnalyticsStore(null);
    expect(store.persistent).toBe(false);
    expect(idb.requests).toHaveLength(0);
  });
});

describe('the session-only fallback', () => {
  it('removes single rows by key, as an unfollow does', async () => {
    vi.stubGlobal('indexedDB', undefined);
    resetAnalyticsStore();
    const store = await openAnalyticsStore(DID);
    expect(store.persistent).toBe(false);
    await store.putAll('following', [
      { uri: 'at://me/app.bsky.graph.follow/a', did: 'did:plc:a' },
      { uri: 'at://me/app.bsky.graph.follow/b', did: 'did:plc:b' },
    ]);
    await store.remove('following', ['at://me/app.bsky.graph.follow/a']);
    expect((await store.all('following')).map((r) => r.did)).toEqual(['did:plc:b']);
  });
});
