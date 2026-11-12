import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@atproto/api';
import {
  SIGNIN_PENDING_KEY,
  backendSignOut,
  buildLoginRequest,
  checkBackendSession,
  clearSigninPending,
  createBackendFetchHandler,
  createBackendRequester,
  fetchBackendSession,
  readBackendReturn,
  readSigninPending,
  requestError,
  startBackendSignIn,
  stripReturnFromAddress,
  writeSigninPending,
} from './backendClient.js';

const COCOON = 'https://cocoon.example';
const DID = 'did:plc:virgaharnessmira2zq4x';
const TOKEN = `vg_${'0f'.repeat(32)}`;

// The headers cocoon's preflight allows, per endpoint. Anything else and the
// browser never sends the request.
const PROXY_ALLOWED = ['content-type', 'authorization', 'x-xrpc-method', 'x-pds-url', 'x-atproto-proxy', 'atproto-accept-labelers', 'accept-language', 'x-bsky-topics'];

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A fetch that records each call and answers with `answer(url, init)`. */
function recorder(answer) {
  const calls = [];
  const fn = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init, headers: Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])) });
    return answer(String(url), init);
  });
  fn.calls = calls;
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the login request', () => {
  it('asks Virga’s server for the login address, coming back to the return path with the nonce', () => {
    const { url, returnUrl } = buildLoginRequest({
      backendUrl: COCOON,
      handle: 'mira.example.com',
      origin: 'https://virga.example',
      returnPath: '/oauth/return',
      nonce: 'abc123',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${COCOON}/virga/oauth/login`);
    expect(u.searchParams.get('handle')).toBe('mira.example.com');
    expect(u.searchParams.get('redirect_uri')).toBe('https://virga.example/oauth/return?n=abc123');
    expect(returnUrl).toBe('https://virga.example/oauth/return?n=abc123');
  });
});

describe('startBackendSignIn', () => {
  const base = { backendUrl: COCOON, handle: 'mira.example.com', origin: 'https://virga.example', returnPath: '/oauth/return' };

  it('fetches the address as JSON, notes the nonce for this tab, then goes there', async () => {
    const fetch = recorder(() => json({ success: true, authUrl: 'https://bsky.social/oauth/authorize?request_uri=x' }));
    const sessionStorage = memoryStorage();
    const assign = vi.fn();
    const pending = startBackendSignIn({ ...base, intent: 'reauth', fetch, sessionStorage, assign });
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
    expect(assign).toHaveBeenCalledWith('https://bsky.social/oauth/authorize?request_uri=x');
    expect(fetch.calls[0].headers).toEqual({ accept: 'application/json' });
    const noted = readSigninPending(sessionStorage);
    expect(noted).toMatchObject({ mode: 'backend', intent: 'reauth' });
    expect(new URL(new URL(fetch.calls[0].url).searchParams.get('redirect_uri')).searchParams.get('n')).toBe(noted.nonce);
    expect(noted.nonce).toMatch(/^[0-9a-f]{32}$/);
    // The page is leaving; nothing should run after it.
    const settled = await Promise.race([pending.then(() => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 20))]);
    expect(settled).toBe('pending');
  });

  it('throws the server’s code for a handle that doesn’t resolve, and stays put', async () => {
    const fetch = recorder(() => json({ success: false, code: 'HANDLE_NOT_FOUND', error: 'Could not resolve handle' }, 400));
    const assign = vi.fn();
    const sessionStorage = memoryStorage();
    await expect(startBackendSignIn({ ...base, fetch, sessionStorage, assign })).rejects.toMatchObject({ code: 'HANDLE_NOT_FOUND', status: 400 });
    expect(assign).not.toHaveBeenCalled();
    expect(sessionStorage.map.has(SIGNIN_PENDING_KEY)).toBe(false);
  });

  it('says it couldn’t reach the server when the request fails', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(startBackendSignIn({ ...base, fetch, sessionStorage: memoryStorage(), assign: vi.fn() })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      name: 'TypeError',
    });
  });
});

describe('the pending sign-in', () => {
  it('round-trips and fails soft', () => {
    const s = memoryStorage();
    writeSigninPending(s, { nonce: 'n1', mode: 'backend', intent: 'add' });
    expect(readSigninPending(s)).toEqual({ nonce: 'n1', mode: 'backend', intent: 'add' });
    clearSigninPending(s);
    expect(readSigninPending(s)).toBeNull();
    expect(readSigninPending(memoryStorage({ [SIGNIN_PENDING_KEY]: '{bad' }))).toBeNull();
    expect(readSigninPending(null)).toBeNull();
  });
});

describe('readBackendReturn', () => {
  const pending = { nonce: 'n1', mode: 'backend', intent: 'reauth' };
  const at = (search, hash = '') => ({ pathname: '/oauth/return', search, hash });

  it('takes the token from the fragment when the nonce is this tab’s', () => {
    const r = readBackendReturn(at('?n=n1', `#session=${TOKEN}&did=${encodeURIComponent(DID)}`), pending, '/oauth/return');
    expect(r).toEqual({ kind: 'session', did: DID, token: TOKEN, intent: 'reauth', pending });
  });

  it('refuses a token this tab didn’t ask for', () => {
    for (const p of [null, { nonce: 'other' }]) {
      const r = readBackendReturn(at('?n=n1', `#session=${TOKEN}&did=${DID}`), p, '/oauth/return');
      expect(r.kind).toBe('error');
      expect(r.error.params.get('error')).toBe('unexpected_return');
    }
    const noNonce = readBackendReturn(at('', `#session=${TOKEN}&did=${DID}`), pending, '/oauth/return');
    expect(noNonce.error.params.get('error')).toBe('unexpected_return');
  });

  it('never reads a token from the query', () => {
    const r = readBackendReturn(at(`?n=n1&session=${TOKEN}&did=${DID}`), pending, '/oauth/return');
    expect(r).toBeNull();
  });

  it('refuses a malformed token or DID', () => {
    const r = readBackendReturn(at('?n=n1', `#session=abc&did=${DID}`), pending, '/oauth/return');
    expect(r.error.params.get('error')).toBe('callback_failed');
    const r2 = readBackendReturn(at('?n=n1', `#session=${TOKEN}&did=mira`), pending, '/oauth/return');
    expect(r2.error.params.get('error')).toBe('callback_failed');
  });

  it('shows an error return even without a nonce, since it carries no token', () => {
    const r = readBackendReturn(at('?error=access_denied&error_description=The+user+declined'), null, '/oauth/return');
    expect(r.kind).toBe('error');
    expect(r.error.params.get('error')).toBe('access_denied');
    expect(r.error.message).toBe('The user declined');
    const withNonce = readBackendReturn(at('?n=n1&error=callback_failed'), pending, '/oauth/return');
    expect(withNonce.error.params.get('error')).toBe('callback_failed');
  });

  it('is nothing on any other path, or with nothing to read', () => {
    expect(readBackendReturn({ pathname: '/oauth/callback', search: '?error=x', hash: '' }, pending, '/oauth/return')).toBeNull();
    expect(readBackendReturn(at(''), pending, '/oauth/return')).toBeNull();
  });
});

