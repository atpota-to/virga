// Virga's server in the harness (harness/fakeServer.js), as far as the
// session goes: scenarios on one server through createServerRouter, its
// tokens minted from repeatable randomness, recording each answer (status,
// type, body): the session checks, sign-out per device and with keepGrant,
// a refused grant, expiry, the terms ledger in each of its three starts,
// the proxy's refusals, preflights, unknown paths and methods.
//
// Where the iOS port answers on purpose differently (a usable grant's
// proxy call: the web fake answers 501, the iOS one forwards to the
// account's fake agent; the routes a later port adds) the scenarios stop
// at what both answer. The forwarding is held instead by the `forward`
// cases: the same requests answered by the real server's own pieces
// (server/oauth/handlers/proxy.js forwardedQuery and isSafeXrpcMethod,
// server/oauth/xrpcErrors.js httpStatusForXrpcError, uploadBlob.js and
// blobPayload.js) over the harness's fake agent, which is what the iOS
// proxy is made of. Swift: VirgaDemo/Harness/FakeServer.swift; tests in
// ios/VirgaKit/Tests/VirgaDemoTests/FakeServerParityTests.swift.

import {
  SERVER_ORIGIN,
  createServer,
  createServerRouter,
} from '../../../harness/fakeServer.js';
import { createFakeAgent } from '../../../harness/fakeXrpc.js';
import { LAB, ME } from '../../../harness/world.js';
import {
  forwardedQuery,
  isSafeXrpcMethod,
} from '../../../server/oauth/handlers/proxy.js';
import { httpStatusForXrpcError } from '../../../server/oauth/xrpcErrors.js';
import { ResponseType } from '@atproto/xrpc';
import { extractBlobPayload } from '../../../server/oauth/blobPayload.js';
import { each } from './_helpers.js';
import { NOW, atTime } from './_demoWorld.js';
import {
  answerOf,
  shrink,
  withRepeatableRandom,
  worldsFor,
} from './_demoNetwork.js';

export const sources = [
  'harness/fakeServer.js',
  'server/oauth/handlers/proxy.js',
  'server/oauth/handlers/uploadBlob.js',
  'server/oauth/xrpcErrors.js',
  'server/oauth/blobPayload.js',
];

const S = SERVER_ORIGIN;
const json = { 'Content-Type': 'application/json' };
const DAY = 86_400_000;

/**
 * A request step: `{ url, method, headers, text }`, where `$t<n>` in a
 * header or the text is the n-th token minted. Other steps: `{ mint: did }`,
 * `{ refuse: did }`, `{ expire: did }`, `{ advance: ms }`.
 */
