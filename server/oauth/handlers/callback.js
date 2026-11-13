// GET /api/oauth/callback: where the authorization server sends the reader
// back.
//
// Success: a `vg_` token in frontend_sessions, handed to the page that started
// the flow in the fragment only:
//   302 <return page, its query kept>#session=<token>&did=<did>
//
// Failure: 302 <return page>?<its query>&error=<code>&error_description=<text>,
// where code is the authorization server's own (access_denied, …) or
// callback_failed. With no app state to name the page (an expired or already
// used state) it goes to OAUTH_PUBLIC_URL's return page.
//
// Nothing else happens here: the library has already saved the OAuth session
// and cleared the state, so the one write is the token.

import { methodGuard, sendJson } from '../../http.js';
import { getOAuthClient } from '../client.js';
import {
  defaultReturnUrl,
  isAllowedReturnUrl,
  sendUnavailable,
  unavailableReason,
} from '../config.js';
import { getStorage } from '../storage.js';
import {
  buildCodedErrorRedirectUrl,
  buildFragmentRedirectUrl,
  redirectFromAppState,
} from '../callbackRedirect.js';
import { rawQuery, redirect302 } from '../respond.js';

// OAuth error codes are short lowercase words (RFC 6749 §4.1.2.1); anything
// else is not passed on as a code.
const asErrorCode = (value) =>
  typeof value === 'string' && /^[a-z_]{1,64}$/.test(value)
    ? value
    : 'callback_failed';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!methodGuard(req, res, ['GET'])) return undefined;

  const unavailable = unavailableReason();
  if (unavailable) return sendUnavailable(res, unavailable);

  const client = getOAuthClient();
  const isAllowed = (url) => isAllowedReturnUrl(url);

  const fail = (appState, code, description) => {
    const url = buildCodedErrorRedirectUrl(
      appState,
      defaultReturnUrl(),
      { code, description },
      isAllowed,
    );
    if (!url)
      return sendJson(res, 400, { success: false, code, error: description });
    return redirect302(res, url);
  };

  try {
    // The raw query, not req.query: the library reads exactly what the
    // authorization server sent.
    const params = new URLSearchParams(rawQuery(req));

    const asError = params.get('error');
    if (asError) {
      console.warn(
        `[oauth/callback] the authorization server answered ${asErrorCode(asError)}`,
      );
      // The library looks up (and clears) the state, recovering the page that
      // started the flow; with an error param it always throws.
      let appState;
      try {
        await client.handleCallback(params);
      } catch (callbackError) {
        appState = callbackError.appState;
      }
      return fail(
        appState,
        asErrorCode(asError),
        params.get('error_description') || asError,
      );
    }

    const { userDID, state } = await client.handleCallback(params);
    const target = redirectFromAppState(state, isAllowed) || defaultReturnUrl();
    if (!target) {
      return sendJson(res, 400, {
        success: false,
        code: 'callback_failed',
        error: 'No page to return to.',
      });
    }

    const sessionToken =
      await getStorage().frontendSessionStore.create(userDID);
    console.log(`[oauth/callback] signed in ${userDID}`);
    return redirect302(
      res,
      buildFragmentRedirectUrl(target, sessionToken, userDID),
    );
  } catch (error) {
    console.warn(`[oauth/callback] ${error?.message || error}`);
    return fail(
      error?.appState,
      asErrorCode(error?.oauthError),
      error?.message,
    );
  }
}
