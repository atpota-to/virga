import { describe, expect, it, vi } from 'vitest';
import { classifyRestoreError, createBrowserDriver, grantedScopeOf, isCallbackResult, isRevokedCause } from './browserDriver.js';

class TokenRefreshError extends Error {}
class TokenRevokedError extends Error {}
class TokenInvalidError extends Error {}
const mod = { TokenRefreshError, TokenRevokedError, TokenInvalidError };

const MIRA = 'did:plc:virgaharnessmira2zq4x';
const LAB = 'did:plc:virgaharnesslab7k2pq';

function fakeClient({ initResult = undefined, sessions = {} } = {}) {
  return {
    init: vi.fn(async () => initResult),
    restore: vi.fn(async (did) => {
      if (sessions[did] instanceof Error) throw sessions[did];
      if (!sessions[did]) throw new TokenRefreshError('The session was deleted by another process');
      return sessions[did];
    }),
    revoke: vi.fn(),
    signIn: vi.fn(async () => {}),
  };
}

function driverWith(client) {
  return createBrowserDriver({ getClient: async () => client, loadModule: async () => mod, events: new EventTarget() });
}

describe('classifyRestoreError', () => {
  it('reads the library’s own session errors as needing a sign-in', () => {
    expect(classifyRestoreError(new TokenRefreshError('x'), mod)).toBe('expired');
    expect(classifyRestoreError(new TokenRevokedError('x'), mod)).toBe('expired');
    expect(classifyRestoreError(new TokenInvalidError('x'), mod)).toBe('expired');
    expect(classifyRestoreError(new TypeError('Token set does not match the expected sub'), mod)).toBe('expired');
  });

  it('reads a network failure as unknown', () => {
    expect(classifyRestoreError(new TypeError('Failed to fetch'), mod)).toBe('unknown');
    expect(classifyRestoreError(new Error('Failed to resolve OAuth server metadata'), mod)).toBe('unknown');
    expect(classifyRestoreError(undefined, mod)).toBe('unknown');
  });

  it('falls back to the message when the classes aren’t at hand', () => {
    expect(classifyRestoreError(new Error('The session was deleted by another process'))).toBe('expired');
    expect(classifyRestoreError(new Error('invalid_grant'))).toBe('expired');
  });
});

describe('isCallbackResult', () => {
  it('tells a finished sign-in from a restore init() fell back to', () => {
    expect(isCallbackResult({ session: { sub: MIRA }, state: null })).toBe(true);
    expect(isCallbackResult({ session: { sub: MIRA } })).toBe(false);
    expect(isCallbackResult(undefined)).toBe(false);
  });
});

describe('grantedScopeOf', () => {
  it('reads the scope without refreshing', async () => {
    const getTokenInfo = vi.fn(async () => ({ scope: 'atproto repo:app.bsky.feed.post' }));
    expect(await grantedScopeOf({ getTokenInfo })).toBe('atproto repo:app.bsky.feed.post');
    expect(getTokenInfo).toHaveBeenCalledWith(false);
    expect(await grantedScopeOf({ getTokenInfo: async () => Promise.reject(new Error('x')) })).toBeNull();
    expect(await grantedScopeOf(null)).toBeNull();
  });
});

