// Tiny isomorphic AT Protocol client. No SDK, just fetch + JSON. The public
// reads the dashboard makes without a session all go through here.

import { APPVIEW, PLC_DIRECTORY } from '../config.js';

// A single request must never wedge a sync. Attach a 15s abort so a hung
// fetch rejects instead of hanging forever. Feature-detected: environments
// without `AbortSignal.timeout` (older runtimes) simply run with no signal.
//
// A caller's own signal (a cancel button, an unmount) is kept, but it is not a
// substitute: it fires when the caller gives up, and nothing gives up on a
// server that has simply stopped answering. So the two are combined where the
// runtime can (`AbortSignal.any`); where it can't, the caller's signal stands
// alone.
const REQUEST_TIMEOUT_MS = 15_000;
function withTimeout(init, ms = REQUEST_TIMEOUT_MS) {
  const base = init || {};
  if (
    typeof AbortSignal === 'undefined' ||
    typeof AbortSignal.timeout !== 'function'
  ) {
    return base;
  }
  const timeout = AbortSignal.timeout(ms);
  if (!base.signal) return { ...base, signal: timeout };
  if (typeof AbortSignal.any !== 'function') return base;
  const signal = AbortSignal.any([base.signal, timeout]);
  // The combined signal holds its sources weakly, and Node 20 lets a pending
  // `AbortSignal.timeout` be collected when nothing else refers to it: after
  // a GC the timeout never fired, and the request hung as if it had none.
  // Hanging it off the signal the request keeps keeps it alive as long as
  // the request is.
  signal.timeoutSignal = timeout;
  return { ...base, signal };
}

/**
 * `fetch` with the same 15s ceiling every request in this module carries. For
 * the clients that talk to other services (Constellation) and so can't go
 * through `fetchJson`, but must not be able to hang the page that waits on
 * them either.
 */
export function fetchWithTimeout(url, init, ms) {
  return fetch(url, withTimeout(init, ms));
}

async function fetchJson(url, init) {
  const res = await fetch(url, withTimeout(init));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `HTTP ${res.status} ${res.statusText} for ${url} :: ${text.slice(0, 200)}`,
    );
    err.status = res.status;
    err.url = url;
    throw err;
  }
  return res.json();
}

/**
 * Resolve a DID's PDS endpoint from its DID document: the PLC directory for
 * `did:plc:*`, the host's `/.well-known/did.json` for `did:web:*`.
 * Returns a URL string with no trailing slash.
 */
export async function resolvePds(did) {
  const doc = await getDidDocument(did);
  const services = doc?.service || [];
  const pds =
    services.find((s) => s.id === '#atproto_pds')?.serviceEndpoint ||
    services[0]?.serviceEndpoint;
  if (!pds) throw new Error(`No PDS endpoint for ${did}`);
  return pds.replace(/\/$/, '');
}

// DID documents, cached in memory as the PROMISE, not the answer, so callers
// on the same tick share one request. A lookup that fails is dropped, so the
// next caller asks again rather than inheriting the failure. Ten minutes:
// what callers read off the document (the PDS) moves only on an account
// migration, which is rare and deliberate.
const DID_DOC_TTL = 10 * 60_000;
const _didDocCache = new Map(); // did -> { promise, ts }

