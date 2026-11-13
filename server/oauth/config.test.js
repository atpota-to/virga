// The client's metadata, keys and return-page rules.
//
// The authorization server fetches the metadata on every sign-in and refresh,
// and NodeOAuthClient refuses to start on metadata it can't validate, so these
// build it the way production does (an https public URL and a real ES256 key)
// and hand it to the real client. The hostname rules are the spec's:
// client_uri shares the client_id's host, and the redirect URI and JWKS hang
// off the same origin.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { JoseKey } from '@atproto/jwk-jose';
import { OAUTH_SCOPE } from '../../src/config.js';
import {
  RETURN_PATH,
  SCOPE,
  classifyAuthorizeError,
  clientMetadata,
  defaultReturnUrl,
  isAllowedReturnUrl,
  jwkThumbprint,
  loadPrivateKeys,
  returnOrigins,
  unavailableReason,
} from './config.js';
import { generateKey, installOAuthEnv } from './testing/env.js';

const store = {
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
};
const repoFile = (rel) => new URL(`../../${rel}`, import.meta.url);

// The library's own negotiation, from the oauth-client NodeOAuthClient runs on.
const nodeClientRequire = createRequire(
  createRequire(import.meta.url).resolve('@atproto/oauth-client-node'),
);
const { Keyset } = nodeClientRequire('@atproto/jwk');
const clientAuth = nodeClientRequire(
  nodeClientRequire
    .resolve('@atproto/oauth-client')
    .replace(/index\.js$/, 'oauth-client-auth.js'),
);
const AS_METADATA = {
  issuer: 'https://as.example',
  token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  token_endpoint_auth_signing_alg_values_supported: ['ES256'],
};
async function keysetOf(env) {
  const keys = [];
  for (const jwk of loadPrivateKeys(env))
    keys.push(await JoseKey.fromImportable(jwk, jwk.kid));
  return new Keyset(keys);
}
const signInKid = async (env) =>
  clientAuth.negotiateClientAuthMethod(
    AS_METADATA,
    { token_endpoint_auth_method: 'private_key_jwt' },
    await keysetOf(env),
  ).kid;
/** Whether a session stored with `kid` can still sign its refreshes. */
const canRefresh = async (env, kid) => {
  try {
    clientAuth.createClientCredentialsFactory(
      { method: 'private_key_jwt', kid },
      AS_METADATA,
      { client_id: 'https://virga.example.com/api/oauth/client-metadata.json' },
      { generateNonce: async () => 'n' },
      await keysetOf(env),
    );
    return true;
  } catch {
    return false;
  }
};

let env;

beforeAll(async () => {
  env = await installOAuthEnv();
});

afterAll(() => env.restore());

