// Lazy singleton for the BrowserOAuthClient.
//
// Production: builds metadata that mirrors what /oauth-client-metadata.json
//   serves (api/client-metadata.js).
// Development: uses the loopback client the spec provides for localhost,
//   which means the OAuth server doesn't have to fetch our metadata. Its
//   redirect URI has to name 127.0.0.1 (RFC 8252 forbids the `localhost`
//   hostname there), and the session the callback stores lives at that
//   origin, so start a local sign-in from http://127.0.0.1:<port>.

// `@atproto/oauth-client-browser` (with its zod / jose dependency tree) is
// heavy, and a visitor who is only reading the front page never needs it.
// It is imported dynamically inside the client factory so it lands in its own
// lazily-fetched chunk: the session provider only awaits it when a session
// may exist or a sign-in starts.
import { APP_NAME, OAUTH_CALLBACK_PATH, OAUTH_SCOPE } from '../config.js';

let _clientPromise = null;

// Module-level event bus. The BrowserOAuthClient itself does not expose
// addEventListener; it surfaces session lifecycle through `onDelete` /
// `onUpdate` constructor hooks. We forward those into a real EventTarget so
// React (or anything else) can subscribe in the usual way.
const _events = new EventTarget();

export function getOauthEvents() {
  return _events;
}

function isLoopbackHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

/**
 * A loopback client's `client_id` IS its metadata: `http://localhost` plus
 * query params naming its redirect URI and scope, which the authorization
 * server parses instead of fetching a document. The scope has to be declared
 * here for the same reason it is in the production metadata: a server checks
 * each sign-in's request against what the client declared.
 */
export function buildLoopbackClientId(origin, redirectPath) {
  const redirect = new URL(redirectPath, origin);
  if (redirect.hostname === 'localhost') redirect.hostname = '127.0.0.1';
  const params = new URLSearchParams({
    redirect_uri: redirect.href,
    scope: OAUTH_SCOPE,
  });
  return `http://localhost?${params}`;
}

/**
 * The metadata for a hosted origin. api/client-metadata.js serves the same
 * object from the same origin; the two must agree, and oauthClient.test.js
 * checks that they do.
 */
export function buildClientMetadata(origin) {
  return {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: APP_NAME,
    client_uri: origin,
    logo_uri: `${origin}/icon.svg`,
    redirect_uris: [`${origin}${OAUTH_CALLBACK_PATH}`],
    scope: OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  };
}

/**
 * Lazily construct (once) the BrowserOAuthClient. Returns a Promise: the
 * `@atproto/oauth-client-browser` module is imported dynamically so it never
 * weighs down the entry bundle. A failed construction clears the cached
 * promise so a later call can retry.
 */
export function getOauthClient() {
  if (_clientPromise) return _clientPromise;
  _clientPromise = createOauthClient().catch((err) => {
    _clientPromise = null;
    throw err;
  });
  return _clientPromise;
}

async function createOauthClient() {
  const { BrowserOAuthClient } = await import('@atproto/oauth-client-browser');

  const origin = window.location.origin;

  const hooks = {
    onDelete: (sub, cause) => {
      _events.dispatchEvent(new CustomEvent('deleted', { detail: { sub, cause } }));
    },
    onUpdate: (sub, session) => {
      _events.dispatchEvent(new CustomEvent('updated', { detail: { sub, session } }));
    },
  };

  if (isLoopbackHost(window.location.hostname)) {
    // `load` turns the loopback client_id into the metadata object the
    // constructor wants.
    return BrowserOAuthClient.load({
      clientId: buildLoopbackClientId(origin, OAUTH_CALLBACK_PATH),
      handleResolver: 'https://bsky.social',
      ...hooks,
    });
  }

  return new BrowserOAuthClient({
    handleResolver: 'https://bsky.social',
    clientMetadata: buildClientMetadata(origin),
    ...hooks,
  });
}

/**
 * A sign-in that couldn't start (the handle didn't resolve, the PDS's
 * authorization server didn't answer), in words a visitor can act on. The
 * library's own messages are written for developers (an unresolvable handle
 * surfaces as "Failed to resolve identity: …", a bad config as a zod issue
 * dump), so the sign-in form shows this and logs the original. A sign-in
 * through Virga's server fails with the server's `code` instead, which is
 * read first.
 */
export function signInErrorMessage(err) {
  const code = typeof err?.code === 'string' ? err.code : null;
  if (code === 'HANDLE_NOT_FOUND') {
    return 'Couldn’t find that account. Check the handle (it looks like you.bsky.social), or paste your DID.';
  }
  if (code === 'AUTHORIZE_FAILED') {
    return 'Found the account, but its server isn’t accepting sign-ins from here right now.';
  }
  if (code === 'VIRGA_CLIENT_UNAVAILABLE' || (code == null && err?.status === 503)) {
    return 'Virga’s server isn’t taking sign-ins right now. Try again in a little while.';
  }
  if (code === 'NETWORK_ERROR') {
    return 'Couldn’t reach Virga’s server. Check your connection and try again.';
  }
  if (code === 'REDIRECT_NOT_ALLOWED') {
    return 'Virga’s server doesn’t take sign-ins from this address. Long sessions work from Virga’s own site.';
  }
  const message = String(err?.message || '');
  if (/redirect_uri|allowed frontend/i.test(message)) {
    return 'Virga’s server doesn’t take sign-ins from this address. Long sessions work from Virga’s own site.';
  }
  if (/resolve identity|invalid (handle|did)|handle must be/i.test(message)) {
    return 'Couldn’t find that account. Check the handle (it looks like you.bsky.social), or paste your DID.';
  }
  const serverRefused =
    /resolve oauth server metadata|not protected by issuer|does not support/i;
  if (serverRefused.test(message)) {
    return 'Found the account, but its server isn’t accepting sign-ins from here right now.';
  }
  // A server that doesn't know the permissions this app asks for answers the
  // request with invalid_scope. Older PDS software is the usual reason.
  if (/invalid_scope|scope/i.test(message)) {
    return 'Found the account, but its server didn’t accept the permissions Virga asks for. It may be running older software.';
  }
  if (err?.name === 'TypeError' && /fetch|network|load failed/i.test(message)) {
    return 'Couldn’t reach the account’s server. Check your connection and try again.';
  }
  return 'Sign-in couldn’t start. Check the handle and try again.';
}

/**
 * The same for a sign-in that came back without a session: declined at the
 * consent screen, or the return couldn't be matched to the request that
 * started it (an old tab, a reload, a link from somewhere else). Both kinds
 * of sign-in put the code in `err.params`.
 */
export function callbackErrorMessage(err) {
  const code =
    typeof err?.params?.get === 'function' ? err.params.get('error') : null;
  if (code === 'access_denied') {
    return 'Access wasn’t granted, so you’re not signed in.';
  }
  if (code === 'unexpected_return') {
    return 'That sign-in wasn’t started from this tab, so Virga ignored it. Nothing was changed.';
  }
  if (code === 'invalid_scope') {
    return 'The account’s server didn’t accept the permissions Virga asks for, so you’re not signed in.';
  }
  if (code === 'VIRGA_CLIENT_UNAVAILABLE') {
    return 'Virga’s server isn’t taking sign-ins right now, so you’re not signed in. Try again in a little while.';
  }
  return 'Sign-in didn’t finish, so you’re not signed in. Nothing was changed.';
}