describe('stripReturnFromAddress', () => {
  it('keeps the path and drops the query and the fragment', () => {
    const replaceState = vi.fn();
    stripReturnFromAddress({ history: { state: null, replaceState }, location: { pathname: '/oauth/return', search: '?n=1', hash: '#session=x' } });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/oauth/return');
  });

  it('survives a history that refuses', () => {
    expect(() =>
      stripReturnFromAddress({
        history: {
          replaceState() {
            throw new Error('SecurityError');
          },
        },
        location: { pathname: '/oauth/return' },
      }),
    ).not.toThrow();
  });
});

describe('the fetch handler', () => {
  it('sends an Agent’s query through the proxy with only the headers the preflight allows', async () => {
    const fetch = recorder(() => json({ success: true, data: { followers: [], subject: { did: DID, handle: 'mira.example.com' } } }));
    const agent = new Agent({ did: DID, fetchHandler: createBackendFetchHandler({ backendUrl: COCOON, token: TOKEN, did: DID, fetch }) });
    const res = await agent.withProxy('bsky_appview', 'did:web:api.bsky.app').app.bsky.graph.getFollowers({ actor: DID, limit: 50 });
    expect(res.data.followers).toEqual([]);

    const call = fetch.calls[0];
    const u = new URL(call.url);
    expect(u.origin + u.pathname).toBe(`${COCOON}/oauth/proxy`);
    expect(u.searchParams.get('actor')).toBe(DID);
    expect(u.searchParams.get('limit')).toBe('50');
    expect(call.init.method).toBe('GET');
    expect(call.init.body).toBeUndefined();
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.headers['x-xrpc-method']).toBe('app.bsky.graph.getFollowers');
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.headers['x-atproto-proxy']).toBe('did:web:api.bsky.app#bsky_appview');
    expect(call.headers['atproto-accept-labelers']).toMatch(/did:plc:/);
    for (const name of Object.keys(call.headers)) expect(PROXY_ALLOWED).toContain(name);
  });

  it('sends a procedure’s body through and reads its answer', async () => {
    const fetch = recorder(() => json({ success: true, data: { uri: `at://${DID}/app.bsky.graph.follow/3k`, cid: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku' } }));
    const agent = new Agent({ did: DID, fetchHandler: createBackendFetchHandler({ backendUrl: COCOON, token: TOKEN, did: DID, fetch }) });
    const res = await agent.com.atproto.repo.createRecord({
      repo: DID,
      collection: 'app.bsky.graph.follow',
      record: { $type: 'app.bsky.graph.follow', subject: 'did:plc:other', createdAt: '2026-11-12T00:00:00.000Z' },
    });
    expect(res.data.uri).toMatch(/^at:\/\//);
    const call = fetch.calls[0];
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(new TextDecoder().decode(call.init.body))).toMatchObject({ repo: DID, collection: 'app.bsky.graph.follow' });
    expect(call.headers['x-xrpc-method']).toBe('com.atproto.repo.createRecord');
    expect(call.headers['x-atproto-proxy']).toBeUndefined();
  });

  it('drops every header the Agent adds that the preflight doesn’t allow', async () => {
    const fetch = recorder(() => json({ success: true, data: {} }));
    const handler = createBackendFetchHandler({ backendUrl: COCOON, token: TOKEN, fetch });
    await handler('/xrpc/app.bsky.actor.getPreferences', { method: 'GET', headers: { 'X-Custom': 'no', 'accept-language': 'en', 'atproto-accept-labelers': ' ' } });
    expect(Object.keys(fetch.calls[0].headers).sort()).toEqual(['authorization', 'content-type', 'x-xrpc-method']);
  });

  it('turns the envelope’s error into an XRPC error with the upstream status', async () => {
    const fetch = recorder(() => json({ success: false, error: 'Could not locate record', code: 'RecordNotFound' }, 400));
    const agent = new Agent({ did: DID, fetchHandler: createBackendFetchHandler({ backendUrl: COCOON, token: TOKEN, fetch }) });
    const err = await agent.com.atproto.repo.getRecord({ repo: DID, collection: 'app.bsky.feed.post', rkey: 'x' }).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.error).toBe('RecordNotFound');
    expect(err.message).toBe('Could not locate record');
  });

  it('passes the rate limit back as headers', async () => {
    const fetch = recorder(() => json({ success: false, error: 'Slow down', code: 'RateLimitExceeded', ratelimit: { 'ratelimit-reset': 1763000000 } }, 429));
    const handler = createBackendFetchHandler({ backendUrl: COCOON, token: TOKEN, fetch });
    const res = await handler('/xrpc/com.atproto.repo.createRecord', { method: 'POST', body: '{}' });
    expect(res.status).toBe(429);
    expect(res.headers.get('ratelimit-reset')).toBe('1763000000');
    expect(await res.json()).toEqual({ error: 'RateLimitExceeded', message: 'Slow down' });
  });

  it('never answers a failure with a 200', async () => {
    const fetch = recorder(() => json({ success: false, error: 'odd' }, 200));
    const res = await createBackendFetchHandler({ backendUrl: COCOON, token: TOKEN, fetch })('/xrpc/app.bsky.actor.getPreferences', {});
    expect(res.status).toBe(502);
  });

  it('hands a 401 to the recovery rules, with the server’s code', async () => {
    const onUnauthorized = vi.fn();
    const fetch = recorder(() => json({ success: false, error: 'gone', code: 'FRONTEND_SESSION_INVALID' }, 401));
    const res = await createBackendFetchHandler({ backendUrl: COCOON, token: TOKEN, did: DID, fetch, onUnauthorized })('/xrpc/app.bsky.actor.getPreferences', {});
    expect(res.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledWith(DID, 'FRONTEND_SESSION_INVALID');
  });

  it('refuses the outputs that are bytes', async () => {
    const fetch = recorder(() => json({}));
    const handler = createBackendFetchHandler({ backendUrl: COCOON, token: TOKEN, fetch });
    await expect(handler(`/xrpc/com.atproto.sync.getRepo?did=${DID}`, {})).rejects.toThrow(/bytes/);
    await expect(handler('/xrpc/com.atproto.sync.getBlob?did=x&cid=y', {})).rejects.toThrow(/bytes/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('uploadBlob through the fetch handler', () => {
  const blob = { $type: 'blob', ref: { $link: 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku' }, mimeType: 'image/png', size: 4 };

  it('posts the bytes to upload-blob with exactly two headers and the type in the query', async () => {
    const fetch = recorder(() => json({ success: true, data: { blob } }));
    const agent = new Agent({ did: DID, fetchHandler: createBackendFetchHandler({ backendUrl: COCOON, token: TOKEN, fetch }) });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const res = await agent.com.atproto.repo.uploadBlob(bytes, { encoding: 'image/png' });
    expect(res.data.blob.mimeType).toBe('image/png');
    expect(res.data.blob.size).toBe(4);

    const call = fetch.calls[0];
    expect(call.url).toBe(`${COCOON}/oauth/upload-blob?encoding=image%2Fpng`);
    expect(call.init.method).toBe('POST');
    expect(call.headers).toEqual({ authorization: `Bearer ${TOKEN}`, 'content-type': 'application/octet-stream' });
    expect(call.init.body).toBe(bytes);
  });

  it('refuses to send a blob with no real type', async () => {
    const fetch = recorder(() => json({ success: true, data: { blob } }));
    const handler = createBackendFetchHandler({ backendUrl: COCOON, token: TOKEN, fetch });
    await expect(handler('/xrpc/com.atproto.repo.uploadBlob', { method: 'POST', body: new Uint8Array(1) })).rejects.toThrow(/real type/);
    await expect(
      handler('/xrpc/com.atproto.repo.uploadBlob', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(1) }),
    ).rejects.toThrow(/real type/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns an upload failure into an XRPC error', async () => {
    const fetch = recorder(() => json({ success: false, error: 'Forward timed out', code: 'PDS_UPLOAD_TIMEOUT' }, 504));
    const res = await createBackendFetchHandler({ backendUrl: COCOON, token: TOKEN, fetch })('/xrpc/com.atproto.repo.uploadBlob', {
      method: 'POST',
      headers: { 'content-type': 'video/mp4' },
      body: new Uint8Array(1),
    });
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: 'PDS_UPLOAD_TIMEOUT', message: 'Forward timed out' });
  });
});

describe('the requester', () => {
  it('resolves to the whole body, sending only the token and a JSON type', async () => {
    const fetch = recorder(() => json({ success: true, moved: 2 }));
    const req = createBackendRequester({ backendUrl: COCOON, token: TOKEN, did: DID, fetch });
    expect(req.did).toBe(DID);
    const body = await req.request('/api/schedule/reorder', { method: 'POST', body: { moves: [] } });
    expect(body).toEqual({ success: true, moved: 2 });
    expect(fetch.calls[0].url).toBe(`${COCOON}/api/schedule/reorder`);
    expect(fetch.calls[0].headers).toEqual({ authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' });
    expect(fetch.calls[0].init.body).toBe('{"moves":[]}');
  });

  it('leaves the type off a request with no body, and puts the query in the address', async () => {
    const fetch = recorder(() => json({ data: [], unavailable: true }));
    const req = createBackendRequester({ backendUrl: COCOON, token: TOKEN, did: DID, fetch });
    expect(await req.request('/api/self-destruct/list', { query: { history: true, ids: ['a', 'b'], skip: null } })).toEqual({ data: [], unavailable: true });
    expect(fetch.calls[0].url).toBe(`${COCOON}/api/self-destruct/list?history=true&ids=a&ids=b`);
    expect(fetch.calls[0].headers).toEqual({ authorization: `Bearer ${TOKEN}` });
  });

  it('reads a bare AI body as it is', async () => {
    const fetch = recorder(() => json({ read: 'fine', monthly_limit: 30 }));
    const req = createBackendRequester({ backendUrl: COCOON, token: TOKEN, did: DID, fetch });
    expect(await req.request('/api/ai/analyze-post', { method: 'POST', body: {} })).toEqual({ read: 'fine', monthly_limit: 30 });
  });

  it('throws with status, code, detail and payload', async () => {
    const quota = { success: false, code: 'QUOTA_EXCEEDED', feature: 'scheduledPosts', error: 'You have 3 of 3' };
    const req = createBackendRequester({ backendUrl: COCOON, token: TOKEN, did: DID, fetch: recorder(() => json(quota, 403)) });
    const err = await req.request('/api/schedule/create', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ status: 403, code: 'QUOTA_EXCEEDED', detail: 'You have 3 of 3', payload: quota, message: 'You have 3 of 3' });
  });

  it('takes a snake-case error as the code, and a sentence as detail only', () => {
    expect(requestError(429, { error: 'monthly_limit' })).toMatchObject({ code: 'monthly_limit', detail: 'monthly_limit' });
    expect(requestError(400, { error: 'Something went wrong' })).toMatchObject({ code: null, detail: 'Something went wrong' });
    expect(requestError(500, null)).toMatchObject({ code: null, detail: null, payload: null, status: 500 });
  });

  it('throws on success: false even with a 200', async () => {
    const req = createBackendRequester({ backendUrl: COCOON, token: TOKEN, did: DID, fetch: recorder(() => json({ success: false, error: 'nope' })) });
    await expect(req.request('/api/x')).rejects.toMatchObject({ status: 200, detail: 'nope' });
  });

  it('hands any 401 to the recovery rules', async () => {
    const onUnauthorized = vi.fn();
    const req = createBackendRequester({ backendUrl: COCOON, token: TOKEN, did: DID, fetch: recorder(() => json({ error: 'Unauthorized' }, 401)), onUnauthorized });
    await expect(req.request('/api/schedule/list')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledWith(DID, null);
  });

  it('says so when the server can’t be reached, and lets a caller’s abort through', async () => {
    const req = createBackendRequester({
      backendUrl: COCOON,
      token: TOKEN,
      did: DID,
      fetch: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    await expect(req.request('/api/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });

    const controller = new AbortController();
    const aborting = createBackendRequester({
      backendUrl: COCOON,
      token: TOKEN,
      did: DID,
      fetch: vi.fn(async (_u, init) => {
        controller.abort();
        throw init.signal.reason || new DOMException('Aborted', 'AbortError');
      }),
    });
    const err = await aborting.request('/api/x', { signal: controller.signal }).catch((e) => e);
    expect(err.name).toBe('AbortError');
  });
});

describe('session checks and sign-out', () => {
  it('probes the lite session with only the token, and reports what came back', async () => {
    const fetch = recorder(() => json({ success: true, authenticated: true, lite: true, oauthSessionMissing: false, user: { did: DID } }));
    const res = await checkBackendSession({ backendUrl: COCOON, token: TOKEN, fetch });
    expect(fetch.calls[0].url).toBe(`${COCOON}/oauth/session?lite=1`);
    expect(fetch.calls[0].headers).toEqual({ authorization: `Bearer ${TOKEN}` });
    expect(res).toMatchObject({ ok: true, status: 200, data: { authenticated: true } });
  });

  it('reads the full session for the grant', async () => {
    const fetch = recorder(() => json({ success: true, authenticated: true, scope: 'atproto', client: 'virga', pds: 'https://pds.example' }));
    const res = await fetchBackendSession({ backendUrl: COCOON, token: TOKEN, fetch });
    expect(fetch.calls[0].url).toBe(`${COCOON}/oauth/session`);
    expect(res.data.scope).toBe('atproto');
  });

  it('turns an unreachable server into a status-0 answer, never a throw', async () => {
    const res = await checkBackendSession({
      backendUrl: COCOON,
      token: TOKEN,
      fetch: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    expect(res).toEqual({ ok: false, status: 0, data: null });
  });

  it('signs this browser’s token out, with the token and a JSON type only', async () => {
    const fetch = recorder(() => json({ success: true }));
    expect(await backendSignOut({ backendUrl: COCOON, token: TOKEN, fetch })).toBe(true);
    expect(fetch.calls[0].url).toBe(`${COCOON}/oauth/logout`);
    expect(fetch.calls[0].init.method).toBe('POST');
    expect(fetch.calls[0].headers).toEqual({ authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' });
  });

  it('never throws from a sign-out, and sends nothing without a token', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await backendSignOut({ backendUrl: COCOON, token: TOKEN, fetch })).toBe(false);
    const idle = vi.fn();
    expect(await backendSignOut({ backendUrl: COCOON, token: null, fetch: idle })).toBe(false);
    expect(idle).not.toHaveBeenCalled();
  });
});
