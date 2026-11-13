// How /api/oauth/proxy answers when the upstream XRPC call fails.
//
// The handler runs for real, down to @atproto/api's Agent and the SDK's
// lexicon validation of the method output; only the session lookups are
// stubbed, and the restored "OAuth session" is a stand-in whose fetchHandler
// plays the PDS. That keeps the SDK's own error construction in the loop,
// which is where the non-HTTP statuses come from.
//
// The response refuses a status outside 100-999 the way Node's writeHead
// does, so handing the SDK's ResponseType to res.status() fails these tests
// the way it would fail in production.

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
import { createReq, createRes } from '../../test/http.js';
import { getOAuthClient, resetOAuthForTests } from '../client.js';
import { getStorage } from '../storage.js';
import { TOKEN, installOAuthEnv } from '../testing/env.js';
import handler from './proxy.js';

const DID = 'did:plc:proxytester000000000000';
const BLUESKY_APPVIEW = 'did:web:api.bsky.app#bsky_appview';
const CUSTOM_APPVIEW = 'did:web:appview.example.invalid#bsky_appview';
const POST_URI =
  'at://did:plc:author0000000000000000/app.bsky.feed.post/3kabcdefghij2';

// The PDS, as the proxy's Agent sees it: every upstream call lands here with
// the atproto-proxy header naming the AppView the PDS would forward to.
let upstream = null;
const upstreamCalls = [];
const session = {
  did: DID,
  async fetchHandler(url, init) {
    const appView = new Headers(init && init.headers).get('atproto-proxy');
    upstreamCalls.push({ url: String(url), appView });
    return upstream({ url: String(url), appView });
  },
};

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

// A getPostThread answer the SDK refuses: the post's uri is not an at-uri.
const invalidThread = () =>
  json(200, {
    thread: {
      $type: 'app.bsky.feed.defs#threadViewPost',
      post: { uri: 'not-an-at-uri' },
    },
  });
// The smallest answer the SDK accepts.
const validThread = () =>
  json(200, {
    thread: {
      $type: 'app.bsky.feed.defs#notFoundPost',
      uri: POST_URI,
      notFound: true,
    },
  });

function strictRes() {
  const res = createRes();
  const json = res.json;
  res.json = (body) => {
    if (
      !Number.isInteger(res.statusCode) ||
      res.statusCode < 100 ||
      res.statusCode > 999
    ) {
      const err = new RangeError(`Invalid status code: ${res.statusCode}`);
      err.code = 'ERR_HTTP_INVALID_STATUS_CODE';
      throw err;
    }
    return json(body);
  };
  return res;
}

function get(xrpcMethod, query, { appView } = {}) {
  const search = new URLSearchParams(query).toString();
  return createReq({
    method: 'GET',
    url: `/api/oauth/proxy?${search}`,
    query: { action: 'proxy', ...query },
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-xrpc-method': xrpcMethod,
      ...(appView ? { 'x-atproto-proxy': appView } : {}),
    },
  });
}

let env;
let consoleError;
let consoleLog;

beforeAll(async () => {
  env = await installOAuthEnv();
});

afterAll(() => {
  resetOAuthForTests();
  env.restore();
});

