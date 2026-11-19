// Virga's server, as src/session/backendClient.js talks to it: the address of
// an endpoint, the sign-in's request and return, the requester for /api/*,
// the session checks and the sign-out. Swift: VirgaNetwork/Session/
// (BackendClient, VirgaBackend). The network cases are recorded exchanges
// (_fetch.js), replayed against the Swift port by MockTransport.

import {
  BACKEND_PATHS,
  SIGNIN_PENDING_KEY,
  SIGNIN_PROMPTS,
  backendAddress,
  backendSignOut,
  buildLoginRequest,
  checkBackendSession,
  createBackendRequester,
  fetchBackendSession,
  readBackendReturn,
  readSigninPending,
  requestError,
  signInPrompt,
  startBackendSignIn,
  strippedReturnAddress,
} from '../../../src/session/backendClient.js';
import { each, value } from './_helpers.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = ['src/session/backendClient.js'];

const SERVER = 'https://server.example';
const DID = 'did:plc:virgaharnessmira2zq4x';
const TOKEN = `vg_${'0f'.repeat(32)}`;
const OTHER_TOKEN = `vg_${'cd'.repeat(32)}`;

/** Runs `fn` with `location.origin` set (or unset), as a page would have it. */
async function withOrigin(origin, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    value: origin === undefined ? undefined : { origin },
    configurable: true,
    writable: true,
  });
  try {
    return await fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'location', had);
    else delete globalThis.location;
  }
}

// Node gives `new URL`'s TypeError the code ERR_INVALID_URL; browsers give
// it none, and neither does the Swift port.
const errorShape = (e) => ({
  name: e?.name ?? null,
  message: e?.message ?? null,
  status: e?.status ?? null,
  code: e?.code === 'ERR_INVALID_URL' ? null : (e?.code ?? null),
  detail: e?.detail ?? null,
  payload: e?.payload ?? null,
});

/** A requester call: its body, or its error's fields, and the 401s it reported. */
async function requesterCase({
  token = TOKEN,
  backendUrl = SERVER,
  path,
  options,
}) {
  const unauthorized = [];
  const req = createBackendRequester({
    backendUrl,
    token: () => token,
    did: DID,
    onUnauthorized: (did, code) => unauthorized.push({ did, code }),
  });
  try {
    return { body: await req.request(path, options), unauthorized };
  } catch (error) {
    return { error: errorShape(error), unauthorized };
  }
}

const memoryStorage = (initial) => {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
};

const returnShape = (r) =>
  r === null
    ? null
    : r.kind === 'error'
      ? {
          kind: 'error',
          error: {
            message: r.error.message,
            code: r.error.code,
            params: Object.fromEntries(r.error.params),
          },
          ...(r.orphanToken ? { orphanToken: r.orphanToken } : {}),
        }
      : r;

