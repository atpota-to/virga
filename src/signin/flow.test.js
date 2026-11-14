import { describe, expect, it } from 'vitest';
import {
  FINDING_MIN_MS,
  LEAVE_DELAY_MS,
  STALL_MS,
  STEP,
  continueLabel,
  flowReducer,
  identityMeta,
  identityName,
  initialFlow,
  leavingDetail,
  leavingTitle,
  lookupFailedNotice,
  notFoundNotice,
  stallLabel,
  tripFailureNotice,
} from './flow.js';

const MIRA = { did: 'did:plc:abcdefghijklmnopqrstuvwx', handle: 'mira.example.com', displayName: 'Mira Okafor', avatar: null, host: 'bsky.social', pds: 'https://pds.test' };

/** Run events through the reducer from the start. */
const run = (...events) => events.reduce(flowReducer, initialFlow());

describe('the steps of a sign-in', () => {
  it('starts on the handle field', () => {
    expect(initialFlow()).toMatchObject({ step: STEP.ENTRY, identity: null, notice: null, leaving: null });
  });

  it('looks the handle up, then asks “Is this you?”', () => {
    const finding = run({ type: 'find' });
    expect(finding.step).toBe(STEP.FINDING);
    const found = flowReducer(finding, { type: 'found', identity: MIRA });
    expect(found).toMatchObject({ step: STEP.FOUND, identity: MIRA, notice: null });
  });

  it('goes back to the field, saying why, when the lookup fails', () => {
    const state = run({ type: 'find' }, { type: 'lookup-failed', notice: notFoundNotice('nobody.example.com') });
    expect(state.step).toBe(STEP.ENTRY);
    expect(state.notice.text).toMatch(/Couldn’t find @nobody\.example\.com/);
  });

  it('ignores a lookup’s answer that arrives after the reader moved on', () => {
    const state = run({ type: 'find' }, { type: 'not-me' }, { type: 'found', identity: MIRA });
    expect(state).toMatchObject({ step: STEP.ENTRY, identity: null });
    const late = run({ type: 'find' }, { type: 'not-me' }, { type: 'lookup-failed', notice: notFoundNotice('x') });
    expect(late.notice).toBeNull();
  });

  it('clears a notice as soon as the reader types', () => {
    const noticed = run({ type: 'notice', notice: notFoundNotice('x.example') });
    expect(noticed.notice).not.toBeNull();
    expect(flowReducer(noticed, { type: 'typed' }).notice).toBeNull();
    // And returns the same state when there was nothing to clear.
    const clean = initialFlow();
    expect(flowReducer(clean, { type: 'typed' })).toBe(clean);
  });

  it('goes back to the field on “Not you?”, forgetting who was found', () => {
    const state = run({ type: 'find' }, { type: 'found', identity: MIRA }, { type: 'not-me' });
    expect(state).toMatchObject({ step: STEP.ENTRY, identity: null, notice: null });
  });

  it('opens the hosts from the field or from “Is this you?”, and goes back to where it was', () => {
    expect(run({ type: 'hosts' }, { type: 'hosts-back' }).step).toBe(STEP.ENTRY);
    const fromFound = run({ type: 'find' }, { type: 'found', identity: MIRA }, { type: 'hosts' });
    expect(fromFound).toMatchObject({ step: STEP.HOSTS, hostsFrom: STEP.FOUND });
    expect(flowReducer(fromFound, { type: 'hosts-back' })).toMatchObject({ step: STEP.FOUND, identity: MIRA });
  });

  it('doesn’t open the hosts mid-lookup or while leaving', () => {
    expect(run({ type: 'find' }, { type: 'hosts' }).step).toBe(STEP.FINDING);
    expect(run({ type: 'leave', host: 'bsky.social' }, { type: 'hosts' }).step).toBe(STEP.LEAVING);
  });
});