beforeEach(() => {
  resetOAuthForTests();
  getStorage().frontendSessionStore.validateWithDetails = async () => ({
    userDid: DID,
    error: null,
  });
  const client = getOAuthClient();
  client.initPromise.catch(() => {});
  client.restoreSession = async () => session;
  upstream = null;
  upstreamCalls.length = 0;
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const logged = (spy) => spy.mock.calls.map((args) => args.join(' ')).join('\n');

describe('/api/oauth/proxy upstream failures', () => {
  it('answers 502 when the answer fails the SDK validation, and logs the refused field', async () => {
    upstream = invalidThread;
    const res = strictRes();
    await handler(get('app.bsky.feed.getPostThread', { uri: POST_URI }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toMatch(/^Invalid ?Response$/);
    expect(res.body.error).toBe(
      'The server gave an invalid response and may be out of date.',
    );
    // Bluesky's AppView (no custom header) has nothing to fall back to.
    expect(upstreamCalls).toHaveLength(1);
    expect(logged(consoleError)).toContain(
      'Output/thread/post/uri must be a valid at-uri',
    );
    expect(logged(consoleError)).not.toContain('Invalid status code');
  });

  it("falls back to Bluesky's AppView when a chosen one gives an answer the SDK refuses", async () => {
    upstream = ({ appView }) =>
      appView === CUSTOM_APPVIEW ? invalidThread() : validThread();
    const res = strictRes();
    await handler(
      get(
        'app.bsky.feed.getPostThread',
        { uri: POST_URI },
        { appView: CUSTOM_APPVIEW },
      ),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        thread: {
          $type: 'app.bsky.feed.defs#notFoundPost',
          uri: POST_URI,
          notFound: true,
        },
      },
    });
    expect(upstreamCalls.map((c) => c.appView)).toEqual([
      CUSTOM_APPVIEW,
      BLUESKY_APPVIEW,
    ]);
  });

  it('falls back on a 5xx from the chosen AppView', async () => {
    upstream = ({ appView }) =>
      appView === CUSTOM_APPVIEW
        ? json(503, { error: 'Unavailable', message: 'down' })
        : validThread();
    const res = strictRes();
    await handler(
      get(
        'app.bsky.feed.getPostThread',
        { uri: POST_URI },
        { appView: CUSTOM_APPVIEW },
      ),
      res,
    );
    expect(res.statusCode).toBe(200);
  });

  it('never falls back for a write, which could take effect twice', async () => {
    upstream = () => json(503, { error: 'Unavailable', message: 'down' });
    const res = strictRes();
    await handler(
      createReq({
        method: 'POST',
        url: '/api/oauth/proxy',
        query: { action: 'proxy' },
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-xrpc-method': 'app.bsky.draft.createDraft',
          'x-atproto-proxy': CUSTOM_APPVIEW,
        },
        body: { draft: { posts: [{ text: 'hi' }] } },
      }),
      res,
    );
    expect(res.statusCode).toBe(503);
    expect(upstreamCalls).toHaveLength(1);
  });

  it('answers 502 for an error with no HTTP status, without a fallback through the same PDS', async () => {
    // The OAuth session failing inside its own fetch handler, say: the SDK
    // wraps it with ResponseType.Unknown (1).
    upstream = () => {
      throw new Error('token refresh failed');
    };
    const res = strictRes();
    await handler(
      get(
        'app.bsky.feed.getPostThread',
        { uri: POST_URI },
        { appView: CUSTOM_APPVIEW },
      ),
      res,
    );
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({
      success: false,
      error: 'token refresh failed',
      code: 'Unknown',
    });
    expect(upstreamCalls).toHaveLength(1);
  });

  it('passes a routine not-found answer through as the PDS gave it, logged at info', async () => {
    upstream = () =>
      json(400, {
        error: 'RecordNotFound',
        message: 'Could not locate record',
      });
    const res = strictRes();
    await handler(
      get('com.atproto.repo.getRecord', {
        repo: DID,
        collection: 'app.bsky.feed.post',
        rkey: 'self',
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'Could not locate record',
      code: 'RecordNotFound',
    });
    expect(consoleError).not.toHaveBeenCalled();
    expect(logged(consoleLog)).toContain(
      'Not found for com.atproto.repo.getRecord: Could not locate record',
    );
  });

  it('keeps any other 4xx at error level', async () => {
    upstream = () =>
      json(400, { error: 'InvalidRequest', message: 'Invalid rkey' });
    const res = strictRes();
    await handler(
      get('com.atproto.repo.getRecord', {
        repo: DID,
        collection: 'app.bsky.feed.post',
        rkey: 'bad key',
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(logged(consoleError)).toContain(
      'XRPC error for com.atproto.repo.getRecord: Invalid rkey',
    );
  });

  it('keeps a rate-limited answer and its reset time', async () => {
    upstream = () =>
      json(
        429,
        { error: 'RateLimitExceeded', message: 'Rate Limit Exceeded' },
        {
          'ratelimit-limit': '5000',
          'ratelimit-remaining': '0',
          'ratelimit-reset': '1791300000',
        },
      );
    const res = strictRes();
    await handler(
      get('com.atproto.repo.getRecord', {
        repo: DID,
        collection: 'app.bsky.feed.post',
        rkey: 'self',
      }),
      res,
    );
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('RateLimitExceeded');
    expect(res.body.ratelimit).toEqual({
      'ratelimit-limit': '5000',
      'ratelimit-remaining': '0',
      'ratelimit-reset': '1791300000',
    });
  });
});
