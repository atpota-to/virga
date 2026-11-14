// The cheap, durable "a session may exist" hint the session provider reads at
// startup (see src/session/useAtprotoSession.jsx).
//
// The OAuth stack is the heaviest thing the app can load (the client with its
// jose/zod tree, then @atproto/api for the Agent), so nobody pays for it
// unless a session might exist. The hint is set the moment a sign-in starts,
// and kept while any remembered account is signed in; it is cleared only
// when none is. One account's session ending (another tab signing it out, a
// refresh that failed) never clears it while others are still signed in.
//
// The account list itself (virga:accounts, src/session/accounts.js) says the
// same thing in more detail; the hint stays because a browser that signed in
// before the list existed has only the hint.
//
// Storage access fails soft everywhere: with no storage there's no hint, and
// the app behaves as it does for any signed-out visitor.

export const SESSION_HINT_KEY = 'virga.oauth.session';

/** True when a session may exist in this browser. */
export function readSessionHint(storage) {
  try {
    return storage?.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSessionHint(storage) {
  try {
    storage?.setItem(SESSION_HINT_KEY, '1');
  } catch {
    // Unwritable storage just means the next visit starts signed out.
  }
}

export function clearSessionHint(storage) {
  try {
    storage?.removeItem(SESSION_HINT_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/**
 * Keep the hint in step with the account list: set while any account is
 * signed in, cleared when none is.
 */
export function syncSessionHint(storage, accounts) {
  if ((accounts || []).some((a) => a && !a.signedOut)) writeSessionHint(storage);
  else clearSessionHint(storage);
}

/**
 * Should the provider restore a session as the app starts? On either sign-in
 * return (the browser callback, or a return from Virga's server: that load
 * exists to finish a sign-in), and whenever a session may exist (the hint, or
 * a remembered account that is still signed in); never for a visitor who has
 * not signed in.
 */
export function restoresAtStartup({ hint, onCallback, onReturn = false, hasAccounts = false }) {
  return Boolean(onCallback) || Boolean(onReturn) || Boolean(hint) || Boolean(hasAccounts);
}
