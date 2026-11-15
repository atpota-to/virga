// A scheduled reply's refs, checked before they are stored, and the look at
// the parent's own PDS before the worker writes the reply: what counts as
// gone, and what only means "couldn't find out".

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  deps,
  isCid,
  normalizeReplyHint,
  parsePostUri,
  probeReplyParent,
  validateReply,
} from './replyTarget.js';
import { CIDS, json } from './testing/fixtures.js';

const DID = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz';
const POST = `at://${DID}/app.bsky.feed.post/3lwcs2m4ock2z`;
const ROOT = `at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3lwcrzq3bbc2y`;
const ref = (uri, cid = CIDS[0]) => ({ uri, cid });

const real = { ...deps };
beforeEach(() => {
  deps.resolvePdsEndpoint = vi.fn(async (did) => ({
    did,
    pdsEndpoint: 'https://pds.example.com',
  }));
  deps.safeFetch = vi.fn(async () => json({ uri: POST, cid: CIDS[0], value: {} }));
});
afterEach(() => {
  Object.assign(deps, real);
  vi.restoreAllMocks();
});

const xrpcError = (error, status = 400) =>
  json({ error, message: `${error}: something` }, status);

describe('parsePostUri', () => {
  it('reads the address of a post', () => {
    expect(parsePostUri(POST)).toEqual({ did: DID, rkey: '3lwcs2m4ock2z' });
    expect(
      parsePostUri('at://did:web:pds.example.com/app.bsky.feed.post/self'),
    ).toEqual({ did: 'did:web:pds.example.com', rkey: 'self' });
  });

  it('refuses anything that isn’t one', () => {
    for (const uri of [
      '',
      null,
      42,
      'https://bsky.app/profile/x/post/3lwcs2m4ock2z',
      // A handle can change hands; a strong ref names a DID.
      'at://alice.example.com/app.bsky.feed.post/3lwcs2m4ock2z',
      `at://${DID}/app.bsky.feed.like/3lwcs2m4ock2z`,
      `at://${DID}/app.bsky.feed.post`,
      `at://${DID}/app.bsky.feed.post/`,
      `at://${DID}/app.bsky.feed.post/..`,
      `at://${DID}/app.bsky.feed.post/a/b`,
      `at://${DID}/app.bsky.feed.post/3lwcs2m4ock2z?x=1`,
      `at://${DID}/app.bsky.feed.post/has space`,
      'at://did:plc:short/app.bsky.feed.post/3lwcs2m4ock2z',
      'at://did:key:z6Mk/app.bsky.feed.post/3lwcs2m4ock2z',
      `at://${DID}/app.bsky.feed.post/${'a'.repeat(700)}`,
    ])
      expect(parsePostUri(uri), String(uri)).toBeNull();
  });
});

describe('isCid', () => {
  it('takes a base32 CID and nothing shorter or stranger', () => {
    for (const cid of CIDS) expect(isCid(cid)).toBe(true);
    for (const cid of ['', 'bafy', 'c1', null, CIDS[0].toUpperCase(), `Q${CIDS[0].slice(1)}`, `${CIDS[0]}!`])
      expect(isCid(cid), String(cid)).toBe(false);
  });
});

describe('validateReply', () => {
  it('is null for a post that isn’t a reply', () => {
    expect(validateReply(null)).toEqual({ value: null });
    expect(validateReply(undefined)).toEqual({ value: null });
  });

  it('keeps the two strong refs and nothing else', () => {
    expect(
      validateReply({
        root: { ...ref(ROOT, CIDS[1]), extra: 1 },
        parent: { ...ref(POST), $type: 'com.atproto.repo.strongRef' },
        author: { handle: 'someone.example.com' },
      }),
    ).toEqual({
      value: { root: ref(ROOT, CIDS[1]), parent: ref(POST) },
    });
  });

  it('refuses a missing or malformed ref, naming it', () => {
    expect(validateReply('at://x').error).toBe('reply must be an object');
    expect(validateReply([]).error).toBe('reply must be an object');
    expect(validateReply({ parent: ref(POST) }).error).toBe(
      'reply.root needs a uri and a cid',
    );
    expect(validateReply({ root: ref(ROOT) }).error).toBe(
      'reply.parent needs a uri and a cid',
    );
    expect(
      validateReply({ root: ref(ROOT), parent: ref('at://nope') }).error,
    ).toBe('reply.parent.uri must be the at:// address of a post');
    expect(
      validateReply({ root: ref(ROOT, 'not-a-cid'), parent: ref(POST) }).error,
    ).toBe('reply.root.cid must be a CID');
  });

  it('refuses one post named with two cids', () => {
    expect(
      validateReply({ root: ref(POST, CIDS[0]), parent: ref(POST, CIDS[1]) }).error,
    ).toMatch(/same post with different cids/);
    expect(
      validateReply({ root: ref(POST), parent: ref(POST) }).value.parent,
    ).toEqual(ref(POST));
  });
});

