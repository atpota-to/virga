// The signed-in endpoints: /api/oauth/session, /proxy, /upload-blob and
// /logout, against the fake Supabase and a stand-in OAuth session whose
// fetchHandler plays the PDS. Each case also counts what was read and
// written, so the cheap paths stay cheap.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createFakeSupabase } from '../../test/fakeSupabase.js';
import { createReq, createRes } from '../../test/http.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../../supabase.js';
import { getOAuthClient, resetOAuthForTests } from '../client.js';
import { getStorage, tokenKey } from '../storage.js';
import { TOKEN, installOAuthEnv, tokenOf } from '../testing/env.js';
import sessionHandler from './session.js';
import proxyHandler, { forwardedQuery } from './proxy.js';
import uploadHandler from './uploadBlob.js';
import logoutHandler from './logout.js';

const DID = 'did:plc:virgashared0000000000000';
const PDS = 'https://morel.us-east.host.bsky.network';
const DAY = 24 * 60 * 60 * 1000;
const CID = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const GRANTED = 'atproto repo:app.bsky.feed.post blob:image/*';

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// A restored OAuth session as the Agent sees it. Its PDS answers the calls
// the tests make; `calls` records each one.
function fakeSession({ readStore } = {}) {
  const calls = [];
  return {
    calls,
    did: DID,
    async fetchHandler(url, init) {
      const parsed = new URL(String(url), 'https://pds.invalid');
      calls.push({ path: parsed.pathname, search: parsed.search, init });
      if (readStore) await readStore();
      if (parsed.pathname.endsWith('app.bsky.actor.getPreferences'))
        return json(200, { preferences: [] });
      if (parsed.pathname.endsWith('com.atproto.repo.listRecords'))
        return json(200, { records: [] });
      if (parsed.pathname.endsWith('com.atproto.repo.createRecord')) {
        return json(200, {
          uri: `at://${DID}/app.bsky.feed.post/3kx`,
          cid: CID,
        });
      }
      if (parsed.pathname.endsWith('com.atproto.repo.uploadBlob')) {
        return json(200, {
          blob: {
            $type: 'blob',
            ref: { $link: CID },
            mimeType: new Headers(init?.headers).get('content-type'),
            size: 3,
          },
        });
      }
      return json(404, {
        error: 'MethodNotImplemented',
        message: parsed.pathname,
      });
    },
  };
}

const db = createFakeSupabase();
let env;
let virga;
let session;

beforeAll(async () => {
  env = await installOAuthEnv();
  setSupabaseClientForTests(db);
});

afterAll(() => {
  resetOAuthForTests();
  resetSupabaseClientForTests();
  env.restore();
});

