// The Posted page's logic outside React: which rows a filter and a search
// keep, reading a post again before acting on it (DESIGN D13: every row
// action works from the post as it is now, not from the archive's copy),
// reading its reply and quote settings, and deleting it.

import { composerTextFromRecord } from '../lib/inlineLinks.js';
import { gatesFromRules } from '../lib/gates.js';
import { getPosts } from '../library/sources.js';

export const POSTED_FILTERS = Object.freeze([
  { value: 'all', label: 'All' },
  { value: 'posts', label: 'Posts' },
  { value: 'replies', label: 'Replies' },
  { value: 'media', label: 'With media' },
]);

const POST = 'app.bsky.feed.post';
const THREADGATE = 'app.bsky.feed.threadgate';
const POSTGATE = 'app.bsky.feed.postgate';

/** Whether an archive row answers somebody else (not a post of its own thread). */
export function isReplyRow(row, did) {
  return Boolean(row?.replyTo) && row.replyTo !== did;
}

/**
 * The rows a filter and a search keep, in the order given. The search reads
 * the words the row keeps (the archive holds the first 200 characters).
 */
export function filterPostRows(rows, { did, filter = 'all', query = '' } = {}) {
  const needle = String(query || '')
    .trim()
    .toLowerCase();
  return (rows || []).filter((row) => {
    if (!row?.uri) return false;
    if (filter === 'posts' && isReplyRow(row, did)) return false;
    if (filter === 'replies' && !isReplyRow(row, did)) return false;
    if (filter === 'media' && !row.hasMedia) return false;
    if (needle && !String(row.text || '').toLowerCase().includes(needle)) return false;
    return true;
  });
}

function rkeyOf(uri) {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/.exec(String(uri || ''));
  return m ? { repo: m[1], rkey: m[2] } : null;
}

/**
 * The post at `uri` as it is now: `{ uri, cid, record, view }`, from the
 * public AppView, else from the account's repo (`view` is then null). A post
 * that is in neither throws with `code: 'GONE'`; one that couldn't be read
 * throws the read's error.
 */
export async function readPostNow(uri, { agent, fetch } = {}) {
  let firstError = null;
  try {
    const { views, failed, error } = await getPosts([uri], { fetch });
    const view = views.find((v) => v?.uri === uri);
    if (view?.cid) return { uri, cid: view.cid, record: view.record || {}, view };
    if (failed) firstError = error;
  } catch (err) {
    firstError = err;
  }
  const at = rkeyOf(uri);
  if (!at || !agent) throw firstError || gone();
  try {
    const res = await agent.com.atproto.repo.getRecord({ repo: at.repo, collection: POST, rkey: at.rkey });
    const data = res?.data || {};
    if (!data.cid) throw gone();
    return { uri, cid: data.cid, record: data.value || {}, view: null };
  } catch (err) {
    if (err?.code === 'GONE' || isNotFound(err)) throw gone();
    throw firstError || err;
  }
}

function gone() {
  const err = new Error('This post isn’t there any more. It may have been deleted somewhere else.');
  err.code = 'GONE';
  return err;
}

const isNotFound = (err) =>
  err?.error === 'RecordNotFound' ||
  err?.status === 404 ||
  /RecordNotFound|could not locate record|not found/i.test(String(err?.message || ''));

/**
 * Who may reply to and quote the post now, from its threadgate and postgate
 * records: `{ reply, quotes }` (reply null is everyone).
 */
export async function readPostGates(uri, { agent }) {
  const at = rkeyOf(uri);
  if (!at) throw new Error('Not a post.');
  const read = async (collection) => {
    try {
      const res = await agent.com.atproto.repo.getRecord({ repo: at.repo, collection, rkey: at.rkey });
      return res?.data?.value || null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  };
  const [threadgate, postgate] = await Promise.all([read(THREADGATE), read(POSTGATE)]);
  return gatesFromRules({
    allow: threadgate ? (Array.isArray(threadgate.allow) ? threadgate.allow : undefined) : undefined,
    embeddingRules: postgate?.embeddingRules,
  });
}

/**
 * Delete the post, then its reply and quote settings (best effort: a gate
 * left behind gates nothing). A post that's already gone counts as deleted.
 */
export async function deletePost(uri, { agent }) {
  const at = rkeyOf(uri);
  if (!at) throw new Error('Not a post.');
  try {
    await agent.com.atproto.repo.deleteRecord({ repo: at.repo, collection: POST, rkey: at.rkey });
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  await Promise.all(
    [THREADGATE, POSTGATE].map((collection) =>
      agent.com.atproto.repo.deleteRecord({ repo: at.repo, collection, rkey: at.rkey }).catch(() => null),
    ),
  );
}

/** The post's text as the composer writes it, with its links put back. */
export function textForComposer(record) {
  return composerTextFromRecord(String(record?.text || ''), record?.facets || []);
}

/**
 * What "Save as a template" starts the editor with: the post's text, and
 * what it quotes or links to when that's something a template can carry (a
 * record or a link card; pictures can't be kept in a template).
 */
export function templateSeedFrom(record) {
  const embed = record?.embed || null;
  let seedEmbed = null;
  if (embed?.$type === 'app.bsky.embed.record' && embed.record?.uri && embed.record?.cid) {
    seedEmbed = { $type: 'app.bsky.embed.record', record: { uri: embed.record.uri, cid: embed.record.cid } };
  } else if (embed?.$type === 'app.bsky.embed.recordWithMedia' && embed.record?.record?.uri) {
    seedEmbed = {
      $type: 'app.bsky.embed.record',
      record: { uri: embed.record.record.uri, cid: embed.record.record.cid },
    };
  } else if (embed?.$type === 'app.bsky.embed.external' && embed.external?.uri) {
    seedEmbed = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: embed.external.uri,
        title: String(embed.external.title || ''),
        description: String(embed.external.description || ''),
      },
    };
  }
  return { text: textForComposer(record), embed: seedEmbed };
}

/** What a post row offers, given the account's capabilities. */
export function postRowActions(row, { did, canPost, canSchedule }) {
  const reply = isReplyRow(row, did);
  return {
    reply: canPost,
    quote: canPost,
    copy: canPost,
    gates: canPost,
    // Replies take no threadgate: only quoting can be changed on one.
    gatesQuotesOnly: reply,
    timer: canSchedule,
    template: true,
    delete: canPost,
  };
}
