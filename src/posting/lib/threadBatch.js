// A whole thread as ONE atomic com.atproto.repo.applyWrites batch, as
// Bluesky's app does it. Every post gets a client TID, and each reply names
// its parent's locally computed CID (recordCid.js), so nothing has to come
// back from the server between posts. Client keys make the batch safe to
// retry (keyed on the first post's rkey: the batch is atomic, so if the first
// post landed, all did).

import { nextTid } from './tid.js';
import { computeRecordCid } from './recordCid.js';

/**
 * @param {object} opts
 * @param {string} opts.did - the repo the thread is written to
 * @param {string} [opts.collection]
 * @param {Array<object>} opts.records - base records in thread order, each
 *   carrying its $type (required for a correct CID) and no reply. A record's
 *   own `createdAt` is kept if it is later than the one before it; otherwise
 *   each gets `now` plus a millisecond per post.
 * @param {{ root: {uri: string, cid: string}, parent: {uri: string, cid: string} } | null} [opts.replyTo]
 *   when the thread's first post replies to an existing post
 * @param {Date|number} [opts.now]
 * @param {(ms?: number) => string} [opts.mintTid]
 * @returns {Promise<{ writes: Array<object>, created: Array<{uri: string, cid: string, rkey: string, record: object}> }>}
 */
export async function buildThreadWrites({
  did,
  collection = 'app.bsky.feed.post',
  records,
  replyTo = null,
  now = new Date(),
  mintTid = nextTid,
}) {
  const writes = [];
  const created = [];

  // Posts sharing a createdAt sort unpredictably, so timestamps and TIDs both
  // strictly increase.
  let lastMs = new Date(now).getTime();
  let first = true;

  // When the first post replies into an existing thread, the whole batch
  // shares that thread's root; otherwise the first post becomes the root.
  let rootRef = replyTo ? replyTo.root : null;
  let parentRef = replyTo ? replyTo.parent : null;

  for (const base of records) {
    const own = Date.parse(base?.createdAt);
    const hasOwn = Number.isFinite(own) && (first || own > lastMs);
    const ms = hasOwn ? own : first ? lastMs : lastMs + 1;
    lastMs = ms;
    first = false;

    const rkey = mintTid(ms);
    const uri = `at://${did}/${collection}/${rkey}`;
    const record = { ...base, createdAt: new Date(ms).toISOString() };
    delete record.reply;
    if (parentRef) record.reply = { root: rootRef, parent: parentRef };

    const cid = await computeRecordCid(record);

    writes.push({
      $type: 'com.atproto.repo.applyWrites#create',
      collection,
      rkey,
      value: record,
    });
    created.push({ uri, cid, rkey, record });

    const ref = { uri, cid };
    if (!rootRef) rootRef = ref;
    parentRef = ref;
  }

  return { writes, created };
}
