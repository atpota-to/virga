// The OAuth client's fetch: every URL and redirect hop checked before it is
// fetched, the request otherwise passed through untouched, and the real client
// built on it, so an unauthenticated sign-in can't reach an internal address.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SsrfError } from '../net/safeFetch.js';
import { createFakeSupabase } from '../test/fakeSupabase.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../supabase.js';
import { OAuthClientWrapper, resetOAuthForTests } from './client.js';
import { createStorage } from './storage.js';
import { createSafeFetch } from './safeFetch.js';
import { installOAuthEnv } from './testing/env.js';

const BLOCKED = new Set([
  '10.0.0.5',
  'intranet.example.com',
  '169.254.169.254',
]);
const assertUrl = vi.fn(async (url) => {
  const { protocol, hostname } = new URL(url);
  if (protocol !== 'https:') throw new SsrfError('Only https URLs allowed');
  if (BLOCKED.has(hostname)) throw new SsrfError(`Blocked host: ${hostname}`);
});

function underlying(answer) {
  const seen = [];
  const fetch = vi.fn(async (request) => {
    seen.push(request);
    return answer(request);
  });
  return { fetch, seen };
}

const redirect = (to, status = 302) =>
  new Response(null, { status, headers: { location: to } });

describe('createSafeFetch', () => {
  it('passes a public request through with its method, headers and body', async () => {
    const { fetch, seen } = underlying(() => new Response('ok'));
    const safe = createSafeFetch({ fetch, assertUrl });
    const res = await safe(
      'https://pds.example/xrpc/com.atproto.repo.createRecord',
      {
        method: 'POST',
        headers: { DPoP: 'proof', 'content-type': 'application/json' },
        body: '{"a":1}',
      },
    );
    expect(await res.text()).toBe('ok');
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].headers.get('dpop')).toBe('proof');
    expect(await seen[0].text()).toBe('{"a":1}');
    expect(seen[0].redirect).toBe('manual');
  });

  it('refuses an internal or non-https URL without fetching it', async () => {
    const { fetch } = underlying(() => new Response('ok'));
    const safe = createSafeFetch({ fetch, assertUrl });
    await expect(
      safe('https://10.0.0.5:8443/.well-known/oauth-protected-resource'),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      safe(new Request('http://pds.example/.well-known/did.json')),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks every redirect hop, so a public URL cannot bounce inside', async () => {
    const { fetch, seen } = underlying(() =>
      redirect('https://169.254.169.254/latest/meta-data'),
    );
    const safe = createSafeFetch({ fetch, assertUrl });
    await expect(
      safe('https://public.example/did.json'),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(seen.map((r) => r.url)).toEqual(['https://public.example/did.json']);
  });

  it('follows a public GET redirect, keeping headers only on the same origin', async () => {
    const { fetch, seen } = underlying((request) => {
      if (request.url.endsWith('/a')) return redirect('/b');
      if (request.url.endsWith('/b'))
        return redirect('https://other.example/c');
      return new Response('done');
    });
    const safe = createSafeFetch({ fetch, assertUrl });
    const res = await safe('https://public.example/a', {
      headers: { authorization: 'DPoP t' },
    });
    expect(await res.text()).toBe('done');
    expect(seen.map((r) => [r.url, r.headers.get('authorization')])).toEqual([
      ['https://public.example/a', 'DPoP t'],
      ['https://public.example/b', 'DPoP t'],
      ['https://other.example/c', null],
    ]);
  });

  it('hands a redirected POST back as it is, and stops after three hops', async () => {
    const post = createSafeFetch({
      fetch: underlying(() => redirect('https://public.example/elsewhere', 307))
        .fetch,
      assertUrl,
    });
    const res = await post('https://as.example/oauth/par', {
      method: 'POST',
      body: 'x',
    });
    expect(res.status).toBe(307);

    const { fetch } = underlying((request) => redirect(`${request.url}x`));
    const loop = createSafeFetch({ fetch, assertUrl });
    await expect(loop('https://public.example/a')).rejects.toThrow(
      'Too many redirects',
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("leaves 'error' and 'manual' to fetch itself", async () => {
    const { fetch, seen } = underlying(() => new Response('ok'));
    const safe = createSafeFetch({ fetch, assertUrl });
    await safe('https://public.example/a', { redirect: 'error' });
    expect(seen[0].redirect).toBe('error');
  });

  it('checks a host once a minute, not on every request', async () => {
    const check = vi.fn(async () => {});
    const safe = createSafeFetch({
      fetch: underlying(() => new Response('ok')).fetch,
      assertUrl: check,
    });
    await safe('https://pds.example/xrpc/a');
    await safe('https://pds.example/xrpc/b');
    expect(check).toHaveBeenCalledTimes(1);
    // An http URL is checked again, cached host or not (and refused there).
    await expect(safe('http://pds.example/xrpc/c')).resolves.toBeTruthy();
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe('the OAuth client', () => {
  let env;
  const db = createFakeSupabase();

  beforeAll(async () => {
    env = await installOAuthEnv();
    setSupabaseClientForTests(db);
  });
  afterAll(() => {
    resetOAuthForTests();
    resetSupabaseClientForTests();
    env.restore();
  });

  it('does all its fetching through the checked fetch by default', async () => {
    const wrapper = new OAuthClientWrapper({ storage: createStorage() });
    const client = await wrapper.initPromise;
    expect(client.fetch).toBe(wrapper.fetch);
    expect(client.fetch).not.toBe(globalThis.fetch);
  });

  it('never reaches an internal host a sign-in names', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetch } = underlying(() => new Response('{}'));
    const wrapper = new OAuthClientWrapper({
      storage: createStorage(),
      fetch: createSafeFetch({ fetch, assertUrl }),
    });
    await wrapper.initPromise;
    await expect(
      wrapper.generateLoginUrl('https://10.0.0.5:8443'),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(assertUrl).toHaveBeenCalledWith(
      expect.stringContaining('https://10.0.0.5:8443/'),
    );
    vi.restoreAllMocks();
  });
});
