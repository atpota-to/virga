// The client wrapper itself: that the real NodeOAuthClient starts on this
// configuration, takes the fast-path hooks, wires its session events on
// either library line, and resolves handles with a safe fallback.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../supabase.js';
import {
  OAuthClientWrapper,
  createHandleResolver,
  getOAuthClient,
  resetOAuthForTests,
} from './client.js';
import { clientMetadata } from './config.js';
import { createStorage } from './storage.js';
import { installClientHooks } from './lockFastPath.js';
import { installOAuthEnv } from './testing/env.js';

const db = createFakeSupabase();
let env;

beforeAll(async () => {
  env = await installOAuthEnv();
  setSupabaseClientForTests(db);
});

afterAll(() => {
  resetOAuthForTests();
  resetSupabaseClientForTests();
  env.restore();
});

beforeEach(() => {
  db.reset();
  resetOAuthForTests();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('the real client', () => {
  it('starts from the env, once per instance', async () => {
    const wrapper = getOAuthClient();
    expect(getOAuthClient()).toBe(wrapper);
    const client = await wrapper.initPromise;
    expect(client.clientMetadata.client_id).toBe(clientMetadata().client_id);
    expect(wrapper.getClientMetadata()).toEqual(clientMetadata());
  });

  it("has a SessionGetter the fast path's hooks fit", async () => {
    const client = await getOAuthClient().initPromise;
    expect(installClientHooks(client.sessionGetter)).toBe(true);
  });

  it('serves only the public half of its keys', async () => {
    const jwks = JSON.parse(JSON.stringify(await getOAuthClient().getJWKS()));
    expect(jwks.keys.map((k) => k.kid)).toEqual(['virga-test-key']);
    for (const k of jwks.keys) expect(k).not.toHaveProperty('d');
  });

  it('does not start without a key, and a caller that needs it gets the throw', async () => {
    const saved = process.env.OAUTH_PRIVATE_KEY_1;
    delete process.env.OAUTH_PRIVATE_KEY_1;
    try {
      const wrapper = new OAuthClientWrapper({ storage: createStorage() });
      await expect(wrapper.initPromise).rejects.toThrow();
      await expect(wrapper.restoreSession('did:plc:x')).rejects.toThrow();
    } finally {
      process.env.OAUTH_PRIVATE_KEY_1 = saved;
    }
  });

  it('wires session events on a client that has addEventListener, and skips them on one that does not', async () => {
    const wrapper = getOAuthClient();
    await wrapper.initPromise;
    const listeners = {};
    wrapper.client = { addEventListener: (type, fn) => (listeners[type] = fn) };
    expect(wrapper.listenForSessionEvents()).toBe(true);
    listeners.deleted({
      detail: { sub: 'did:plc:x', cause: new Error('revoked') },
    });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('did:plc:x: revoked'),
    );

    // oauth-client 0.6: no addEventListener; the onUpdate/onDelete options carry them.
    wrapper.client = {};
    expect(wrapper.listenForSessionEvents()).toBe(false);
  });

  it('passes the 0.6 hooks in its options', async () => {
    const wrapper = getOAuthClient();
    await wrapper.initPromise;
    const options = wrapper.clientOptions([]);
    expect(options.requestLock).toBe(wrapper.storage.requestLock);
    expect(options.sessionStore).toBe(wrapper.storage.sessionStore);
    const deleted = vi.spyOn(wrapper, 'onSessionDeleted');
    const updated = vi.spyOn(wrapper, 'onSessionUpdated');
    options.onDelete('did:plc:y', new Error('gone'));
    options.onUpdate('did:plc:y', {});
    expect(deleted).toHaveBeenCalledWith('did:plc:y', expect.any(Error));
    expect(updated).toHaveBeenCalledWith('did:plc:y');
  });
});

describe('generateLoginUrl and handleCallback', () => {
  it('asks for the scope by default and keeps the library error as the cause', async () => {
    const wrapper = getOAuthClient();
    const client = await wrapper.ensureInitialized();
    const authorize = vi
      .spyOn(client, 'authorize')
      .mockResolvedValue(new URL('https://as.example/authorize?x=1'));
    expect(
      await wrapper.generateLoginUrl('reader.example.com', { state: 's' }),
    ).toBe('https://as.example/authorize?x=1');
    expect(authorize).toHaveBeenCalledWith(
      'reader.example.com',
      expect.objectContaining({ state: 's', scope: clientMetadata().scope }),
    );

    const cause = new Error('Failed to resolve identity: nobody.invalid');
    authorize.mockRejectedValueOnce(cause);
    const error = await wrapper
      .generateLoginUrl('nobody.invalid')
      .catch((e) => e);
    expect(error.message).toMatch(/^Failed to initiate OAuth flow/);
    expect(error.cause).toBe(cause);
  });

  it("carries the app state and the server's error code out of a failed callback", async () => {
    const wrapper = getOAuthClient();
    const client = await wrapper.ensureInitialized();
    const failure = Object.assign(new Error('denied'), {
      state: '{"redirect_uri":"https://virga.example.com/oauth/return"}',
      params: new URLSearchParams('error=access_denied'),
    });
    vi.spyOn(client, 'callback').mockRejectedValue(failure);
    const error = await wrapper
      .handleCallback(new URLSearchParams('error=access_denied&state=s'))
      .catch((e) => e);
    expect(error.message).toBe('Authentication failed: denied');
    expect(error.appState).toBe(failure.state);
    expect(error.oauthError).toBe('access_denied');
  });
});

describe('revokeSession', () => {
  it("signs a restored session out, and falls back to the library's revoke", async () => {
    const wrapper = getOAuthClient();
    const client = await wrapper.ensureInitialized();
    const signOut = vi.fn(async () => {});
    vi.spyOn(client, 'restore')
      .mockResolvedValueOnce({ signOut })
      .mockResolvedValueOnce(null);
    const revoke = vi.spyOn(client, 'revoke').mockResolvedValue(undefined);
    expect(await wrapper.revokeSession('did:plc:a')).toBe(true);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    expect(await wrapper.revokeSession('did:plc:b')).toBe(true);
    expect(revoke).toHaveBeenCalledWith('did:plc:b');
  });
});

describe('createHandleResolver', () => {
  it('falls back to the AppView with the handle URL-encoded, and names the failure the classifier reads', async () => {
    const calls = [];
    const fetch = vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).startsWith('https://dns.google/'))
        throw new Error('dns down');
      if (String(url).includes('/.well-known/atproto-did'))
        return new Response('nope', { status: 404 });
      return new Response(
        JSON.stringify({ did: 'did:plc:found00000000000000000' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const resolver = createHandleResolver({
      fetch,
      appview: 'https://appview.example',
    });
    expect(await resolver.resolve('reader.example.com')).toBe(
      'did:plc:found00000000000000000',
    );
    const fallback = calls.find((u) =>
      u.startsWith('https://appview.example/'),
    );
    expect(fallback).toBe(
      'https://appview.example/xrpc/com.atproto.identity.resolveHandle?handle=reader.example.com',
    );

    calls.length = 0;
    fetch.mockImplementation(async (url) => {
      calls.push(String(url));
      throw new Error('offline');
    });
    await expect(resolver.resolve('a&b=c')).rejects.toThrow(
      'Failed to resolve identity: a&b=c',
    );
    expect(calls.find((u) => u.startsWith('https://appview.example/'))).toBe(
      'https://appview.example/xrpc/com.atproto.identity.resolveHandle?handle=a%26b%3Dc',
    );
  });
});
