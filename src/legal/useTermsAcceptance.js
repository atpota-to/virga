// Whether the open account has agreed to the current Terms of Service and
// Privacy Policy, for App.jsx to decide between the app and the agreement
// screen. The decisions are acceptance.js's; this holds the state, asks the
// server, and follows other tabs.
//
//   status  'accepted'  go on into the app
//           'checking'  a long session with no note here: asking the server
//           'needs'     show the agreement screen
//   accept  record the agreement. On a long session it resolves once the
//           server has the row and throws when it couldn't be written
//           (acceptFailure words the error), so nobody on a long session is
//           let in without a record; that holds when the session's token has
//           gone too, which is refused rather than taken as a browser
//           session's. On a browser session the note is kept here at once
//           and the report to the server follows.

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_REPORT_TRIES, needsReport, opensGate, readAcceptance, startingStatus, statusFromAnswer, termsKey, writeAcceptance } from './acceptance.js';
import { fetchTermsStatus, recordAcceptance, reportAcceptance } from './termsService.js';
import { TERMS_VERSION } from './version.js';

function local() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// Agreements this page load has already offered to the server, so a
// re-render (or StrictMode's second effect) doesn't offer one twice.
const reported = new Set();

/**
 * Send a browser session's agreement to the server, and note how it went. A
 * server that refuses claims outright won't change its mind on the next
 * visit, so that agreement stops being offered.
 */
async function report(did, entry, send = reportAcceptance) {
  try {
    await send({ did, version: entry.version });
    // The server says nothing back about a claim, so the time stays this
    // browser's own.
    writeAcceptance(local(), did, { ...entry, recorded: true, identity: 'claimed' });
  } catch (error) {
    const tries = error?.code === 'SESSION_REQUIRED' ? MAX_REPORT_TRIES : entry.tries + 1;
    writeAcceptance(local(), did, { ...entry, tries });
  }
}

export function useTermsAcceptance({ did, mode, backendFor }) {
  const requester = did && mode === 'backend' ? backendFor(did) : null;
  const requesterRef = useRef(requester);
  requesterRef.current = requester;

  const decide = () => (did ? startingStatus({ entry: readAcceptance(local(), did), mode, canAsk: Boolean(requester) }) : 'accepted');
  const [state, setState] = useState(() => ({ did, status: decide() }));
  // An account switched to in place is decided afresh in the same render, so
  // the app never shows for it on the strength of the last account's answer.
  let current = state;
  if (state.did !== did) {
    current = { did, status: decide() };
    setState(current);
  }
  const { status } = current;

  // A long session with no note here: the agreement may have been made on
  // another device. If the server can't say, the screen shows; agreeing again
  // finds the first row and adds nothing.
  useEffect(() => {
    if (!did || status !== 'checking') return undefined;
    const asked = requesterRef.current;
    if (!asked) {
      setState({ did, status: 'needs' });
      return undefined;
    }
    const controller = new AbortController();
    fetchTermsStatus(asked, { signal: controller.signal })
      .then((answer) => {
        if (controller.signal.aborted) return;
        const next = statusFromAnswer(answer);
        if (next === 'accepted') writeAcceptance(local(), did, { at: answer.acceptedAt, recorded: true, identity: 'session' });
        setState({ did, status: next });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ did, status: 'needs' });
      });
    return () => controller.abort();
  }, [did, status]);

  // A browser session's agreement that hasn't reached the server yet (it was
  // unreachable when it was made) is offered again, once per visit.
  useEffect(() => {
    if (!did || mode === 'backend' || status !== 'accepted') return;
    const entry = readAcceptance(local(), did);
    const key = `${did}:${entry?.version}`;
    if (!needsReport(entry) || reported.has(key)) return;
    reported.add(key);
    report(did, entry);
  }, [did, mode, status]);

  // Agreed in another tab: this one follows.
  useEffect(() => {
    if (!did || typeof window === 'undefined') return undefined;
    const onStorage = (event) => {
      if (event.key !== termsKey(did)) return;
      if (opensGate(readAcceptance(local(), did), { mode })) setState({ did, status: 'accepted' });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [did, mode]);

  const accept = useCallback(async () => {
    if (!did) return;
    const at = new Date().toISOString();
    const asked = requesterRef.current;
    if (mode === 'backend') {
      // A long session whose token has gone (it ended while this screen was
      // up) has nobody to vouch for it. It is not a browser session, and
      // isn't recorded as one.
      if (!asked) throw Object.assign(new Error('This account has no session with Virga’s server'), { status: 401, code: 'FRONTEND_SESSION_INVALID' });
      const result = await recordAcceptance(asked, { version: TERMS_VERSION });
      writeAcceptance(local(), did, { at: result.acceptedAt, recorded: true, identity: 'session' });
      setState({ did, status: 'accepted' });
      return;
    }
    const entry = { version: TERMS_VERSION, at, recorded: false, tries: 0, identity: null };
    writeAcceptance(local(), did, entry);
    reported.add(`${did}:${entry.version}`);
    setState({ did, status: 'accepted' });
    report(did, entry);
  }, [did, mode]);

  return { status, accept };
}
