import { describe, it, expect, vi } from 'vitest';
import {
  isRetriablePublishError,
  publishWithIdempotentRetry,
  createRecordIdempotent,
  needsThreadgateRecord,
  needsPostgateRecord,
  buildGateWrites,
  createPostWithGates,
  isTransientNetworkError,
} from './publishRecord.js';
import { isTid } from './tid.js';
import { Agent } from '@atproto/api';

// Idempotent post writes, so a slow/timed-out publish can retry without a
// duplicate:
//   • a landed write (getRecord on our rkey) returns success instead of
//     retrying, even when the write call itself errored or timed out;
//   • only transient failures retry; a 4xx throws;
//   • the rkey is fixed across attempts.

const makeAgent = ({ createRecord, applyWrites, getRecord } = {}) => ({
  com: {
    atproto: {
      repo: {
        createRecord: createRecord || vi.fn(),
        applyWrites: applyWrites || vi.fn(),
        // Default: the record is NOT there (no uri) → "not landed".
        getRecord: getRecord || vi.fn(async () => ({ data: {} })),
      },
    },
  },
});

const err = (message, extra) => Object.assign(new Error(message), extra);

describe('isRetriablePublishError', () => {
  it('retries transient failures only', () => {
    expect(isRetriablePublishError({ timedOut: true })).toBe(true);
    expect(isRetriablePublishError({ status: 500 })).toBe(true);
    expect(isRetriablePublishError({ status: 503 })).toBe(true);
    expect(isRetriablePublishError({ status: 429 })).toBe(true);
    expect(isRetriablePublishError({ message: 'fetch failed' })).toBe(true);
    expect(
      isRetriablePublishError({ message: 'UND_ERR_CONNECT_TIMEOUT error' }),
    ).toBe(true);
  });

  it('retries a request the real agent never got an answer to', async () => {
    // @atproto/xrpc reports a fetch that threw as status 1 (ResponseType
    // .Unknown), not as an HTTP status.
    const agent = new Agent({
      did: 'did:plc:x',
      fetchHandler: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const err = await agent.com.atproto.repo
      .createRecord({
        repo: 'did:plc:x',
        collection: 'app.bsky.feed.post',
        record: { text: 'hi' },
      })
      .catch((e) => e);
    expect(err.status).toBe(1);
    expect(isRetriablePublishError(err)).toBe(true);
    // An answer that isn't a transient failure is still not retried.
    expect(isRetriablePublishError({ status: 1, message: 'Bad record' })).toBe(
      false,
    );
  });

  it('does not retry client rejections or nothing', () => {
    expect(
      isRetriablePublishError({ status: 400, message: 'InvalidRequest' }),
    ).toBe(false);
    expect(isRetriablePublishError({ status: 403 })).toBe(false);
    expect(isRetriablePublishError(null)).toBe(false);
  });
});

describe('createRecordIdempotent', () => {
  const base = {
    repo: 'did:plc:x',
    collection: 'app.bsky.feed.post',
    record: { text: 'hi' },
  };

  it('creates once on the happy path and never needs the landed check', async () => {
    const createRecord = vi.fn(async () => ({
      data: { uri: 'at://did:plc:x/app.bsky.feed.post/rk', cid: 'c' },
    }));
    const getRecord = vi.fn();
    const data = await createRecordIdempotent(
      makeAgent({ createRecord, getRecord }),
      base,
    );
    expect(data.uri).toBe('at://did:plc:x/app.bsky.feed.post/rk');
    expect(createRecord).toHaveBeenCalledTimes(1);
    expect(getRecord).not.toHaveBeenCalled();
  });

  it('retries a transient failure and succeeds on the second attempt', async () => {
    const createRecord = vi
      .fn()
      .mockRejectedValueOnce(err('server blip', { status: 503 }))
      .mockResolvedValueOnce({ data: { uri: 'at://landed' } });
    const getRecord = vi.fn(async () => ({ data: {} })); // not landed after first failure
    const data = await createRecordIdempotent(
      makeAgent({ createRecord, getRecord }),
      base,
    );
    expect(data.uri).toBe('at://landed');
    expect(createRecord).toHaveBeenCalledTimes(2);
    expect(getRecord).toHaveBeenCalledTimes(1);
  });

  it('reuses the SAME rkey across attempts (a retry cannot duplicate)', async () => {
    const createRecord = vi
      .fn()
      .mockRejectedValueOnce(err('blip', { status: 500 }))
      .mockResolvedValueOnce({ data: { uri: 'at://landed' } });
    await createRecordIdempotent(makeAgent({ createRecord }), base);
    const rkey1 = createRecord.mock.calls[0][0].rkey;
    const rkey2 = createRecord.mock.calls[1][0].rkey;
    expect(rkey1).toBeTruthy();
    expect(rkey2).toBe(rkey1);
  });

  it('returns the landed record when the write timed out but actually succeeded', async () => {
    const createRecord = vi.fn(() => new Promise(() => {})); // never resolves → times out
    const getRecord = vi.fn(async () => ({
      data: { uri: 'at://landed-after-timeout' },
    }));
    const data = await createRecordIdempotent(
      makeAgent({ createRecord, getRecord }),
      base,
      { timeoutMs: 30 },
    );
    expect(data.uri).toBe('at://landed-after-timeout');
    expect(createRecord).toHaveBeenCalledTimes(1); // no retry — it already landed
  });

  it('treats a duplicate-rkey rejection as success when the record is present', async () => {
    const createRecord = vi.fn(async () => {
      throw err('Record already exists', { status: 400 });
    });
    const getRecord = vi.fn(async () => ({ data: { uri: 'at://dup-landed' } }));
    const data = await createRecordIdempotent(
      makeAgent({ createRecord, getRecord }),
      base,
    );
    expect(data.uri).toBe('at://dup-landed');
    expect(createRecord).toHaveBeenCalledTimes(1); // landed → no retry despite the error
  });

  it('throws a genuine 4xx immediately without retrying', async () => {
    const createRecord = vi.fn(async () => {
      throw err('InvalidRequest', { status: 400 });
    });
    const getRecord = vi.fn(async () => ({ data: {} })); // not landed
    await expect(
      createRecordIdempotent(makeAgent({ createRecord, getRecord }), base),
    ).rejects.toThrow('InvalidRequest');
    expect(createRecord).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries when the write never lands', async () => {
    const createRecord = vi.fn(async () => {
      throw err('still down', { status: 502 });
    });
    const getRecord = vi.fn(async () => ({ data: {} }));
    await expect(
      createRecordIdempotent(makeAgent({ createRecord, getRecord }), base),
    ).rejects.toThrow('still down');
    expect(createRecord).toHaveBeenCalledTimes(2);
  });
});

describe('publishWithIdempotentRetry (applyWrites shape)', () => {
  it('checks the landed post under the caller-supplied rkey', async () => {
    const applyWrites = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('blip'), { status: 500 }))
      .mockResolvedValueOnce({ data: {} });
    const getRecord = vi.fn(async () => ({ data: {} })); // not landed after first failure
    const agent = makeAgent({ applyWrites, getRecord });
    await publishWithIdempotentRetry(
      agent,
      async () => (await agent.com.atproto.repo.applyWrites()).data,
      {
        repo: 'did:plc:x',
        collection: 'app.bsky.feed.post',
        rkey: 'fixedrkey',
      },
    );
    expect(applyWrites).toHaveBeenCalledTimes(2);
    expect(getRecord).toHaveBeenCalledWith({
      repo: 'did:plc:x',
      collection: 'app.bsky.feed.post',
      rkey: 'fixedrkey',
    });
  });
});