const SCENARIOS = [
  {
    name: 'sessions',
    steps: [
      { mint: ME.did },
      { mint: LAB.did },
      { mint: LAB.did },
      {
        url: `${S}/api/oauth/session`,
        headers: { authorization: 'Bearer $t1' },
      },
      {
        url: `${S}/api/oauth/session?lite=1`,
        headers: { authorization: 'Bearer $t1' },
      },
      {
        url: `${S}/api/oauth/session?lite=true`,
        headers: { authorization: 'bearer   $t0' },
      },
      {
        url: `${S}/api/oauth/session?lite=yes`,
        headers: { authorization: 'BEARER $t0' },
      },
      { url: `${S}/api/oauth/session` },
      { url: `${S}/api/oauth/session`, headers: { authorization: 'Bearer' } },
      {
        url: `${S}/api/oauth/session`,
        headers: { authorization: 'Bearer $t0 extra' },
      },
      {
        url: `${S}/api/oauth/session`,
        headers: { authorization: `Bearer vg_${'1'.repeat(64)}` },
      },
      {
        url: `${S}/api/oauth/session`,
        headers: { authorization: 'Basic $t0' },
      },
      {
        url: `${S}/api/oauth/session/`,
        method: 'POST',
        headers: { authorization: 'Bearer $t0' },
      },
      {
        url: `${S}/api/oauth/logout`,
        method: 'POST',
        headers: { authorization: 'Bearer $t1', ...json },
        text: '{}',
      },
      {
        url: `${S}/api/oauth/session?lite=1`,
        headers: { authorization: 'Bearer $t1' },
      },
      {
        url: `${S}/api/oauth/session?lite=1`,
        headers: { authorization: 'Bearer $t2' },
      },
      {
        url: `${S}/api/oauth/logout`,
        method: 'POST',
        headers: { authorization: 'Bearer $t2', ...json },
        text: '{"keepGrant":true}',
      },
      {
        url: `${S}/api/oauth/session?lite=1`,
        headers: { authorization: 'Bearer $t2' },
      },
      { mint: LAB.did },
      {
        url: `${S}/api/oauth/logout`,
        method: 'POST',
        headers: { authorization: 'Bearer $t3', ...json },
        text: '{"keepGrant":"yes"}',
      },
      {
        url: `${S}/api/oauth/logout`,
        method: 'POST',
        headers: { authorization: 'Bearer $t3' },
      },
      { url: `${S}/api/oauth/logout`, method: 'POST', text: '{}' },
      {
        url: `${S}/api/oauth/logout`,
        method: 'POST',
        headers: { authorization: `Bearer vg_${'2'.repeat(64)}` },
        text: '{}',
      },
      {
        url: `${S}/api/oauth/logout`,
        headers: { authorization: 'Bearer $t0' },
      },
      {
        url: `${S}/api/oauth/logout`,
        method: 'POST',
        headers: json,
        text: '{not json',
      },
      { url: `${S}/api/schedule/list`, method: 'OPTIONS' },
      { url: `${S}/oauth/session`, headers: { authorization: 'Bearer $t0' } },
      {
        url: `${S}/virga/oauth/login`,
        headers: { authorization: 'Bearer $t0' },
      },
      { url: `${S}/api/nothing-here` },
      {
        url: `${S}/api/schedule/list`,
        method: 'POST',
        headers: { authorization: 'Bearer $t0' },
      },
      { url: `${S}/api/schedule/list` },
      {
        url: `${S}/api/defense/lists`,
        headers: { authorization: `Bearer vg_${'3'.repeat(64)}` },
      },
      {
        url: `${S}/api/limits/status`,
        headers: { authorization: 'Bearer nope' },
      },
      {
        url: 'http://127.0.0.1:5701/api/oauth/session',
        headers: { authorization: 'Bearer $t0' },
      },
      {
        url: `${S}/api/oauth/proxy`,
        headers: { 'x-xrpc-method': 'com.atproto.repo.getRecord' },
      },
      {
        url: `${S}/api/oauth/proxy`,
        headers: {
          authorization: `Bearer vg_${'4'.repeat(64)}`,
          'x-xrpc-method': 'com.atproto.repo.getRecord',
        },
      },
      {
        url: `${S}/api/oauth/proxy`,
        method: 'PUT',
        headers: { authorization: 'Bearer $t0' },
      },
      {
        url: `${S}/api/oauth/upload-blob`,
        method: 'POST',
        headers: { 'content-type': 'image/png' },
      },
      {
        url: `${S}/api/oauth/upload-blob`,
        headers: { authorization: 'Bearer $t0' },
      },
    ],
  },
  {
    name: 'refused',
    steps: [
      { mint: ME.did },
      { refuse: ME.did },
      {
        url: `${S}/api/oauth/session?lite=1`,
        headers: { authorization: 'Bearer $t0' },
      },
      {
        url: `${S}/api/oauth/proxy`,
        headers: {
          authorization: 'Bearer $t0',
          'x-xrpc-method': 'com.atproto.repo.getRecord',
        },
      },
      {
        url: `${S}/api/oauth/session?lite=1`,
        headers: { authorization: 'Bearer $t0' },
      },
      {
        url: `${S}/api/oauth/session`,
        headers: { authorization: 'Bearer $t0' },
      },
      {
        url: `${S}/api/oauth/upload-blob?encoding=image/png`,
        method: 'POST',
        headers: {
          authorization: 'Bearer $t0',
          'content-type': 'application/octet-stream',
        },
      },
      { mint: ME.did },
      {
        url: `${S}/api/oauth/session?lite=1`,
        headers: { authorization: 'Bearer $t1' },
      },
      {
        url: `${S}/api/oauth/session`,
        headers: { authorization: 'Bearer $t0' },
      },
      { refuse: LAB.did },
      { mint: LAB.did },
      {
        url: `${S}/api/oauth/session`,
        headers: { authorization: 'Bearer $t2' },
      },
      { expire: ME.did },
      {
        url: `${S}/api/oauth/session`,
        headers: { authorization: 'Bearer $t1' },
      },
      {
        url: `${S}/api/oauth/session`,
        headers: { authorization: 'Bearer $t0' },
      },
      {
        url: `${S}/api/oauth/logout`,
        method: 'POST',
        headers: { authorization: 'Bearer $t2' },
        text: '{}',
      },
      {
        url: `${S}/api/oauth/session?lite=1`,
        headers: { authorization: 'Bearer $t2' },
      },
    ],
  },
  {
    name: 'terms-agreed',
    steps: [
      { mint: ME.did },
      { advance: DAY },
      {
        url: `${S}/api/terms/status`,
        headers: { authorization: 'Bearer $t0' },
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: { authorization: 'Bearer $t0', ...json },
        text: '{"version":1}',
      },
      { url: `${S}/api/terms/status` },
      {
        url: `${S}/api/terms/status`,
        method: 'POST',
        headers: { authorization: 'Bearer $t0' },
      },
      {
        url: `${S}/api/terms/accept`,
        headers: { authorization: 'Bearer $t0' },
      },
    ],
  },
  {
    name: 'terms-ask',
    terms: 'ask',
    steps: [
      { mint: ME.did },
      { mint: LAB.did },
      {
        url: `${S}/api/terms/status`,
        headers: { authorization: 'Bearer $t0' },
      },
      { advance: 5000 },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: {
          authorization: 'Bearer $t0',
          ...json,
          'user-agent': 'Virga',
        },
        text: '{"version":1}',
      },
      {
        url: `${S}/api/terms/status`,
        headers: { authorization: 'Bearer $t0' },
      },
      { advance: 5000 },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: { authorization: 'Bearer $t0', ...json },
        text: '{"version":1}',
      },
      {
        url: `${S}/api/terms/status`,
        headers: { authorization: 'Bearer $t1' },
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: json,
        text: `{"version":1,"did":"${LAB.did}"}`,
      },
      {
        url: `${S}/api/terms/status`,
        headers: { authorization: 'Bearer $t1' },
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: json,
        text: `{"version":1,"did":"${LAB.did}"}`,
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: json,
        text: `{"version":2,"did":"${ME.did}"}`,
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: json,
        text: `{"version":"1","did":"${ME.did}"}`,
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: json,
        text: '{"version":1,"did":"mira.example.com"}',
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: json,
        text: '{"version":1,"did":"did:key:z6Mk"}',
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: json,
        text: '{"version":1,"did":"did:web:café.example"}',
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: json,
        text: '{"version":1,"did":5}',
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: json,
        text: '{"version":1}',
      },
      { url: `${S}/api/terms/accept`, method: 'POST', headers: json },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: json,
        text: 'null',
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: { authorization: `Bearer vg_${'0'.repeat(64)}`, ...json },
        text: '{"version":1}',
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: { authorization: 'Bearer $t1', ...json },
        text: '[1]',
      },
    ],
  },
  {
    name: 'terms-down',
    terms: 'down',
    steps: [
      { mint: ME.did },
      {
        url: `${S}/api/terms/status`,
        headers: { authorization: 'Bearer $t0' },
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: { authorization: 'Bearer $t0', ...json },
        text: '{"version":1}',
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: json,
        text: `{"version":1,"did":"${ME.did}"}`,
      },
      {
        url: `${S}/api/terms/accept`,
        method: 'POST',
        headers: { authorization: 'Bearer nope', ...json },
        text: '{"version":1}',
      },
    ],
  },
];