describe('leaving for a host', () => {
  const leaving = run({ type: 'find' }, { type: 'found', identity: MIRA }, { type: 'leave', host: 'bsky.social', purpose: 'signin' });

  it('shows where the browser is going, and waits', () => {
    expect(leaving).toMatchObject({ step: STEP.LEAVING, notice: null, leaving: { trip: 1, host: 'bsky.social', purpose: 'signin', from: STEP.FOUND, phase: 'waiting' } });
  });

  it('counts its trips, so a timer from an earlier one can’t act on a later one', () => {
    const again = [{ type: 'cancel' }, { type: 'leave', host: 'bsky.social' }].reduce(flowReducer, leaving);
    expect(again.leaving.trip).toBe(2);
    expect(flowReducer(again, { type: 'sent', trip: 1 })).toBe(again);
    expect(flowReducer(again, { type: 'stalled', trip: 1 })).toBe(again);
    expect(flowReducer(again, { type: 'trip-failed', trip: 1, notice: { text: 'old' } })).toBe(again);
  });

  it('notes that the browser was sent, then that it is still here', () => {
    const sent = flowReducer(leaving, { type: 'sent', trip: 1 });
    expect(sent.leaving.phase).toBe('sent');
    const stalled = flowReducer(sent, { type: 'stalled', trip: 1 });
    expect(stalled.leaving.phase).toBe('stalled');
    // Trying again keeps the offer on the card.
    expect(flowReducer(stalled, { type: 'sent', trip: 1 }).leaving.phase).toBe('stalled');
  });

  it('goes back to the card it left on Cancel, with nothing to say', () => {
    expect(flowReducer(leaving, { type: 'cancel' })).toMatchObject({ step: STEP.FOUND, leaving: null, notice: null, identity: MIRA });
    const fromHosts = run({ type: 'hosts' }, { type: 'leave', host: 'eurosky.social', purpose: 'signup' });
    expect(fromHosts.leaving).toMatchObject({ purpose: 'signup', from: STEP.HOSTS });
    expect(flowReducer(fromHosts, { type: 'cancel' }).step).toBe(STEP.HOSTS);
    expect(flowReducer(run({ type: 'leave' }), { type: 'cancel' }).step).toBe(STEP.ENTRY);
  });

  it('goes back saying why when the trip couldn’t start', () => {
    const failed = flowReducer(leaving, { type: 'trip-failed', trip: 1, notice: { about: 'trip', text: 'Couldn’t reach Virga’s server.' } });
    expect(failed).toMatchObject({ step: STEP.FOUND, leaving: null, notice: { text: 'Couldn’t reach Virga’s server.' } });
  });

  it('fills in a host learned after the card came up, once', () => {
    const unknown = run({ type: 'leave', host: null });
    expect(unknown.leaving.host).toBeNull();
    const known = flowReducer(unknown, { type: 'host-known', trip: 1, host: 'bsky.social' });
    expect(known.leaving.host).toBe('bsky.social');
    expect(flowReducer(known, { type: 'host-known', trip: 1, host: 'other.example' })).toBe(known);
    expect(flowReducer(unknown, { type: 'host-known', trip: 9, host: 'bsky.social' })).toBe(unknown);
    expect(flowReducer(unknown, { type: 'host-known', trip: 1, host: null })).toBe(unknown);
  });

  it('can’t start twice, or in the middle of a lookup', () => {
    expect(flowReducer(leaving, { type: 'leave', host: 'elsewhere.example' })).toBe(leaving);
    const finding = run({ type: 'find' });
    expect(flowReducer(finding, { type: 'leave', host: 'bsky.social' })).toBe(finding);
  });

  it('ignores what it doesn’t know', () => {
    const state = initialFlow();
    expect(flowReducer(state, { type: 'no-such-event' })).toBe(state);
    expect(flowReducer(state, { type: 'cancel' })).toBe(state);
  });
});

describe('the timings', () => {
  it('give time to read the leaving card, and are in the order they happen', () => {
    expect(FINDING_MIN_MS).toBeLessThan(1000);
    expect(LEAVE_DELAY_MS).toBe(3500);
    expect(STALL_MS).toBeGreaterThanOrEqual(3000);
  });
});

