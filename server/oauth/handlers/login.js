// GET /api/oauth/login?handle=<h>&redirect_uri=<url>[&prompt=<p>][&defense=1|lists]:
// start a sign-in.
//
// The scope is SCOPE; SCOPE_WITH_DEFENSE when `defense=1` (an account
// turning Defense on, or signing in again with it on); SCOPE_WITH_LISTS when
// `defense=lists` (an account keeping Defense's lists). Those three fixed
// strings are the only scopes it can ask for: the caller picks one, it never
// writes one, and nothing else from the query reaches the authorization
// request. redirect_uri must be the return page on an allowed
// origin, because the session token is handed to whatever page it names.
//
// With `Accept: application/json` (what the app sends) the answer is
// { success, authUrl } for the page to navigate to, so a failure stays in the
// app's own UI; otherwise a 302.
//
// Unauthenticated, and each call stores an oauth_state row (for up to an
// hour) and sends a pushed authorization request signed as Virga to the
// account's host, so it is limited per address.

import { callerAddress, methodGuard, sendJson } from '../../http.js';
import { envInt } from '../../env.js';
import { createRateLimiter } from '../../rateLimit.js';
import { getOAuthClient } from '../client.js';
import {
  SCOPE,
  SCOPE_WITH_DEFENSE,
  SCOPE_WITH_LISTS,
  classifyAuthorizeError,
  defaultReturnUrl,
  isAllowedReturnUrl,
  sendUnavailable,
  unavailableReason,
} from '../config.js';
import { queryParam, redirect302 } from '../respond.js';

// OIDC prompt values passed on. Not 'none': nothing in the app asks for a
// sign-in that can't show the reader anything, and a silent one is only ever
// someone else's doing.
const PROMPTS = new Set(['login', 'consent', 'select_account', 'create']);

/**
 * One of the three fixed scopes, by the `defense` the caller sent. Compared,
 * not looked up, so no value reaches anything but these strings.
 */
function scopeFor(defense) {
  if (defense === '1') return SCOPE_WITH_DEFENSE;
  if (defense === 'lists') return SCOPE_WITH_LISTS;
  return SCOPE;
}

const LOGIN_LIMIT_PER_MINUTE = 20;
let limiter = null;
let limiterLimit = null;

/** The per-address limiter, rebuilt when OAUTH_LOGIN_RATE_LIMIT changes (tests). */
function loginLimiter() {
  const limit = envInt(
    process.env,
    'OAUTH_LOGIN_RATE_LIMIT',
    LOGIN_LIMIT_PER_MINUTE,
  );
  if (!limiter || limiterLimit !== limit) {
    limiter = createRateLimiter({ limit, windowMs: 60 * 1000 });
    limiterLimit = limit;
  }
  return limiter;
}

/** Tests only: start every window afresh. */
export function resetLoginLimiterForTests() {
  limiter = null;
}

const ERROR_TEXT = {
  HANDLE_NOT_FOUND: 'That handle could not be found.',
  AUTHORIZE_FAILED: "The account's host could not start a sign-in.",
};

/**
 * The URL with an explicit empty fragment. A Location without one inherits
 * the fragment of the URL that led here (RFC 9110 §10.2.2), and a session
 * token in that fragment must never ride on to an authorization server.
 */
function withEmptyFragment(url) {
  const parsed = new URL(url);
  parsed.hash = '#';
  return parsed.href;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!methodGuard(req, res, ['GET'])) return undefined;

  const unavailable = unavailableReason();
  if (unavailable) return sendUnavailable(res, unavailable);

  const limit = loginLimiter().check(`login:${callerAddress(req)}`);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSec));
    return sendJson(res, 429, {
      success: false,
      code: 'RATE_LIMITED',
      error: 'Too many sign-ins at once. Wait a minute and try again.',
      retryAfter: limit.retryAfterSec,
    });
  }

  const handle = (queryParam(req, 'handle') || '').trim();
  if (!handle) {
    return sendJson(res, 400, {
      success: false,
      code: 'HANDLE_REQUIRED',
      error: 'A handle is required.',
    });
  }

  const redirect = queryParam(req, 'redirect_uri') || defaultReturnUrl();
  if (!redirect || !isAllowedReturnUrl(redirect)) {
    console.warn(
      '[oauth/login] refused a redirect_uri that is not the return page on an allowed origin',
    );
    return sendJson(res, 400, {
      success: false,
      code: 'REDIRECT_NOT_ALLOWED',
      error:
        "redirect_uri must be Virga's /oauth/return page on an allowed origin.",
    });
  }

  const options = {
    scope: scopeFor(queryParam(req, 'defense')),
    state: JSON.stringify({ redirect_uri: redirect, timestamp: Date.now() }),
  };
  const prompt = queryParam(req, 'prompt');
  if (typeof prompt === 'string' && PROMPTS.has(prompt))
    options.prompt = prompt;

  let authUrl;
  try {
    authUrl = await getOAuthClient().generateLoginUrl(handle, options);
  } catch (error) {
    const { status, code } = classifyAuthorizeError(error);
    console.warn(
      `[oauth/login] ${code} for ${handle}: ${error?.message || error}`,
    );
    return sendJson(res, status, {
      success: false,
      code,
      error: ERROR_TEXT[code],
    });
  }

  if (!authUrl || typeof authUrl !== 'string') {
    return sendJson(res, 502, {
      success: false,
      code: 'AUTHORIZE_FAILED',
      error: ERROR_TEXT.AUTHORIZE_FAILED,
    });
  }

  if (String(req.headers?.accept || '').includes('application/json')) {
    return sendJson(res, 200, { success: true, authUrl });
  }
  return redirect302(res, withEmptyFragment(authUrl));
}