const fill = (text, tokens) =>
  typeof text === 'string'
    ? text.replace(/\$t(\d+)/g, (_, i) => tokens[Number(i)])
    : text;

async function serverScenario({ terms = 'agreed', steps }) {
  const worlds = worldsFor('', NOW);
  return withRepeatableRandom(async () => {
    let clock = NOW;
    const server = createServer({
      worlds,
      terms,
      seed: false,
      now: () => clock,
    });
    const route = createServerRouter(server);
    const tokens = [];
    const out = [];
    for (const s of steps) {
      if (s.mint) {
        tokens.push(server.mintToken(s.mint));
        out.push({ token: tokens.at(-1) });
      } else if (s.refuse) {
        server.refuseGrant(s.refuse);
        out.push(null);
      } else if (s.expire) {
        server.expireAccount(s.expire);
        out.push(null);
      } else if (s.advance) {
        clock += s.advance;
        out.push(null);
      } else {
        const headers = {};
        for (const [k, v] of Object.entries(s.headers || {}))
          headers[k] = fill(v, tokens);
        const init = { method: s.method || 'GET', headers };
        if (s.text !== undefined) init.body = fill(s.text, tokens);
        out.push(await answerOf(await route(new URL(s.url), init)));
      }
    }
    return out;
  });
}

