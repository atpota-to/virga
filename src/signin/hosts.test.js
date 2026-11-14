import { describe, expect, it, vi } from 'vitest';
import { SIGNUP_HOSTS, signUpAt } from './hosts.js';

describe('the hosts offered for a new account', () => {
  it('each have a name, a secure address and the domain it is known by', () => {
    expect(SIGNUP_HOSTS.length).toBeGreaterThan(1);
    for (const host of SIGNUP_HOSTS) {
      const url = new URL(host.url);
      expect(url.protocol, host.id).toBe('https:');
      expect(url.hostname, host.id).toBe(host.domain);
      // The address is the host itself: a path or a query would be part of
      // what the sign-in is started with.
      expect(host.url, host.id).toBe(url.origin);
      expect(host.name, host.id).toBeTruthy();
      expect(host.region, host.id).toBeTruthy();
    }
  });

  it('are told apart, and recommend exactly one, first', () => {
    expect(new Set(SIGNUP_HOSTS.map((h) => h.id)).size).toBe(SIGNUP_HOSTS.length);
    expect(new Set(SIGNUP_HOSTS.map((h) => h.domain)).size).toBe(SIGNUP_HOSTS.length);
    expect(SIGNUP_HOSTS.filter((h) => h.recommended)).toEqual([SIGNUP_HOSTS[0]]);
  });

  it('can’t be changed by whoever reads them', () => {
    expect(Object.isFrozen(SIGNUP_HOSTS)).toBe(true);
  });
});

describe('making an account at a host', () => {
  const coded = (code, message = 'x') => Object.assign(new Error(message), { code });

  it('asks the host for its make-an-account page', async () => {
    const signIn = vi.fn(async () => 'gone');
    await expect(signUpAt(signIn, 'https://bsky.social', { mode: 'backend' })).resolves.toBe('gone');
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith('https://bsky.social', { mode: 'backend', intent: 'add', prompt: 'create' });
  });

  it('falls back to the host’s ordinary sign-in page when that is turned down', async () => {
    const signIn = vi.fn().mockRejectedValueOnce(coded('AUTHORIZE_FAILED')).mockResolvedValueOnce('gone');
    await expect(signUpAt(signIn, 'https://old.example', { mode: 'backend' })).resolves.toBe('gone');
    expect(signIn).toHaveBeenLastCalledWith('https://old.example', { mode: 'backend', intent: 'add' });

    // A browser sign-in fails with the library's own error, which has no code.
    const browser = vi.fn().mockRejectedValueOnce(new Error('invalid_request: unsupported prompt')).mockResolvedValueOnce('gone');
    await expect(signUpAt(browser, 'https://old.example', { mode: 'browser' })).resolves.toBe('gone');
    expect(browser).toHaveBeenCalledTimes(2);
  });

  it('says so when the second try fails too', async () => {
    const signIn = vi.fn().mockRejectedValueOnce(coded('AUTHORIZE_FAILED', 'first')).mockRejectedValueOnce(coded('AUTHORIZE_FAILED', 'second'));
    await expect(signUpAt(signIn, 'https://down.example')).rejects.toThrow('second');
  });

  it('doesn’t try again for a failure that isn’t the host’s', async () => {
    for (const code of ['NETWORK_ERROR', 'RATE_LIMITED', 'VIRGA_CLIENT_UNAVAILABLE', 'REDIRECT_NOT_ALLOWED']) {
      const signIn = vi.fn().mockRejectedValue(coded(code));
      await expect(signUpAt(signIn, 'https://bsky.social')).rejects.toMatchObject({ code });
      expect(signIn, code).toHaveBeenCalledTimes(1);
    }
    const back = vi.fn().mockRejectedValue(new Error('User navigated back'));
    await expect(signUpAt(back, 'https://bsky.social')).rejects.toThrow(/navigated back/);
    expect(back).toHaveBeenCalledTimes(1);
  });
});
