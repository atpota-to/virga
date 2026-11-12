// Where an account's repo lives: the `#atproto_pds` service in its DID
// document. A post's video is uploaded with a pass minted for this host, and
// it is the same for both kinds of sign-in, which is why it is read from the
// identity and not from either session.

import { getDidDocument as fetchDidDocument } from '../lib/atproto.js';

/** The PDS endpoint a DID document names, with no trailing slash, or null. */
export function pdsFromDidDocument(doc, did = doc?.id) {
  const services = Array.isArray(doc?.service) ? doc.service : [];
  const isPds = (s) => s?.id === '#atproto_pds' || (did && s?.id === `${did}#atproto_pds`);
  const svc = services.find(isPds);
  const endpoint = typeof svc?.serviceEndpoint === 'string' ? svc.serviceEndpoint : null;
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return endpoint.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * A resolver with its own per-DID cache. The cache holds the promise, so
 * callers on the same tick share one lookup, and forgets a failure so the
 * next caller asks again. An account's PDS changes only when it migrates.
 */
export function createPdsResolver({ getDidDocument = fetchDidDocument } = {}) {
  const cache = new Map();
  async function lookup(did) {
    const doc = await getDidDocument(did);
    const pds = pdsFromDidDocument(doc, did);
    if (!pds) throw new Error(`No PDS listed for ${did}`);
    return pds;
  }
  return {
    resolvePdsUrl(did) {
      if (!did) return Promise.reject(new Error('resolvePdsUrl: missing did'));
      if (!cache.has(did)) {
        const p = lookup(did);
        cache.set(did, p);
        p.catch(() => {
          if (cache.get(did) === p) cache.delete(did);
        });
      }
      return cache.get(did);
    },
    /** Note a PDS learned another way (the server's session answer), so no lookup is needed. */
    remember(did, pdsUrl) {
      if (did && typeof pdsUrl === 'string' && /^https?:\/\//.test(pdsUrl)) cache.set(did, Promise.resolve(pdsUrl.replace(/\/+$/, '')));
    },
    forget(did) {
      cache.delete(did);
    },
  };
}

const shared = createPdsResolver();

/** The account's PDS URL, e.g. `https://morel.us-east.host.bsky.network`. */
export function resolvePdsUrl(did) {
  return shared.resolvePdsUrl(did);
}

export function rememberPdsUrl(did, pdsUrl) {
  shared.remember(did, pdsUrl);
}
