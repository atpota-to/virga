// The steps of a sign-in, as a reducer, with the words each step says. The
// component (SignInFlow.jsx) owns the timers and the network; this decides
// where the card goes next and what it reads, so both can be tested without
// a page.
//
//   entry    the handle field (and the accounts this browser remembers)
//   finding  looking the handle up
//   found    "Is this you?", with the account and where it signs in
//   hosts    the hosts to make an account on
//   leaving  the card that says where the browser is about to go

import { signInErrorMessage } from '../lib/oauthClient.js';
import { notTheHosts } from './hosts.js';

export const STEP = Object.freeze({ ENTRY: 'entry', FINDING: 'finding', FOUND: 'found', HOSTS: 'hosts', LEAVING: 'leaving' });

// Long enough that a quick lookup reads as a step rather than a flicker.
export const FINDING_MIN_MS = 450;
// How long the leaving card stays before the browser goes: time to read where
// it is going, and to turn back.
export const LEAVE_DELAY_MS = 3_500;
// Once the browser has been sent on, how long before offering to try again.
export const STALL_MS = 4_000;

export function initialFlow() {
  return { step: STEP.ENTRY, identity: null, notice: null, leaving: null, hostsFrom: STEP.ENTRY, trips: 0 };
}

/** Where the card goes back to from the leaving card: the step it left, never a lookup. */
function returnStep(from) {
  return from === STEP.FOUND || from === STEP.HOSTS ? from : STEP.ENTRY;
}

export function flowReducer(state, event) {
  switch (event.type) {
    // Typing answers whatever the notice said.
    case 'typed':
      return state.notice ? { ...state, notice: null } : state;
    case 'notice':
      return { ...state, notice: event.notice };
    case 'find':
      if (state.step !== STEP.ENTRY) return state;
      return { ...state, step: STEP.FINDING, identity: null, notice: null };
    case 'found':
      if (state.step !== STEP.FINDING) return state;
      return { ...state, step: STEP.FOUND, identity: event.identity, notice: null };
    case 'lookup-failed':
      if (state.step !== STEP.FINDING) return state;
      return { ...state, step: STEP.ENTRY, identity: null, notice: event.notice };
    case 'not-me':
      return { ...state, step: STEP.ENTRY, identity: null, notice: null };
    case 'hosts':
      if (state.step !== STEP.ENTRY && state.step !== STEP.FOUND) return state;
      return { ...state, step: STEP.HOSTS, hostsFrom: state.step, notice: null };
    case 'hosts-back':
      if (state.step !== STEP.HOSTS) return state;
      // Back to "Is this you?" only while there is still someone to ask about.
      return { ...state, step: state.hostsFrom === STEP.FOUND && state.identity ? STEP.FOUND : STEP.ENTRY, notice: null };
    case 'leave':
      if (state.step === STEP.LEAVING || state.step === STEP.FINDING) return state;
      return {
        ...state,
        step: STEP.LEAVING,
        notice: null,
        trips: state.trips + 1,
        leaving: { trip: state.trips + 1, host: event.host || null, purpose: event.purpose === 'signup' ? 'signup' : 'signin', from: state.step, phase: 'waiting' },
      };
    // A remembered account's host, found a moment after the card came up.
    case 'host-known':
      if (state.step !== STEP.LEAVING || state.leaving.trip !== event.trip || state.leaving.host || !event.host) return state;
      return { ...state, leaving: { ...state.leaving, host: event.host } };
    case 'sent':
      if (state.step !== STEP.LEAVING || state.leaving.trip !== event.trip) return state;
      return { ...state, leaving: { ...state.leaving, phase: state.leaving.phase === 'stalled' ? 'stalled' : 'sent' } };
    case 'stalled':
      if (state.step !== STEP.LEAVING || state.leaving.trip !== event.trip) return state;
      return { ...state, leaving: { ...state.leaving, phase: 'stalled' } };
    case 'cancel':
      if (state.step !== STEP.LEAVING) return state;
      return { ...state, step: returnStep(state.leaving.from), leaving: null, notice: null };
    case 'trip-failed':
      if (state.step !== STEP.LEAVING || state.leaving.trip !== event.trip) return state;
      return { ...state, step: returnStep(state.leaving.from), leaving: null, notice: event.notice };
    default:
      return state;
  }
}

/* ---- the words ------------------------------------------------------- */

const atHandle = (value) => (String(value).startsWith('did:') ? value : `@${value}`);

/** A handle (or DID) nobody has. The field is marked, since it is what to fix. */
export function notFoundNotice(value) {
  return { about: 'field', text: `Couldn’t find ${atHandle(value)}. Check the spelling, or type the whole handle (it looks like you.bsky.social).` };
}

/** The lookup couldn’t be made. The handle may be fine, so the reader can go on with it. */
export function lookupFailedNotice(value) {
  return { about: 'lookup', text: `Couldn’t look up ${atHandle(value)} just now.`, anyway: value };
}

/** The name an account is shown by: its display name, else its handle, else its DID. */
export function identityName(identity) {
  return identity?.displayName || (identity?.handle ? `@${identity.handle}` : identity?.did) || '';
}

/** The line under the name: the handle when the name above is something else, else the DID. */
export function identityMeta(identity) {
  if (identity?.displayName && identity.handle) return `@${identity.handle}`;
  if (identity?.handle || identity?.displayName) return identity?.did || '';
  return '';
}

export function continueLabel(identity) {
  return identity?.host ? `Continue at ${identity.host}` : 'Continue to your account’s server';
}

export function leavingTitle(leaving) {
  return leaving?.host ? `Taking you to ${leaving.host}` : 'Taking you to your account’s server';
}

export function leavingDetail(leaving) {
  return leaving?.purpose === 'signup'
    ? 'Make your account on their page, and you’ll come straight back here, signed in.'
    : 'Approve Virga on their page, and you’ll come straight back here, signed in.';
}

export function stallLabel(leaving) {
  return leaving?.host ? `Open ${leaving.host}` : 'Try again';
}

/**
 * What to say when the trip to a host couldn’t start, or null when there is
 * nothing to say (the reader called it off, or came back with the browser’s
 * Back button). A new account’s trip blames the host only for what is the
 * host’s doing: no connection, or Virga’s own server, is worded as it is
 * for any sign-in.
 */
export function tripFailureNotice(error, leaving) {
  if (error?.code === 'CANCELLED' || error?.name === 'AbortError' || /navigated back/i.test(String(error?.message || ''))) return null;
  if (leaving?.purpose === 'signup' && !notTheHosts(error)) {
    const host = leaving.host || 'That host';
    return { about: 'trip', text: `${host} isn’t taking sign-ups from here right now. Pick another host, or try again in a little while.` };
  }
  return { about: 'trip', text: signInErrorMessage(error) };
}