describe('the words', () => {
  it('name the handle that wasn’t found, or the DID without an @', () => {
    expect(notFoundNotice('nobody.example.com')).toEqual({
      about: 'field',
      text: 'Couldn’t find @nobody.example.com. Check the spelling, or type the whole handle (it looks like you.bsky.social).',
    });
    expect(notFoundNotice('did:plc:x').text).toMatch(/^Couldn’t find did:plc:x\./);
  });

  it('offer to go on when the lookup itself failed', () => {
    expect(lookupFailedNotice('mira.example.com')).toEqual({ about: 'lookup', text: 'Couldn’t look up @mira.example.com just now.', anyway: 'mira.example.com' });
  });

  it('show an account by the best name there is, and never the same thing twice', () => {
    expect(identityName(MIRA)).toBe('Mira Okafor');
    expect(identityMeta(MIRA)).toBe('@mira.example.com');
    const noName = { ...MIRA, displayName: null };
    expect(identityName(noName)).toBe('@mira.example.com');
    expect(identityMeta(noName)).toBe(MIRA.did);
    const bare = { did: MIRA.did, handle: null, displayName: null };
    expect(identityName(bare)).toBe(MIRA.did);
    expect(identityMeta(bare)).toBe('');
    expect(identityName(null)).toBe('');
  });

  it('name the host on the button and the leaving card, when it is known', () => {
    expect(continueLabel(MIRA)).toBe('Continue at bsky.social');
    expect(continueLabel({ ...MIRA, host: null })).toBe('Continue to your account’s host');
    expect(leavingTitle({ host: 'bsky.social' })).toBe('Taking you to bsky.social');
    expect(leavingTitle({ host: null })).toBe('Taking you to your account’s host');
    expect(stallLabel({ host: 'bsky.social' })).toBe('Open bsky.social');
    expect(stallLabel({ host: null })).toBe('Try again');
  });

  it('say what happens on the host’s page, for a sign-in and for a new account', () => {
    expect(leavingDetail({ purpose: 'signin' })).toMatch(/^Approve Virga on their page/);
    expect(leavingDetail({ purpose: 'signup' })).toMatch(/^Make your account on their page/);
  });

  it('put a failed sign-in in the session’s own words', () => {
    const error = Object.assign(new Error('x'), { code: 'HANDLE_NOT_FOUND' });
    expect(tripFailureNotice(error, { purpose: 'signin', host: 'bsky.social' })).toEqual({ about: 'trip', text: expect.stringMatching(/Couldn’t find that account/) });
  });

  it('blame the host for a failed sign-up only when it is the host’s doing', () => {
    const refused = Object.assign(new Error('x'), { code: 'AUTHORIZE_FAILED' });
    expect(tripFailureNotice(refused, { purpose: 'signup', host: 'eurosky.social' }).text).toBe(
      'eurosky.social isn’t taking sign-ups from here right now. Pick another host, or try again in a little while.',
    );
    expect(tripFailureNotice(new Error('invalid_request'), { purpose: 'signup', host: null }).text).toMatch(/^That host isn’t taking sign-ups/);
    const offline = Object.assign(new TypeError('Failed to fetch'), { code: 'NETWORK_ERROR' });
    expect(tripFailureNotice(offline, { purpose: 'signup', host: 'eurosky.social' }).text).toMatch(/Couldn’t reach Virga’s server/);
    const limited = Object.assign(new Error('x'), { code: 'RATE_LIMITED' });
    expect(tripFailureNotice(limited, { purpose: 'signup', host: 'eurosky.social' }).text).toMatch(/Too many sign-ins/);
  });

  it('don’t blame the host for a missing connection, on a browser sign-in either', () => {
    // A browser sign-in fails with the library's own error, which has no code.
    const offline = new TypeError('Failed to fetch');
    expect(tripFailureNotice(offline, { purpose: 'signup', host: 'bsky.social' }).text).toMatch(/Couldn’t reach the account’s host/);
    const broken = Object.assign(new Error('x'), { code: 'INTERNAL', status: 500 });
    expect(tripFailureNotice(broken, { purpose: 'signup', host: 'bsky.social' }).text).not.toMatch(/bsky\.social isn’t taking sign-ups/);
  });

  it('say nothing when the reader called it off, or simply came back', () => {
    expect(tripFailureNotice(new Error('User navigated back'), { purpose: 'signin' })).toBeNull();
    expect(tripFailureNotice(Object.assign(new Error('The sign-in was called off'), { name: 'AbortError', code: 'CANCELLED' }), { purpose: 'signup', host: 'bsky.social' })).toBeNull();
    expect(tripFailureNotice(new DOMException('Aborted', 'AbortError'), { purpose: 'signin' })).toBeNull();
  });
});
