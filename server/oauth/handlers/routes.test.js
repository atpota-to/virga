// The sign-in routes: /api/oauth/login, /api/oauth/callback,
// /api/oauth/client-metadata.json and /api/oauth/jwks.json.
//
// The OAuth client is the real one, started from a real ES256 key and
// production-shaped metadata; only its authorize and callback steps are stood
// in for, on the instance getOAuthClient() hands the handlers. What has to hold:
//   - login asks for exactly the app scope, passes nothing else through, and
//     returns only to the return page on an allowed origin;
//   - the callback hands the token over in the fragment only, keeps the
//     page's own query, and writes nothing but the token;
//   - a refused or broken sign-in comes back as ?error=<code>, never a token;
//   - with no key every route is 503 VIRGA_CLIENT_UNAVAILABLE.

import fs from 'node:fs';
import { createRequire } from 'node:module';
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
import { OAUTH_SCOPE } from '../../../src/config.js';
import { getOAuthClient, resetOAuthForTests } from '../client.js';
import { clientMetadata } from '../config.js';
import { installOAuthEnv } from '../testing/env.js';
import { tokenKey } from '../storage.js';
import loginHandler, { resetLoginLimiterForTests } from './login.js';
import callbackHandler from './callback.js';
import metadataHandler from './clientMetadata.js';
import jwksHandler from './jwks.js';
import oauthRouter from '../../../api/oauth/[action].js';

const nodeClientRequire = createRequire(
  createRequire(import.meta.url).resolve('@atproto/oauth-client-node'),
);
const { OAuthResolverError } = nodeClientRequire('@atproto/oauth-client');

const DID = 'did:plc:virgaroutes000000000000';
const RETURN = 'https://virga.example.com/oauth/return?n=nonce123';
const AUTH_URL =
  'https://bsky.social/oauth/authorize?client_id=x&request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3Areq-1';

const db = createFakeSupabase();
let env;
let virga;
let realGenerate;

beforeAll(async () => {
  env = await installOAuthEnv();
  setSupabaseClientForTests(db);
});

afterAll(() => {
  resetOAuthForTests();
  resetSupabaseClientForTests();
  env.restore();
});

