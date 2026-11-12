// How the account screens word an account, and the requests they hand to
// SessionNotices (the one place that sends someone off to sign in again, so
// two screens never race to redirect).

export const REAUTH_REQUEST_EVENT = 'virga:reauth-request';
export const SESSION_NOTICE_EVENT = 'virga:session-notice';

/** For a session granted before Virga could post (scopes.js missingScopes). */
export const POSTING_REGRANT_MESSAGE = 'Virga needs permission to post. Sign in again to grant it.';

/** What each kind of sign-in is called on screen. */
export function modeLabel(mode) {
  return mode === 'backend' ? 'Long session through Virga’s server' : 'Browser session';
}

/** A short word for an account's state, or null when there's nothing to say. */
export function statusLabel(status, { active = false, switching = false } = {}) {
  if (switching) return 'Switching…';
  if (status === 'needsSignIn') return 'Signed out';
  if (status === 'unknown') return 'Couldn’t check';
  return active ? 'Open now' : null;
}

/**
 * Which sign-in a fresh sign-in for this account should be. A long session
 * stays one; a browser session becomes one when this build signs new
 * accounts in that way ("sign in again for a longer session").
 */
export function reauthModeFor(account, authMode) {
  return account?.mode === 'backend' || authMode === 'backend' ? 'backend' : 'browser';
}

/** Whether to offer moving this account to a long session. */
export function offersLongerSession(account, authMode) {
  return authMode === 'backend' && account?.mode === 'browser';
}

/**
 * Ask SessionNotices to sign `did` in again: after the short notice, or at
 * once (`immediate`, for a "Sign back in" the reader pressed themselves).
 */
export function requestReauth(did, { immediate = false } = {}) {
  window.dispatchEvent(new CustomEvent(REAUTH_REQUEST_EVENT, { detail: { did, immediate } }));
}

/** Show a line in SessionNotices (a sign-in that couldn't start, say). */
export function showSessionNotice(text, { tone = 'danger' } = {}) {
  window.dispatchEvent(new CustomEvent(SESSION_NOTICE_EVENT, { detail: { text, tone } }));
}
