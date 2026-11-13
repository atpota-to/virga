// Where the callback sends the browser.
//
// The session token goes in the fragment only, so it stays out of the
// Location header the page's server sees, its access logs and Referer. The
// page's own query (its sign-in nonce) is kept.

/** `<page>#session=<token>&did=<did>`, the page's query untouched. */
export function buildFragmentRedirectUrl(pageUrl, sessionToken, userDid) {
  const url = new URL(pageUrl);
  url.hash = new URLSearchParams({
    session: sessionToken,
    did: userDid,
  }).toString();
  return url;
}

/**
 * The redirect_uri an app state names, when it is allowed; else null.
 *
 * The callback's `state` param is the library's own key, never the JSON the
 * login handler wrote; that JSON comes back as the app state the library
 * recovers under the key.
 */
export function redirectFromAppState(appState, isAllowed) {
  if (typeof appState !== 'string') return null;
  try {
    const stateData = JSON.parse(appState);
    if (stateData?.redirect_uri && isAllowed(stateData.redirect_uri))
      return stateData.redirect_uri;
  } catch {
    // Not ours, or not JSON.
  }
  return null;
}

/**
 * A failed callback: back to the page that started the flow with
 * `error=<code>` (the authorization server's own, such as access_denied, or
 * callback_failed) and `error_description`. Never a token, and the hash is
 * cleared. Null when neither the app state nor the default names a page.
 */
export function buildCodedErrorRedirectUrl(
  appState,
  defaultPageUrl,
  { code, description } = {},
  isAllowed,
) {
  const target = redirectFromAppState(appState, isAllowed) || defaultPageUrl;
  if (!target) return null;
  const url = new URL(target);
  url.hash = '';
  url.searchParams.set('error', code || 'callback_failed');
  url.searchParams.set(
    'error_description',
    String(description || 'Sign-in did not finish').slice(0, 300),
  );
  return url;
}