beforeEach(async () => {
  db.reset();
  resetOAuthForTests();
  resetLoginLimiterForTests();
  virga = getOAuthClient();
  await virga.initPromise;
  realGenerate = virga.generateLoginUrl.bind(virga);
  virga.generateLoginUrl = vi.fn(async () => AUTH_URL);
  virga.handleCallback = vi.fn();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

async function login(query, headers = { accept: 'application/json' }) {
  const res = createRes();
  await loginHandler(
    createReq({ method: 'GET', query: { action: 'login', ...query }, headers }),
    res,
  );
  return res;
}

async function callback(search) {
  const res = createRes();
  await callbackHandler(
    createReq({
      method: 'GET',
      url: `/api/oauth/callback?${search}`,
      query: { action: 'callback' },
    }),
    res,
  );
  return res;
}

describe('GET /api/oauth/login', () => {
  it('answers a preflight with 204 and no CORS headers of its own', async () => {
    const res = createRes();
    await loginHandler(createReq({ method: 'OPTIONS' }), res);
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses another method', async () => {
    const res = createRes();
    await loginHandler(
      createReq({ method: 'POST', query: { handle: 'reader.example.com' } }),
      res,
    );
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ success: false, error: 'Method not allowed' });
  });

  it('asks for the app scope and remembers the page to return to', async () => {
    const res = await login({
      handle: ' reader.example.com ',
      redirect_uri: RETURN,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, authUrl: AUTH_URL });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(virga.generateLoginUrl).toHaveBeenCalledTimes(1);
    const [handle, options] = virga.generateLoginUrl.mock.calls[0];
    expect(handle).toBe('reader.example.com');
    expect(options.scope).toBe(OAUTH_SCOPE);
    expect(JSON.parse(options.state)).toMatchObject({ redirect_uri: RETURN });
  });

  it("passes nothing else through: not a caller's scope, client_id or anything", async () => {
    await login({
      handle: 'reader.example.com',
      redirect_uri: RETURN,
      scope: 'atproto transition:generic',
      client_id: 'https://evil.example/meta.json',
      redirect_url: 'https://evil.example',
      foo: 'bar',
    });
    const [, options] = virga.generateLoginUrl.mock.calls[0];
    expect(Object.keys(options).sort()).toEqual(['scope', 'state']);
    expect(options.scope).toBe(OAUTH_SCOPE);
  });

  it('passes a known prompt value only', async () => {
    await login({
      handle: 'reader.example.com',
      redirect_uri: RETURN,
      prompt: 'login',
    });
    await login({
      handle: 'reader.example.com',
      redirect_uri: RETURN,
      prompt: 'whatever',
    });
    // A silent sign-in is never the reader's own doing.
    await login({
      handle: 'reader.example.com',
      redirect_uri: RETURN,
      prompt: 'none',
    });
    expect(virga.generateLoginUrl.mock.calls[0][1].prompt).toBe('login');
    expect(virga.generateLoginUrl.mock.calls[1][1]).not.toHaveProperty(
      'prompt',
    );
    expect(virga.generateLoginUrl.mock.calls[2][1]).not.toHaveProperty(
      'prompt',
    );
  });

  it('limits sign-ins per address, answering 429 with Retry-After', async () => {
    const saved = process.env.OAUTH_LOGIN_RATE_LIMIT;
    process.env.OAUTH_LOGIN_RATE_LIMIT = '2';
    try {
      const from = (ip) => ({ accept: 'application/json', 'x-real-ip': ip });
      const query = { handle: 'reader.example.com', redirect_uri: RETURN };
      expect((await login(query, from('203.0.113.7'))).statusCode).toBe(200);
      expect((await login(query, from('203.0.113.7'))).statusCode).toBe(200);
      const refused = await login(query, from('203.0.113.7'));
      expect(refused.statusCode).toBe(429);
      expect(refused.headers['retry-after']).toBe('60');
      expect(refused.body).toMatchObject({
        success: false,
        code: 'RATE_LIMITED',
      });
      // Refused before anything is resolved or stored.
      expect(virga.generateLoginUrl).toHaveBeenCalledTimes(2);
      // Another address has its own window.
      expect((await login(query, from('198.51.100.4'))).statusCode).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.OAUTH_LOGIN_RATE_LIMIT;
      else process.env.OAUTH_LOGIN_RATE_LIMIT = saved;
    }
  });

  it("defaults the return page to OAUTH_PUBLIC_URL's /oauth/return", async () => {
    await login({ handle: 'reader.example.com' });
    expect(
      JSON.parse(virga.generateLoginUrl.mock.calls[0][1].state).redirect_uri,
    ).toBe('https://virga.example.com/oauth/return');
  });

  it('redirects a navigating browser with a 302 and an empty fragment, so none is carried on', async () => {
    const res = await login(
      { handle: 'reader.example.com', redirect_uri: RETURN },
      {},
    );
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe(`${AUTH_URL}#`);
  });

  it.each([
    'https://another-app.example/oauth/return',
    'https://preview-abc.vercel.app/oauth/return',
    'https://virga.example.com.evil.example/oauth/return',
    'http://virga.example.com/oauth/return',
    'javascript:alert(1)',
    'https://virga.example.com/',
    'https://virga.example.com/posting',
    'https://virga.example.com/oauth/return/',
    'https://virga.example.com/api/oauth/login?handle=evil.example&redirect_uri=https%3A%2F%2Fvirga.example.com%2Foauth%2Freturn',
  ])('refuses to return to %s', async (redirect) => {
    const res = await login({
      handle: 'reader.example.com',
      redirect_uri: redirect,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      code: 'REDIRECT_NOT_ALLOWED',
      error:
        "redirect_uri must be Virga's /oauth/return page on an allowed origin.",
    });
    expect(virga.generateLoginUrl).not.toHaveBeenCalled();
  });

  it('accepts an extra allowed origin', async () => {
    const res = await login({
      handle: 'reader.example.com',
      redirect_uri: 'http://localhost:5173/oauth/return?n=1',
    });
    expect(res.statusCode).toBe(200);
  });

  it('needs a handle', async () => {
    const res = await login({ redirect_uri: RETURN });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      code: 'HANDLE_REQUIRED',
      error: 'A handle is required.',
    });
  });

  it('tells an unresolvable handle from a host that failed', async () => {
    virga.generateLoginUrl = vi.fn(async () => {
      const cause = new OAuthResolverError(
        'Failed to resolve identity: nobody.invalid',
      );
      throw new Error(`Failed to initiate OAuth flow: ${cause.message}`, {
        cause,
      });
    });
    const missing = await login({
      handle: 'nobody.invalid',
      redirect_uri: RETURN,
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toEqual({
      success: false,
      code: 'HANDLE_NOT_FOUND',
      error: 'That handle could not be found.',
    });

    virga.generateLoginUrl = vi.fn(async () => {
      const cause = new OAuthResolverError(
        'Failed to resolve OAuth server metadata for resource: https://pds.example',
      );
      throw new Error(`Failed to initiate OAuth flow: ${cause.message}`, {
        cause,
      });
    });
    const down = await login({
      handle: 'reader.example.com',
      redirect_uri: RETURN,
    });
    expect(down.statusCode).toBe(502);
    expect(down.body).toEqual({
      success: false,
      code: 'AUTHORIZE_FAILED',
      error: "The account's host could not start a sign-in.",
    });
  });

  it('answers 502 AUTHORIZE_FAILED for an answer that is not a URL string', async () => {
    virga.generateLoginUrl = vi.fn(async () => null);
    const res = await login({
      handle: 'reader.example.com',
      redirect_uri: RETURN,
    });
    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe('AUTHORIZE_FAILED');
  });

  it("the real client's failure carries the cause the classifier reads", async () => {
    virga.generateLoginUrl = realGenerate;
    const client = await virga.ensureInitialized();
    const authorize = vi
      .spyOn(client, 'authorize')
      .mockRejectedValue(
        new OAuthResolverError('Failed to resolve identity: nobody.invalid'),
      );
    const res = await login({ handle: 'nobody.invalid', redirect_uri: RETURN });
    expect(authorize).toHaveBeenCalledWith(
      'nobody.invalid',
      expect.objectContaining({ scope: OAUTH_SCOPE }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('HANDLE_NOT_FOUND');
  });
});

describe('GET /api/oauth/callback', () => {
  const okState = (redirect = RETURN) =>
    JSON.stringify({ redirect_uri: redirect, timestamp: 1 });
  // A finished callback, with the session row the library saves on the way.
  const stored = (result) => {
    db.rowsOf('oauth_sessions').push({ sub: result.userDID, session_data: {} });
    return result;
  };

  it('hands a vg_ token to the page in the fragment only, keeping its query', async () => {
    virga.handleCallback = vi.fn(async () =>
      stored({
        userDID: DID,
        session: {},
        state: okState(),
      }),
    );
    const res = await callback(
      'code=abc&state=s1&iss=https%3A%2F%2Fbsky.social',
    );
    expect(res.statusCode).toBe(302);
    expect(res.headers['cache-control']).toBe('no-store');

    const url = new URL(res.redirectedTo);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://virga.example.com/oauth/return',
    );
    expect([...url.searchParams.keys()]).toEqual(['n']);
    expect(url.searchParams.get('n')).toBe('nonce123');
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get('did')).toBe(DID);
    expect(fragment.get('session')).toMatch(/^vg_[0-9a-f]{64}$/);

    expect(db.rowsOf('frontend_sessions')).toEqual([
      expect.objectContaining({
        token_hash: tokenKey(fragment.get('session')),
        user_did: DID,
      }),
    ]);
    // The library has already saved the session and cleared the state: one
    // write, then a look that a sign-out hasn't taken the grant meanwhile.
    expect(db.ops.map((o) => `${o.table}:${o.verb}`)).toEqual([
      'frontend_sessions:insert',
      'oauth_sessions:select',
    ]);
    const [params] = virga.handleCallback.mock.calls[0];
    expect(params.get('code')).toBe('abc');
    expect(params.get('iss')).toBe('https://bsky.social');
  });

  it('imports nothing beyond the OAuth modules and the shared helpers', () => {
    const source = fs.readFileSync(
      new URL('./callback.js', import.meta.url),
      'utf8',
    );
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const spec of imports)
      expect(spec, spec).toMatch(/^\.\.\/(\.\.\/http\.js|[a-zA-Z]+\.js)$/);
  });

  it("comes back with the host's own error code, and no token", async () => {
    virga.handleCallback = vi.fn(async () => {
      const failure = new Error('Authentication failed: access_denied');
      failure.appState = okState();
      throw failure;
    });
    const res = await callback(
      'error=access_denied&error_description=The%20reader%20declined&state=s1',
    );
    expect(res.statusCode).toBe(302);
    const url = new URL(res.redirectedTo);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://virga.example.com/oauth/return',
    );
    expect(url.searchParams.get('n')).toBe('nonce123');
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('error_description')).toBe(
      'The reader declined',
    );
    expect(url.hash).toBe('');
    expect(res.redirectedTo).not.toMatch(/session=/);
    expect(db.rowsOf('frontend_sessions')).toEqual([]);
    // The library was still asked, so it cleared the state.
    expect(virga.handleCallback).toHaveBeenCalledTimes(1);
  });

  it("goes to OAUTH_PUBLIC_URL's /oauth/return when the state is gone", async () => {
    virga.handleCallback = vi.fn(async () => {
      throw new Error(
        'Authentication failed: Unknown authorization session "s1"',
      );
    });
    const res = await callback('code=abc&state=s1');
    const url = new URL(res.redirectedTo);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://virga.example.com/oauth/return',
    );
    expect(url.searchParams.get('error')).toBe('callback_failed');
    expect(url.searchParams.get('error_description')).toMatch(
      /Unknown authorization session/,
    );
  });

  it('reads a failed exchange as callback_failed, back to the page that started it', async () => {
    virga.handleCallback = vi.fn(async () => {
      const failure = new Error('Authentication failed: invalid_grant');
      failure.appState = okState();
      throw failure;
    });
    const res = await callback('code=abc&state=s1');
    const url = new URL(res.redirectedTo);
    expect(url.searchParams.get('n')).toBe('nonce123');
    expect(url.searchParams.get('error')).toBe('callback_failed');
  });

  it('passes on an authorization server code the library recovered', async () => {
    virga.handleCallback = vi.fn(async () => {
      const failure = new Error('Authentication failed: scope');
      failure.appState = okState();
      failure.oauthError = 'invalid_scope';
      throw failure;
    });
    const res = await callback('code=abc&state=s1');
    expect(new URL(res.redirectedTo).searchParams.get('error')).toBe(
      'invalid_scope',
    );
  });

  it('never returns to a page off the allowlist, whatever the state says', async () => {
    virga.handleCallback = vi.fn(async () =>
      stored({
        userDID: DID,
        session: {},
        state: okState('https://evil.example/steal'),
      }),
    );
    const res = await callback('code=abc&state=s1');
    expect(new URL(res.redirectedTo).origin).toBe('https://virga.example.com');
  });

  it('never hands a token to another page on an allowed origin, whatever the state says', async () => {
    // The open-redirect chain: a state naming the login, which would 302 to an
    // attacker's authorization server with the token still in the fragment.
    const bounce =
      'https://virga.example.com/api/oauth/login?handle=evil.example&redirect_uri=https%3A%2F%2Fvirga.example.com%2Foauth%2Freturn';
    virga.handleCallback = vi.fn(async () =>
      stored({
        userDID: DID,
        session: {},
        state: okState(bounce),
      }),
    );
    const res = await callback('code=abc&state=s1');
    const url = new URL(res.redirectedTo);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://virga.example.com/oauth/return',
    );
    expect(url.search).toBe('');
  });

  it('hands out no token when a sign-out ended the grant as it was stored', async () => {
    // The library saved the grant, then the DID's last device signed out and
    // deleted it before the token was minted.
    virga.handleCallback = vi.fn(async () => ({
      userDID: DID,
      session: {},
      state: okState(),
    }));
    const res = await callback('code=abc&state=s1');
    expect(res.statusCode).toBe(302);
    const url = new URL(res.redirectedTo);
    expect(url.searchParams.get('error')).toBe('callback_failed');
    expect(res.redirectedTo).not.toMatch(/session=/);
    expect(db.rowsOf('frontend_sessions')).toEqual([]);
  });

  it('mints the token under the grant lock a last-device sign-out takes', async () => {
    virga.handleCallback = vi.fn(async () =>
      stored({
        userDID: DID,
        session: {},
        state: okState(),
      }),
    );
    await callback('code=abc&state=s1');
    expect(db.rpcs.map((r) => [r.name, r.args.p_key])).toEqual([
      ['acquire_oauth_lock', `virga-grant-${DID}`],
      ['release_oauth_lock', `virga-grant-${DID}`],
    ]);
  });

  it('sends a failure for another page on an allowed origin to the return page', async () => {
    virga.handleCallback = vi.fn(async () => {
      const failure = new Error('Authentication failed: invalid_grant');
      failure.appState = okState(
        'https://virga.example.com/api/oauth/login?handle=evil.example',
      );
      throw failure;
    });
    const res = await callback('code=abc&state=s1');
    const url = new URL(res.redirectedTo);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://virga.example.com/oauth/return',
    );
    expect(url.searchParams.get('handle')).toBeNull();
  });

  it('passes on only well-formed error codes', async () => {
    virga.handleCallback = vi.fn(async () => {
      throw new Error('nope');
    });
    const res = await callback('error=%3Cscript%3E&state=s1');
    expect(new URL(res.redirectedTo).searchParams.get('error')).toBe(
      'callback_failed',
    );
  });

  it('fails a token that cannot be stored back to the page, with no token', async () => {
    virga.handleCallback = vi.fn(async () =>
      stored({
        userDID: DID,
        session: {},
        state: okState(),
      }),
    );
    db.failNext('frontend_sessions', 'insert');
    const res = await callback('code=abc&state=s1');
    const url = new URL(res.redirectedTo);
    expect(url.searchParams.get('error')).toBe('callback_failed');
    expect(url.hash).toBe('');
  });
});

