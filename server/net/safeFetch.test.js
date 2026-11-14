import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  assertPublicHostname,
  assertPublicUrl,
  isPrivateIp,
  isSafeHttpsUrlShape,
  readXrpcErrorBody,
  safeFetch,
  safeFetchBuffer,
  safeFetchJson,
  SsrfError,
} from './safeFetch.js';

// safeFetch is the SSRF guard for every user-influenced outbound fetch (did:web
// domains, PDS endpoints, scheduled-post card thumbnails). These lock the guard
// against regressions that would reopen the cloud-metadata and internal-service
// vectors it exists to close. Everything here is network-free: IP literals need
// no DNS, and fetch is stubbed.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isPrivateIp', () => {
  it('blocks the cloud metadata address and other IPv4 private or reserved ranges', () => {
    for (const ip of ['169.254.169.254', '127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.5.4', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it('allows public IPv4 addresses', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
  });

  it('blocks IPv6 loopback, ULA, link-local and documentation; allows public IPv6', () => {
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('::')).toBe(true);
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
    expect(isPrivateIp('fe80::1%eth0')).toBe(true);
    expect(isPrivateIp('2001:db8::1')).toBe(true);
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
  });

  it('checks the IPv4 address inside an IPv4-mapped IPv6 address', () => {
    expect(isPrivateIp('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('treats anything that is not a valid IP as unsafe', () => {
    expect(isPrivateIp('not-an-ip')).toBe(true);
    expect(isPrivateIp('')).toBe(true);
  });
});

describe('isSafeHttpsUrlShape', () => {
  it('accepts public https URLs', () => {
    expect(isSafeHttpsUrlShape('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts')).toBe(true);
    expect(isSafeHttpsUrlShape('https://example.com/')).toBe(true);
  });

  it('rejects non-https schemes', () => {
    expect(isSafeHttpsUrlShape('http://public.api.bsky.app')).toBe(false);
    expect(isSafeHttpsUrlShape('file:///etc/passwd')).toBe(false);
    expect(isSafeHttpsUrlShape('gopher://x')).toBe(false);
  });

  it('rejects internal names, internal literals and malformed input', () => {
    expect(isSafeHttpsUrlShape('https://localhost/x')).toBe(false);
    expect(isSafeHttpsUrlShape('https://foo.internal/x')).toBe(false);
    expect(isSafeHttpsUrlShape('https://printer.local/x')).toBe(false);
    expect(isSafeHttpsUrlShape('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafeHttpsUrlShape('https://10.0.0.1/')).toBe(false);
    expect(isSafeHttpsUrlShape('https://[::1]/')).toBe(false);
    expect(isSafeHttpsUrlShape('not a url')).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  it('rejects non-https schemes with an SsrfError (no DNS needed)', async () => {
    await expect(assertPublicUrl('http://public.api.bsky.app')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl('ftp://example.com')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl('::nope')).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects a private IP literal or an internal name without a lookup', async () => {
    await expect(assertPublicUrl('https://169.254.169.254/')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl('https://127.0.0.1/')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl('https://localhost/')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicHostname('db.internal')).rejects.toThrow(/Blocked host/);
    await expect(assertPublicHostname('')).rejects.toThrow(/Empty host/);
  });

  it('returns a URL object for a public https literal', async () => {
    const url = await assertPublicUrl('https://8.8.8.8/');
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe('8.8.8.8');
  });
});

describe('safeFetch redirects', () => {
  it('re-validates every hop, so a public URL cannot redirect inward', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetch('https://8.8.8.8/x')).rejects.toBeInstanceOf(SsrfError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
  });

  it('follows a public redirect and stops after maxRedirects', async () => {
    let hop = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      hop += 1;
      return new Response(null, { status: 302, headers: { location: `https://8.8.8.8/hop${hop}` } });
    }));
    await expect(safeFetch('https://8.8.8.8/x', { maxRedirects: 2 })).rejects.toThrow(/Too many redirects/);
    expect(hop).toBe(3);
  });

  it('refuses an internal URL before fetching at all', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetch('https://10.1.2.3/')).rejects.toBeInstanceOf(SsrfError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('size caps', () => {
  it('refuses a declared or streamed body over maxBytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(100), { status: 200, headers: { 'content-length': '100' } })));
    await expect(safeFetchBuffer('https://8.8.8.8/img', { maxBytes: 10 })).rejects.toThrow(/too large/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(100), { status: 200 })));
    await expect(safeFetchBuffer('https://8.8.8.8/img', { maxBytes: 10 })).rejects.toThrow(/too large/);
  });

  it('returns the bytes and the content type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })));
    const { bytes, contentType } = await safeFetchBuffer('https://8.8.8.8/img');
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(contentType).toBe('image/png');
  });

  it('carries the status of a failed buffer fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404 })));
    await expect(safeFetchBuffer('https://8.8.8.8/img')).rejects.toMatchObject({ status: 404 });
  });
});