beforeEach(() => {
  db.reset();
  // Each test starts with cold per-instance caches.
  resetOAuthForTests();
  virga = getOAuthClient();
  virga.initPromise.catch(() => {});

  db.rowsOf('frontend_sessions').push({
    token_hash: tokenKey(TOKEN),
    user_did: DID,
    expires_at: new Date(Date.now() + 20 * DAY).toISOString(),
  });
  db.rowsOf('oauth_sessions').push({
    sub: DID,
    session_data: {
      dpopJwk: {},
      tokenSet: {
        sub: DID,
        aud: PDS,
        scope: GRANTED,
        access_token: 'v',
        token_type: 'DPoP',
      },
    },
  });

  const storage = getStorage();
  session = fakeSession({ readStore: () => storage.sessionStore.get(DID) });
  // The real restore reads the stored row (which takes the notes); so does this.
  virga.restoreSession = vi.fn(async (did) => {
    await storage.sessionStore.get(did);
    return session;
  });
  virga.revokeSession = vi.fn(async () => true);

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const touched = () => [...new Set(db.ops.map((o) => o.table))].sort();
const auth = (token) => ({ authorization: `Bearer ${token}` });

describe('/api/oauth/session', () => {
  async function call(token, query = {}) {
    const res = createRes();
    await sessionHandler(
      createReq({
        method: 'GET',
        headers: token ? auth(token) : {},
        query: { action: 'session', ...query },
      }),
      res,
    );
    return res;
  }

  it('answers with the granted scope and the PDS, from the store notes, and fetches nothing', async () => {
    const res = await call(TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      authenticated: true,
      client: 'virga',
      oauthSessionMissing: false,
      scope: GRANTED,
      pds: PDS,
      user: { did: DID },
    });
    expect(session.calls).toEqual([]);
    expect(virga.restoreSession).toHaveBeenCalledWith(DID);
    expect(touched()).toEqual(['frontend_sessions', 'oauth_sessions']);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers the lite probe with one oauth_sessions read and no restore', async () => {
    const res = await call(TOKEN, { lite: '1' });
    expect(res.body).toEqual({
      success: true,
      authenticated: true,
      lite: true,
      client: 'virga',
      oauthSessionMissing: false,
      scope: GRANTED,
      user: { did: DID },
    });
    expect(db.ops.map((o) => `${o.table}:${o.verb}`)).toEqual([
      'frontend_sessions:select',
      'oauth_sessions:select',
    ]);
    expect(virga.restoreSession).not.toHaveBeenCalled();
    expect((await call(TOKEN, { lite: 'true' })).body.lite).toBe(true);
  });

  it('reports a missing grant without a scope, in both forms', async () => {
    db.tables.set('oauth_sessions', []);
    const lite = await call(TOKEN, { lite: '1' });
    expect(lite.body).toMatchObject({ oauthSessionMissing: true });
    expect(lite.body).not.toHaveProperty('scope');

    vi.useFakeTimers();
    virga.restoreSession = vi.fn(async () => null);
    const pending = call(TOKEN);
    await vi.runAllTimersAsync();
    const full = await pending;
    expect(full.body).toMatchObject({
      success: true,
      oauthSessionMissing: true,
    });
    expect(full.body).not.toHaveProperty('scope');
    expect(full.body).not.toHaveProperty('pds');
    // Three tries, 800 ms then 1600 ms apart.
    expect(virga.restoreSession).toHaveBeenCalledTimes(3);
  });

  it('leaves pds out when no read named one', async () => {
    virga.restoreSession = vi.fn(async () => session);
    const res = await call(TOKEN);
    expect(res.body).toMatchObject({ oauthSessionMissing: false });
    expect(res.body).not.toHaveProperty('pds');
  });

  it('refuses an unknown token with the code the client reads as signed out', async () => {
    const res = await call(tokenOf(9));
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: 'Invalid or expired session',
      authenticated: false,
      code: 'FRONTEND_SESSION_INVALID',
    });
  });

  it('refuses a missing header', async () => {
    const res = await call(null);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: 'Missing or invalid authorization header',
      authenticated: false,
    });
  });

  it('answers 503 VALIDATION_TRANSIENT_ERROR when the token store cannot be read', async () => {
    db.failNext('frontend_sessions', 'select');
    const res = await call(tokenOf(8));
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      authenticated: false,
      code: 'VALIDATION_TRANSIENT_ERROR',
    });
  });

  it('answers 503 VIRGA_CLIENT_UNAVAILABLE without a key', async () => {
    const saved = process.env.OAUTH_PRIVATE_KEY_1;
    delete process.env.OAUTH_PRIVATE_KEY_1;
    try {
      const res = await call(TOKEN);
      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('VIRGA_CLIENT_UNAVAILABLE');
    } finally {
      process.env.OAUTH_PRIVATE_KEY_1 = saved;
    }
  });

  it('refuses another method', async () => {
    const res = createRes();
    await sessionHandler(
      createReq({ method: 'POST', headers: auth(TOKEN) }),
      res,
    );
    expect(res.statusCode).toBe(405);
  });
});

