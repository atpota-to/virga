// What a scheduled reply answers: the two strong refs it carries, checked
// before they are stored, and a look at whether the post it replies to is
// still there before the worker writes it.
//
//   payload.reply   = { root: { uri, cid }, parent: { uri, cid } }
//   payload.replyTo = { handle, displayName, text }   // for the Scheduled page
//
// `reply` is what goes into the record. `replyTo` is only what the writer saw
// when they scheduled it (who, and the start of what was said), so the list
// can say what a row answers without a read per row. It is never written to
// the repo.
//
// The worker posts hours or weeks after the reply was written, with nobody
// watching, so it asks the parent's own PDS whether the record still exists
// first. A reply to a deleted post is an orphan in the author's feed that
// they didn't mean to publish.

import { resolvePdsEndpoint } from '../net/didResolver.js';
import { readXrpcErrorBody, safeFetch } from '../net/safeFetch.js';

/** Network seams, so tests can stand in for DID resolution and the PDS. */
export const deps = {
  resolvePdsEndpoint: (did) => resolvePdsEndpoint(did),
  safeFetch,
  readXrpcErrorBody,
};

const POST_COLLECTION = 'app.bsky.feed.post';

// The DID syntax from the atproto spec, and the two methods it blesses. A
// strong ref always names its repo by DID: a handle can change hands.
// (did:web is a bare host here, as the DID resolver reads it.)
const DID_RE = /^did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9.%-]{1,253})$/;
// A record key: 1 to 512 of these characters, and not "." or "..".
const RKEY_RE = /^[A-Za-z0-9._:~-]{1,512}$/;
// A CID as atproto writes one: version 1, base32 (the leading "b"). A
// sha-256 one is 59 characters; the range leaves room for another hash.
const CID_RE = /^b[a-z2-7]{58,120}$/;

/** `{ did, rkey }` for a well-formed at:// URI of a post, else null. */
export function parsePostUri(uri) {
  if (typeof uri !== 'string' || uri.length > 700) return null;
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(uri);
  if (!m) return null;
  const [, did, collection, rkey] = m;
  if (!DID_RE.test(did) || collection !== POST_COLLECTION) return null;
  if (!RKEY_RE.test(rkey) || rkey === '.' || rkey === '..') return null;
  return { did, rkey };
}

export function isCid(value) {
  return typeof value === 'string' && CID_RE.test(value);
}

function readRef(raw, name) {
  if (!raw || typeof raw !== 'object')
    return { error: `reply.${name} needs a uri and a cid` };
  if (!parsePostUri(raw.uri))
    return { error: `reply.${name}.uri must be the at:// address of a post` };
  if (!isCid(raw.cid)) return { error: `reply.${name}.cid must be a CID` };
  return { value: { uri: raw.uri, cid: raw.cid } };
}

/**
 * Normalize the `payload.reply` a create or an edit may carry. Answers
 * `{ value }` (null when the post isn't a reply) or `{ error }`. Both refs
 * are written verbatim into the record at publish time, so their shape is
 * checked here rather than trusted: a malformed one would only be refused by
 * the PDS hours later, when nobody is there to fix it.
 */
export function validateReply(raw) {
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw !== 'object' || Array.isArray(raw))
    return { error: 'reply must be an object' };
  const root = readRef(raw.root, 'root');
  if (root.error) return root;
  const parent = readRef(raw.parent, 'parent');
  if (parent.error) return parent;
  // One post can't be two versions of itself.
  if (root.value.uri === parent.value.uri && root.value.cid !== parent.value.cid) {
    return {
      error: 'reply.root and reply.parent name the same post with different cids',
    };
  }
  return { value: { root: root.value, parent: parent.value } };
}

const clip = (value, max) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/**
 * The `payload.replyTo` note as plain, bounded strings, or null when it says
 * nothing. It is shown, never acted on, so anything unreadable is dropped
 * rather than refused.
 */
export function normalizeReplyHint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hint = {
    handle: clip(raw.handle, 253),
    displayName: clip(raw.displayName, 128),
    text: clip(raw.text, 300),
  };
  return hint.handle || hint.displayName || hint.text ? hint : null;
}

// ─── Is the parent still there? ─────────────────────────────────────────────

export const PROBE_TIMEOUT_MS = 10_000;

// What a PDS calls a repo it will not serve from. The record may exist on
// disk, but nobody can see the post, so a reply to it is as orphaned as one
// to a deleted post.
const ACCOUNT_UNAVAILABLE = new Set([
  'RepoNotFound',
  'RepoTakendown',
  'RepoDeactivated',
  'RepoSuspended',
]);

export const PARENT_GONE_ERROR =
  'the post this replies to has been deleted, so the reply was not posted.';
export const PARENT_ACCOUNT_GONE_ERROR =
  'the account this replies to is no longer available, so the reply was not posted.';
export const PARENT_UNCHECKED_ERROR =
  "couldn't check that the post this replies to is still there, so the reply was held back.";

/**
 * Ask the parent's own PDS whether the post a reply answers still exists.
 *
 * Answers `{ state }`:
 *   'there'    the PDS returned the record
 *   'gone'     the PDS says there is no such record, or it no longer serves
 *              the account (`reason`: 'post' | 'account')
 *   'unknown'  it couldn't be found out: the DID didn't resolve, the PDS
 *              didn't answer, or it answered something else (`detail`)
 *
 * Only the repo's own answer counts as gone. A timeout, a rate limit or a
 * 5xx says nothing about the post, and the caller retries rather than
 * posting blind or giving up on a reply that is still wanted.
 */
export async function probeReplyParent(uri) {
  const at = parsePostUri(uri);
  if (!at) return { state: 'unknown', detail: 'not a post address' };

  let pdsEndpoint;
  try {
    ({ pdsEndpoint } = (await deps.resolvePdsEndpoint(at.did)) || {});
  } catch (err) {
    // The PLC directory answers 404 for a DID it never held and 410 for one
    // that was tombstoned: the account is gone, and its posts with it.
    if (
      at.did.startsWith('did:plc:') &&
      (err?.status === 404 || err?.status === 410)
    ) {
      return { state: 'gone', reason: 'account' };
    }
    return { state: 'unknown', detail: String(err?.message || err) };
  }
  if (!pdsEndpoint) return { state: 'unknown', detail: 'no PDS endpoint' };

  try {
    const url = new URL(
      `${String(pdsEndpoint).replace(/\/+$/, '')}/xrpc/com.atproto.repo.getRecord`,
    );
    url.searchParams.set('repo', at.did);
    url.searchParams.set('collection', POST_COLLECTION);
    url.searchParams.set('rkey', at.rkey);
    const res = await deps.safeFetch(url.toString(), {
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (res.ok) {
      // Only the status was wanted; let the connection go.
      try {
        await res.body?.cancel();
      } catch {
        // Nothing to release.
      }
      return { state: 'there' };
    }
    // The PDS is somebody else's and may be hostile: read at most a small,
    // capped error body.
    const kind = (await deps.readXrpcErrorBody(res))?.error || '';
    if (kind === 'RecordNotFound') return { state: 'gone', reason: 'post' };
    if (ACCOUNT_UNAVAILABLE.has(kind))
      return { state: 'gone', reason: 'account' };
    return {
      state: 'unknown',
      detail: `HTTP ${res.status}${kind ? ` ${kind}` : ''}`,
    };
  } catch (err) {
    return { state: 'unknown', detail: String(err?.message || err) };
  }
}
