// Idempotent, retrying publish for PDS repo writes. A plain createRecord lets
// the server pick the rkey, so retrying a write that timed out after landing
// creates a duplicate post. Here the rkey is client-generated (one record per
// repo/collection/rkey, so a retry can't duplicate), and after any failure the
// PDS is asked whether the record already landed (a slow write can succeed
// after our timeout; a duplicate-rkey rejection means an earlier attempt won).
// If it landed, that counts as success.

import { nextTid } from './tid.js';

export const DEFAULT_TIMEOUT_MS = 30000;
const CHECK_TIMEOUT_MS = 15000;
export const DEFAULT_ATTEMPTS = 2;

/**
 * A failure that is the network's, not the request's: a socket error, a
 * timeout, a gateway that didn't answer.
 * @param {any} err
 * @returns {boolean}
 */
export function isTransientNetworkError(err) {
  if (!err) return false;
  const code = err.code || err.cause?.code || '';
  if (/^(UND_ERR_|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE)/i.test(code))
    return true;

  const status =
    typeof err.status === 'number'
      ? err.status
      : typeof err.statusCode === 'number'
        ? err.statusCode
        : undefined;
  if (status === 408 || status === 504) return true;

  const msg = (
    err.message ||
    err.cause?.message ||
    (typeof err === 'string' ? err : '') ||
    ''
  ).toLowerCase();
  return /und_err_|failed to fetch|load failed|network ?error|fetch failed|timed out|timeout|connection|econnreset|econnrefused|etimedout|enotfound|eai_again|gateway timeout|service unavailable|temporarily unavailable/.test(
    msg,
  );
}

/**
 * Only transient failures (timeout, network blip, 5xx, 429) are retried, which
 * is safe only because the write is idempotent by rkey. Other 4xx throw at once.
 *
 * @param {any} err
 * @returns {boolean}
 */
export function isRetriablePublishError(err) {
  if (!err) return false;
  if (err.timedOut) return true;
  const status =
    typeof err.status === 'number'
      ? err.status
      : typeof err.statusCode === 'number'
        ? err.statusCode
        : undefined;
  // Below 100 is not an HTTP status: @atproto/xrpc reports a fetch that threw
  // (no response at all) as ResponseType.Unknown, status 1, so it is read as
  // the network failure it is.
  if (status !== undefined && status >= 100)
    return status === 429 || status >= 500;
  return isTransientNetworkError(err);
}

// Race against a timeout that rejects with `.timedOut`. A later rejection of
// `promise` is still handled (it's a race input); the in-flight write is
// reconciled by the landed-check, not aborted.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(label), { timedOut: true })),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Run `doWrite(rkey)` with a bounded, idempotent retry.
 *
 * @param {object} agent - write agent exposing `com.atproto.repo.getRecord`
 * @param {(rkey: string) => Promise<any>} doWrite - performs the write for the
 *   given rkey; resolves to the write's `data` (ideally carrying `uri`)
 * @param {object} opts
 * @param {string} opts.repo
 * @param {string} opts.collection
 * @param {string} [opts.rkey] - fixed rkey to use (defaults to a fresh TID);
 *   pass one when the caller already built records around it (e.g. applyWrites
 *   with a threadgate/postgate sharing the post's rkey)
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.attempts]
 * @returns {Promise<any>} the write's data, or the landed record's data
 */
