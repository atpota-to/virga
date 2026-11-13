import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// How the worker reaches the author's account: through the OAuth client's
// restoreSession, by the seam's default wiring (not a stand-in for it). A
// client that never started must read as "couldn't reach the session", with
// the post left up and the library's words kept out of the row.

const restoreSession = vi.fn();
vi.mock('../oauth/client.js', () => ({ getOAuthClient: () => ({ restoreSession }) }));

const selfDestruct = await import('./selfDestruct.js');
const { deps } = selfDestruct;
const realDeps = { ...deps };

const DID = 'did:plc:sessionauthor';
let pdsCalls;
let pdsBehaviour;
let writes;

function FakeAgent(session) {
  const record = (method) => async (params) => {
    pdsCalls.push({ method, session: session.id, ...params });
    const hook = pdsBehaviour[method];
    if (hook) return hook(params, session);
    return { data: {} };
  };
  this.com = { atproto: { repo: { deleteRecord: record('deleteRecord'), putRecord: record('putRecord'), getRecord: record('getRecord') } } };
}

const invalidToken = () => Object.assign(new Error('Invalid token'), { error: 'InvalidToken', status: 400 });
const timerRow = (extra = {}) => ({
  id: 'timer-1', user_did: DID, post_uri: `at://${DID}/app.bsky.feed.post/3kroot`, rkey: '3kroot',
  collection: 'app.bsky.feed.post', extra_uris: [], conditions: {}, effects: null, acted: null,
  attempts: 1, max_attempts: 5, lifespan_seconds: 3600, ...extra,
});

beforeEach(() => {
  pdsCalls = [];
  pdsBehaviour = {};
  writes = [];
  restoreSession.mockReset();
  restoreSession.mockImplementation(async (did, opts) => ({ id: opts && opts.fresh ? 'fresh' : 'session', did }));
  deps.Agent = FakeAgent;
  deps.getSupabaseClient = () => ({
    from: () => ({ update: (payload) => ({ eq: async () => { writes.push(payload); return { error: null }; } }) }),
  });
  deps.safeFetchJson = vi.fn(async () => ({ thread: { replies: [] } }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  Object.assign(deps, realDeps);
  vi.restoreAllMocks();
});

describe('resolveSelfDestruct and the account session', () => {
  it('deletes the post with the restored session', async () => {
    const result = await selfDestruct.resolveSelfDestruct(timerRow());
    expect(result.outcome).toBe('deleted');
    expect(restoreSession).toHaveBeenCalledWith(DID, undefined);
    const deletes = pdsCalls.filter((c) => c.method === 'deleteRecord');
    expect(deletes.length).toBe(3);
    expect(new Set(deletes.map((c) => c.session))).toEqual(new Set(['session']));
  });

  it('fails as SESSION_UNAVAILABLE, with the post left up, when the client never started', async () => {
    restoreSession.mockRejectedValue(new Error('Client authentication method "private_key_jwt" requires at least one active signing key with a "kid" property'));
    const err = await selfDestruct.resolveSelfDestruct(timerRow()).catch((e) => e);
    expect(err).toMatchObject({ code: 'SESSION_UNAVAILABLE' });
    expect(err.message).not.toMatch(/private_key_jwt|signing key/);
    expect(selfDestruct.classifyFailure(err)).toBe('SESSION_UNAVAILABLE');
    expect(pdsCalls).toEqual([]);
    expect(writes.filter((w) => w.status)).toEqual([]);
  });

  it('fails the same way, retriably, when there is no session to restore', async () => {
    restoreSession.mockResolvedValue(null);
    const err = await selfDestruct.resolveSelfDestruct(timerRow()).catch((e) => e);
    expect(err).toMatchObject({ code: 'SESSION_UNAVAILABLE' });
    expect(err.nonRetryable).toBeUndefined();
    expect(pdsCalls).toEqual([]);
  });

  it('shares one fresh restore when the token rotates under the deletes', async () => {
    pdsBehaviour.deleteRecord = async (params, session) => {
      if (session.id === 'session') throw invalidToken();
      return { data: {} };
    };
    const result = await selfDestruct.resolveSelfDestruct(timerRow());
    expect(result.outcome).toBe('deleted');
    const fresh = restoreSession.mock.calls.filter(([, opts]) => opts && opts.fresh);
    expect(fresh).toEqual([[DID, { fresh: true }]]);
  });

  it('keeps the rotated-token error when the fresh restore throws too', async () => {
    restoreSession.mockImplementation(async (did, opts) => {
      if (opts && opts.fresh) throw new Error('refresh failed');
      return { id: 'session', did };
    });
    pdsBehaviour.deleteRecord = async () => { throw invalidToken(); };
    const err = await selfDestruct.resolveSelfDestruct(timerRow()).catch((e) => e);
    expect(err.message).toBe('Invalid token');
    expect(selfDestruct.classifyFailure(err)).toBe('SESSION_UNAVAILABLE');
  });
});