function cachedRead(cache, key, ttl, read) {
  const held = cache.get(key);
  if (held && Date.now() - held.ts < ttl) return held.promise;
  const promise = read();
  cache.set(key, { promise, ts: Date.now() });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

/**
 * Where a `did:web` keeps its document: `did:web:example.com` →
 * `https://example.com/.well-known/did.json`. A port arrives percent-encoded
 * (`did:web:localhost%3A2583`). Further `:` segments would be a path, which
 * atproto doesn't use for accounts, so those are refused rather than guessed
 * at. `null` for anything that isn't a usable `did:web`.
 */
export function didWebDocumentUrl(did) {
  const m = /^did:web:([^:/?#]+)$/.exec(String(did || ''));
  if (!m) return null;
  const host = m[1].replace(/%3A/gi, ':');
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return null;
  return `https://${host}/.well-known/did.json`;
}

/**
 * The DID document for a `did:plc` or a `did:web`, through the same cache.
 * A `did:web` is read from its own host, which from a browser also needs
 * that host to allow cross-origin reads of the file.
 */
export async function getDidDocument(did) {
  if (!did) throw new Error('getDidDocument: missing did');
  const url = String(did).startsWith('did:web:')
    ? didWebDocumentUrl(did)
    : `${PLC_DIRECTORY}/${encodeURIComponent(did)}`;
  if (!url) throw new Error(`Unsupported did:web identifier ${did}`);
  return cachedRead(_didDocCache, did, DID_DOC_TTL, () => fetchJson(url));
}

/** AppView: `app.bsky.actor.getProfile`. */
export async function getProfile(actor, { appview = APPVIEW } = {}) {
  return fetchJson(
    `${appview}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`,
  );
}

/**
 * AppView: `app.bsky.actor.getProfiles`, for many actors at once. Returns
 * `{ did: { handle, displayName, avatar } }`. The endpoint takes 25 per call,
 * so a long list is chunked; a chunk that fails twice is skipped rather than
 * failing the lot.
 *
 * A DID that resolves to nothing is simply absent. A deactivated account and
 * an account we failed to reach look the same from here, and neither should
 * be invented.
 */
export async function resolveProfiles(dids, { appview = APPVIEW } = {}) {
  const unique = Array.from(new Set((dids || []).filter(Boolean)));
  const out = {};
  for (let i = 0; i < unique.length; i += 25) {
    const params = new URLSearchParams();
    for (const did of unique.slice(i, i + 25)) params.append('actors', did);
    const url = `${appview}/xrpc/app.bsky.actor.getProfiles?${params}`;
    try {
      // Tried twice: sequential and small, a second ask rather than a loop.
      const res = await fetchJson(url).catch(async (err) => {
        await new Promise((r) => setTimeout(r, 400));
        return fetchJson(url).catch(() => {
          throw err;
        });
      });
      for (const p of res?.profiles || []) {
        if (!p?.did) continue;
        out[p.did] = {
          handle: p.handle || '',
          displayName: p.displayName || '',
          avatar: p.avatar || '',
        };
      }
    } catch {
      /* leave this chunk unresolved */
    }
  }
  return out;
}

/** Extract the rkey from an `at://did/collection/rkey` URI. */
export function rkeyFromAtUri(atUri) {
  if (!atUri) return null;
  const m = String(atUri).match(/^at:\/\/[^/]+\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : null;
}

// The base32-sortable alphabet atproto TIDs are encoded with.
const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';

/**
 * Recover the timestamp embedded in a TID record key.
 *
 * A TID is a 13-char base32-sortable string whose bits are
 * `0 | 53-bit microseconds-since-epoch | 10-bit clock id`, so the key alone
 * pins when the record was minted. That is how a follow or a block is dated
 * here without reading the record. Returns an ISO string, or `null` when
 * `rkey` isn't a well-formed TID (custom, human-chosen rkeys aren't).
 */
export function tidToTimestamp(rkey) {
  const s = String(rkey || '');
  if (s.length !== 13) return null;
  let n = 0n;
  for (const ch of s) {
    const i = TID_ALPHABET.indexOf(ch);
    if (i < 0) return null; // not a TID: bail rather than decode garbage
    n = n * 32n + BigInt(i);
  }
  const ms = Number((n >> 10n) / 1000n); // drop the clock id, µs → ms
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * A did:plc's operation log from the PLC directory, oldest first: every
 * handle and PDS it has had, and when it changed. `null` for a did:web
 * (which keeps no history) or when the directory can't be reached.
 *
 * @returns {Promise<Array<{at: string, handles: string[], pds: string|null, nullified: boolean}>|null>}
 */
export async function getPlcHistory(did) {
  if (!String(did || '').startsWith('did:plc:')) return null;
  try {
    const res = await fetchWithTimeout(`${PLC_DIRECTORY}/${did}/log/audit`, {}, 15_000);
    if (!res.ok) return null;
    const log = await res.json();
    if (!Array.isArray(log)) return null;
    return log.map((entry) => {
      const op = entry?.operation || {};
      const handles = (op.alsoKnownAs || (op.handle ? [`at://${op.handle}`] : []))
        .map((aka) => String(aka).replace(/^at:\/\//, ''))
        .filter(Boolean);
      const pds = op.services?.atproto_pds?.endpoint || op.service || null;
      return { at: entry?.createdAt || null, handles, pds, nullified: Boolean(entry?.nullified), type: op.type || null };
    });
  } catch {
    return null;
  }
}
