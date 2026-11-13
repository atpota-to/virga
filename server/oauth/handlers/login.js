// GET /api/oauth/login?handle=<h>&redirect_uri=<url>[&prompt=<p>]: start a
// sign-in.
//
// The scope is always SCOPE, and nothing else from the query reaches the
// authorization request. redirect_uri must be the return page on an allowed
// origin, because the session token is handed to whatever page it names.
//
// With `Accept: application/json` (what the app sends) the answer is
// { success, authUrl } for the page to navigate to, so a failure stays in the
// app's own UI; otherwise a 302.
//
// Unauthenticated, and each call stores an oauth_state row (for up to an
// hour) and sends a pushed authorization request signed as Virga to the
// account's host, so it is limited per address.

import { methodGuard, sendJson } from '../../http.js';
import { envInt } from '../../env.js';
import { createRateLimiter } from '../../rateLimit.js';
import { getOAuthClient } from '../client.js';
import {
  SCOPE,
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

const firstHeader = (req, name) => {
  const value = req.headers?.[name];
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === 'string' ? text.split(',')[0].trim() : '';
};

/**
 * The caller's address. Vercel's edge sets x-real-ip and x-forwarded-for
 * itself, replacing whatever the caller sent, so neither can be chosen to
 * dodge the limit there.
 */
function callerAddress(req) {
  return (
    firstHeader(req, 'x-real-ip') ||
    firstHeader(req, 'x-forwarded-for') ||
    req.socket?.remoteAddress ||
    'unknown'
  );
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
    scope: SCOPE,
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
