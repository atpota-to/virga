// A signed-in XRPC call as the web makes it on a long session: @atproto/api's
// Agent, whose fetch handler is src/session/backendClient.js's
// createBackendFetchHandler, sending each call through Virga's server
// (/api/oauth/proxy, /api/oauth/upload-blob). The fixture records what
// reached the server and what the caller got back: `res.data` and
// `res.headers`, or the XRPCError's status, error name, message and headers.
// Swift: XRPCAgent with BackendFetchHandler (VirgaNetwork/XRPC,
// VirgaNetwork/Session).
//
// Every answer is one the method's lexicon accepts: the SDK checks a JSON
// answer against it, which the Swift port doesn't (see XRPCAgent.swift).

import { Agent, lexToJson } from '@atproto/api';
import { createBackendFetchHandler } from '../../../src/session/backendClient.js';
import { each } from './_helpers.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = ['src/session/backendClient.js'];

const SERVER = 'https://server.example';
const DID = 'did:plc:virgaharnessmira2zq4x';
const TOKEN = `vg_${'0f'.repeat(32)}`;
const CID = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const BLOB = {
  $type: 'blob',
  ref: { $link: CID },
  mimeType: 'image/png',
  size: 4,
};
const BYTES = [1, 2, 3, 4];

/** The lexicon type of each parameter, so Swift can build the same values. */
function typedParams(agent, nsid, params) {
  const def = agent.lex.getDefOrThrow(nsid);
  return Object.entries(params || {}).map(([name, value]) => {
    const schema = def.parameters?.properties?.[name];
    const type =
      schema?.type === 'array' ? `array:${schema.items.type}` : schema?.type;
    return [name, type, value === undefined ? null : value];
  });
}

const kindOf = (agent, nsid) => agent.lex.getDefOrThrow(nsid).type;

function dataOf(input) {
  if (!input) return undefined;
  if (input.bytes) return new Uint8Array(input.bytes);
  if (input.text !== undefined) return input.text;
  return input.json;
}

async function agentCase({
  nsid,
  params,
  input,
  opts,
  proxy,
  labelers,
  token = TOKEN,
  backendUrl = SERVER,
  did = DID,
}) {
  const heard = { unauthorized: [], authorized: [] };
  const fetchHandler = createBackendFetchHandler({
    backendUrl,
    token: typeof token === 'function' ? token : () => token,
    did,
    onUnauthorized: (who, code) => heard.unauthorized.push({ did: who, code }),
    onAuthorized: (who) => heard.authorized.push(who),
  });
  let agent = new Agent({ did, fetchHandler });
  if (proxy) agent = agent.withProxy(...proxy);
  if (labelers) agent.configureLabelers(labelers);
  try {
    const res = await agent.call(nsid, params, dataOf(input), opts);
    const data =
      res.data instanceof Uint8Array
        ? { $bytes: Buffer.from(res.data).toString('base64') }
        : lexToJson(res.data);
    return { data, headers: res.headers, ...heard };
  } catch (e) {
    return {
      error: {
        status: e.status,
        error: e.error,
        message: e.message,
        headers: e.headers ?? null,
      },
      ...heard,
    };
  }
}

const probe = new Agent({
  did: DID,
  fetchHandler: async () => new Response('{}'),
});

