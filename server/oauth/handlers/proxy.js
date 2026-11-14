// GET|POST /api/oauth/proxy: an XRPC call made as the account.
//
// The browser holds only its `vg_` token; this restores the account's OAuth
// session and makes the call named by X-XRPC-Method through @atproto/api's
// Agent, which signs it with the session's DPoP-bound token. The query string
// is the call's params, the POST body its input.
//
//   200 { success: true, data }
//   <upstream status> { success: false, error, code, ratelimit? }
//
// Optional headers: X-Atproto-Proxy (<did>#<service>, for AppView-proxied
// calls), Atproto-Accept-Labelers, and the relayed Accept-Language /
// X-Bsky-Topics.

import { Agent } from '@atproto/api';
import { ResponseType } from '@atproto/xrpc';
import { bearerToken, methodGuard, readJson, sendJson } from '../../http.js';
import { getOAuthClient } from '../client.js';
import { sendUnavailable, unavailableReason } from '../config.js';
import { getStorage } from '../storage.js';
import { isInvalidTokenError, restoreWithRetry } from '../restore.js';
import {
  describeXrpcError,
  httpStatusForXrpcError,
  isRetriableConnectError,
  isRoutineNotFound,
  pickRateLimitHeaders,
  pickRelayedHeaders,
} from '../xrpcErrors.js';
import { rawQuery } from '../respond.js';

// A lexicon NSID: a reverse-DNS authority (two or more segments) plus a name.
// The method is walked as a path into the Agent, so anything else could reach
// non-XRPC internals: `fetchHandler` would send the access token and a DPoP
// proof to whatever absolute URL followed.
const XRPC_NSID_SHAPE = /^[a-z][a-z0-9]*(\.[a-zA-Z0-9]+){2,}$/;
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

// Outputs that are bytes, not JSON: the envelope can't carry them, and the
// app reads repos and blobs from the PDS directly.
const BINARY_OUTPUT = new Set([
  'com.atproto.sync.getRepo',
  'com.atproto.sync.getBlob',
  'com.atproto.sync.getRecord',
]);

const BOOLEAN_PARAMS = [
  'reverse',
  'validate',
  'includeTakedowns',
  'includeItemCount',
  'includePins',
];
const NUMERIC_PARAMS = ['limit', 'depth', 'parentHeight'];
const ARRAY_PARAMS = [
  'feeds',
  'uris',
  'actors',
  'dids',
  'handles',
  'members',
  'labelers',
];

const BLUESKY_APPVIEW_PROXY = 'did:web:api.bsky.app#bsky_appview';
// The SDK sends Bluesky's moderation labeler on its own.
const BLUESKY_DEFAULT_LABELER_DID = 'did:plc:ar7c4by46qjdydhdevvrndac';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether a method name is safe to walk into the Agent. */
export function isSafeXrpcMethod(method) {
  if (typeof method !== 'string' || !XRPC_NSID_SHAPE.test(method)) return false;
  return !method.split('.').some((part) => UNSAFE_SEGMENTS.has(part));
}

/**
 * The XRPC params of the request: its query string, with repeated keys as
 * arrays and the known non-string params coerced for the SDK.
 *
 * Read from the raw URL rather than req.query, which also carries the router's
 * own `action` segment. `method` is never forwarded: the method is named by
 * its header only, and a `method` param left in would reach the call.
 */
