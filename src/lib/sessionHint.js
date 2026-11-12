// The cheap, durable "a session may exist" hint the session provider reads at
// startup (see src/session/useAtprotoSession.jsx).
//
// The OAuth stack is the heaviest thing the app can load (the client with its
// jose/zod tree, then @atproto/api for the Agent), so nobody pays for it
// unless a session might exist. The hint is set the moment a sign-in starts,
// confirmed when a session is restored, and cleared when there turns out to be
// none.
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
 * Should the provider load the OAuth stack as the app starts? On the OAuth
 * callback (that load exists to finish a sign-in) and whenever a session may
 * exist; never for a visitor who has not signed in.
 */
export function restoresAtStartup({ hint, onCallback }) {
  return Boolean(onCallback) || Boolean(hint);
}