describe('normalizeReplyHint', () => {
  it('keeps who and the start of what was said, bounded', () => {
    expect(
      normalizeReplyHint({
        handle: ' ada.example.com ',
        displayName: 'Ada',
        text: 'x'.repeat(500),
        avatar: 'https://cdn.example/a.jpg',
      }),
    ).toEqual({
      handle: 'ada.example.com',
      displayName: 'Ada',
      text: 'x'.repeat(300),
    });
  });

  it('is null when it says nothing', () => {
    for (const raw of [null, undefined, 'ada', {}, { handle: 7, text: '  ' }])
      expect(normalizeReplyHint(raw)).toBeNull();
  });
});

describe('probeReplyParent', () => {
  it('asks the parent’s own PDS for the record, through the safe fetch', async () => {
    expect(await probeReplyParent(POST)).toEqual({ state: 'there' });
    expect(deps.resolvePdsEndpoint).toHaveBeenCalledWith(DID);
    const [url, options] = deps.safeFetch.mock.calls[0];
    expect(url).toBe(
      `https://pds.example.com/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(DID)}&collection=app.bsky.feed.post&rkey=3lwcs2m4ock2z`,
    );
    expect(options.timeoutMs).toBe(10_000);
  });

  it('says gone when the repo says there is no such record', async () => {
    deps.safeFetch.mockResolvedValue(xrpcError('RecordNotFound'));
    expect(await probeReplyParent(POST)).toEqual({ state: 'gone', reason: 'post' });
  });

  it('says gone when the PDS no longer serves the account', async () => {
    for (const error of ['RepoNotFound', 'RepoTakendown', 'RepoDeactivated', 'RepoSuspended']) {
      deps.safeFetch.mockResolvedValue(xrpcError(error));
      expect(await probeReplyParent(POST), error).toEqual({
        state: 'gone',
        reason: 'account',
      });
    }
  });

  it('reads the reference PDS’s words for a repo it doesn’t hold', async () => {
    deps.safeFetch.mockResolvedValue(
      json({ error: 'InvalidRequest', message: `Could not find repo: ${DID}` }, 400),
    );
    expect(await probeReplyParent(POST)).toEqual({ state: 'gone', reason: 'account' });
  });

  it('says gone when the PLC directory has no such DID, or a tombstone', async () => {
    for (const status of [404, 410]) {
      deps.resolvePdsEndpoint.mockRejectedValue(
        Object.assign(new Error(`PLC directory lookup failed: HTTP ${status}`), { status }),
      );
      expect(await probeReplyParent(POST), String(status)).toEqual({
        state: 'gone',
        reason: 'account',
      });
    }
    expect(deps.safeFetch).not.toHaveBeenCalled();
  });

  it('says unknown, never gone, for anything that isn’t the repo’s own answer', async () => {
    const unknowns = [
      () => deps.safeFetch.mockResolvedValue(xrpcError('RateLimitExceeded', 429)),
      () => deps.safeFetch.mockResolvedValue(xrpcError('InternalServerError', 500)),
      () => deps.safeFetch.mockResolvedValue(xrpcError('InvalidRequest', 400)),
      () => deps.safeFetch.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 })),
      () => deps.safeFetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      () => deps.safeFetch.mockRejectedValue(new Error('pds.example.com resolves to blocked IP 10.0.0.1')),
    ];
    for (const arrange of unknowns) {
      arrange();
      expect((await probeReplyParent(POST)).state).toBe('unknown');
    }
  });

  it('says unknown when the DID can’t be resolved for any other reason', async () => {
    deps.resolvePdsEndpoint.mockRejectedValue(
      Object.assign(new Error('PLC directory lookup failed: HTTP 503'), { status: 503 }),
    );
    expect(await probeReplyParent(POST)).toEqual({
      state: 'unknown',
      detail: 'PLC directory lookup failed: HTTP 503',
    });
    deps.resolvePdsEndpoint.mockRejectedValue(new Error('No PDS endpoint found'));
    expect((await probeReplyParent(POST)).state).toBe('unknown');
    // A did:web host that 404s may only be a site having a bad day.
    deps.resolvePdsEndpoint.mockRejectedValue(Object.assign(new Error('HTTP 404'), { status: 404 }));
    expect(
      (await probeReplyParent('at://did:web:pds.example.com/app.bsky.feed.post/abc')).state,
    ).toBe('unknown');
    deps.resolvePdsEndpoint.mockResolvedValue({});
    expect((await probeReplyParent(POST)).state).toBe('unknown');
  });

  it('says unknown for an address it can’t read, without asking anyone', async () => {
    expect((await probeReplyParent('at://nope')).state).toBe('unknown');
    expect(deps.resolvePdsEndpoint).not.toHaveBeenCalled();
  });
});
