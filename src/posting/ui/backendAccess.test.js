import { describe, expect, it } from 'vitest';
import { backendAccess } from './backendAccess.js';

describe('the long-session check', () => {
  it('lets a live long session through', () => {
    expect(backendAccess({ mode: 'backend', status: 'ready' }, { authMode: 'backend', canSchedule: true })).toEqual({ ready: true, action: null });
  });

  it('offers a browser session a reconnect where long sessions are offered', () => {
    expect(backendAccess({ mode: 'browser' }, { authMode: 'backend', canSchedule: false })).toEqual({ ready: false, action: 'reconnect' });
  });

  it('says a browser session can’t have one where they aren’t', () => {
    expect(backendAccess({ mode: 'browser' }, { authMode: 'browser', canSchedule: false })).toEqual({ ready: false, action: 'unavailable' });
  });

  it('asks an ended long session to sign back in, whatever new sign-ins use', () => {
    expect(backendAccess({ mode: 'backend', status: 'needsSignIn' }, { authMode: 'browser', canSchedule: false })).toEqual({
      ready: false,
      action: 'signBackIn',
    });
  });

  it('has nothing to offer an account it doesn’t know', () => {
    expect(backendAccess(null, { authMode: 'backend' })).toEqual({ ready: false, action: 'none' });
  });
});