const CASES = [
  {
    $id: 'query-through-proxy',
    nsid: 'app.bsky.graph.getFollowers',
    params: { actor: DID, limit: 50 },
    proxy: ['bsky_appview', 'did:web:api.bsky.app'],
    answers: [
      json({
        success: true,
        data: {
          followers: [],
          subject: { did: DID, handle: 'mira.example.com' },
        },
      }),
    ],
  },
  {
    $id: 'procedure-body',
    nsid: 'com.atproto.repo.createRecord',
    input: {
      json: {
        repo: DID,
        collection: 'app.bsky.graph.follow',
        record: {
          $type: 'app.bsky.graph.follow',
          subject: 'did:plc:other',
          createdAt: '2026-11-12T00:00:00.000Z',
        },
      },
    },
    answers: [
      json({
        success: true,
        data: {
          uri: `at://${DID}/app.bsky.graph.follow/3k`,
          cid: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
        },
      }),
    ],
  },
  {
    $id: 'procedure-unicode',
    nsid: 'com.atproto.repo.putRecord',
    input: {
      json: {
        repo: DID,
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
        record: {
          $type: 'app.bsky.actor.profile',
          displayName: 'Mïra 😀 "quoted" \\ /slash\n',
          description: ' ',
        },
      },
    },
    answers: [
      json({
        success: true,
        data: {
          uri: `at://${DID}/app.bsky.actor.profile/self`,
          cid: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
        },
      }),
    ],
  },
  {
    $id: 'params-typed',
    nsid: 'app.bsky.feed.getAuthorFeed',
    params: {
      actor: 'mira.example.com',
      limit: 50.7,
      cursor: undefined,
      filter: 'posts_with_replies',
      includePins: true,
    },
    answers: [json({ success: true, data: { feed: [] } })],
  },
  {
    $id: 'params-array',
    nsid: 'app.bsky.feed.getPosts',
    params: {
      uris: [
        `at://${DID}/app.bsky.feed.post/3k`,
        `at://${DID}/app.bsky.feed.post/3l?x=1&y`,
      ],
    },
    answers: [json({ success: true, data: { posts: [] } })],
  },
  {
    $id: 'params-false-and-unicode',
    nsid: 'com.atproto.repo.listRecords',
    params: {
      repo: DID,
      collection: 'app.bsky.feed.post',
      limit: 100,
      cursor: 'c é+&=',
      reverse: false,
    },
    answers: [json({ success: true, data: { records: [], cursor: 'next' } })],
  },
  {
    $id: 'params-search',
    nsid: 'app.bsky.feed.searchPosts',
    params: { q: 'é 😀 a+b #tag', sort: 'latest', lang: 'en', limit: 25 },
    proxy: ['bsky_appview', 'did:web:api.bsky.app'],
    answers: [json({ success: true, data: { posts: [] } })],
  },
  {
    $id: 'params-integer-overflow',
    nsid: 'app.bsky.actor.getSuggestions',
    params: { limit: 4294967297 },
    answers: [json({ success: true, data: { actors: [] } })],
  },
  {
    $id: 'labelers',
    nsid: 'app.bsky.actor.getPreferences',
    labelers: ['did:plc:labelerone', 'did:web:labeler.example'],
    answers: [json({ success: true, data: { preferences: [] } })],
  },
  {
    $id: 'own-proxy-header',
    nsid: 'app.bsky.actor.getPreferences',
    opts: {
      headers: {
        'atproto-proxy': 'did:web:other.example#bsky_appview',
        'atproto-accept-labelers': ' did:plc:extra ',
      },
    },
    proxy: ['bsky_appview', 'did:web:api.bsky.app'],
    answers: [json({ success: true, data: { preferences: [] } })],
  },
  {
    $id: 'procedure-no-input',
    nsid: 'com.atproto.server.refreshSession',
    answers: [
      json({
        success: true,
        data: {
          accessJwt: 'a',
          refreshJwt: 'r',
          handle: 'mira.example.com',
          did: DID,
        },
      }),
    ],
  },
  {
    $id: 'record-not-found',
    nsid: 'com.atproto.repo.getRecord',
    params: { repo: DID, collection: 'app.bsky.feed.post', rkey: 'x' },
    answers: [
      json(
        {
          success: false,
          error: 'Could not locate record',
          code: 'RecordNotFound',
        },
        400,
      ),
    ],
  },
  {
    $id: 'rate-limited',
    nsid: 'com.atproto.repo.createRecord',
    input: {
      json: {
        repo: DID,
        collection: 'app.bsky.feed.like',
        record: { $type: 'app.bsky.feed.like' },
      },
    },
    answers: [
      json(
        {
          success: false,
          error: 'Slow down',
          code: 'RateLimitExceeded',
          ratelimit: {
            'ratelimit-reset': 1763000000,
            'ratelimit-remaining': 0,
            'ratelimit-policy': null,
          },
        },
        429,
      ),
    ],
  },
  {
    $id: 'failure-as-200',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [json({ success: false, error: 'odd' })],
  },
  {
    $id: 'unauthorized',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [
      json(
        { success: false, error: 'gone', code: 'FRONTEND_SESSION_INVALID' },
        401,
      ),
    ],
  },
  {
    $id: 'unauthorized-no-code',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [
      json(
        { success: false, error: 'Missing or invalid authorization header' },
        401,
      ),
    ],
  },
  {
    $id: 'grant-missing',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [
      json(
        {
          success: false,
          error: 'OAuth session missing. Automatic re-authentication required.',
          code: 'OAUTH_SESSION_MISSING',
        },
        401,
      ),
    ],
  },
  {
    $id: 'transient',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [
      json(
        {
          success: false,
          error: 'Session validation temporarily unavailable, please retry',
          code: 'VALIDATION_TRANSIENT_ERROR',
        },
        503,
      ),
    ],
  },
  {
    $id: 'not-json',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [{ status: 502, text: 'Bad Gateway' }],
  },
  {
    $id: 'not-json-200',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [{ status: 200, text: '<html>' }],
  },
  {
    $id: 'code-not-string',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [json({ success: false, error: 'x', code: 5 }, 500)],
  },
  {
    $id: 'error-not-string',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [json({ success: false, error: { a: 1 }, code: 'Odd' }, 400)],
  },
  {
    $id: 'status-unusual',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [json({ success: false, error: 'teapot', code: 'Teapot' }, 418)],
  },
  {
    $id: 'status-5xx',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [json({ success: false }, 507)],
  },
  // A 304 has no body, and `new Response(body, { status: 304 })` throws:
  // the call fails with that TypeError, not with an XRPC answer.
  {
    $id: 'status-not-modified',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [{ status: 304 }],
  },
  // A 204 is a success with no body: not a success envelope, so a 502.
  {
    $id: 'status-no-content',
    nsid: 'app.bsky.actor.getPreferences',
    answers: [{ status: 204 }],
  },
  {
    $id: 'offline',
    nsid: 'app.bsky.actor.getPreferences',
    answers: ['offline'],
  },
  {
    $id: 'no-token',
    nsid: 'app.bsky.actor.getPreferences',
    token: null,
    answers: [],
  },
  {
    $id: 'binary-output',
    nsid: 'com.atproto.sync.getRepo',
    params: { did: DID },
    answers: [],
  },
  {
    $id: 'binary-blob',
    nsid: 'com.atproto.sync.getBlob',
    params: { did: DID, cid: CID },
    answers: [],
  },
  {
    $id: 'upload',
    nsid: 'com.atproto.repo.uploadBlob',
    input: { bytes: BYTES },
    opts: { encoding: 'image/png' },
    answers: [json({ success: true, data: { blob: BLOB } })],
  },
  {
    $id: 'upload-type-parameters',
    nsid: 'com.atproto.repo.uploadBlob',
    input: { bytes: BYTES },
    opts: { encoding: 'image/jpeg; charset=binary' },
    answers: [
      json({
        success: true,
        data: { blob: { ...BLOB, mimeType: 'image/jpeg' }, extra: 1 },
      }),
    ],
  },
  {
    $id: 'upload-untyped',
    nsid: 'com.atproto.repo.uploadBlob',
    input: { bytes: BYTES },
    answers: [],
  },
  {
    $id: 'upload-octet-stream',
    nsid: 'com.atproto.repo.uploadBlob',
    input: { bytes: BYTES },
    opts: { encoding: 'application/octet-stream' },
    answers: [],
  },
  {
    $id: 'upload-failed',
    nsid: 'com.atproto.repo.uploadBlob',
    input: { bytes: BYTES },
    opts: { encoding: 'video/mp4' },
    answers: [
      json(
        {
          success: false,
          error:
            'The PDS took too long to accept the upload. Please try again.',
          code: 'PDS_UPLOAD_TIMEOUT',
        },
        504,
      ),
    ],
  },
  {
    $id: 'prefix-server',
    nsid: 'app.bsky.actor.getPreferences',
    backendUrl: 'https://other.example/prefix/',
    answers: [json({ success: true, data: { preferences: [] } })],
  },
  // `if (opts?.encoding)`: an empty encoding is none, and the input's own
  // type is sent.
  {
    $id: 'empty-encoding',
    nsid: 'com.atproto.repo.createRecord',
    input: {
      json: {
        repo: DID,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text: 'hi',
          createdAt: '2026-11-12T00:00:00.000Z',
        },
      },
    },
    opts: { encoding: '' },
    answers: [
      json({
        success: true,
        data: { uri: `at://${DID}/app.bsky.feed.post/3k`, cid: CID },
      }),
    ],
  },
];