// An EMPTY threadgate allow array is a real gate ("nobody can reply"); only
// null/undefined means no threadgate. A length > 0 check would publish
// "nobody" posts open to everybody.

describe('needsThreadgateRecord / needsPostgateRecord', () => {
  it('treats an empty threadgate allow array as a real gate (nobody can reply)', () => {
    expect(needsThreadgateRecord([])).toBe(true);
    expect(
      needsThreadgateRecord([
        { $type: 'app.bsky.feed.threadgate#mentionRule' },
      ]),
    ).toBe(true);
    expect(needsThreadgateRecord(null)).toBe(false);
    expect(needsThreadgateRecord(undefined)).toBe(false);
  });

  it('only gates quoting when postgate rules are non-empty (empty imposes nothing)', () => {
    expect(
      needsPostgateRecord([{ $type: 'app.bsky.feed.postgate#disableRule' }]),
    ).toBe(true);
    expect(needsPostgateRecord([])).toBe(false);
    expect(needsPostgateRecord(null)).toBe(false);
  });
});

describe('buildGateWrites', () => {
  it('builds a threadgate with allow: [] for "nobody can reply"', () => {
    const writes = buildGateWrites({
      did: 'did:plc:x',
      rkey: 'rk1',
      threadgateRules: [],
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].collection).toBe('app.bsky.feed.threadgate');
    expect(writes[0].rkey).toBe('rk1');
    expect(writes[0].value.allow).toEqual([]);
    expect(writes[0].value.post).toBe('at://did:plc:x/app.bsky.feed.post/rk1');
  });

  it('builds both gates sharing the post rkey, and nothing when no gates apply', () => {
    const both = buildGateWrites({
      did: 'did:plc:x',
      rkey: 'rk2',
      threadgateRules: [{ $type: 'app.bsky.feed.threadgate#followingRule' }],
      postgateRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
    });
    expect(both.map((w) => w.collection)).toEqual([
      'app.bsky.feed.threadgate',
      'app.bsky.feed.postgate',
    ]);
    expect(both.every((w) => w.rkey === 'rk2')).toBe(true);

    expect(
      buildGateWrites({
        did: 'did:plc:x',
        rkey: 'rk3',
        threadgateRules: null,
        postgateRules: [],
      }),
    ).toEqual([]);
  });
});