/* ---- the iOS proxy, made of the real server's pieces --------------------- */

const BINARY_OUTPUT = new Set([
  'com.atproto.sync.getRepo',
  'com.atproto.sync.getBlob',
  'com.atproto.sync.getRecord',
]);

const BLUESKY_APPVIEW_PROXY = 'did:web:api.bsky.app#bsky_appview';

const failure = (status, error, code) => ({
  status,
  body: { success: false, error, ...(code ? { code } : {}) },
});

/** server/oauth/handlers/proxy.js, past the token and the grant, over `agent`. */
async function proxyCall(
  agent,
  { method = 'GET', query = '', headers = {}, text },
) {
  const xrpcMethod = headers['x-xrpc-method'];
  if (!xrpcMethod) return failure(400, 'Missing X-XRPC-Method header');
  if (!isSafeXrpcMethod(xrpcMethod))
    return failure(400, 'Invalid or unsupported XRPC method');
  if (BINARY_OUTPUT.has(xrpcMethod))
    return failure(
      400,
      `${xrpcMethod} answers in bytes and can't go through Virga's server; read it from the PDS directly.`,
    );
  const isPost = method === 'POST';
  const params = forwardedQuery({ url: `/api/oauth/proxy?${query}` });
  let requestBody = null;
  if (isPost && text) {
    const body = JSON.parse(text);
    if (
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).length > 0
    )
      requestBody = body;
  }
  const input =
    isPost && requestBody
      ? requestBody
      : Object.keys(params).length > 0
        ? params
        : undefined;
  // executeXrpcCall(session, proxyHeader)
  const call = async (proxy) => {
    let target = agent;
    if (proxy) {
      const at = proxy.indexOf('#');
      const [did, service] =
        at === -1
          ? [proxy, 'bsky_fg']
          : [proxy.slice(0, at), proxy.slice(at + 1)];
      target = agent.withProxy(service, did);
    }
    return (await target.handle(xrpcMethod, input)).data;
  };
  const sendXrpcError = (error) =>
    failure(httpStatusForXrpcError(error), error.message, error.error);
  const customProxy = headers['x-atproto-proxy'];
  const usingCustomAppView =
    !!customProxy && customProxy !== BLUESKY_APPVIEW_PROXY;
  try {
    return {
      status: 200,
      body: { success: true, data: await call(customProxy) },
    };
  } catch (error) {
    // A read whose chosen AppView failed tries Bluesky's once.
    const status = error.status || error.statusCode;
    const upstreamFailure =
      !status || status >= 500 || status === ResponseType.InvalidResponse;
    if (!isPost && usingCustomAppView && upstreamFailure) {
      try {
        const data = await call(BLUESKY_APPVIEW_PROXY);
        return { status: 200, body: { success: true, data } };
      } catch (fallbackError) {
        return sendXrpcError(fallbackError);
      }
    }
    return sendXrpcError(error);
  }
}

