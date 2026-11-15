// Whether an account has agreed to the current Terms of Service and Privacy
// Policy, as this browser knows it, and what the agreement screen should do.
// Pure: storage is passed in, and the network is termsService.js's.
//
// A note is kept per account (`virga:terms-accepted:<did>`), so an account
// that has agreed here is never asked again on this browser, nor made to
// wait while the server is asked. It is a convenience, not the record: the
// record is the row on Virga's server (the terms_acceptance table in its schema).
//
//   { version, at, recorded, tries, identity }
//
// `identity` is how the server knows the agreement: 'session' (a long
// session's own, written here only once the server has answered), 'claimed'
// (a browser session's, reported on its word) or null (not reported yet).
// `recorded` says the server has it. For an account on a browser session,
// which the server can't vouch for, the note comes first and the report
// follows, and is tried again on later visits (up to MAX_REPORT_TRIES) until
// it lands.
//
// A long session is opened only by a 'session' note. An account that agreed
// on a browser session and later takes a long one in the same browser is
// asked again, once, so that no long session runs without a row the server
// can stand behind.

import { TERMS_VERSION } from './version.js';

export const TERMS_ACCEPTED_PREFIX = 'virga:terms-accepted:';

/** How many visits an unreported agreement is offered to the server before it is left alone. */
export const MAX_REPORT_TRIES = 5;

export function termsKey(did) {
  return `${TERMS_ACCEPTED_PREFIX}${did}`;
}

/** The note for `did`, or null when there is none (or it can't be read). */
export function readAcceptance(storage, did) {
  if (!did) return null;
  try {
    const value = JSON.parse(storage?.getItem(termsKey(did)) || 'null');
    if (!value || !Number.isInteger(value.version) || value.version < 1) return null;
    return {
      version: value.version,
      at: typeof value.at === 'string' ? value.at : null,
      recorded: value.recorded === true,
      tries: Number.isInteger(value.tries) && value.tries > 0 ? value.tries : 0,
      identity: value.identity === 'session' || value.identity === 'claimed' ? value.identity : null,
    };
  } catch {
    return null;
  }
}

/** Keep the note. Fails soft: without storage the account is simply asked again next time. */
export function writeAcceptance(storage, did, { version = TERMS_VERSION, at = null, recorded = false, tries = 0, identity = null } = {}) {
  if (!did) return;
  try {
    storage?.setItem(termsKey(did), JSON.stringify({ version, at, recorded, tries, identity }));
  } catch {
    // Unwritable storage: nothing to do about it here.
  }
}

/** Whether a note covers the documents as they are now. A later version covers an earlier one. */
export function coversCurrent(entry, version = TERMS_VERSION) {
  return Boolean(entry) && entry.version >= version;
}

/** Whether an agreement made on a browser session still has to be reported to the server. */
export function needsReport(entry, version = TERMS_VERSION) {
  return coversCurrent(entry, version) && !entry.recorded && entry.tries < MAX_REPORT_TRIES;
}

/**
 * Whether a note lets the account past the agreement screen. On a long
 * session only the server's own word does, whether or not the server can be
 * reached just now; on a browser session the note is all there is.
 */
export function opensGate(entry, { mode }) {
  if (!coversCurrent(entry)) return false;
  return mode === 'backend' ? entry.identity === 'session' : true;
}

/**
 * Where the agreement screen starts for an account, before anything is asked
 * of the network:
 *
 *   'accepted'  this browser has a note that opens the gate
 *   'checking'  no such note, but the account is on a long session, so the
 *               server can say whether it agreed somewhere else
 *   'needs'     no note and nobody to ask: show the screen. A long session
 *               whose token has gone lands here too, and can't agree until
 *               it has signed in again
 */
export function startingStatus({ entry, mode, canAsk }) {
  if (opensGate(entry, { mode })) return 'accepted';
  return mode === 'backend' && canAsk ? 'checking' : 'needs';
}

/**
 * What the server's answer to "has this account agreed?" means. An answer
 * for other documents than this page holds (a deploy landed in between)
 * isn't an agreement to these.
 */
export function statusFromAnswer(answer, version = TERMS_VERSION) {
  return answer?.accepted === true && answer.version === version ? 'accepted' : 'needs';
}

/**
 * The words for an agreement that couldn't be recorded, for the screen to
 * show above its button. `{ text, reload }`: `reload` is true when the fix
 * is to load the page again.
 */
export function acceptFailure(error) {
  const code = error?.code || null;
  if (code === 'TERMS_VERSION_MISMATCH') {
    return { text: 'The Terms of Service and Privacy Policy have changed since this page loaded. Reload to read the current ones.', reload: true };
  }
  if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
    return { text: 'Couldn’t reach Virga’s server, so your agreement isn’t recorded yet. Check your connection and try again.', reload: false };
  }
  if (code === 'RATE_LIMITED') {
    return { text: 'Virga’s server is busy with this account. Wait a minute and try again.', reload: false };
  }
  if (code === 'FRONTEND_SESSION_INVALID' || error?.status === 401) {
    return { text: 'Virga’s server didn’t recognise this account’s sign-in, so your agreement isn’t recorded yet. Try again; if it keeps happening, the account needs to sign in again.', reload: false };
  }
  return { text: 'Virga’s server couldn’t record your agreement just now. Try again in a little while.', reload: false };
}
