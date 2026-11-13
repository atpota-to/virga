// The environment an OAuth test needs: a real ES256 signing key, the public
// URL in its production shape, and the extra return origins. Values go on
// process.env because the modules read it when called; the previous values
// are handed back so a file can restore them.

import { JoseKey } from '@atproto/jwk-jose';

export const OAUTH_ENV = Object.freeze({
  OAUTH_PUBLIC_URL: 'https://virga.example.com',
  OAUTH_EXTRA_RETURN_ORIGINS:
    'https://staging.virga.example.com, http://localhost:5173',
});

const KEYS = [
  'OAUTH_PRIVATE_KEY_1',
  'OAUTH_PRIVATE_KEY_2',
  'OAUTH_PRIVATE_KEY_3',
  'OAUTH_TOS_URL',
  'OAUTH_POLICY_URL',
  'OAUTH_LOCK_FAST_PATH',
  'SESSION_ENCRYPTION_KEY',
  'OAUTH_SESSION_CACHE_TTL_MS',
  'FRONTEND_SESSION_CACHE_TTL_MS',
  'UPLOAD_FORWARD_TIMEOUT_MS',
  ...Object.keys(OAUTH_ENV),
];

/** A fresh ES256 key as the env holds it (JWK JSON with a kid). */
export async function generateKey(kid = 'virga-test-key') {
  const key = await JoseKey.generate(['ES256'], kid);
  return { key, json: JSON.stringify({ ...key.privateJwk, kid }) };
}

/** Set the OAuth env (with a key unless `withKey` is false); returns { key, restore }. */
export async function installOAuthEnv({ withKey = true, extra = {} } = {}) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, OAUTH_ENV, extra);
  let key = null;
  if (withKey) {
    const generated = await generateKey();
    key = generated.key;
    process.env.OAUTH_PRIVATE_KEY_1 = generated.json;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return { key, restore };
}

/** A token in the shape the store mints. */
export const TOKEN = `vg_${'b'.repeat(64)}`;
export const tokenOf = (ch) => `vg_${String(ch).repeat(64)}`;
