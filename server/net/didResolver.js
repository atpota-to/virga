// DID → DID document → PDS endpoint, for the workers that read a user's repo
// without their session (a timer checking whether a post still exists). Rows
// always hold a DID, so there is no handle resolution here.

import { assertPublicUrl, isSafeHttpsUrlShape, safeFetchJson } from './safeFetch.js';

const DEFAULT_PLC_DIRECTORY_URL = 'https://plc.directory';

// Each lookup gets its own ceiling, so a hung PLC or did:web host can't eat the
// whole function budget.
export const DID_DOC_TIMEOUT_MS = 8000;

// did:plc identifiers are 24 base32 characters, lowercase only. Checking the
// shape before building the URL keeps anything else (path segments, query
// strings) from being sent to the PLC host.
const DID_PLC_RE = /^did:plc:[a-z2-7]{24}$/;

/**
 * Network seams, so tests can stand in for the SSRF guard without real DNS.
 * Production code never changes them.
 */
export const deps = { safeFetchJson, assertPublicUrl, isSafeHttpsUrlShape };

/** The PLC directory base: PLC_DIRECTORY_URL, else https://plc.directory, without a trailing slash. */
export function plcDirectoryUrl(env = process.env) {
  return String(env?.PLC_DIRECTORY_URL || DEFAULT_PLC_DIRECTORY_URL).replace(/\/+$/, '');
}

export class FetchTimeoutError extends Error {
  constructor(message, { url, timeoutMs } = {}) {
    super(message);
    this.name = 'FetchTimeoutError';
    this.code = 'TIMEOUT';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/** fetch() and the JSON body read inside one timeout. `data` is null when the body isn't JSON. */
async function fetchJsonWithTimeout(url, { timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    let data = null;
    try {
      data = await response.json();
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      data = null;
    }
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new FetchTimeoutError(`Timed out after ${timeoutMs}ms fetching ${url}`, { url, timeoutMs });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The DID document for `did`: did:plc from the PLC directory, did:web from the
 * domain's /.well-known/did.json through the SSRF guard. Throws when the fetch
 * fails or the document describes a different DID (`code: 'DID_DOC_MISMATCH'`).
 */
export async function fetchDidDocument(did, { timeoutMs = DID_DOC_TIMEOUT_MS, env = process.env } = {}) {
  if (typeof did !== 'string') throw new Error('A DID is required');
  let didDoc;
  if (did.startsWith('did:plc:')) {
    if (!DID_PLC_RE.test(did)) throw new Error(`Malformed did:plc: ${did}`);
    const { ok, status, data } = await fetchJsonWithTimeout(`${plcDirectoryUrl(env)}/${did}`, { timeoutMs });
    if (!ok) {
      const err = new Error(`PLC directory lookup failed: HTTP ${status}`);
      err.status = status;
      throw err;
    }
    didDoc = data;
  } else if (did.startsWith('did:web:')) {
    // The domain comes from the (attacker-influenced) DID, so the fetch goes
    // through the SSRF guard: https only, and the host must resolve to public
    // addresses.
    const domain = did.slice('did:web:'.length);
    didDoc = await deps.safeFetchJson(`https://${domain}/.well-known/did.json`, { timeoutMs });
  } else {
    throw new Error(`Unsupported DID method: ${did}`);
  }

  // A document is only authoritative for the DID it names. A PLC mirror or a
  // did:web host answering with someone else's document would otherwise route
  // this account to another account's PDS.
  if (!didDoc || typeof didDoc !== 'object' || didDoc.id !== did) {
    const err = new Error(`DID document does not describe ${did}`);
    err.code = 'DID_DOC_MISMATCH';
    throw err;
  }
  return didDoc;
}

/** The PDS endpoint a DID document names, or null when it names none (or an unsafe one). */
export function extractPdsEndpoint(didDoc) {
  const services = Array.isArray(didDoc?.service) ? didDoc.service : [];
  const pds = services.find((s) => s?.id === '#atproto_pds' || s?.type === 'AtprotoPersonalDataServer');
  const endpoint = pds?.serviceEndpoint;
  if (typeof endpoint !== 'string' || !endpoint) return null;
  // The endpoint comes from an attacker-influenceable document and is fetched
  // server-side later, so anything that isn't a public-looking https URL is
  // refused here; resolvePdsEndpoint does the full DNS check before use.
  if (!deps.isSafeHttpsUrlShape(endpoint)) {
    console.warn('[did-resolver] refusing an unsafe PDS endpoint');
    return null;
  }
  return endpoint;
}

/**
 * Resolve a DID to its PDS.
 * @returns {Promise<{ did: string, pdsEndpoint: string, didDoc: object }>} Throws on any failure.
 */
export async function resolvePdsEndpoint(did, options = {}) {
  const didDoc = await fetchDidDocument(did, options);
  const pdsEndpoint = extractPdsEndpoint(didDoc);
  if (!pdsEndpoint) {
    const err = new Error(`No PDS endpoint found for ${did}`);
    err.code = 'NO_PDS_ENDPOINT';
    throw err;
  }
  // Full SSRF check (https and public addresses) before any caller fetches
  // from it. Throws SsrfError on a private, loopback or link-local target.
  await deps.assertPublicUrl(pdsEndpoint);
  return { did, pdsEndpoint, didDoc };
}