describe('the browser driver', () => {
  it('restores any account by DID, without refreshing first', async () => {
    const lab = { sub: LAB };
    const client = fakeClient({ sessions: { [LAB]: lab } });
    const driver = driverWith(client);
    expect(await driver.restore(LAB)).toBe(lab);
    expect(client.restore).toHaveBeenCalledWith(LAB, false);
    expect(client.init).not.toHaveBeenCalled();
  });

  it('marks why a restore failed', async () => {
    const client = fakeClient({ sessions: { [LAB]: new TypeError('Failed to fetch') } });
    const driver = driverWith(client);
    await expect(driver.restore(MIRA)).rejects.toMatchObject({ restoreFailure: 'expired' });
    await expect(driver.restore(LAB)).rejects.toMatchObject({ restoreFailure: 'unknown' });
  });

  it('finishes a callback, and ignores the restore init() does when there is none', async () => {
    const session = { sub: MIRA };
    expect(await driverWith(fakeClient({ initResult: { session, state: 'reauth' } })).finishCallback()).toEqual({ session, intent: 'reauth' });
    expect(await driverWith(fakeClient({ initResult: { session, state: null } })).finishCallback()).toEqual({ session, intent: 'add' });
    expect(await driverWith(fakeClient({ initResult: { session } })).finishCallback()).toBeNull();
    expect(await driverWith(fakeClient()).finishCallback()).toBeNull();
  });

  it('signs out through the session when it can be restored', async () => {
    const signOut = vi.fn(async () => {});
    const client = fakeClient({ sessions: { [LAB]: { sub: LAB, signOut } } });
    await driverWith(client).signOut(LAB);
    expect(signOut).toHaveBeenCalled();
    expect(client.revoke).not.toHaveBeenCalled();
  });

  it('still deletes the stored session when it can’t be restored', async () => {
    // Offline, or the authorization server down: restore needs its metadata,
    // revoke deletes the stored tokens and key without it.
    const client = fakeClient({ sessions: { [LAB]: new TypeError('Failed to fetch') } });
    await expect(driverWith(client).signOut(LAB)).resolves.toBeUndefined();
    expect(client.revoke).toHaveBeenCalledWith(LAB);
    client.revoke.mockRejectedValueOnce(new Error('nothing stored'));
    await expect(driverWith(client).signOut(MIRA)).resolves.toBeUndefined();
  });

  it('passes the scope and why the sign-in started', async () => {
    const client = fakeClient();
    await driverWith(client).signIn('mira.example.com', { scope: 'atproto', intent: 'reauth' });
    expect(client.signIn).toHaveBeenCalledWith('mira.example.com', { scope: 'atproto', state: 'reauth' });
  });

  it('tells a sign-out from an expiry when the library drops a session', async () => {
    const events = new EventTarget();
    const driver = createBrowserDriver({ getClient: async () => fakeClient(), loadModule: async () => mod, events });
    const seen = [];
    const off = driver.onDeleted((sub, info) => seen.push([sub, info.revoked]));
    events.dispatchEvent(new CustomEvent('deleted', { detail: { sub: MIRA, cause: new TokenRevokedError('x') } }));
    events.dispatchEvent(new CustomEvent('deleted', { detail: { sub: LAB, cause: new TokenRefreshError('x') } }));
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen).toEqual([
      [MIRA, true],
      [LAB, false],
    ]);
    off();
    events.dispatchEvent(new CustomEvent('deleted', { detail: { sub: MIRA } }));
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toHaveLength(2);
  });
});

describe('isRevokedCause', () => {
  it('knows a sign-out made in another tab, whose error arrives as a plain Error', () => {
    // What the library's TokenRevokedError becomes after the BroadcastChannel
    // clones it: the class and the name are gone, the message is kept.
    const real = new TokenRevokedError(`The session for "${MIRA}" was successfully revoked`);
    const cloned = structuredClone(real);
    expect(cloned instanceof TokenRevokedError).toBe(false);
    expect(isRevokedCause(cloned, mod)).toBe(true);
    expect(isRevokedCause(real, mod)).toBe(true);
    expect(isRevokedCause(Object.assign(new Error('x'), { name: 'TokenRevokedError' }), mod)).toBe(true);
  });

  it('reads anything else as a session that ended', () => {
    expect(isRevokedCause(structuredClone(new TokenRefreshError('The session was deleted by another process')), mod)).toBe(false);
    expect(isRevokedCause(undefined, mod)).toBe(false);
  });
});

describe('a session dropped in another tab', () => {
  it('reaches onDeleted as a sign-out', async () => {
    const events = new EventTarget();
    const driver = createBrowserDriver({ getClient: async () => fakeClient(), loadModule: async () => mod, events });
    const seen = [];
    driver.onDeleted((sub, info) => seen.push([sub, info.revoked]));
    const cause = structuredClone(new TokenRevokedError(`The session for "${MIRA}" was successfully revoked`));
    events.dispatchEvent(new CustomEvent('deleted', { detail: { sub: MIRA, cause } }));
    await vi.waitFor(() => expect(seen).toEqual([[MIRA, true]]));
  });
});