// The handler called as the Agent calls it, for what the Agent never sends
// (a header the preflight doesn't allow, a text body).
const HANDLER_CASES = [
  {
    $id: 'drops-headers',
    url: '/xrpc/app.bsky.actor.getPreferences',
    init: {
      method: 'GET',
      headers: {
        'X-Custom': 'no',
        'accept-language': 'en',
        'atproto-accept-labelers': ' ',
      },
    },
    answers: [json({ success: true, data: {} })],
  },
  {
    $id: 'text-body',
    url: '/xrpc/com.atproto.repo.createRecord',
    init: { method: 'POST', body: '{}' },
    answers: [
      json(
        {
          success: false,
          error: 'Slow down',
          code: 'RateLimitExceeded',
          ratelimit: { 'ratelimit-reset': 1763000000 },
        },
        429,
      ),
    ],
  },
  {
    $id: 'head-drops-body',
    url: '/xrpc/app.bsky.actor.getPreferences?a=1',
    init: { method: 'head', body: '{"x":1}' },
    answers: [json({ success: true, data: { preferences: [] } })],
  },
  {
    $id: 'pick-blob',
    url: '/xrpc/com.atproto.repo.uploadBlob',
    init: {
      method: 'POST',
      headers: { 'content-type': ' image/png ;q=1' },
      body: new Uint8Array([9]),
    },
    answers: [json({ success: true, data: { blob: 'x', other: 1 } })],
  },
  {
    $id: 'pick-no-blob',
    url: '/xrpc/com.atproto.repo.uploadBlob',
    init: {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([9]),
    },
    answers: [json({ success: true, data: { other: 1 } })],
  },
  {
    $id: 'ratelimit-array',
    url: '/xrpc/app.bsky.actor.getPreferences',
    init: {},
    answers: [json({ success: false, ratelimit: ['a', null, 3] }, 429)],
  },
  {
    $id: 'success-data-string',
    url: '/xrpc/app.bsky.actor.getPreferences',
    init: {},
    answers: [json({ success: true, data: 'text' })],
  },
  {
    $id: 'success-truthy',
    url: '/xrpc/app.bsky.actor.getPreferences',
    init: {},
    answers: [json({ success: 1, data: false })],
  },
  {
    $id: 'binary-record',
    url: '/xrpc/com.atproto.sync.getRecord?did=x',
    init: {},
    answers: [],
  },
  // `Object.entries` of a string: its code units, by index.
  {
    $id: 'ratelimit-string',
    url: '/xrpc/app.bsky.actor.getPreferences',
    init: {},
    answers: [json({ success: false, ratelimit: 'ab' }, 429)],
  },
  // withDeadline: a falsy timeoutMs is no deadline at all.
  {
    $id: 'no-deadline',
    url: '/xrpc/app.bsky.actor.getPreferences',
    init: {},
    options: { timeoutMs: 0 },
    answers: [json({ success: true, data: { preferences: [] } })],
  },
  {
    $id: 'own-deadline',
    url: '/xrpc/app.bsky.actor.getPreferences',
    init: {},
    options: { timeoutMs: 5000 },
    answers: [json({ success: true, data: { preferences: [] } })],
  },
  // An upload with the caller's own signal gets no fallback deadline.
  {
    $id: 'upload-own-signal',
    url: '/xrpc/com.atproto.repo.uploadBlob',
    init: {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([9]),
    },
    withSignal: true,
    answers: [json({ success: true, data: { blob: BLOB } })],
  },
];