/** server/oauth/handlers/uploadBlob.js, past the token and the grant, over `agent`. */
async function uploadCall(agent, { query = '', bytes }) {
  const encoding = new URLSearchParams(query).get('encoding') ?? undefined;
  const payload = extractBlobPayload(Buffer.from(bytes || []), encoding);
  if (payload.error) return failure(400, payload.error);
  try {
    const result = await agent.handle(
      'com.atproto.repo.uploadBlob',
      payload.uint8Array,
      { encoding: payload.encoding },
    );
    return {
      status: 200,
      body: { success: true, data: { blob: result.data.blob } },
    };
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (
      message.includes('expired') ||
      message.includes('invalid') ||
      message.includes('unauthorized')
    )
      return failure(
        401,
        'Session expired. Please re-authenticate.',
        'SESSION_EXPIRED',
      );
    const status =
      Number.isInteger(error?.status) &&
      error.status >= 400 &&
      error.status <= 599
        ? error.status
        : 500;
    return failure(status, error?.message || 'Internal error');
  }
}

const P = 'com.atproto.repo';
const FORWARDS = [
  { headers: {} },
  { headers: { 'x-xrpc-method': 'getRecord' } },
  { headers: { 'x-xrpc-method': 'com.atproto.__proto__.x' } },
  { headers: { 'x-xrpc-method': 'Com.atproto.repo.getRecord' } },
  { headers: { 'x-xrpc-method': 'com.atproto.sync.getRepo' } },
  {
    query: `repo=${ME.did}&collection=app.bsky.actor.profile&rkey=self`,
    headers: { 'x-xrpc-method': `${P}.getRecord` },
  },
  {
    query: 'collection=app.bsky.graph.follow&limit=2&reverse=true',
    headers: { 'x-xrpc-method': `${P}.listRecords` },
  },
  {
    query: 'collection=app.bsky.graph.follow&limit=2&reverse=1',
    headers: { 'x-xrpc-method': `${P}.listRecords` },
  },
  {
    query: 'collection=app.bsky.feed.post&limit=abc&cursor=2',
    headers: { 'x-xrpc-method': `${P}.listRecords` },
  },
  {
    query: 'limit=2&limit=3',
    headers: { 'x-xrpc-method': 'app.bsky.notification.listNotifications' },
  },
  {
    query: `actor=${ME.did}&limit=2&method=x&action=proxy`,
    headers: { 'x-xrpc-method': 'app.bsky.graph.getFollowers' },
  },
  {
    query: `actors=${LAB.did},%20ana.example.com,,&actors=nobody`,
    headers: { 'x-xrpc-method': 'app.bsky.actor.getProfiles' },
  },
  {
    query: `actors=${LAB.did}`,
    headers: { 'x-xrpc-method': 'app.bsky.actor.getProfiles' },
  },
  {
    query: 'actors=',
    headers: { 'x-xrpc-method': 'app.bsky.actor.getProfiles' },
  },
  { headers: { 'x-xrpc-method': 'app.bsky.actor.getPreferences' } },
  { headers: { 'x-xrpc-method': 'app.bsky.draft.getDrafts' } },
  {
    headers: {
      'x-xrpc-method': 'app.bsky.draft.getDrafts',
      'x-atproto-proxy': 'did:web:api.bsky.app#bsky_appview',
    },
  },
  {
    headers: {
      'x-xrpc-method': 'app.bsky.draft.getDrafts',
      'x-atproto-proxy': 'did:web:api.bsky.app',
    },
  },
  {
    query: 'limit=1',
    headers: {
      'x-xrpc-method': 'app.bsky.bookmark.getBookmarks',
      'x-atproto-proxy': 'did:web:api.bsky.app#bsky_appview',
    },
  },
  {
    query: 'q=garden&limit=2',
    headers: { 'x-xrpc-method': 'app.bsky.feed.searchPosts' },
  },
  // Through another AppView: a read that fails there (a 5xx, or no status)
  // is asked of Bluesky's once; a 4xx, and a write, are not.
  {
    headers: {
      'x-xrpc-method': 'app.bsky.draft.getDrafts',
      'x-atproto-proxy': 'did:web:appview.example#bsky_appview',
    },
  },
  {
    query: 'limit=1',
    headers: {
      'x-xrpc-method': 'app.bsky.bookmark.getBookmarks',
      'x-atproto-proxy': 'did:web:appview.example',
    },
  },
  {
    headers: {
      'x-xrpc-method': 'app.bsky.unspecced.getSomething',
      'x-atproto-proxy': 'did:web:appview.example#bsky_appview',
    },
  },
  {
    query: 'q=garden&author=a&author=b',
    headers: {
      'x-xrpc-method': 'app.bsky.feed.searchPosts',
      'x-atproto-proxy': 'did:web:appview.example#bsky_appview',
    },
  },
  {
    query: 'limit=1',
    headers: {
      'x-xrpc-method': 'app.bsky.feed.searchPosts',
      'x-atproto-proxy': 'did:web:appview.example#bsky_appview',
    },
  },
  {
    query: 'q=garden&author=a&author=b',
    headers: { 'x-xrpc-method': 'app.bsky.feed.searchPosts' },
  },
  {
    method: 'POST',
    headers: {
      'x-xrpc-method': 'app.bsky.draft.createDraft',
      'x-atproto-proxy': 'did:web:appview.example#bsky_appview',
    },
    text: JSON.stringify({ draft: { posts: [{ text: 'x' }] } }),
  },
  {
    query: 'toString=x&limit=1',
    headers: { 'x-xrpc-method': 'app.bsky.notification.listNotifications' },
  },
  {
    query: 'aud=did:web:x&lxm=a.b.c&constructor=y',
    headers: { 'x-xrpc-method': 'com.atproto.server.getServiceAuth' },
  },
  {
    query: '__proto__=z&collection=app.bsky.graph.follow&limit=1',
    headers: { 'x-xrpc-method': `${P}.listRecords` },
  },
  { headers: { 'x-xrpc-method': 'app.bsky.unspecced.getSomething' } },
  { headers: { 'x-xrpc-method': 'com.atproto.server.getServiceAuth' } },
  {
    query: `aud=did:web:video.bsky.app&lxm=app.bsky.video.getUploadLimits&exp=${Math.floor(NOW / 1000) + 600}`,
    headers: { 'x-xrpc-method': 'com.atproto.server.getServiceAuth' },
  },
  {
    method: 'POST',
    headers: { 'x-xrpc-method': `${P}.createRecord` },
    text: JSON.stringify({
      repo: ME.did,
      collection: 'app.bsky.feed.post',
      rkey: '3mproxypost22',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Through the proxy',
        createdAt: new Date(NOW).toISOString(),
      },
    }),
  },
  {
    method: 'POST',
    headers: { 'x-xrpc-method': `${P}.createRecord` },
    text: JSON.stringify({
      repo: ME.did,
      collection: 'app.bsky.feed.post',
      rkey: '3mproxypost22',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Again',
        createdAt: new Date(NOW).toISOString(),
      },
    }),
  },
  {
    method: 'POST',
    headers: { 'x-xrpc-method': `${P}.createRecord` },
    text: JSON.stringify({
      repo: LAB.did,
      collection: 'x',
      rkey: 'a',
      record: {},
    }),
  },
  {
    method: 'POST',
    query: 'collection=app.bsky.feed.post&limit=1',
    headers: { 'x-xrpc-method': `${P}.listRecords` },
    text: '{}',
  },
  {
    method: 'POST',
    query: 'collection=app.bsky.feed.post&limit=1',
    headers: { 'x-xrpc-method': `${P}.listRecords` },
    text: '[1,2]',
  },
  {
    method: 'POST',
    headers: { 'x-xrpc-method': `${P}.deleteRecord` },
    text: JSON.stringify({
      repo: ME.did,
      collection: 'app.bsky.feed.post',
      rkey: '3mproxypost22',
    }),
  },
  {
    method: 'POST',
    headers: { 'x-xrpc-method': `${P}.applyWrites` },
    text: JSON.stringify({ writes: 'abc' }),
  },
  {
    method: 'POST',
    headers: { 'x-xrpc-method': 'app.bsky.actor.putPreferences' },
    text: JSON.stringify({ preferences: [{ $type: 'x' }] }),
  },
  { headers: { 'x-xrpc-method': 'app.bsky.actor.getPreferences' } },
  { upload: true, query: 'encoding=image/png', bytes: [137, 80, 78, 71] },
  { upload: true, query: 'encoding=application/octet-stream', bytes: [1, 2] },
  { upload: true, query: 'encoding=image/png', bytes: [] },
  { upload: true, query: '', bytes: [1] },
];