describe('/api/oauth/proxy', () => {
  async function call({
    token = TOKEN,
    method = 'GET',
    nsid = 'app.bsky.actor.getPreferences',
    url,
    query = {},
    headers = {},
    body,
  } = {}) {
    const res = createRes();
    await proxyHandler(
      createReq({
        method,
        url,
        query: { action: 'proxy', ...query },
        headers: {
          ...(token ? auth(token) : {}),
          ...(nsid ? { 'x-xrpc-method': nsid } : {}),
          ...headers,
        },
        body,
      }),
      res,
    );
    return res;
  }

  it("acts with the account's grant", async () => {
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { preferences: [] } });
    expect(virga.restoreSession).toHaveBeenCalledWith(DID);
    expect(session.calls.map((c) => c.path)).toEqual([
      '/xrpc/app.bsky.actor.getPreferences',
    ]);
  });

  it('passes the query on as the params, coerced, and never the router segment or a method param', async () => {
    const res = await call({
      nsid: 'com.atproto.repo.listRecords',
      url: `/api/oauth/proxy?repo=${encodeURIComponent(DID)}&collection=app.bsky.feed.post&limit=5&reverse=true&method=app.bsky.actor.getPreferences`,
      query: {
        repo: DID,
        collection: 'app.bsky.feed.post',
        limit: '5',
        reverse: 'true',
        method: 'app.bsky.actor.getPreferences',
      },
    });
    expect(res.statusCode).toBe(200);
    const sent = new URLSearchParams(session.calls[0].search);
    expect(Object.fromEntries(sent)).toEqual({
      repo: DID,
      collection: 'app.bsky.feed.post',
      limit: '5',
      reverse: 'true',
    });
  });

  it('builds the params from the raw URL, with repeated keys as arrays', () => {
    expect(
      forwardedQuery({
        url: '/api/oauth/proxy?uris=a&uris=b&limit=3&validate=false&method=x',
        query: { action: 'proxy' },
      }),
    ).toEqual({ uris: ['a', 'b'], limit: 3, validate: false });
    expect(
      forwardedQuery({ url: '/api/oauth/proxy?actors=a,b', query: {} }),
    ).toEqual({ actors: ['a', 'b'] });
    // A runtime that rewrites the URL to the dynamic route carries the segment in it.
    expect(
      forwardedQuery({
        url: '/api/oauth/[action]?action=proxy&repo=x',
        query: { action: 'proxy' },
      }),
    ).toEqual({ repo: 'x' });
    // No query string at all: Vercel's parsed query, minus the router segment.
    expect(
      forwardedQuery({ url: '/api/oauth/proxy', query: { action: 'proxy' } }),
    ).toEqual({});
  });

  it('sends a POST body as the input', async () => {
    const record = {
      $type: 'app.bsky.feed.post',
      text: 'hello',
      createdAt: new Date().toISOString(),
    };
    const res = await call({
      method: 'POST',
      nsid: 'com.atproto.repo.createRecord',
      body: { repo: DID, collection: 'app.bsky.feed.post', record },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      uri: `at://${DID}/app.bsky.feed.post/3kx`,
      cid: CID,
    });
    expect(session.calls[0].init.method.toUpperCase()).toBe('POST');
    expect(
      JSON.parse(new TextDecoder().decode(session.calls[0].init.body)),
    ).toMatchObject({ repo: DID, record: { text: 'hello' } });
  });

  it('points the call at the AppView X-Atproto-Proxy names, and passes the extra labelers on', async () => {
    await call({
      headers: {
        'x-atproto-proxy': 'did:web:api.bsky.app#bsky_appview',
        'atproto-accept-labelers':
          'did:plc:ar7c4by46qjdydhdevvrndac;redact, did:plc:extralabeler0000000000',
      },
    });
    const sent = new Headers(session.calls[0].init.headers);
    expect(sent.get('atproto-proxy')).toBe('did:web:api.bsky.app#bsky_appview');
    expect(sent.get('atproto-accept-labelers')).toContain(
      'did:plc:extralabeler0000000000',
    );
    expect(sent.get('authorization')).toBeNull();
  });

  it('refuses an unknown token as FRONTEND_SESSION_INVALID, without restoring', async () => {
    const res = await call({ token: tokenOf(9) });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: 'Invalid or expired session',
      code: 'FRONTEND_SESSION_INVALID',
    });
    expect(virga.restoreSession).not.toHaveBeenCalled();
  });

  it('answers a blip in the token store as 503 VALIDATION_TRANSIENT_ERROR', async () => {
    db.failNext('frontend_sessions', 'select');
    const res = await call({ token: tokenOf(8) });
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('VALIDATION_TRANSIENT_ERROR');
  });

  it('needs the method header', async () => {
    const res = await call({
      nsid: null,
      query: { method: 'app.bsky.actor.getPreferences' },
    });
    expect(res.statusCode).toBe(400);
    expect(virga.restoreSession).not.toHaveBeenCalled();
  });

  it.each([
    'fetchHandler',
    'app.bsky',
    'app.__proto__.x',
    'constructor.a.b',
    'app.bsky.actor.getPreferences/../x',
    'APP.bsky.x',
  ])('refuses %s as a method', async (nsid) => {
    const res = await call({ nsid });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'Invalid or unsupported XRPC method',
    });
    expect(virga.restoreSession).not.toHaveBeenCalled();
  });

  it.each([
    'com.atproto.sync.getRepo',
    'com.atproto.sync.getBlob',
    'com.atproto.sync.getRecord',
  ])('refuses %s, which answers in bytes', async (nsid) => {
    const res = await call({ nsid });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(session.calls).toEqual([]);
  });

  it('answers 401 OAUTH_SESSION_MISSING when the grant cannot be restored', async () => {
    vi.useFakeTimers();
    virga.restoreSession = vi.fn(async () => null);
    const pending = call();
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: 'OAuth session missing. Automatic re-authentication required.',
      code: 'OAUTH_SESSION_MISSING',
    });
  });

  it('restores fresh once on "Invalid token", and answers OAUTH_SESSION_MISSING when it persists', async () => {
    vi.useFakeTimers();
    const dead = {
      did: DID,
      fetchHandler: vi.fn(async () =>
        json(400, { error: 'InvalidToken', message: 'Invalid token' }),
      ),
    };
    virga.restoreSession = vi.fn(async () => dead);
    virga.evictSession = vi.fn();
    const pending = call();
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('OAUTH_SESSION_MISSING');
    expect(virga.restoreSession).toHaveBeenLastCalledWith(DID, { fresh: true });
    expect(dead.fetchHandler).toHaveBeenCalledTimes(2);
    expect(virga.evictSession).toHaveBeenCalledWith(DID);
  });

  it('retries a connect failure once, and succeeds', async () => {
    vi.useFakeTimers();
    let first = true;
    const flaky = {
      did: DID,
      async fetchHandler(url, init) {
        if (first) {
          first = false;
          throw Object.assign(new TypeError('fetch failed'), {
            cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
          });
        }
        return session.fetchHandler(url, init);
      },
    };
    virga.restoreSession = vi.fn(async () => flaky);
    const pending = call();
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.statusCode).toBe(200);
  });
});