describe('createPostWithGates', () => {
  const record = {
    $type: 'app.bsky.feed.post',
    text: 'hi',
    createdAt: '2026-07-24T00:00:00.000Z',
  };
  const base = { repo: 'did:plc:x', collection: 'app.bsky.feed.post', record };

  it('falls back to plain idempotent createRecord when no gates apply', async () => {
    const createRecord = vi.fn(async () => ({ data: { uri: 'at://plain' } }));
    const applyWrites = vi.fn();
    const data = await createPostWithGates(
      makeAgent({ createRecord, applyWrites }),
      { ...base, threadgateRules: null, postgateRules: [] },
    );
    expect(data.uri).toBe('at://plain');
    expect(createRecord).toHaveBeenCalledTimes(1);
    expect(applyWrites).not.toHaveBeenCalled();
  });

  it('publishes post + threadgate atomically, sharing one rkey — including allow: [] (nobody)', async () => {
    const applyWrites = vi.fn(async ({ writes }) => ({
      data: {
        results: writes.map((w) => ({
          uri: `at://did:plc:x/${w.collection}/${w.rkey}`,
          cid: 'c',
        })),
      },
    }));
    const createRecord = vi.fn();
    const data = await createPostWithGates(
      makeAgent({ createRecord, applyWrites }),
      { ...base, threadgateRules: [] },
    );

    expect(createRecord).not.toHaveBeenCalled();
    expect(applyWrites).toHaveBeenCalledTimes(1);
    const call = applyWrites.mock.calls[0][0];
    expect(call.repo).toBe('did:plc:x');
    expect(call.validate).toBe(true);
    expect(call.writes).toHaveLength(2);
    expect(call.writes[0].collection).toBe('app.bsky.feed.post');
    expect(call.writes[1].collection).toBe('app.bsky.feed.threadgate');
    expect(call.writes[1].value.allow).toEqual([]);
    expect(call.writes[1].rkey).toBe(call.writes[0].rkey);
    // Return value is normalized to the created POST's { uri, cid }.
    expect(data.uri).toBe(
      `at://did:plc:x/app.bsky.feed.post/${call.writes[0].rkey}`,
    );
  });

  it("never gates replies — the thread root's threadgate governs", async () => {
    const createRecord = vi.fn(async () => ({ data: { uri: 'at://reply' } }));
    const applyWrites = vi.fn();
    const replyRecord = {
      ...record,
      reply: {
        root: { uri: 'at://r', cid: 'c' },
        parent: { uri: 'at://r', cid: 'c' },
      },
    };
    await createPostWithGates(makeAgent({ createRecord, applyWrites }), {
      ...base,
      record: replyRecord,
      threadgateRules: [],
    });
    expect(applyWrites).not.toHaveBeenCalled();
    expect(createRecord).toHaveBeenCalledTimes(1);
  });

  it('never gates non-Bluesky collections', async () => {
    const createRecord = vi.fn(async () => ({ data: { uri: 'at://note' } }));
    const applyWrites = vi.fn();
    await createPostWithGates(makeAgent({ createRecord, applyWrites }), {
      repo: 'did:plc:x',
      collection: 'com.example.note',
      record: { ...record, $type: 'com.example.note' },
      threadgateRules: [{ $type: 'app.bsky.feed.threadgate#mentionRule' }],
    });
    expect(applyWrites).not.toHaveBeenCalled();
    expect(createRecord).toHaveBeenCalledTimes(1);
  });

  it('retries the gate batch under the SAME rkey after a transient failure', async () => {
    const applyWrites = vi
      .fn()
      .mockRejectedValueOnce(err('blip', { status: 500 }))
      .mockResolvedValueOnce({
        data: { results: [{ uri: 'at://landed', cid: 'c' }] },
      });
    const getRecord = vi.fn(async () => ({ data: {} })); // not landed after first failure
    const data = await createPostWithGates(
      makeAgent({ applyWrites, getRecord }),
      { ...base, threadgateRules: [] },
    );
    expect(data.uri).toBe('at://landed');
    expect(applyWrites).toHaveBeenCalledTimes(2);
    const rkey1 = applyWrites.mock.calls[0][0].writes[0].rkey;
    const rkey2 = applyWrites.mock.calls[1][0].writes[0].rkey;
    expect(rkey2).toBe(rkey1);
  });

  it('recovers the real ref via the landed-check if applyWrites returns no results', async () => {
    // A spec-violating applyWrites: HTTP success but no results[]. The retry
    // must fetch the landed post by rkey rather than return a ref-less commit
    // envelope that crashes callers.
    const applyWrites = vi.fn(async () => ({
      data: { commit: { rev: 'r1' } },
    }));
    const getRecord = vi.fn(async () => ({
      data: { uri: 'at://recovered-by-rkey', cid: 'c' },
    }));
    const data = await createPostWithGates(
      makeAgent({ applyWrites, getRecord }),
      { ...base, threadgateRules: [] },
    );
    expect(data.uri).toBe('at://recovered-by-rkey');
    expect(getRecord).toHaveBeenCalled();
  });
});

