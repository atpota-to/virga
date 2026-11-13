/**
 * SSRF-safe outbound fetch.
 *
 * The server resolves attacker-influenced identities (did:web domains, PDS
 * service endpoints from DID documents) and fetches attacker-supplied URLs
 * (scheduled post card thumbnails). Fetching those without validation lets a caller point
 * the server at internal services or the cloud metadata endpoint
 * (169.254.169.254) — classic SSRF. This module centralizes the guard:
 *
 *   - https only (no http/file/gopher/…).
 *   - The host must resolve exclusively to PUBLIC IPs. Private, loopback,
 *     link-local, CGNAT, and reserved ranges (v4 and v6) are rejected.
 *   - Redirects are followed manually, re-validating each hop (so a public URL
 *     can't 302 to an internal one).
 *   - Response size and total time are capped. The timeout covers the body as
 *     well as the headers: a server that sends its headers and then stalls (or
 *     trickles) the body must not hold the caller open past the timeout.
 *
 * Residual risk: a DNS-rebinding attacker could in principle flip a hostname's
 * A record to an internal IP in the window between our lookup and the socket's
 * own lookup. Closing that fully needs IP-pinned TLS (a custom undici agent);
 * this guard blocks the practical static-target and redirect SSRF vectors that
 * were reported. Callers should still treat fetched bytes as untrusted.
 */

import net from 'node:net';
import { promises as dns } from 'node:dns';

export class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SsrfError';
    this.ssrf = true;
  }
}

// --- IP range checks -------------------------------------------------------

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255 || !/^\d+$/.test(p)) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

// Ranges that must never be reachable from a user-influenced fetch.
const BLOCKED_V4 = [
  ['0.0.0.0', 8],       // "this" network
  ['10.0.0.0', 8],      // private
  ['100.64.0.0', 10],   // CGNAT
  ['127.0.0.0', 8],     // loopback
  ['169.254.0.0', 16],  // link-local (incl. cloud metadata 169.254.169.254)
  ['172.16.0.0', 12],   // private
  ['192.0.0.0', 24],    // IETF protocol assignments
  ['192.0.2.0', 24],    // TEST-NET-1
  ['192.88.99.0', 24],  // 6to4 relay anycast
  ['192.168.0.0', 16],  // private
  ['198.18.0.0', 15],   // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24],  // TEST-NET-3
  ['224.0.0.0', 4],     // multicast
  ['240.0.0.0', 4],     // reserved
  ['255.255.255.255', 32],
];

function isPrivateIpv4(ip) {
  const intIp = ipv4ToInt(ip);
  if (intIp === null) return true; // unparseable → treat as unsafe
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (intIp & mask) === (ipv4ToInt(base) & mask);
  });
}