export default async function cases() {
  return [
    ...(await each(
      'agentCall',
      CASES.map(({ answers, ...c }) => ({
        ...c,
        kind: kindOf(probe, c.nsid),
        typedParams: typedParams(probe, c.nsid, c.params),
        answers,
      })),
      // agentCase reads the call; `kind` and `typedParams` are for Swift.
      (c) => recordFetch(inTurn(...c.answers), () => agentCase(c)),
    )),
    ...(await each(
      'fetchHandler',
      HANDLER_CASES.map(({ init, ...c }) => ({
        ...c,
        init: {
          ...init,
          ...(init.body instanceof Uint8Array
            ? { body: { $bytes: Buffer.from(init.body).toString('base64') } }
            : {}),
        },
        $init: init,
      })),
      ({ url, $init, answers, options, withSignal }) =>
        recordFetch(inTurn(...answers), async () => {
          const heard = { unauthorized: [], authorized: [] };
          const handler = createBackendFetchHandler({
            backendUrl: SERVER,
            token: TOKEN,
            did: DID,
            onUnauthorized: (who, code) =>
              heard.unauthorized.push({ did: who, code }),
            onAuthorized: (who) => heard.authorized.push(who),
            ...options,
          });
          const res = await handler(
            url,
            withSignal
              ? { ...$init, signal: new AbortController().signal }
              : $init,
          );
          return {
            status: res.status,
            headers: Object.fromEntries(res.headers),
            body: await res.json(),
            ...heard,
          };
        }),
    )),
    ...(await each(
      'serviceAgent',
      [
        {
          $id: 'pds',
          service: 'https://pds.example/',
          nsid: 'com.atproto.repo.describeRepo',
          params: { repo: DID },
          answers: [
            json({
              handle: 'mira.example.com',
              did: DID,
              didDoc: {},
              collections: [],
              handleIsCorrect: true,
            }),
          ],
        },
        {
          $id: 'pds-error',
          service: 'https://pds.example/base/',
          nsid: 'com.atproto.repo.getRecord',
          params: { repo: DID, collection: 'app.bsky.feed.post', rkey: 'gone' },
          answers: [
            json(
              {
                error: 'RecordNotFound',
                message: 'Could not locate record: at://x',
              },
              400,
            ),
          ],
        },
        {
          $id: 'bytes',
          service: 'https://pds.example',
          nsid: 'com.atproto.sync.getBlob',
          params: { did: DID, cid: CID },
          answers: [
            {
              status: 200,
              bytes: new Uint8Array([1, 2, 3]),
              contentType: 'image/png',
            },
          ],
        },
        {
          $id: 'text',
          service: 'https://pds.example',
          nsid: 'com.atproto.sync.getBlob',
          params: { did: DID, cid: CID },
          answers: [{ status: 200, text: 'plain words' }],
        },
        {
          $id: 'error-without-body',
          service: 'https://pds.example',
          nsid: 'com.atproto.repo.describeRepo',
          params: { repo: DID },
          answers: [{ status: 404, text: '' }],
        },
        {
          $id: 'redirect-status',
          service: 'https://pds.example',
          nsid: 'com.atproto.repo.describeRepo',
          params: { repo: DID },
          answers: [json({ error: 'Moved' }, 302)],
        },
      ].map(({ answers, ...c }) => ({
        ...c,
        kind: kindOf(probe, c.nsid),
        typedParams: typedParams(probe, c.nsid, c.params),
        answers,
      })),
      ({ service, nsid, params, answers }) =>
        recordFetch(inTurn(...answers), async () => {
          const agent = new Agent(service);
          try {
            const res = await agent.call(nsid, params);
            const data =
              res.data instanceof Uint8Array
                ? { $bytes: Buffer.from(res.data).toString('base64') }
                : lexToJson(res.data);
            return { data, headers: res.headers };
          } catch (e) {
            return {
              error: {
                status: e.status,
                error: e.error,
                message: e.message,
                headers: e.headers ?? null,
              },
            };
          }
        }),
    )),
  ];
}