export function forwardedQuery(req) {
  const raw = rawQuery(req);
  const params = {};
  if (raw || !req?.query) {
    for (const [key, value] of new URLSearchParams(raw)) {
      if (key in params) params[key] = [].concat(params[key], value);
      else params[key] = value;
    }
    // Where a runtime rewrites the URL to the dynamic route, the router's
    // segment arrives as a param of its own.
    if (params.action === 'proxy') delete params.action;
  } else {
    Object.assign(params, req.query);
    delete params.action;
  }
  delete params.method;

  for (const name of BOOLEAN_PARAMS) {
    if (params[name] !== undefined) params[name] = params[name] === 'true';
  }
  for (const name of NUMERIC_PARAMS) {
    if (params[name] !== undefined) params[name] = Number(params[name]);
  }
  for (const name of ARRAY_PARAMS) {
    if (typeof params[name] === 'string' && params[name]) {
      params[name] = params[name]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return params;
}

/** The extra labeler DIDs from Atproto-Accept-Labelers, without `;redact` and without Bluesky's own. */
function acceptLabelers(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((entry) => entry.split(';')[0].trim())
    .filter((did) => did && did !== BLUESKY_DEFAULT_LABELER_DID);
}

function header(req, name) {
  const value = req?.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return undefined;

  try {
    const token = bearerToken(req);
    if (!token)
      return sendJson(res, 401, {
        success: false,
        error: 'Missing or invalid authorization header',
      });

    const unavailable = unavailableReason();
    if (unavailable) return sendUnavailable(res, unavailable);

    const validation =
      await getStorage().frontendSessionStore.validateWithDetails(token);
    if (!validation.userDid) {
      if (validation.error) {
        console.warn(
          `[oauth/proxy] token store unavailable (${validation.error})`,
        );
        return sendJson(res, 503, {
          success: false,
          error: 'Session validation temporarily unavailable, please retry',
          code: 'VALIDATION_TRANSIENT_ERROR',
        });
      }
      return sendJson(res, 401, {
        success: false,
        error: 'Invalid or expired session',
        code: 'FRONTEND_SESSION_INVALID',
      });
    }
    const userDid = validation.userDid;

    const xrpcMethod = header(req, 'x-xrpc-method');
    if (!xrpcMethod) {
      return sendJson(res, 400, {
        success: false,
        error: 'Missing X-XRPC-Method header',
      });
    }
    if (!isSafeXrpcMethod(xrpcMethod)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Invalid or unsupported XRPC method',
      });
    }
    if (BINARY_OUTPUT.has(xrpcMethod)) {
      return sendJson(res, 400, {
        success: false,
        error: `${xrpcMethod} answers in bytes and can't go through Virga's server; read it from the PDS directly.`,
      });
    }

    const oauthClient = getOAuthClient();
    let oauthSession = await restoreWithRetry(oauthClient, userDid, {
      tag: 'oauth/proxy',
    });
    if (!oauthSession) {
      return sendJson(res, 401, {
        success: false,
        error: 'OAuth session missing. Automatic re-authentication required.',
        code: 'OAUTH_SESSION_MISSING',
      });
    }

    const isPost = String(req.method).toUpperCase() === 'POST';
    const queryParams = forwardedQuery(req);
    let requestBody = null;
    if (isPost) {
      const body = await readJson(req);
      if (Object.keys(body).length > 0) requestBody = body;
    }

    const customProxyHeader = header(req, 'x-atproto-proxy');
    const upstreamHeaders = pickRelayedHeaders(req.headers);
    const extraLabelers = acceptLabelers(
      header(req, 'atproto-accept-labelers'),
    );
    const usingCustomAppView =
      !!customProxyHeader && customProxyHeader !== BLUESKY_APPVIEW_PROXY;

    async function executeXrpcCall(session, proxyHeader) {
      let agent = new Agent(session);
      if (proxyHeader) {
        const at = proxyHeader.indexOf('#');
        const [did, service] =
          at === -1
            ? [proxyHeader, 'bsky_fg']
            : [proxyHeader.slice(0, at), proxyHeader.slice(at + 1)];
        agent = agent.withProxy(service, did);
      }
      if (
        extraLabelers.length > 0 &&
        typeof agent.configureLabelers === 'function'
      ) {
        agent.configureLabelers(extraLabelers);
      }

      let parent = null;
      let current = agent;
      for (const part of xrpcMethod.split('.')) {
        if (current && current[part] !== undefined) {
          parent = current;
          current = current[part];
        } else {
          throw new Error(`Unknown XRPC method: ${xrpcMethod}`);
        }
      }
      if (typeof current !== 'function')
        throw new Error(`${xrpcMethod} is not a callable method`);

      // Per-call options, only when there is something to relay, so every
      // other call keeps the single-argument shape.
      const callOpts =
        Object.keys(upstreamHeaders).length > 0
          ? { headers: upstreamHeaders }
          : undefined;
      const call = current.bind(parent);
      if (isPost && requestBody)
        return callOpts ? call(requestBody, callOpts) : call(requestBody);
      if (Object.keys(queryParams).length > 0)
        return callOpts ? call(queryParams, callOpts) : call(queryParams);
      return callOpts ? call({}, callOpts) : call();
    }

    // The call with two transparent retries, each on its own budget:
    //   "Invalid token"  a refresh race (another request just rotated the
    //                    token); restore fresh and retry once. A second one
    //                    means the grant is dead: tagged for a 401, never a
    //                    fallback.
    //   connect failure  the socket never opened, so the request was never
    //                    sent; retry once after a short wait, writes included.
    async function callWithRetries(proxyHeader) {
      let tokenRetries = 0;
      let connectRetries = 0;
      for (;;) {
        try {
          const result = await executeXrpcCall(oauthSession, proxyHeader);
          return result.data;
        } catch (xrpcError) {
          const invalidToken = isInvalidTokenError(xrpcError);
          if (invalidToken && tokenRetries < 1) {
            tokenRetries++;
            console.warn(
              `[oauth/proxy] "Invalid token" for ${xrpcMethod}; restoring the session again`,
            );
            await sleep(1200);
            try {
              const fresh = await oauthClient.restoreSession(userDid, {
                fresh: true,
              });
              if (fresh) {
                oauthSession = fresh;
                continue;
              }
            } catch (restoreError) {
              console.warn(
                `[oauth/proxy] fresh restore failed: ${restoreError?.message || restoreError}`,
              );
            }
          }
          if (invalidToken) {
            console.warn(
              `[oauth/proxy] the grant for ${userDid} is dead; the account must sign in again`,
            );
            oauthClient.evictSession(userDid);
            const dead = new Error(
              'OAuth session expired. Automatic re-authentication required.',
            );
            dead.reauth = true;
            throw dead;
          }
          if (isRetriableConnectError(xrpcError) && connectRetries < 1) {
            connectRetries++;
            console.warn(
              `[oauth/proxy] connect failure for ${xrpcMethod}; retrying once`,
            );
            await sleep(500);
            continue;
          }
          throw xrpcError;
        }
      }
    }

    function sendXrpcError(xrpcError) {
      if (xrpcError.reauth) {
        return sendJson(res, 401, {
          success: false,
          error: xrpcError.message,
          code: 'OAUTH_SESSION_MISSING',
        });
      }
      const ratelimit = pickRateLimitHeaders(xrpcError.headers);
      return sendJson(res, httpStatusForXrpcError(xrpcError), {
        success: false,
        error: xrpcError.message,
        code: xrpcError.error,
        ...(ratelimit ? { ratelimit } : {}),
      });
    }

    try {
      const data = await callWithRetries(customProxyHeader);
      return sendJson(res, 200, { success: true, data });
    } catch (xrpcError) {
      // A read whose chosen AppView is down or answered something unusable
      // tries Bluesky's once. Not writes (no double effect), not a dead grant,
      // not a clean 4xx (it would just repeat). InvalidResponse counts: the
      // chosen AppView's answer failed the SDK's validation, which Bluesky's
      // may pass. Unknown doesn't: the retry would go through the same PDS and
      // session.
      const status = xrpcError.status || xrpcError.statusCode;
      const upstreamFailure =
        !status || status >= 500 || status === ResponseType.InvalidResponse;
      if (
        !isPost &&
        usingCustomAppView &&
        !xrpcError.reauth &&
        upstreamFailure
      ) {
        console.warn(
          `[oauth/proxy] AppView failed for ${xrpcMethod} (${xrpcError.error || status || 'network error'}); trying Bluesky's`,
        );
        try {
          const data = await callWithRetries(BLUESKY_APPVIEW_PROXY);
          return sendJson(res, 200, { success: true, data });
        } catch (fallbackError) {
          console.error(
            `[oauth/proxy] Bluesky's AppView also failed for ${xrpcMethod}: ${describeXrpcError(fallbackError)}`,
          );
          return sendXrpcError(fallbackError);
        }
      }
      // A missing record is an answer, not a failure.
      if (isRoutineNotFound(xrpcError)) {
        console.log(
          `[oauth/proxy] Not found for ${xrpcMethod}: ${describeXrpcError(xrpcError)}`,
        );
      } else {
        console.error(
          `[oauth/proxy] XRPC error for ${xrpcMethod}: ${describeXrpcError(xrpcError)}`,
        );
      }
      return sendXrpcError(xrpcError);
    }
  } catch (error) {
    console.error(`[oauth/proxy] ${error?.message || error}`);
    return sendJson(res, 500, {
      success: false,
      error: error?.message || 'Internal error',
    });
  }
}