export default async function cases() {
  const base = {
    backendUrl: SERVER,
    handle: 'mira.example.com',
    origin: 'https://virga.example',
    returnPath: '/oauth/return',
    nonce: 'abc123',
  };
  const pending = { nonce: 'n1', mode: 'backend', intent: 'reauth' };
  const at = (search, hash = '') => ({
    pathname: '/oauth/return',
    search,
    hash,
  });

  return [
    value('BACKEND_PATHS', BACKEND_PATHS),
    value('SIGNIN_PENDING_KEY', SIGNIN_PENDING_KEY),
    value('SIGNIN_PROMPTS', SIGNIN_PROMPTS),

    ...(await each(
      'backendAddress',
      [
        { backendUrl: SERVER, path: '/api/schedule/list' },
        { backendUrl: `${SERVER}/`, path: '/api/schedule/list' },
        { backendUrl: `${SERVER}///`, path: 'api/limits/status' },
        {
          backendUrl: 'https://other.example/prefix/',
          path: '/api/oauth/session',
        },
        { backendUrl: 'https://Other.Example:443/a/../b', path: '/api/x' },
        { backendUrl: 'https://other.example', path: '/api/a b?c=d e#f' },
        { backendUrl: 'https://other.example', path: '' },
        {
          backendUrl: '',
          origin: 'https://virga.test',
          path: '/api/schedule/list',
        },
        { backendUrl: null, origin: 'https://virga.test/', path: 'api/x' },
        { backendUrl: '', path: '/api/oauth/session' },
        { backendUrl: '/', origin: 'https://virga.test', path: '/api/x' },
        { backendUrl: 'not a url', path: '/api/x' },
        { backendUrl: 'https://exa mple.com', path: '/api/x' },
      ],
      ({ backendUrl, path, origin }) =>
        withOrigin(origin, () => backendAddress(backendUrl, path).href),
    )),

    ...(await each(
      'signInPrompt',
      [
        { prompt: 'login' },
        { prompt: 'consent' },
        { prompt: 'select_account' },
        { prompt: 'create' },
        { prompt: 'none' },
        { prompt: 'Login' },
        { prompt: '' },
        { prompt: null },
      ],
      ({ prompt }) => signInPrompt(prompt),
    )),

    ...(await each(
      'buildLoginRequest',
      [
        { ...base },
        { ...base, defense: true },
        { ...base, defense: 'yes' },
        { ...base, defense: 'scan' },
        { ...base, defense: 'lists' },
        { ...base, defense: false },
        { ...base, prompt: 'create', handle: 'https://bsky.social' },
        { ...base, prompt: 'none' },
        { ...base, handle: 'did:plc:abc', nonce: 'a b&c=d' },
        {
          ...base,
          handle: 'Mïra.Example.com ',
          returnPath: '/oauth/return?x=1#y',
        },
        {
          ...base,
          returnPath: 'oauth/return',
          origin: 'https://virga.example/app/',
        },
        { ...base, backendUrl: 'https://other.example/prefix/' },
        { ...base, backendUrl: '', origin: 'https://virga.test' },
        { ...base, origin: 'not a url' },
        { ...base, returnPath: 'https://evil.example/x' },
      ],
      (input) =>
        withOrigin(input.backendUrl === '' ? input.origin : undefined, () =>
          buildLoginRequest(input),
        ),
    )),

    ...(await each(
      'readSigninPending',
      [
        {
          stored: JSON.stringify({
            nonce: 'n1',
            mode: 'backend',
            intent: 'add',
          }),
        },
        {
          stored: JSON.stringify({
            nonce: 'n1',
            mode: 'backend',
            intent: 'add',
            did: null,
            at: 5,
          }),
        },
        { stored: JSON.stringify({ nonce: 5 }) },
        { stored: JSON.stringify({ mode: 'backend' }) },
        { stored: '"n1"' },
        { stored: '[]' },
        { stored: '{bad' },
        { stored: '' },
        { stored: 'null' },
        {},
      ],
      ({ stored }) =>
        readSigninPending(
          memoryStorage(
            stored === undefined ? {} : { [SIGNIN_PENDING_KEY]: stored },
          ),
        ),
    )),

    ...(await each(
      'readBackendReturn',
      [
        {
          $id: 'session',
          location: at(
            '?n=n1',
            `#session=${TOKEN}&did=${encodeURIComponent(DID)}`,
          ),
          pending,
        },
        {
          $id: 'session-trailing-slash',
          location: {
            pathname: '/oauth/return/',
            search: '?n=n1',
            hash: `#session=${TOKEN}&did=${DID}`,
          },
          pending,
        },
        {
          $id: 'no-pending',
          location: at('?n=n1', `#session=${TOKEN}&did=${DID}`),
          pending: null,
        },
        {
          $id: 'other-nonce',
          location: at('?n=n1', `#session=${TOKEN}&did=${DID}`),
          pending: { nonce: 'other' },
        },
        {
          $id: 'no-nonce',
          location: at('', `#session=${TOKEN}&did=${DID}`),
          pending,
        },
        {
          $id: 'junk-orphan',
          location: at('?n=n1', `#session=nope&did=${DID}`),
          pending: { nonce: 'other' },
        },
        {
          $id: 'query-token',
          location: at(`?n=n1&session=${TOKEN}&did=${DID}`),
          pending,
        },
        {
          $id: 'bad-token',
          location: at('?n=n1', `#session=abc&did=${DID}`),
          pending,
        },
        {
          $id: 'bad-did',
          location: at('?n=n1', `#session=${TOKEN}&did=mira`),
          pending,
        },
        {
          $id: 'uppercase-token',
          location: at('?n=n1', `#session=vg_${'0F'.repeat(32)}&did=${DID}`),
          pending,
        },
        {
          $id: 'did-web',
          location: at(
            '?n=n1',
            `#session=${TOKEN}&did=did:web:example.com%3A8080`,
          ),
          pending,
        },
        {
          $id: 'did-newline',
          location: at('?n=n1', `#session=${TOKEN}&did=${DID}%0A`),
          pending,
        },
        {
          $id: 'error',
          location: at(
            '?error=access_denied&error_description=The+user+declined',
          ),
          pending: null,
        },
        {
          $id: 'error-in-fragment',
          location: at('', '#error=callback_failed'),
          pending,
        },
        {
          $id: 'error-with-nonce',
          location: at('?n=n1&error=callback_failed'),
          pending,
        },
        {
          $id: 'empty-error',
          location: at('?error=&n=n1', `#session=${TOKEN}&did=${DID}`),
          pending,
        },
        {
          $id: 'other-path',
          location: {
            pathname: '/oauth/callback',
            search: '?error=x',
            hash: '',
          },
          pending,
        },
        { $id: 'nothing', location: at(''), pending },
        { $id: 'did-only', location: at('?n=n1', `#did=${DID}`), pending },
        {
          $id: 'intent-missing',
          location: at('?n=n1', `#session=${TOKEN}&did=${DID}`),
          pending: { nonce: 'n1' },
        },
        {
          $id: 'question-fragment',
          location: at('?n=n1', `#?session=${TOKEN}&did=${DID}`),
          pending,
        },
        {
          $id: 'plus-encoded',
          location: at('?n=n+1', `#session=${TOKEN}&did=${DID}`),
          pending: { nonce: 'n 1', intent: 'add' },
        },
      ],
      ({ location, pending: p }) =>
        returnShape(readBackendReturn(location, p, '/oauth/return')),
    )),

    ...(await each(
      'strippedReturnAddress',
      [
        {
          location: {
            pathname: '/oauth/return',
            search: '?n=1',
            hash: '#session=x',
          },
        },
      ],
      ({ location }) => strippedReturnAddress(location),
    )),

    ...(await each(
      'requestError',
      [
        { status: 429, body: { error: 'monthly_limit' } },
        { status: 400, body: { error: 'Something went wrong' } },
        { status: 500, body: null },
        { status: 0, body: null },
        {
          status: 403,
          body: {
            success: false,
            code: 'QUOTA_EXCEEDED',
            feature: 'scheduledPosts',
            error: 'You have 3 of 3',
          },
        },
        { status: 401, body: { error: 'Unauthorized' } },
        { status: 502, body: { message: 'Bad gateway' } },
        { status: 502, body: { message: '', error: '' } },
        { status: 400, body: { code: null, error: 'bad_thing' } },
        { status: 400, body: { code: 0 } },
        { status: 400, body: { code: 'X', error: 5 } },
        { status: 200, body: 'a page' },
        { status: 200, body: [1, 2] },
      ],
      ({ status, body }) => errorShape(requestError(status, body)),
    )),

    ...(await each(
      'request',
      [
        {
          $id: 'post-body',
          path: '/api/schedule/reorder',
          options: { method: 'POST', body: { moves: [] } },
          answers: [json({ success: true, moved: 2 })],
        },
        {
          $id: 'query',
          path: '/api/self-destruct/list',
          options: {
            query: {
              history: true,
              ids: ['a', 'b'],
              skip: null,
              n: 2.5,
              none: undefined,
            },
          },
          answers: [json({ data: [], unavailable: true })],
        },
        {
          $id: 'query-replaces',
          path: '/api/x?ids=z&keep=1',
          options: { query: { ids: ['a'], keep: 'b c', obj: { a: 1 } } },
          answers: [json({ success: true })],
        },
        {
          $id: 'bare-ai',
          path: '/api/ai/analyze-post',
          options: { method: 'POST', body: {} },
          answers: [json({ read: 'fine', monthly_limit: 30 })],
        },
        {
          $id: 'quota',
          path: '/api/schedule/create',
          options: { method: 'POST', body: { text: 'é 😀' } },
          answers: [
            json(
              {
                success: false,
                code: 'QUOTA_EXCEEDED',
                feature: 'scheduledPosts',
                error: 'You have 3 of 3',
              },
              403,
            ),
          ],
        },
        {
          $id: 'success-false-200',
          path: '/api/x',
          answers: [json({ success: false, error: 'nope' })],
        },
        {
          $id: 'unauthorized',
          path: '/api/schedule/list',
          answers: [json({ error: 'Unauthorized' }, 401)],
        },
        {
          $id: 'unauthorized-code',
          path: '/api/schedule/list',
          answers: [
            json(
              {
                success: false,
                code: 'FRONTEND_SESSION_INVALID',
                error: 'gone',
              },
              401,
            ),
          ],
        },
        { $id: 'offline', path: '/api/x', answers: ['offline'] },
        {
          $id: 'html',
          path: '/api/x',
          answers: [{ status: 200, text: '<!doctype html>' }],
        },
        {
          $id: 'html-404',
          path: '/api/x',
          answers: [{ status: 404, text: 'Not here' }],
        },
        {
          $id: 'null-body',
          path: '/api/x',
          options: { method: 'POST', body: null },
          answers: [json(null)],
        },
        {
          $id: 'no-token',
          path: '/api/schedule/list',
          token: null,
          answers: [],
        },
        {
          $id: 'empty-token',
          path: '/api/schedule/list',
          token: '',
          answers: [],
        },
        {
          $id: 'other-token',
          path: '/api/schedule/list',
          token: OTHER_TOKEN,
          answers: [json({ success: true, data: [] })],
        },
        { $id: 'no-address', path: '/api/x', backendUrl: '', answers: [] },
        {
          $id: 'prefix',
          path: 'api/terms/status',
          backendUrl: 'https://other.example/v/',
          answers: [json({ accepted: true })],
        },
      ].map((c) => ({ ...c, queryKeys: Object.keys(c.options?.query || {}) })),
      async ({ answers, token, backendUrl, path, options }) => {
        const out = await recordFetch(inTurn(...answers), () =>
          withOrigin(undefined, () =>
            requesterCase({ token, backendUrl, path, options }),
          ),
        );
        return out;
      },
    )),

    ...(await each(
      'sessionCheck',
      [
        {
          $id: 'lite',
          lite: true,
          answers: [
            json({
              success: true,
              authenticated: true,
              lite: true,
              oauthSessionMissing: false,
              user: { did: DID },
            }),
          ],
        },
        {
          $id: 'full',
          lite: false,
          answers: [
            json({
              success: true,
              authenticated: true,
              scope: 'atproto',
              client: 'virga',
              pds: 'https://pds.example',
            }),
          ],
        },
        {
          $id: 'expired',
          lite: true,
          answers: [
            json({ success: false, code: 'FRONTEND_SESSION_INVALID' }, 401),
          ],
        },
        {
          $id: 'not-json',
          lite: false,
          answers: [{ status: 502, text: 'Bad Gateway' }],
        },
        { $id: 'offline', lite: true, answers: ['offline'] },
        { $id: 'no-address', lite: true, backendUrl: '', answers: [] },
        {
          $id: 'prefix',
          lite: false,
          backendUrl: 'https://other.example/prefix/',
          answers: [json({ success: true })],
        },
      ],
      ({ lite, answers, backendUrl = SERVER }) =>
        recordFetch(inTurn(...answers), () =>
          withOrigin(undefined, () =>
            (lite ? checkBackendSession : fetchBackendSession)({
              backendUrl,
              token: TOKEN,
            }),
          ),
        ),
    )),

    ...(await each(
      'backendSignOut',
      [
        { $id: 'done', answers: [json({ success: true })] },
        {
          $id: 'keep-grant',
          keepGrant: true,
          answers: [json({ success: true })],
        },
        {
          $id: 'transient-then-done',
          answers: [
            json({ success: false, code: 'LOGOUT_TRANSIENT_ERROR' }, 503),
            json({ success: true }),
          ],
        },
        {
          $id: 'transient-twice',
          answers: [
            json({ success: false, code: 'VALIDATION_TRANSIENT_ERROR' }, 503),
          ],
        },
        {
          $id: 'transient-then-offline',
          answers: [
            json({ success: false, code: 'LOGOUT_TRANSIENT_ERROR' }, 503),
            'offline',
          ],
        },
        {
          $id: 'other-503',
          answers: [json({ success: false, code: 'SOMETHING' }, 503)],
        },
        { $id: '503-not-json', answers: [{ status: 503, text: 'busy' }] },
        {
          $id: 'refused',
          answers: [
            json({ success: false, code: 'FRONTEND_SESSION_INVALID' }, 401),
          ],
        },
        { $id: 'offline', answers: ['offline'] },
        { $id: 'no-token', token: null, answers: [] },
        { $id: 'empty-token', token: '', answers: [] },
        {
          $id: 'retry-delay',
          retryDelayMs: 250,
          answers: [
            json({ success: false, code: 'LOGOUT_TRANSIENT_ERROR' }, 503),
            json({ success: true }),
          ],
        },
        { $id: 'no-address', backendUrl: '', answers: [] },
      ],
      ({
        answers,
        token = TOKEN,
        keepGrant,
        retryDelayMs,
        backendUrl = SERVER,
      }) =>
        recordFetch(inTurn(...answers), () =>
          withOrigin(undefined, () =>
            backendSignOut({
              backendUrl,
              token,
              keepGrant,
              ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
            }),
          ),
        ),
    )),

    ...(await each(
      'startBackendSignIn',
      [
        {
          $id: 'goes',
          intent: 'reauth',
          answers: [
            json({
              success: true,
              authUrl: 'https://bsky.social/oauth/authorize?request_uri=x',
            }),
          ],
        },
        {
          $id: 'create',
          handle: 'https://bsky.social',
          prompt: 'create',
          answers: [
            json({
              success: true,
              authUrl: 'https://bsky.social/oauth/authorize?request_uri=y',
            }),
          ],
        },
        {
          $id: 'defense-lists',
          did: DID,
          defense: 'lists',
          answers: [
            json({ success: true, authUrl: 'https://pds.example/authorize' }),
          ],
        },
        {
          $id: 'handle-not-found',
          answers: [
            json(
              {
                success: false,
                code: 'HANDLE_NOT_FOUND',
                error: 'Could not resolve handle',
              },
              400,
            ),
          ],
        },
        { $id: 'no-auth-url', answers: [json({ success: true })] },
        {
          $id: 'auth-url-not-string',
          answers: [json({ success: true, authUrl: 5 })],
        },
        { $id: 'server-page', answers: [{ status: 500, text: '<html>' }] },
        {
          $id: 'error-not-string',
          answers: [json({ success: false, error: { a: 1 }, code: '' }, 400)],
        },
        { $id: 'offline', answers: ['offline'] },
        { $id: 'bad-origin', origin: 'not a url', answers: [] },
      ],
      async ({ answers, ...options }) => {
        const realRandom = globalThis.crypto.getRandomValues;
        globalThis.crypto.getRandomValues = (bytes) => {
          for (let i = 0; i < bytes.length; i++)
            bytes[i] = (i * 37 + 11) & 0xff;
          return bytes;
        };
        try {
          return await recordFetch(inTurn(...answers), async () => {
            const storage = memoryStorage();
            let assigned = null;
            let settle;
            const settled = new Promise((resolve) => {
              settle = resolve;
            });
            startBackendSignIn({
              backendUrl: SERVER,
              handle: 'mira.example.com',
              origin: 'https://virga.example',
              returnPath: '/oauth/return',
              ...options,
              sessionStorage: storage,
              assign: (url) => {
                assigned = url;
                settle({});
              },
            }).catch((error) => settle({ error: errorShape(error) }));
            const outcome = await settled;
            return {
              ...outcome,
              assigned,
              stored: storage.map.has(SIGNIN_PENDING_KEY)
                ? JSON.parse(storage.map.get(SIGNIN_PENDING_KEY))
                : null,
            };
          });
        } finally {
          globalThis.crypto.getRandomValues = realRandom;
        }
      },
    )),
  ];
}
