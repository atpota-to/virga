// Who a typed handle belongs to and where they sign in, looked up before the
// browser leaves, so the sign-in can ask "Is this you?" and name the host the
// reader is about to visit. A handle nobody can resolve stops here, in words,
// instead of failing on someone else's page. Everything after that first
// answer is best-effort: an account with no picture, or a host that can't be
// named, still signs in.
//
// The lookups are public reads and need no session: the profile and the
// handle from Bluesky's public API, the DID document from the PLC directory
// (or the did:web's own host), and the host's own sign-in metadata.

import { APPVIEW } from '../config.js';
import { fetchWithTimeout, getDidDocument as fetchDidDocument } from '../lib/atproto.js';
import { pdsFromDidDocument } from '../session/pds.js';

const PROFILE_TIMEOUT_MS = 8_000;
const HANDLE_TIMEOUT_MS = 8_000;
const HOST_TIMEOUT_MS = 3_000;

// Zero-width characters and direction marks: they ride along when a handle is
// copied from a web page, and no server knows the handle with them in it.
const INVISIBLE = /[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g;

/** A handle (or DID) that resolves to no account at all. */
export class IdentityNotFoundError extends Error {
  constructor(input) {
    super(`No account found for ${input}`);
    this.name = 'IdentityNotFoundError';
    this.input = input;
  }
}

/** The lookup itself failed (offline, a service down): the handle may be fine. */
export class IdentityLookupError extends Error {
  constructor(input, cause) {
    super(`Could not look up ${input}`);
    this.name = 'IdentityLookupError';
    this.input = input;
    this.cause = cause;
  }
}

/** What typing leaves in the field: the invisible characters taken out, nothing else changed. */
export function cleanTyped(raw) {
  return String(raw ?? '').replace(INVISIBLE, '');
}

/**
 * What the reader typed, as a sign-in can use it: invisible characters out,
 * trimmed, lower case, a leading @ dropped, and a pasted bsky.app profile
 * link reduced to the handle (or DID) in it. Any other address passes through
 * as typed: a sign-in takes a host's address too.
 */
export function normalizeSignInInput(raw) {
  let value = cleanTyped(raw).normalize('NFKC').trim();
  if (!value) return '';
  const profileLink = /^https?:\/\/(?:www\.)?bsky\.app\/profile\/([^/?#\s]+)/i.exec(value);
  if (profileLink) {
    try {
      value = decodeURIComponent(profileLink[1]);
    } catch {
      value = profileLink[1];
    }
  }
  if (/^https?:\/\//i.test(value)) return value;
  value = value.replace(/^@+/, '');
  // A DID's method is lower case already, and what follows it is not ours to change.
  return value.startsWith('did:') ? value : value.toLowerCase();
}

/** 'url' (a host's address), 'did', 'handle', or 'empty'. */
export function classifySignInInput(value) {
  if (!value) return 'empty';
  if (/^https?:\/\//i.test(value)) return 'url';
  if (value.startsWith('did:')) return 'did';
  return 'handle';
}

/** The host name in an address, or null. */
export function hostnameOf(url) {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * The name a reader knows a PDS by. Bluesky's own PDSes
 * (…host.bsky.network) sit behind bsky.social, which is the page their
 * accounts sign in on.
 */
export function hostLabelForPds(pdsUrl) {
  const host = hostnameOf(pdsUrl);
  if (!host) return null;
  if (host === 'bsky.network' || host.endsWith('.bsky.network')) return 'bsky.social';
  return host;
}

/** The handle a DID document claims (`alsoKnownAs: ['at://handle']`), or null. */
export function handleFromDidDocument(doc) {
  const names = Array.isArray(doc?.alsoKnownAs) ? doc.alsoKnownAs : [];
  for (const name of names) {
    const match = /^at:\/\/([a-z0-9.-]+)$/i.exec(String(name));
    if (match && match[1].includes('.')) return match[1].toLowerCase();
  }
  return null;
}

const aborted = (signal) => Boolean(signal?.aborted);
const abortError = () => new DOMException('The lookup was cancelled', 'AbortError');

/**
 * The lookups, over whatever does the fetching. `fetch(url, init, ms)` is
 * fetchWithTimeout's shape; tests pass their own.
 */
export function createIdentityResolver({ fetch = fetchWithTimeout, getDidDocument = fetchDidDocument, appview = APPVIEW } = {}) {
  /** `{ status, body }` for a JSON read; throws when the request itself fails. */
  async function read(url, signal, ms) {
    const res = await fetch(url, { signal }, ms);
    const body = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body };
  }

  /**
   * Where an account signs in: `{ host, pds }`. `host` is the name of the
   * page it will approve Virga on (its PDS's authorization server when the
   * PDS names one, else the PDS itself); either is null when it can't be
   * found. Never throws, except when the lookup was cancelled.
   */
  async function resolveSignInHost(did, { signal, document = null } = {}) {
    let pds = null;
    try {
      pds = pdsFromDidDocument(document || (await getDidDocument(did)), did);
    } catch {
      // No document to read; the sign-in itself will say if the account is gone.
    }
    if (aborted(signal)) throw abortError();
    if (!pds) return { host: null, pds: null };
    try {
      const { ok, body } = await read(new URL('/.well-known/oauth-protected-resource', pds).href, signal, HOST_TIMEOUT_MS);
      const server = ok && Array.isArray(body?.authorization_servers) ? body.authorization_servers[0] : null;
      const host = typeof server === 'string' ? hostnameOf(server) : null;
      if (host) return { host, pds };
    } catch {
      if (aborted(signal)) throw abortError();
      // A PDS that doesn't publish it still has a name.
    }
    return { host: hostLabelForPds(pds), pds };
  }

  /**
   * The account behind a handle or a DID: `{ did, handle, displayName,
   * avatar, host, pds }`. The public profile when there is one; otherwise the
   * handle is resolved on its own, since an account the AppView hasn't
   * indexed can still sign in.
   *
   * @throws {IdentityNotFoundError} nobody has that handle (or DID)
   * @throws {IdentityLookupError} the lookup couldn't be made
   * @throws an AbortError when `signal` fires
   */
  async function resolveSignInIdentity(input, { signal } = {}) {
    let identity = null;
    let profileFailure = null;
    try {
      const { ok, body } = await read(`${appview}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(input)}`, signal, PROFILE_TIMEOUT_MS);
      if (ok && typeof body?.did === 'string') {
        identity = {
          did: body.did,
          handle: body.handle && body.handle !== 'handle.invalid' ? body.handle : input.startsWith('did:') ? null : input,
          displayName: typeof body.displayName === 'string' ? body.displayName.trim() || null : null,
          avatar: body.avatar || null,
        };
      }
    } catch (error) {
      if (aborted(signal)) throw abortError();
      profileFailure = error;
    }

    let document = null;
    if (!identity && input.startsWith('did:')) {
      try {
        document = await getDidDocument(input);
      } catch (error) {
        if (aborted(signal)) throw abortError();
        // The directory answers 404 for a DID it has never heard of. Any
        // other failure says nothing about the DID.
        if (error?.status === 404 || error?.status === 410) throw new IdentityNotFoundError(input);
        throw new IdentityLookupError(input, error);
      }
      identity = { did: input, handle: handleFromDidDocument(document), displayName: null, avatar: null };
    }

    if (!identity) {
      let answer;
      try {
        answer = await read(`${appview}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(input)}`, signal, HANDLE_TIMEOUT_MS);
      } catch (error) {
        if (aborted(signal)) throw abortError();
        throw new IdentityLookupError(input, error);
      }
      if (answer.ok && typeof answer.body?.did === 'string') {
        identity = { did: answer.body.did, handle: input, displayName: null, avatar: null };
      } else if (answer.status >= 400 && answer.status < 500 && answer.status !== 429) {
        // An unknown handle is answered 400.
        throw new IdentityNotFoundError(input);
      } else {
        throw new IdentityLookupError(input, profileFailure || new Error(`HTTP ${answer.status}`));
      }
    }

    if (aborted(signal)) throw abortError();
    const where = await resolveSignInHost(identity.did, { signal, document });
    return { ...identity, ...where };
  }

  return { resolveSignInHost, resolveSignInIdentity };
}

const shared = createIdentityResolver();

export function resolveSignInHost(did, options) {
  return shared.resolveSignInHost(did, options);
}

export function resolveSignInIdentity(input, options) {
  return shared.resolveSignInIdentity(input, options);
}