// An IPv6 address as eight 16-bit groups (an embedded dotted IPv4 tail taken
// as the last two), or null.
function ipv6Groups(addr) {
  let text = addr;
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = ipv4ToInt(dotted[1]);
    if (v4 === null) return null;
    text = `${text.slice(0, -dotted[1].length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const groupsToIpv4 = (hi, lo) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');

function isPrivateIpv6(ip) {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf('%'); // strip scope id (fe80::1%eth0)
  if (zone >= 0) addr = addr.slice(0, zone);

  const g = ipv6Groups(addr);
  if (!g) return true; // unparseable → treat as unsafe
  const zeroUpTo = (n) => g.slice(0, n).every((x) => x === 0);

  // Forms that carry an IPv4 address, whichever way URL or the resolver wrote
  // them (URL turns ::ffff:169.254.169.254 into ::ffff:a9fe:a9fe): mapped
  // ::ffff:0:0/96, compatible ::/96, translated ::ffff:0:0:0/96, NAT64
  // 64:ff9b::/96 and 6to4 2002::/16 all reach the embedded IPv4 address.
  if (zeroUpTo(5) && g[5] === 0xffff) return isPrivateIpv4(groupsToIpv4(g[6], g[7]));
  if (zeroUpTo(4) && g[4] === 0xffff && g[5] === 0) return isPrivateIpv4(groupsToIpv4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIpv4(groupsToIpv4(g[6], g[7]));
  if (g[0] === 0x2002) return isPrivateIpv4(groupsToIpv4(g[1], g[2]));
  if (zeroUpTo(6)) return true; // ::, ::1 and the deprecated IPv4-compatible block

  if ((g[0] & 0xfc00) === 0xfc00) return true; // fc00::/6 → ULA, link-local, site-local, multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

export function isPrivateIp(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) return isPrivateIpv4(ip);
  if (fam === 6) return isPrivateIpv6(ip);
  return true; // not a valid IP → unsafe
}

// --- Host / URL validation -------------------------------------------------

// URL.hostname keeps an IPv6 literal's brackets ("[::1]"), which net.isIP
// doesn't take; without this the literal is never checked as an address.
const bareHost = (hostname) => String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan'];

export async function assertPublicHostname(hostname) {
  const host = bareHost(hostname);
  if (!host) throw new SsrfError('Empty host');

  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SsrfError(`Blocked host: ${host}`);
  }

  // IP literal — check directly, no DNS.
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new SsrfError(`Blocked IP: ${host}`);
    return;
  }

  // Hostname — resolve and require every address to be public.
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (err) {
    throw new SsrfError(`DNS resolution failed for ${host}: ${err.message}`);
  }
  if (!addrs || addrs.length === 0) throw new SsrfError(`No addresses for ${host}`);
  for (const { address } of addrs) {
    if (isPrivateIp(address)) throw new SsrfError(`${host} resolves to blocked IP ${address}`);
  }
}

/** Parse + validate a URL string. Throws SsrfError. Returns the URL object. */
export async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('Invalid URL');
  }
  if (url.protocol !== 'https:') throw new SsrfError(`Only https URLs allowed (got ${url.protocol})`);
  await assertPublicHostname(url.hostname);
  return url;
}

/**
 * Sync, best-effort shape check for storing/accepting a URL before we ever fetch
 * it (no DNS). Rejects non-https and obvious internal literals. The real check
 * is assertPublicUrl/safeFetch at fetch time.
 */
export function isSafeHttpsUrlShape(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = bareHost(url.hostname);
  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return false;
  if (net.isIP(host) && isPrivateIp(host)) return false;
  return true;
}

// --- Fetch -----------------------------------------------------------------

// safeFetch leaves the final response's abort timer armed after the headers
// arrive, so the timeout bounds the body too. The handle lives on the response
// under this symbol: readCapped races every read against it (a stand-in fetch
// that ignores the abort signal is bounded all the same) and disarms the timer
// once the body is read, too large, or failed.
const BODY_DEADLINE = Symbol('safeFetch.bodyDeadline');

function bodyTimeoutError(timeoutMs) {
  // Named like the AbortError fetch throws for the header timeout, so a caller
  // that already reads that as "too slow" reads this the same way.
  const err = new Error(`Response body not received within ${timeoutMs}ms`);
  err.name = 'AbortError';
  err.code = 'BODY_TIMEOUT';
  return err;
}

/** Settle with `promise`, or reject once the response's timeout fires. */
function beforeBodyDeadline(promise, deadline) {
  if (!deadline) return promise;
  const { signal, timeoutMs } = deadline;
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(bodyTimeoutError(timeoutMs));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(bodyTimeoutError(timeoutMs));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (err) => { signal.removeEventListener('abort', onAbort); reject(err); },
    );
  });
}

export async function readCapped(res, maxBytes) {
  const deadline = res ? res[BODY_DEADLINE] : null;
  try {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new SsrfError(`Response too large (${declared} bytes)`);
    }
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!reader) {
      const buf = Buffer.from(await beforeBodyDeadline(res.arrayBuffer(), deadline));
      if (buf.byteLength > maxBytes) throw new SsrfError('Response too large');
      return buf;
    }
    const chunks = [];
    let total = 0;
    for (;;) {
      let chunk;
      try {
        chunk = await beforeBodyDeadline(reader.read(), deadline);
      } catch (err) {
        // Not awaited: cancelling a stalled stream must not become the next stall.
        try { reader.cancel().catch(() => {}); } catch { /* ignore */ }
        throw err;
      }
      const { done, value } = chunk;
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new SsrfError('Response too large');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    if (deadline) deadline.disarm();
  }
}

/**
 * SSRF-safe fetch. Validates the URL (and every redirect hop), enforces a
 * timeout, and returns the final Response. The body has NOT been consumed —
 * read it with a cap (readCapped) or use safeFetchJson/safeFetchBuffer.
 *
 * The timeout covers the body read as well as the headers: the timer stays
 * armed (unref'd) after the headers arrive, and when it fires the body read
 * is aborted. A caller that streams a long body under deadlines of its own
 * passes `bodyTimeout: false` to have the timer cleared at the headers instead.
 *
 * @param {string} rawUrl
 * @param {{ headers?: object, timeoutMs?: number, maxRedirects?: number, bodyTimeout?: boolean }} [opts]
 */
export async function safeFetch(rawUrl, opts = {}) {
  const { headers = {}, timeoutMs = 10000, maxRedirects = 3, bodyTimeout = true } = opts;
  let url = await assertPublicUrl(rawUrl);

  for (let hop = 0; ; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { headers, redirect: 'manual', signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }

    // Manual redirect handling: re-validate the target before following.
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (location) {
      clearTimeout(timer);
      if (hop >= maxRedirects) throw new SsrfError('Too many redirects');
      // Re-validate the redirect target before following it (a public URL must
      // not be allowed to 302 to an internal one). assertPublicUrl throws on a
      // blocked target; let it propagate.
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }

    if (!bodyTimeout) {
      clearTimeout(timer);
      return res;
    }
    // A body nobody reads must not keep a script's process alive until it fires.
    if (typeof timer.unref === 'function') timer.unref();
    try {
      Object.defineProperty(res, BODY_DEADLINE, {
        value: { signal: controller.signal, timeoutMs, disarm: () => clearTimeout(timer) },
      });
    } catch {
      // A frozen stand-in response: the armed abort still bounds a real body.
    }
    return res;
  }
}

// How much of an error response is read looking for an XRPC error body. Those
// are a line of JSON; anything bigger is an HTML error page nobody needs.
const ERROR_BODY_MAX_BYTES = 16 * 1024;

/**
 * The `{ error, message }` an XRPC service puts in a failed response's body, or
 * null. Best-effort by design: it runs on a request that has already failed,
 * so nothing here may throw or replace the failure it is describing.
 */
export async function readXrpcErrorBody(res) {
  try {
    const buf = await readCapped(res, ERROR_BODY_MAX_BYTES);
    const body = JSON.parse(buf.toString('utf8'));
    if (!body || typeof body !== 'object') return null;
    return {
      error: typeof body.error === 'string' ? body.error : undefined,
      message: typeof body.message === 'string' ? body.message : undefined,
    };
  } catch {
    return null;
  }
}

export async function safeFetchJson(rawUrl, opts = {}) {
  const maxBytes = opts.maxBytes || 2 * 1024 * 1024;
  const res = await safeFetch(rawUrl, opts);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    // The status alone cannot tell an answer from a failure. An XRPC service
    // says "no such post" as a 400 with error NotFound, and also says "your
    // request was malformed" as a 400 — and a 429 is a 4xx too. Callers that
    // need to act on which one it was read `err.error` (the XRPC error name);
    // `err.status` is unchanged, so every existing check still reads the same.
    const body = await readXrpcErrorBody(res);
    if (body?.error) err.error = body.error;
    if (body?.message) err.errorMessage = body.message;
    throw err;
  }
  const buf = await readCapped(res, maxBytes);
  return JSON.parse(buf.toString('utf8'));
}

export async function safeFetchBuffer(rawUrl, opts = {}) {
  const maxBytes = opts.maxBytes || 5 * 1024 * 1024;
  const res = await safeFetch(rawUrl, opts);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const bytes = await readCapped(res, maxBytes);
  return { bytes, contentType: res.headers.get('content-type') || null };
}
