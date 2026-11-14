import { describe, expect, it } from 'vitest';
import { modeLabel, offersLongerSession, reauthModeFor, statusLabel } from './accountCopy.js';

describe('the words for an account', () => {
  it('names each kind of sign-in', () => {
    expect(modeLabel('browser')).toBe('Browser session');
    expect(modeLabel('backend')).toBe('Long session through Virga’s server');
  });

  it('says what state it’s in, switching first', () => {
    expect(statusLabel('ready', { active: true })).toBe('Open now');
    expect(statusLabel('ready')).toBeNull();
    expect(statusLabel('needsSignIn', { active: true })).toBe('Signed out');
    expect(statusLabel('unknown')).toBe('Couldn’t check');
    expect(statusLabel('needsSignIn', { switching: true })).toBe('Switching…');
  });
});

describe('signing an account in again', () => {
  it('keeps a long session long, and lengthens a browser one when the build signs in that way', () => {
    expect(reauthModeFor({ mode: 'backend' }, 'browser')).toBe('backend');
    expect(reauthModeFor({ mode: 'browser' }, 'backend')).toBe('backend');
    expect(reauthModeFor({ mode: 'browser' }, 'browser')).toBe('browser');
  });

  it('offers a longer session only where one can be had', () => {
    expect(offersLongerSession({ mode: 'browser' }, 'backend')).toBe(true);
    expect(offersLongerSession({ mode: 'browser' }, 'browser')).toBe(false);
    expect(offersLongerSession({ mode: 'backend' }, 'backend')).toBe(false);
  });
});
