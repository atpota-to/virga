// The fetch the OAuth client does all its network work through.
//
// /api/oauth/login is unauthenticated and takes any identity, so what the
// client fetches is the caller's to choose: https://<handle>/.well-known/
// atproto-did, a did:web's did.json, the PDS a DID document names and the
// metadata, PAR and token endpoints that PDS's authorization server names (the
// last two POSTed a client assertion signed as Virga). Each URL, and every
// redirect hop, must be https and resolve only to public addresses
// (server/net/safeFetch.js's rules), so none of that can be pointed inside the
// network the server runs in.
//
// Unlike server/net/safeFetch.js this is a drop-in fetch: it takes a Request
// or (url, init), keeps the method, headers and body, and leaves timeouts to
// the caller's signal. A host found public is remembered briefly, because the
// proxy signs every XRPC call through here; that widens the DNS-rebinding gap
// safeFetch.js already accepts by at most HOST_VERDICT_TTL_MS.

import { SsrfError, assertPublicUrl } from '../net/safeFetch.js';
import { TtlCache } from '../ttlCache.js';

const MAX_REDIRECTS = 3;
const HOST_VERDICT_TTL_MS = 60 * 1000;

const isRedirect = (status) => status >= 300 && status < 400;

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch] - the fetch underneath (globalThis.fetch, read per call)
 * @param {(url: string) => Promise<unknown>} [options.assertUrl] - throws for a URL that must not be fetched
 * @param {number} [options.hostTtlMs]
 * @returns {typeof fetch}
 */
export function createSafeFetch({
  fetch,
  assertUrl = assertPublicUrl,
  hostTtlMs = HOST_VERDICT_TTL_MS,
} = {}) {
  const publicHosts = new TtlCache({ ttlMs: hostTtlMs, max: 5000 });
  const send = (request) => (fetch || globalThis.fetch)(request);

  async function check(url) {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && publicHosts.get(parsed.hostname))
      return;
    await assertUrl(parsed.href);
    publicHosts.set(parsed.hostname, true);
  }

  return async function safeFetch(input, init) {
    let request = new Request(input, init);
    await check(request.url);
    // 'error' and 'manual' never follow, so there is no hop to check.
    if (request.redirect !== 'follow') return send(request);

    for (let hop = 0; ; hop++) {
      const response = await send(new Request(request, { redirect: 'manual' }));
      const location = isRedirect(response.status)
        ? response.headers.get('location')
        : null;
      // A redirected POST would need its body again; the 3xx goes back as it
      // is, which the library reads as a failed request.
      if (!location || !['GET', 'HEAD'].includes(request.method))
        return response;
      if (hop >= MAX_REDIRECTS) throw new SsrfError('Too many redirects');
      response.body?.cancel().catch(() => {});
      const next = new URL(location, request.url);
      await check(next.href);
      // Headers (the DPoP proof, an Authorization) stay with their origin.
      const sameOrigin = next.origin === new URL(request.url).origin;
      request = new Request(next, {
        method: request.method,
        headers: sameOrigin ? request.headers : undefined,
        signal: request.signal,
      });
    }
  };
}