export async function publishWithIdempotentRetry(
  agent,
  doWrite,
  {
    repo,
    collection,
    rkey = nextTid(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    attempts = DEFAULT_ATTEMPTS,
  } = {},
) {
  // Any failure to confirm counts as "not landed"; safe, since re-writing the
  // same rkey can't duplicate.
  const fetchIfLanded = async () => {
    try {
      const res = await withTimeout(
        agent.com.atproto.repo.getRecord({ repo, collection, rkey }),
        CHECK_TIMEOUT_MS,
        'Record check timed out',
      );
      return res?.data?.uri ? res.data : null;
    } catch {
      return null;
    }
  };

  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await withTimeout(
        doWrite(rkey),
        timeoutMs,
        'Post creation timed out',
      );
    } catch (err) {
      // The write may have landed despite the error; if so, return it.
      const landed = await fetchIfLanded();
      if (landed) return landed;

      lastErr = err;
      if (isRetriablePublishError(err) && attempt < attempts - 1) continue;
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Idempotent drop-in for `agent.com.atproto.repo.createRecord({ repo,
 * collection, record })` on the publish path.
 *
 * @returns {Promise<any>} the created (or already-landed) record's data
 */
export function createRecordIdempotent(
  agent,
  { repo, collection, record },
  opts = {},
) {
  return publishWithIdempotentRetry(
    agent,
    async (rkey) => {
      const res = await agent.com.atproto.repo.createRecord({
        repo,
        collection,
        rkey,
        record,
      });
      return res?.data;
    },
    { repo, collection, ...opts },
  );
}

// `allow: []` is a real threadgate (nobody can reply); only null/undefined
// means no record. Don't change this to a `length > 0` check: that ships
// "nobody can reply" posts wide open.
export function needsThreadgateRecord(threadgateRules) {
  return Array.isArray(threadgateRules);
}

// An empty postgate embeddingRules imposes nothing, so only a non-empty set
// needs a record.
export function needsPostgateRecord(postgateRules) {
  return Array.isArray(postgateRules) && postgateRules.length > 0;
}

/**
 * Build the applyWrites#create entries for a post's threadgate/postgate. Gate
 * records share the post's rkey (the convention the AppView expects) and
 * reference it by at:// URI.
 *
 * @param {object} opts
 * @param {string} opts.did - repo the post publishes to
 * @param {string} opts.rkey - the post's rkey
 * @param {Array|null} opts.threadgateRules - allow rules; [] = nobody can reply
 * @param {Array|null} opts.postgateRules - embedding rules; only non-empty gates
 * @param {string} [opts.createdAt]
 * @returns {Array<object>} zero, one, or two applyWrites#create entries
 */
export function buildGateWrites({
  did,
  rkey,
  threadgateRules = null,
  postgateRules = null,
  createdAt = new Date().toISOString(),
}) {
  const writes = [];
  const postUri = `at://${did}/app.bsky.feed.post/${rkey}`;

  if (needsThreadgateRecord(threadgateRules)) {
    writes.push({
      $type: 'com.atproto.repo.applyWrites#create',
      collection: 'app.bsky.feed.threadgate',
      rkey,
      value: {
        $type: 'app.bsky.feed.threadgate',
        post: postUri,
        createdAt,
        allow: threadgateRules,
        hiddenReplies: [],
      },
    });
  }

  if (needsPostgateRecord(postgateRules)) {
    writes.push({
      $type: 'com.atproto.repo.applyWrites#create',
      collection: 'app.bsky.feed.postgate',
      rkey,
      value: {
        $type: 'app.bsky.feed.postgate',
        post: postUri,
        createdAt,
        detachedEmbeddingUris: [],
        embeddingRules: postgateRules,
      },
    });
  }

  return writes;
}

/**
 * Publish a post with its threadgate/postgate as one atomic applyWrites
 * (idempotent by shared client rkey), or a plain idempotent createRecord when
 * no gates are needed. The single primitive for every new top-level post path
 * (composer, quote modals, drafts), so gates can't go missing on one. Gates
 * apply only to top-level app.bsky.feed.post records (replies inherit the
 * root's gate), enforced here rather than per caller.
 *
 * @param {object} agent - write agent (active or publish-as scoped)
 * @param {object} opts
 * @param {string} opts.repo
 * @param {string} [opts.collection]
 * @param {object} opts.record - fully built post record (with $type)
 * @param {Array|null} [opts.threadgateRules] - [] = nobody can reply, null = everybody
 * @param {Array|null} [opts.postgateRules] - non-empty = restrict quoting
 * @returns {Promise<any>} the created (or already-landed) post's data
 */
export function createPostWithGates(
  agent,
  {
    repo,
    collection = 'app.bsky.feed.post',
    record,
    threadgateRules = null,
    postgateRules = null,
  },
  opts = {},
) {
  const gatesApply = collection === 'app.bsky.feed.post' && !record?.reply;
  const effectiveThreadgate = gatesApply ? threadgateRules : null;
  const effectivePostgate = gatesApply ? postgateRules : null;

  if (
    !needsThreadgateRecord(effectiveThreadgate) &&
    !needsPostgateRecord(effectivePostgate)
  ) {
    return createRecordIdempotent(agent, { repo, collection, record }, opts);
  }

  return publishWithIdempotentRetry(
    agent,
    async (rkey) => {
      const writes = [
        {
          $type: 'com.atproto.repo.applyWrites#create',
          collection,
          rkey,
          value: record,
        },
        ...buildGateWrites({
          did: repo,
          rkey,
          threadgateRules: effectiveThreadgate,
          postgateRules: effectivePostgate,
        }),
      ];
      const res = await agent.com.atproto.repo.applyWrites({
        repo,
        validate: true,
        writes,
      });
      // Normalize to the createRecord shape: the post is results[0]. If a PDS
      // omits it, throw so the landed-check fetches the real ref by rkey rather
      // than returning a ref-less commit envelope.
      const postResult = res?.data?.results?.[0];
      if (!postResult?.uri)
        throw new Error('applyWrites returned no create result for the post');
      return postResult;
    },
    { repo, collection, ...opts },
  );
}