// The timeout bounds the body as well as the headers: a server that answers
// its headers promptly and then stalls or trickles the body must not hold the
// caller for as long as it likes.
describe('safeFetch body timeout', () => {
  const URL_OK = 'https://8.8.8.8/x';
  const enc = (s) => new TextEncoder().encode(s);
  const stalled = () => new ReadableStream({ start(c) { c.enqueue(enc('{"records":[')); } });
  let seenSignal;

  function stubFetch(makeBody, init = {}) {
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      seenSignal = opts.signal;
      return new Response(makeBody(), { status: 200, ...init });
    }));
  }

  afterEach(() => {
    seenSignal = null;
  });

  it('rejects a body that stalls after the headers, within the timeout', async () => {
    stubFetch(stalled);
    const started = Date.now();
    const err = await safeFetchJson(URL_OK, { timeoutMs: 60 }).catch((e) => e);
    expect(err).toMatchObject({ name: 'AbortError', code: 'BODY_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(seenSignal.aborted).toBe(true);
  });

  it('bounds a trickling body by the overall timeout, not by the gap between chunks', async () => {
    let timer;
    stubFetch(() => new ReadableStream({
      start(c) { timer = setInterval(() => c.enqueue(enc(' ')), 10); },
      cancel() { clearInterval(timer); },
    }));
    const started = Date.now();
    await expect(safeFetchJson(URL_OK, { timeoutMs: 80 })).rejects.toMatchObject({ code: 'BODY_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(1000);
    clearInterval(timer);
  });

  it('disarms the timer once the body has been read', async () => {
    stubFetch(() => '{"ok":true}');
    expect(await safeFetchJson(URL_OK, { timeoutMs: 30 })).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 60));
    expect(seenSignal.aborted).toBe(false);
  });

  it('keeps the abort armed for a caller that reads the body itself', async () => {
    stubFetch(stalled);
    const res = await safeFetch(URL_OK, { timeoutMs: 30 });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 60));
    expect(seenSignal.aborted).toBe(true);
  });

  it('clears the timer at the headers for a streaming caller (bodyTimeout: false)', async () => {
    stubFetch(stalled);
    await safeFetch(URL_OK, { timeoutMs: 30, bodyTimeout: false });
    await new Promise((r) => setTimeout(r, 60));
    expect(seenSignal.aborted).toBe(false);
  });
});

describe('safeFetchJson on a failed response', () => {
  // The status alone cannot tell "no such post" (a 400 with error NotFound)
  // from a malformed request (also a 400) or a rate limit. The XRPC error name
  // in the body is what tells them apart, so it rides on the error.
  const reply = (status, body, contentType = 'application/json') =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': contentType } });

  it('carries the XRPC error name and message, beside the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(400, { error: 'NotFound', message: 'Post not found: at://x' })));
    const err = await safeFetchJson('https://8.8.8.8/xrpc/app.bsky.feed.getPostThread').catch((e) => e);
    expect(err.message).toBe('HTTP 400');
    expect(err.status).toBe(400);
    expect(err.error).toBe('NotFound');
    expect(err.errorMessage).toBe('Post not found: at://x');
  });

  it('still fails with just the status when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(502, '<html>bad gateway</html>', 'text/html')));
    const err = await safeFetchJson('https://8.8.8.8/xrpc/x').catch((e) => e);
    expect(err.message).toBe('HTTP 502');
    expect(err.status).toBe(502);
    expect(err.error).toBeUndefined();
  });

  it('readXrpcErrorBody never throws', async () => {
    expect(await readXrpcErrorBody(reply(500, 'not json'))).toBeNull();
    expect(await readXrpcErrorBody(null)).toBeNull();
    expect(await readXrpcErrorBody(reply(400, { error: 'X' }))).toEqual({ error: 'X', message: undefined });
  });
});

describe('IPv6 literals in URLs', () => {
  it('are checked as addresses despite URL.hostname keeping their brackets', async () => {
    expect(isSafeHttpsUrlShape('https://[fe80::1]/')).toBe(false);
    expect(isSafeHttpsUrlShape('https://[::ffff:169.254.169.254]/')).toBe(false);
    expect(isSafeHttpsUrlShape('https://[2606:4700:4700::1111]/')).toBe(true);
    await expect(assertPublicUrl('https://[::1]/')).rejects.toThrow(/Blocked IP/);
    expect((await assertPublicUrl('https://[2606:4700:4700::1111]/')).hostname).toBe('[2606:4700:4700::1111]');
  });
});

describe('IPv6 forms that carry an IPv4 address', () => {
  it('are judged by the IPv4 address inside, in dotted or hex form', () => {
    expect(isPrivateIp('::ffff:a9fe:a9fe')).toBe(true); // ::ffff:169.254.169.254
    expect(isPrivateIp('::ffff:7f00:1')).toBe(true); // ::ffff:127.0.0.1
    expect(isPrivateIp('::ffff:808:808')).toBe(false); // ::ffff:8.8.8.8
    expect(isPrivateIp('::ffff:0:a9fe:a9fe')).toBe(true); // translated
    expect(isPrivateIp('64:ff9b::a9fe:a9fe')).toBe(true); // NAT64
    expect(isPrivateIp('64:ff9b::808:808')).toBe(false);
    expect(isPrivateIp('2002:a9fe:a9fe::1')).toBe(true); // 6to4
    expect(isPrivateIp('::127.0.0.1')).toBe(true); // compatible
    expect(isPrivateIp('0:0:0:0:0:0:0:1')).toBe(true);
  });
});