describe('the client metadata and JWKS', () => {
  it('serves the metadata, never cached', async () => {
    const res = createRes();
    await metadataHandler(createReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(
      'no-store, no-cache, must-revalidate',
    );
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual(clientMetadata());
  });

  it('names OAUTH_PUBLIC_URL whatever Host the request names', async () => {
    const res = createRes();
    await metadataHandler(
      createReq({
        method: 'GET',
        headers: {
          host: 'preview-123.vercel.app',
          'x-forwarded-host': 'evil.example',
        },
      }),
      res,
    );
    expect(res.body.client_id).toBe(
      'https://virga.example.com/api/oauth/client-metadata.json',
    );
    expect(JSON.stringify(res.body)).not.toMatch(/preview-123|evil\.example/);
  });

  it('serves the public half of the keys, cached for an hour', async () => {
    const res = createRes();
    await jwksHandler(createReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    // As it goes over the wire (the library leaves `d: undefined` on the object).
    const sent = JSON.parse(JSON.stringify(res.body));
    expect(sent.keys.map((k) => k.kid)).toEqual(['virga-test-key']);
    for (const k of sent.keys) expect(k).not.toHaveProperty('d');
  });

  it('answers the JWKS 503 when the client could not start', async () => {
    virga.getJWKS = vi.fn(async () => {
      throw new Error('bad key');
    });
    const res = createRes();
    await jwksHandler(createReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('VIRGA_CLIENT_UNAVAILABLE');
  });
});

describe('through the area function', () => {
  it('routes each action to its handler', async () => {
    const res = createRes();
    await oauthRouter(
      createReq({ method: 'GET', query: { action: 'client-metadata' } }),
      res,
    );
    expect(res.body).toEqual(clientMetadata());

    const login = createRes();
    await oauthRouter(
      createReq({
        method: 'GET',
        query: {
          action: 'login',
          handle: 'reader.example.com',
          redirect_uri: RETURN,
        },
        headers: { accept: 'application/json' },
      }),
      login,
    );
    expect(login.body).toEqual({ success: true, authUrl: AUTH_URL });
  });
});

describe('without a key', () => {
  let saved;

  beforeEach(() => {
    saved = process.env.OAUTH_PRIVATE_KEY_1;
    delete process.env.OAUTH_PRIVATE_KEY_1;
  });

  afterEach(() => {
    process.env.OAUTH_PRIVATE_KEY_1 = saved;
  });

  it.each([
    [
      'login',
      () => loginHandler,
      { method: 'GET', query: { handle: 'reader.example.com' } },
    ],
    [
      'callback',
      () => callbackHandler,
      { method: 'GET', url: '/api/oauth/callback?code=a&state=b' },
    ],
    ['metadata', () => metadataHandler, { method: 'GET' }],
    ['jwks', () => jwksHandler, { method: 'GET' }],
  ])('%s answers 503 VIRGA_CLIENT_UNAVAILABLE', async (_name, handler, req) => {
    const res = createRes();
    await handler()(createReq(req), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      success: false,
      code: 'VIRGA_CLIENT_UNAVAILABLE',
      error: 'Signing in with Virga is not available right now.',
    });
    expect(virga.generateLoginUrl).not.toHaveBeenCalled();
    expect(virga.handleCallback).not.toHaveBeenCalled();
  });
});