async function forward({ search = '', steps }) {
  const worlds = worldsFor(search, NOW);
  const world = worlds[0];
  let sweeps = 0;
  const agent = createFakeAgent(world, {
    worlds,
    scope: () => world.scope,
    sweepCounter: { next: () => ++sweeps },
  });
  const out = [];
  for (const s of steps) {
    const { status, body } = s.upload
      ? await uploadCall(agent, s)
      : await proxyCall(agent, s);
    out.push({ status, body: shrink(body) });
  }
  return out;
}

export default async function cases() {
  return [
    ...(await each(
      'server',
      SCENARIOS.map((s) => ({ $id: s.name, ...s })),
      (s) => atTime(NOW, () => serverScenario(s)),
    )),
    ...(await each(
      'forward',
      [
        { $id: 'full', steps: FORWARDS },
        {
          $id: 'read-only',
          search: '?scope=read',
          steps: FORWARDS.filter((s) => s.method === 'POST' || s.upload),
        },
      ],
      (s) => atTime(NOW, () => forward(s)),
    )),
    ...(await each(
      'forwardedQuery',
      [
        '',
        'a=1',
        'a=1&a=2&a=3',
        'limit=10&depth=x&parentHeight=2.5',
        'limit=1&limit=2',
        'reverse=true&validate=false&includePins=TRUE&includeTakedowns=',
        'reverse=true&reverse=true',
        'uris=a,%20b,,c&feeds=&actors=x&actors=y&dids=,&handles=%20',
        'method=x&action=proxy&action=other',
        'action=proxy',
        'action=x',
        'q=a+b%20c&cursor=%E0%A4',
        '%E2%80%A8=1&=2&x',
        'toString=x',
        'constructor=y&a=1',
        'valueOf=1&valueOf=2&hasOwnProperty=3',
        '__defineGetter__=a&__lookupSetter__=b&isPrototypeOf=c&propertyIsEnumerable=d&toLocaleString=e',
        'limit=1&toString=x&toString=y',
        '__proto__=z&a=1',
        'a=1&__proto__=z',
        '__proto__=z&length=5&0=a&1=b&2=c&map=m&reverse=true',
        '__proto__=z&__proto__=w&length=5&2=c&01=d&-0=e',
        '__proto__=z&limit=3&uris=a,b&feeds=x&with=1&flatMap=2&toSorted=3&push=4',
        '__proto__=z&reverse=false&reverse=true',
        'reverse=x&__proto__=z',
        '__proto__=z&method=x&action=proxy',
        'length=3&map=x&0=y',
      ].map((query) => ({ $id: query || 'empty', query })),
      ({ query }) => forwardedQuery({ url: `/api/oauth/proxy?${query}` }),
    )),
    ...(await each(
      'isSafeXrpcMethod',
      [
        'com.atproto.repo.getRecord',
        'app.bsky.feed.getPostThread',
        'a.b.c',
        'a.b',
        'A.b.c',
        '1a.b.c',
        'a1.B2.C3',
        'a.b.',
        'a..b.c',
        'a.b.c.d.e',
        'com.atproto.__proto__',
        'com.constructor.x',
        'com.x.prototype',
        'com.x.y-z',
        'com.x.y_z',
        'com.x.é',
        '',
        null,
        5,
      ].map((method, i) => ({ $id: `method#${i}`, method })),
      ({ method }) => isSafeXrpcMethod(method),
    )),
    ...(await each(
      'httpStatusForXrpcError',
      [
        undefined,
        0,
        1,
        2,
        3,
        200,
        399,
        400,
        401,
        404,
        501,
        599,
        600,
        400.5,
        '400',
      ].map((status, i) => ({
        $id: `status#${i}`,
        status,
      })),
      ({ status }) => httpStatusForXrpcError({ status }),
    )),
  ];
}