describe('client metadata', () => {
  it('is accepted by the OAuth client it is built for', () => {
    expect(
      () =>
        new NodeOAuthClient({
          clientMetadata: clientMetadata(),
          keyset: [env.key],
          stateStore: store,
          sessionStore: store,
        }),
    ).not.toThrow();
  });

  it('hangs every URL off OAUTH_PUBLIC_URL, on one host, over https', () => {
    const m = clientMetadata();
    expect(m.client_id).toBe(
      'https://virga.example.com/api/oauth/client-metadata.json',
    );
    expect(m.redirect_uris).toEqual([
      'https://virga.example.com/api/oauth/callback',
    ]);
    expect(m.jwks_uri).toBe('https://virga.example.com/api/oauth/jwks.json');
    expect(m.client_uri).toBe('https://virga.example.com');
    expect(m.logo_uri).toBe('https://virga.example.com/icon.svg');
    const host = new URL(m.client_id).hostname;
    for (const url of [
      m.client_uri,
      m.logo_uri,
      m.jwks_uri,
      ...m.redirect_uris,
    ]) {
      expect(new URL(url).hostname).toBe(host);
      expect(new URL(url).protocol).toBe('https:');
    }
  });

  it('takes the public URL as an origin, whatever path or slash it was written with', () => {
    const m = clientMetadata({
      ...process.env,
      OAUTH_PUBLIC_URL: 'https://virga.example.com/some/path/',
    });
    expect(m.client_id).toBe(
      'https://virga.example.com/api/oauth/client-metadata.json',
    );
  });

  it('is a confidential web client asking for exactly the app scope', () => {
    const m = clientMetadata();
    expect(m).toMatchObject({
      client_name: 'Virga',
      scope: OAUTH_SCOPE,
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_signing_alg: 'ES256',
      dpop_bound_access_tokens: true,
      application_type: 'web',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
    expect(m).not.toHaveProperty('jwks');
    expect(SCOPE).toBe(OAUTH_SCOPE);
  });

  it('links terms and privacy only when they are set, and only over https', () => {
    const plain = clientMetadata();
    expect(plain).not.toHaveProperty('tos_uri');
    expect(plain).not.toHaveProperty('policy_uri');

    const linked = clientMetadata({
      ...process.env,
      OAUTH_TOS_URL: 'https://virga.example.com/terms',
      OAUTH_POLICY_URL: 'http://virga.example.com/privacy',
    });
    expect(linked.tos_uri).toBe('https://virga.example.com/terms');
    // A plain-http policy would stop the client from starting; it is left out.
    expect(linked).not.toHaveProperty('policy_uri');
    expect(
      () =>
        new NodeOAuthClient({
          clientMetadata: linked,
          keyset: [env.key],
          stateStore: store,
          sessionStore: store,
        }),
    ).not.toThrow();
  });

  it('has no client without a public URL to hang it off', () => {
    expect(() =>
      clientMetadata({ ...process.env, OAUTH_PUBLIC_URL: '' }),
    ).toThrow(/OAUTH_PUBLIC_URL/);
  });
});

describe('availability and keys', () => {
  it('is unavailable without a key', () => {
    expect(
      unavailableReason({ OAUTH_PUBLIC_URL: 'https://virga.example.com' }),
    ).toMatch(/OAUTH_PRIVATE_KEY_1/);
    expect(unavailableReason({})).toMatch(/OAUTH_PRIVATE_KEY_1/);
    expect(unavailableReason(process.env)).toBeNull();
  });

  it('is unavailable without an https OAUTH_PUBLIC_URL', () => {
    const key = process.env.OAUTH_PRIVATE_KEY_1;
    expect(unavailableReason({ OAUTH_PRIVATE_KEY_1: key })).toMatch(
      /OAUTH_PUBLIC_URL/,
    );
    expect(
      unavailableReason({
        OAUTH_PRIVATE_KEY_1: key,
        OAUTH_PUBLIC_URL: 'http://virga.example.com',
      }),
    ).toMatch(/OAUTH_PUBLIC_URL/);
    // A confidential client can't be loopback, though a return origin can.
    expect(
      unavailableReason({
        OAUTH_PRIVATE_KEY_1: key,
        OAUTH_PUBLIC_URL: 'http://localhost:5173',
      }),
    ).toMatch(/OAUTH_PUBLIC_URL/);
    expect(
      unavailableReason({
        OAUTH_PRIVATE_KEY_1: key,
        OAUTH_PUBLIC_URL: 'not a url',
      }),
    ).toMatch(/OAUTH_PUBLIC_URL/);
  });

  it('loads up to three keys and skips one that is not JSON', async () => {
    const second = await generateKey('virga-second');
    const keys = loadPrivateKeys({
      OAUTH_PRIVATE_KEY_1: process.env.OAUTH_PRIVATE_KEY_1,
      OAUTH_PRIVATE_KEY_2: 'not json',
      OAUTH_PRIVATE_KEY_3: second.json,
    });
    expect(keys.map((k) => k.kid)).toEqual(['virga-test-key', 'virga-second']);
  });

  it('names a key without a kid by its thumbprint, the same in any slot', () => {
    const anonymous = JSON.parse(process.env.OAUTH_PRIVATE_KEY_1);
    delete anonymous.kid;
    const value = JSON.stringify(anonymous);
    const inSlot = (i) =>
      loadPrivateKeys({ [`OAUTH_PRIVATE_KEY_${i}`]: value }).map((k) => k.kid);
    expect(inSlot(1)).toEqual([jwkThumbprint(anonymous)]);
    expect(inSlot(2)).toEqual(inSlot(1));
    expect(inSlot(3)).toEqual(inSlot(1));
    // RFC 7638: SHA-256 of the required members in order, base64url.
    expect(jwkThumbprint(anonymous)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('skips a key with no kid that is not an EC key, and a repeated kid', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const keys = loadPrivateKeys({
      OAUTH_PRIVATE_KEY_1: process.env.OAUTH_PRIVATE_KEY_1,
      OAUTH_PRIVATE_KEY_2: process.env.OAUTH_PRIVATE_KEY_1,
      OAUTH_PRIVATE_KEY_3: JSON.stringify({ kty: 'oct', k: 'abc' }),
    });
    expect(keys.map((k) => k.kid)).toEqual(['virga-test-key']);
    vi.restoreAllMocks();
  });

  it('rotates as documented: new sign-ins take the new key, old sessions keep refreshing', async () => {
    const old = await generateKey('virga-2026-a');
    const next = await generateKey('virga-2026-b');
    const before = { OAUTH_PRIVATE_KEY_1: old.json };
    expect(await signInKid(before)).toBe('virga-2026-a');

    // Move the current key to slot 2, put the new one in slot 1.
    const rotated = {
      OAUTH_PRIVATE_KEY_1: next.json,
      OAUTH_PRIVATE_KEY_2: old.json,
    };
    expect(await signInKid(rotated)).toBe('virga-2026-b');
    expect(await canRefresh(rotated, 'virga-2026-a')).toBe(true);
    expect(await canRefresh(rotated, 'virga-2026-b')).toBe(true);

    // Removing the retired key ends the sessions still on it, which is why it
    // stays until they have signed in again.
    const retired = { OAUTH_PRIVATE_KEY_1: next.json };
    expect(await canRefresh(retired, 'virga-2026-a')).toBe(false);
  });

  it('keeps a kid-less key usable by its old sessions after it moves slot', async () => {
    const anonymous = JSON.parse((await generateKey('x')).json);
    delete anonymous.kid;
    const value = JSON.stringify(anonymous);
    const signedInWith = await signInKid({ OAUTH_PRIVATE_KEY_1: value });
    const next = await generateKey('virga-next');
    expect(
      await canRefresh(
        { OAUTH_PRIVATE_KEY_1: next.json, OAUTH_PRIVATE_KEY_2: value },
        signedInWith,
      ),
    ).toBe(true);
  });
});

describe('return pages', () => {
  it('takes exact origins only', () => {
    const e = {
      OAUTH_PUBLIC_URL: 'https://virga.example.com/some/path',
      OAUTH_EXTRA_RETURN_ORIGINS:
        'https://*.vercel.app, http://evil.example, http://localhost:5173, not a url, https://staging.virga.example.com',
    };
    expect(returnOrigins(e)).toEqual([
      'https://virga.example.com',
      'http://localhost:5173',
      'https://staging.virga.example.com',
    ]);
    expect(
      isAllowedReturnUrl('https://virga.example.com/oauth/return?n=1', e),
    ).toBe(true);
    expect(
      isAllowedReturnUrl(
        'https://virga.example.com.evil.example/oauth/return',
        e,
      ),
    ).toBe(false);
    expect(
      isAllowedReturnUrl('https://preview-123.vercel.app/oauth/return', e),
    ).toBe(false);
    expect(isAllowedReturnUrl('http://virga.example.com/oauth/return', e)).toBe(
      false,
    );
    expect(
      isAllowedReturnUrl('https://user:pw@virga.example.com/oauth/return', e),
    ).toBe(false);
    expect(isAllowedReturnUrl('', e)).toBe(false);
    expect(isAllowedReturnUrl(undefined, e)).toBe(false);
    expect(isAllowedReturnUrl('http://localhost:5173/oauth/return', e)).toBe(
      true,
    );
    expect(
      isAllowedReturnUrl('https://staging.virga.example.com/oauth/return#x', e),
    ).toBe(true);
    expect(defaultReturnUrl(e)).toBe('https://virga.example.com/oauth/return');
    expect(defaultReturnUrl({})).toBeNull();
  });

  it('takes only the return page on an allowed origin, never another path there', () => {
    const e = { OAUTH_PUBLIC_URL: 'https://virga.example.com' };
    for (const url of [
      'https://virga.example.com/',
      'https://virga.example.com/oauth/return/',
      'https://virga.example.com/oauth/returned',
      'https://virga.example.com/oauth/callback',
      'https://virga.example.com/posting',
      // The login redirects to any authorization server a handle names, and
      // would carry the fragment along.
      'https://virga.example.com/api/oauth/login?handle=evil.example&redirect_uri=https://virga.example.com/oauth/return',
      'https://virga.example.com/oauth/../api/oauth/login',
      'https://virga.example.com/x/../oauth/return/../../api/oauth/login',
    ]) {
      expect(isAllowedReturnUrl(url, e), url).toBe(false);
    }
    expect(
      isAllowedReturnUrl('https://virga.example.com/x/../oauth/return?n=1', e),
    ).toBe(true);
    expect(RETURN_PATH).toBe('/oauth/return');
  });
});

describe('classifyAuthorizeError', () => {
  it('reads an identity that does not resolve, down the cause chain', () => {
    const cause = new Error('Failed to resolve identity: nobody.invalid');
    expect(
      classifyAuthorizeError(
        new Error('Failed to initiate OAuth flow', { cause }),
      ),
    ).toEqual({ status: 400, code: 'HANDLE_NOT_FOUND' });
    expect(
      classifyAuthorizeError(
        new Error('Failed to resolve OAuth server metadata'),
      ),
    ).toEqual({ status: 502, code: 'AUTHORIZE_FAILED' });
    expect(classifyAuthorizeError(undefined)).toEqual({
      status: 502,
      code: 'AUTHORIZE_FAILED',
    });
  });
});

describe('routes', () => {
  const vercel = JSON.parse(fs.readFileSync(repoFile('vercel.json'), 'utf8'));
  const rewrites = Object.fromEntries(
    (vercel.rewrites || []).map((r) => [r.source, r.destination]),
  );

  it("serves the metadata and JWKS at the paths the metadata names, from this area's function", () => {
    const m = clientMetadata();
    expect(rewrites[new URL(m.client_id).pathname]).toBe(
      '/api/oauth/client-metadata',
    );
    expect(rewrites[new URL(m.jwks_uri).pathname]).toBe('/api/oauth/jwks');
    // The callback is served by the function itself, with no rewrite.
    expect(new URL(m.redirect_uris[0]).pathname).toBe('/api/oauth/callback');
    expect(fs.existsSync(repoFile('api/oauth/[action].js'))).toBe(true);
    for (const handler of [
      'clientMetadata',
      'jwks',
      'login',
      'callback',
      'session',
      'proxy',
      'uploadBlob',
      'logout',
    ]) {
      expect(
        fs.existsSync(new URL(`./handlers/${handler}.js`, import.meta.url)),
        handler,
      ).toBe(true);
    }
  });

  it('keeps the SPA catch-all off /api/ and the old /backend rewrite gone', () => {
    const catchAll = (vercel.rewrites || []).find(
      (r) => r.destination === '/index.html',
    );
    expect(catchAll).toBeTruthy();
    expect(new RegExp(`^${catchAll.source}$`).test('/api/oauth/login')).toBe(
      false,
    );
    expect(
      Object.keys(rewrites).some((source) => source.startsWith('/backend')),
    ).toBe(false);
    // The two rewrites come before the catch-all, or it would answer first.
    const order = (vercel.rewrites || []).map((r) => r.source);
    expect(order.indexOf('/api/oauth/client-metadata.json')).toBeLessThan(
      order.indexOf(catchAll.source),
    );
  });
});