describe('/api/oauth/upload-blob', () => {
  async function call(
    token,
    {
      body = Buffer.from([1, 2, 3]),
      encoding = 'image/png',
      stream = false,
    } = {},
  ) {
    const res = createRes();
    const query = { action: 'upload-blob', ...(encoding ? { encoding } : {}) };
    await uploadHandler(
      createReq({
        method: 'POST',
        headers: { ...auth(token), 'content-type': 'application/octet-stream' },
        query,
        body,
        stream,
      }),
      res,
    );
    return res;
  }

  it("uploads with the account's grant, with the type from ?encoding=", async () => {
    const res = await call(TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(JSON.parse(JSON.stringify(res.body.data.blob))).toMatchObject({
      $type: 'blob',
      ref: { $link: CID },
      mimeType: 'image/png',
    });
    expect(virga.restoreSession).toHaveBeenCalledWith(DID);
  });

  it('reads the bytes from the request stream when the runtime left the body unparsed', async () => {
    const res = await call(TOKEN, { stream: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.blob).toBeTruthy();
  });

  it('accepts the base64 JSON envelope', async () => {
    const res = createRes();
    await uploadHandler(
      createReq({
        method: 'POST',
        headers: auth(TOKEN),
        body: {
          blob: Buffer.from([1, 2, 3]).toString('base64'),
          encoding: 'image/jpeg',
        },
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.blob.mimeType).toBe('image/jpeg');
  });

  it('refuses a body without bytes or a type', async () => {
    expect((await call(TOKEN, { body: Buffer.alloc(0) })).body).toEqual({
      success: false,
      error: 'Missing blob data',
    });
    expect((await call(TOKEN, { encoding: null })).body).toEqual({
      success: false,
      error: 'Missing encoding/content-type',
    });
  });

  it('tells a transient validation failure from a dead token', async () => {
    const dead = await call(tokenOf(9));
    expect(dead.statusCode).toBe(401);
    expect(dead.body.code).toBe('FRONTEND_SESSION_INVALID');

    db.failNext('frontend_sessions', 'select');
    const blip = await call(tokenOf(8));
    expect(blip.statusCode).toBe(503);
    expect(blip.body.code).toBe('VALIDATION_TRANSIENT_ERROR');
  });

  it('answers 504 PDS_UPLOAD_TIMEOUT after the forward times out twice', async () => {
    process.env.UPLOAD_FORWARD_TIMEOUT_MS = '20';
    try {
      const hung = {
        did: DID,
        fetchHandler: vi.fn(() => new Promise(() => {})),
      };
      virga.restoreSession = vi.fn(async () => hung);
      const res = await call(TOKEN);
      expect(res.statusCode).toBe(504);
      expect(res.body).toEqual({
        success: false,
        error: 'The PDS took too long to accept the upload. Please try again.',
        code: 'PDS_UPLOAD_TIMEOUT',
      });
      expect(hung.fetchHandler).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env.UPLOAD_FORWARD_TIMEOUT_MS;
    }
  });

  it('answers 401 OAUTH_SESSION_MISSING when the grant is dead', async () => {
    vi.useFakeTimers();
    const dead = {
      did: DID,
      fetchHandler: vi.fn(async () =>
        json(401, { error: 'InvalidToken', message: 'Invalid token' }),
      ),
    };
    virga.restoreSession = vi.fn(async () => dead);
    const pending = call(TOKEN);
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('OAUTH_SESSION_MISSING');
  });
});

describe('/api/oauth/logout', () => {
  async function call(token, body = {}) {
    const res = createRes();
    await logoutHandler(
      createReq({
        method: 'POST',
        headers: token ? auth(token) : {},
        body,
      }),
      res,
    );
    return res;
  }

  const writesTo = (table) =>
    db.ops.filter((o) => o.table === table && o.verb !== 'select');

  it('signs out only this device while the DID has another live token', async () => {
    const other = tokenOf(7);
    db.rowsOf('frontend_sessions').push({
      token_hash: tokenKey(other),
      user_did: DID,
      expires_at: new Date(Date.now() + DAY).toISOString(),
    });
    const res = await call(TOKEN);
    expect(res.body).toEqual({
      success: true,
      message: 'Logged out successfully',
      grantRevoked: false,
    });
    expect(db.rowsOf('frontend_sessions').map((r) => r.token_hash)).toEqual([
      tokenKey(other),
    ]);
    expect(db.rowsOf('oauth_sessions')).toHaveLength(1);
    expect(virga.revokeSession).not.toHaveBeenCalled();
  });

  it("revokes the grant with the DID's last live token", async () => {
    // An expired token doesn't keep the grant alive.
    db.rowsOf('frontend_sessions').push({
      token_hash: tokenKey(tokenOf(6)),
      user_did: DID,
      expires_at: new Date(Date.now() - DAY).toISOString(),
    });
    const res = await call(TOKEN);
    expect(res.body).toEqual({
      success: true,
      message: 'Logged out successfully',
      grantRevoked: true,
    });
    expect(virga.revokeSession).toHaveBeenCalledWith(DID);
    expect(db.rowsOf('oauth_sessions')).toEqual([]);
    expect(writesTo('oauth_sessions')).toHaveLength(1);
  });

  it('drops only the token with keepGrant, even on the last device', async () => {
    // A token from a sign-in the app never started: anyone can start one for
    // anyone, so dropping it must not end the grant the workers run on.
    const res = await call(TOKEN, { keepGrant: true });
    expect(res.body).toEqual({
      success: true,
      message: 'Logged out successfully',
      grantRevoked: false,
    });
    expect(db.rowsOf('frontend_sessions')).toEqual([]);
    expect(db.rowsOf('oauth_sessions')).toHaveLength(1);
    expect(virga.revokeSession).not.toHaveBeenCalled();
  });

  it('reads keepGrant only as true', async () => {
    const res = await call(TOKEN, { keepGrant: 'yes' });
    expect(res.body.grantRevoked).toBe(true);
  });

  it('counts, revokes and deletes under the grant lock a sign-in takes', async () => {
    await call(TOKEN);
    expect(db.rpcs.map((r) => [r.name, r.args.p_key])).toEqual([
      ['acquire_oauth_lock', `virga-grant-${DID}`],
      ['release_oauth_lock', `virga-grant-${DID}`],
    ]);
  });

  it('keeps the row when a sign-in minted a token while the grant was revoked', async () => {
    const count = vi
      .spyOn(getStorage().frontendSessionStore, 'countForUser')
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    const res = await call(TOKEN);
    expect(count).toHaveBeenCalledTimes(2);
    expect(virga.revokeSession).toHaveBeenCalledWith(DID);
    expect(res.body.grantRevoked).toBe(false);
    expect(db.rowsOf('oauth_sessions')).toHaveLength(1);
  });

  it('keeps the grant when the count cannot be read', async () => {
    vi.spyOn(
      getStorage().frontendSessionStore,
      'countForUser',
    ).mockResolvedValue(null);
    const res = await call(TOKEN);
    expect(res.body.grantRevoked).toBe(false);
    expect(virga.revokeSession).not.toHaveBeenCalled();
    expect(db.rowsOf('oauth_sessions')).toHaveLength(1);
  });

  it('keeps the token and answers 503 when the store cannot say whose it is', async () => {
    // The last device: deleting the token here would leave nothing to name
    // the DID by, and the grant would never be revoked.
    db.failNext('frontend_sessions', 'select', {
      code: 'XX000',
      message: 'connection reset',
    });
    const res = await call(TOKEN);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      success: false,
      code: 'VALIDATION_TRANSIENT_ERROR',
      error: 'Signing out could not finish. Try again in a moment.',
    });
    expect(writesTo('frontend_sessions')).toEqual([]);
    expect(db.rowsOf('frontend_sessions').map((r) => r.token_hash)).toEqual([
      tokenKey(TOKEN),
    ]);
    expect(virga.revokeSession).not.toHaveBeenCalled();

    // Once the store answers again, the same call finishes the job.
    db.clearFailures();
    const retry = await call(TOKEN);
    expect(retry.body).toMatchObject({ success: true, grantRevoked: true });
    expect(virga.revokeSession).toHaveBeenCalledWith(DID);
    expect(db.rowsOf('oauth_sessions')).toEqual([]);
  });

  it('answers 503 LOGOUT_TRANSIENT_ERROR and keeps the grant when the token cannot be deleted', async () => {
    db.failNext('frontend_sessions', 'delete', {
      code: 'XX000',
      message: 'connection reset',
    });
    const res = await call(TOKEN);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      code: 'LOGOUT_TRANSIENT_ERROR',
    });
    expect(virga.revokeSession).not.toHaveBeenCalled();
    expect(db.rowsOf('oauth_sessions')).toHaveLength(1);
  });

  it('still deletes an unknown token, and nothing else', async () => {
    const res = await call(tokenOf(9));
    expect(res.body).toEqual({
      success: true,
      message: 'Logged out successfully',
      grantRevoked: false,
    });
    expect(virga.revokeSession).not.toHaveBeenCalled();
    expect(touched()).toEqual(['frontend_sessions']);
  });

  it('answers a call with no token as nothing to do', async () => {
    const res = await call(null);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'No session to logout',
    });
    expect(db.ops).toEqual([]);
  });

  it('still deletes the token and the row without a key, skipping only the revoke', async () => {
    const saved = process.env.OAUTH_PRIVATE_KEY_1;
    delete process.env.OAUTH_PRIVATE_KEY_1;
    try {
      const res = await call(TOKEN);
      expect(res.body).toMatchObject({ success: true, grantRevoked: true });
      expect(virga.revokeSession).not.toHaveBeenCalled();
      expect(db.rowsOf('oauth_sessions')).toEqual([]);
    } finally {
      process.env.OAUTH_PRIVATE_KEY_1 = saved;
    }
  });
});
