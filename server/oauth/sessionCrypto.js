// Envelope encryption for OAuth session rows at rest.
//
// oauth_sessions.session_data holds the account's access and refresh tokens
// and its DPoP key. RLS keeps other roles out, but it isn't encryption: a
// database dump, a backup or a leaked service-role key would yield long-lived
// refresh tokens. With SESSION_ENCRYPTION_KEY set, rows are written as an
// AES-256-GCM envelope and decrypted on read.
//
// The key must decode to 32 bytes: 64 hex characters or base64
// (`openssl rand -hex 32`). Set it before the first sign-in. Rotating it
// without re-encrypting the rows makes them unreadable, and every account
// signs in again.
//
// Without a key, rows are stored as they are. A plaintext row still reads
// with a key set, so turning encryption on later needs no migration: rows
// become envelopes as their tokens refresh.

import crypto from 'node:crypto';

const ENC_TAG = 'aesgcm-v1';

function resolveKey(env = process.env) {
  const raw = env.SESSION_ENCRYPTION_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'SESSION_ENCRYPTION_KEY must decode to 32 bytes (use `openssl rand -hex 32`)',
    );
  }
  return key;
}

/** True for one of these envelopes, as opposed to a plaintext session. */
export function isEncrypted(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    value.enc === ENC_TAG &&
    typeof value.iv === 'string' &&
    typeof value.ct === 'string' &&
    typeof value.tag === 'string'
  );
}

/** The session as it is stored: an envelope with a key, the object itself without. */
export function encryptSession(session, env = process.env) {
  const key = resolveKey(env);
  if (!key) return session;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(session), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    enc: ENC_TAG,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/**
 * A stored value as a session. Plaintext rows (and undefined) pass through;
 * an envelope read without a key, or one that fails its auth tag, throws.
 */
export function decryptSession(stored, env = process.env) {
  if (!isEncrypted(stored)) return stored;
  const key = resolveKey(env);
  if (!key)
    throw new Error(
      'Session is encrypted at rest but SESSION_ENCRYPTION_KEY is not set',
    );
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(stored.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(stored.ct, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

export function sessionEncryptionEnabled(env = process.env) {
  return !!resolveKey(env);
}