describe('isTransientNetworkError', () => {
  it('reads socket codes, gateway statuses and the usual messages', () => {
    expect(isTransientNetworkError({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientNetworkError({ cause: { code: 'UND_ERR_SOCKET' } })).toBe(
      true,
    );
    expect(isTransientNetworkError({ status: 504 })).toBe(true);
    expect(isTransientNetworkError(new TypeError('Failed to fetch'))).toBe(
      true,
    );
    expect(
      isTransientNetworkError(
        new Error('Backend temporarily unavailable, please retry'),
      ),
    ).toBe(true);
  });

  it('leaves real refusals alone', () => {
    expect(isTransientNetworkError(null)).toBe(false);
    expect(
      isTransientNetworkError({ status: 400, message: 'InvalidRequest' }),
    ).toBe(false);
  });
});

describe('client record keys', () => {
  it('writes under a TID it minted', async () => {
    const createRecord = vi.fn(async () => ({
      data: { uri: 'at://x', cid: 'c' },
    }));
    const agent = makeAgent({ createRecord });
    await createRecordIdempotent(agent, {
      repo: 'did:plc:me',
      collection: 'app.bsky.feed.post',
      record: {},
    });
    expect(isTid(createRecord.mock.calls[0][0].rkey)).toBe(true);
  });
});
