// Virga's confidential OAuth client: its identity, keys, scope and the pages a
// sign-in may return to.
//
// Every URL hangs off OAUTH_PUBLIC_URL and never off the request's Host
// header. Grants are bound to the client_id that obtained them and
// oauth_sessions is keyed by DID alone, so two client_ids writing one table (a
// preview origin, a tunnel, a second domain) would overwrite each other's
// grants for the same DID, and the overwritten side could then neither refresh
// nor revoke. One OAUTH_PUBLIC_URL per Supabase project, set before the first
// sign-in and never changed: a new value is a new client, and every stored
// grant stops refreshing.

import { APP_NAME, OAUTH_RETURN_PATH, OAUTH_SCOPE } from '../../src/config.js';
import { frontendOrigins, publicUrl } from '../origins.js';
import { sendJson } from '../http.js';

/** Every frontend session token is this plus 64 lowercase hex (the client checks the shape). */
export const TOKEN_PREFIX = 'vg_';
export const TOKEN_PATTERN = /^vg_[0-9a-f]{64}$/;

/** The one page a sign-in may hand its token to. */
export const RETURN_PATH = OAUTH_RETURN_PATH;

/**
 * What every sign-in asks for and what the metadata declares, so declared ⊇
 * requested holds trivially. The app's own definition, so the two can't drift.
 */
export const SCOPE = OAUTH_SCOPE;

export const CLIENT_METADATA_PATH = '/api/oauth/client-metadata.json';
export const JWKS_PATH = '/api/oauth/jwks.json';
export const CALLBACK_PATH = '/api/oauth/callback';

const MAX_KEYS = 3;

/** The origins a sign-in may return to: OAUTH_PUBLIC_URL's plus OAUTH_EXTRA_RETURN_ORIGINS. */
export function returnOrigins(env = process.env) {
  return frontendOrigins(env);
}

/**
 * Whether a sign-in may hand its token to this page: the return page on one of
 * the allowed origins, with any query (the page's nonce). The path is pinned,
 * not just the origin, because the token rides in the fragment and a browser
 * carries a fragment across any redirect whose Location has none: a page on
 * the same origin that redirects onward (/api/oauth/login, which 302s to
 * whatever authorization server a handle names) would pass the token on.
 */
export function isAllowedReturnUrl(url, env = process.env) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    if (parsed.pathname !== RETURN_PATH) return false;
    return returnOrigins(env).includes(parsed.origin);
  } catch {
    return false;
  }
}

/** Where a sign-in lands when nothing better is known, or null. */
export function defaultReturnUrl(env = process.env) {
  const origin = publicUrl(env);
  return origin ? `${origin}${RETURN_PATH}` : null;
}

export function httpsUrlOrNull(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The https origin of OAUTH_PUBLIC_URL, or null (a confidential client can't be loopback). */
function httpsPublicUrl(env) {
  const origin = publicUrl(env);
  if (!origin) return null;
  try {
    return new URL(origin).protocol === 'https:' ? origin : null;
  } catch {
    return null;
  }
}

/**
 * The client metadata, served at its own client_id. The authorization server
 * fetches it (and the JWKS) again for the life of every session, so both paths
 * must stay reachable and unchanged.
 */
export function clientMetadata(env = process.env) {
  const origin = httpsPublicUrl(env);
  if (!origin)
    throw new Error('OAUTH_PUBLIC_URL is not set to an https origin');
  const tos = httpsUrlOrNull(env.OAUTH_TOS_URL);
  const policy = httpsUrlOrNull(env.OAUTH_POLICY_URL);
  return {
    client_id: `${origin}${CLIENT_METADATA_PATH}`,
    client_name: APP_NAME,
    // Must share the client_id's host.
    client_uri: origin,
    logo_uri: `${origin}/icon.svg`,
    // An http link would stop NodeOAuthClient from starting; it is left out.
    ...(tos ? { tos_uri: tos } : {}),
    ...(policy ? { policy_uri: policy } : {}),
    redirect_uris: [`${origin}${CALLBACK_PATH}`],
    grant_types: ['authorization_code', 'refresh_token'],
    scope: SCOPE,
    response_types: ['code'],
    application_type: 'web',
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    dpop_bound_access_tokens: true,
    // By reference, never inline, so a key rotation needs no metadata change.
    jwks_uri: `${origin}${JWKS_PATH}`,
  };
}

/**
 * OAUTH_PRIVATE_KEY_1..3: ES256 private JWKs as JSON. More than one only while
 * rotating: add the new key, deploy, and remove the old one once nothing signs
 * with it. A value that isn't JSON is skipped with a warning (never logged).
 */
export function loadPrivateKeys(env = process.env) {
  const keys = [];
  for (let i = 1; i <= MAX_KEYS; i++) {
    const raw = env[`OAUTH_PRIVATE_KEY_${i}`];
    if (!raw) continue;
    try {
      const jwk = JSON.parse(raw);
      keys.push({ ...jwk, kid: jwk.kid || `virga-key${i}` });
    } catch {
      console.warn(`[oauth] OAUTH_PRIVATE_KEY_${i} is not valid JSON; skipped`);
    }
  }
  return keys;
}

/**
 * Why the client can't run here, or null when it can. Previews are given no
 * key on purpose: they answer 503 and the app stays in browser mode.
 */
export function unavailableReason(env = process.env) {
  if (loadPrivateKeys(env).length === 0)
    return 'OAUTH_PRIVATE_KEY_1 is not set';
  if (!httpsPublicUrl(env))
    return 'OAUTH_PUBLIC_URL is not set to an https origin';
  return null;
}

/** The 503 every OAuth route answers while the client is unavailable. */
export function sendUnavailable(res, reason) {
  console.warn(`[oauth] client unavailable: ${reason}`);
  return sendJson(res, 503, {
    success: false,
    code: 'VIRGA_CLIENT_UNAVAILABLE',
    error: 'Signing in with Virga is not available right now.',
  });
}

/**
 * How a failed authorize() reads to the caller: an identity that doesn't
 * resolve is the reader's input (400 HANDLE_NOT_FOUND); anything else is the
 * host or its authorization server (502 AUTHORIZE_FAILED). The wrapper's error
 * carries the library's as its cause, so the chain is walked.
 */
export function classifyAuthorizeError(error) {
  for (let e = error, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (/Failed to resolve identity/i.test(String(e.message || ''))) {
      return { status: 400, code: 'HANDLE_NOT_FOUND' };
    }
  }
  return { status: 502, code: 'AUTHORIZE_FAILED' };
}
