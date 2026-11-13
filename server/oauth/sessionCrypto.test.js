// Session rows at rest: the AES-GCM envelope, and the plaintext path for a
// deployment without a key.

import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decryptSession,
  encryptSession,
  isEncrypted,
  sessionEncryptionEnabled,
} from './sessionCrypto.js';

const SAMPLE = {
  tokenSet: { access_token: 'AAA', refresh_token: 'RRR' },
  dpopJwk: { kty: 'EC' },
};
const KEY = crypto.randomBytes(32).toString('hex');

describe('without a key', () => {
  beforeEach(() => {
    delete process.env.SESSION_ENCRYPTION_KEY;
  });

  it('stores sessions as they are', () => {
    expect(encryptSession(SAMPLE)).toEqual(SAMPLE);
    expect(sessionEncryptionEnabled()).toBe(false);
  });

  it('reads plaintext rows (and undefined) as they are', () => {
    expect(decryptSession(SAMPLE)).toEqual(SAMPLE);
    expect(decryptSession(undefined)).toBeUndefined();
  });
});

describe('with a key', () => {
  beforeEach(() => {
    process.env.SESSION_ENCRYPTION_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.SESSION_ENCRYPTION_KEY;
  });

  it('produces an AES-GCM envelope that does not contain the token', () => {
    const enc = encryptSession(SAMPLE);
    expect(isEncrypted(enc)).toBe(true);
    expect(JSON.stringify(enc)).not.toContain('RRR');
    expect(sessionEncryptionEnabled()).toBe(true);
  });

  it('round-trips back to the original object', () => {
    expect(decryptSession(encryptSession(SAMPLE))).toEqual(SAMPLE);
  });

  it('accepts the key as base64 too', () => {
    const env = {
      SESSION_ENCRYPTION_KEY: Buffer.from(KEY, 'hex').toString('base64'),
    };
    expect(decryptSession(encryptSession(SAMPLE, env), env)).toEqual(SAMPLE);
  });

  it('still reads a plaintext row', () => {
    expect(decryptSession(SAMPLE)).toEqual(SAMPLE);
  });

  it('rejects tampered ciphertext through the GCM auth tag', () => {
    const enc = encryptSession(SAMPLE);
    enc.ct = Buffer.from('tampered-bytes').toString('base64');
    expect(() => decryptSession(enc)).toThrow();
  });

  it('rejects a key that does not decode to 32 bytes', () => {
    process.env.SESSION_ENCRYPTION_KEY = 'too-short';
    expect(() => encryptSession(SAMPLE)).toThrow(/32 bytes/);
  });

  it('throws when an encrypted row is read with no key', () => {
    const enc = encryptSession(SAMPLE);
    delete process.env.SESSION_ENCRYPTION_KEY;
    expect(() => decryptSession(enc)).toThrow(/SESSION_ENCRYPTION_KEY/);
  });
});
