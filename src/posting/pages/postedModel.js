// The Posted page's logic outside React: which rows a filter and a search
// keep, reading a post again before acting on it (DESIGN D13: every row
// action works from the post as it is now, not from the archive's copy),
// reading its reply and quote settings, and deleting it.

import { blobCid } from '../lib/blobs.js';
import { composerTextFromRecord } from '../lib/inlineLinks.js';
import { gatesFromRules } from '../lib/gates.js';
import { normalizeTags } from '../lib/tags.js';
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

/* ---- posting it again -------------------------------------------------- */

const mimeOf = (blob) =>
  typeof blob?.mimeType === 'string' ? blob.mimeType : 'image/jpeg';

/** The pictures an embed carries, in order: `[{ cid, mime, alt }]`. */
function imagesOf(media) {
  const list =
    media?.$type === 'app.bsky.embed.images'
      ? media.images
      : media?.$type === 'app.bsky.embed.gallery'
        ? media.items
        : [];
  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      cid: blobCid(item?.image),
      mime: mimeOf(item?.image),
      alt: typeof item?.alt === 'string' ? item.alt : '',
    }))
    .filter((image) => image.cid);
}

/**
 * What "Post again" takes from a post as it reads now: its words with their
 * links put back, its tags and languages, what it quotes, its link card, and
 * its pictures by CID (fetchPostImages reads them back from the repo).
 * `video` and `labelled` say what can't come along as it is: a video isn't
 * fetched back, and a post with a content warning doesn't bring its pictures
 * without it.
 */
export function postAgainSeed(record) {
  const embed = record?.embed || null;
  const withMedia = embed?.$type === 'app.bsky.embed.recordWithMedia';
  const media = withMedia ? embed.media : embed;
  const quoted = withMedia
    ? embed.record?.record?.uri
    : embed?.$type === 'app.bsky.embed.record'
      ? embed.record?.uri
      : null;
  const external =
    media?.$type === 'app.bsky.embed.external' ? media.external : null;
  return {
    text: textForComposer(record),
    tags: normalizeTags(record?.tags),
    langs: Array.isArray(record?.langs)
      ? record.langs.filter((l) => typeof l === 'string' && l)
      : [],
    quote: typeof quoted === 'string' && quoted ? quoted : null,
    link: external?.uri
      ? {
          url: external.uri,
          title: String(external.title || ''),
          description: String(external.description || ''),
        }
      : null,
    images: imagesOf(media),
    video: media?.$type === 'app.bsky.embed.video',
    labelled:
      Array.isArray(record?.labels?.values) && record.labels.values.length > 0,
  };
}

/**
 * Read a post's pictures back from the account's own repo (the PDS's public
 * `com.atproto.sync.getBlob`), as files the composer can attach:
 * `{ files: [{ file, alt }], missing }`. A picture that can't be read is
 * counted, not thrown: the post still opens, and the writer adds it again.
 */
export async function fetchPostImages(
  images,
  { did, pdsUrl, fetch = globalThis.fetch } = {},
) {
  const files = [];
  let missing = 0;
  for (const [n, image] of (images || []).entries()) {
    try {
      if (!pdsUrl || typeof fetch !== 'function') throw new Error('no PDS');
      const url = `${String(pdsUrl).replace(/\/+$/, '')}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(image.cid)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.size) throw new Error('empty');
      const type = blob.type?.startsWith('image/') ? blob.type : image.mime;
      const ext = type.split('/')[1]?.split('+')[0] || 'jpg';
      files.push({
        file: new File([blob], `posted-image-${n + 1}.${ext}`, { type }),
        alt: image.alt,
      });
    } catch {
      missing += 1;
    }
  }
  return { files, missing };
}

/**
 * The composer intent for "Post again", and what to tell the writer about
 * anything that didn't come along: `{ intent, notes }`. `intent` is null
 * when there is nothing to open with (a post that was only pictures, none of
 * which could be read). The new post goes out with the account's usual reply
 * settings and no timer, as any new post does, and never as a reply.
 *
 * @param {object} seed - postAgainSeed's
 * @param {{ did: string, files?: Array<{ file: Blob, alt: string }>, missing?: number }} options
 */
export function postAgainIntent(seed, { did, files = [], missing = 0 } = {}) {
  const notes = [];
  const pictures = seed.labelled ? [] : files;
  if (seed.labelled && seed.images.length) {
    notes.push(
      'It had a content warning, so its pictures weren’t brought over. Add them again and set the warning.',
    );
  } else if (missing > 0) {
    notes.push(
      `${missing === 1 ? 'One of its pictures' : `${missing} of its pictures`} couldn’t be fetched. Add ${missing === 1 ? 'it' : 'them'} again.`,
    );
  }
  if (seed.video) notes.push('Its video isn’t carried over. Add it again.');

  const intent = { asDid: did, text: seed.text };
  if (seed.tags.length) intent.tags = seed.tags;
  if (seed.langs.length) intent.langs = seed.langs;
  if (seed.quote) intent.quote = { uri: seed.quote };
  if (pictures.length) intent.images = pictures;
  // A post holds pictures or a link card, not both; the original had one.
  else if (seed.link) intent.attach = { attach: { kind: 'link', ...seed.link } };

  const brings =
    seed.text.trim() ||
    seed.tags.length ||
    seed.quote ||
    pictures.length ||
    seed.link;
  return { intent: brings ? intent : null, notes };
}

/** What a post row offers, given the account's capabilities. */
export function postRowActions(row, { canPost, canSchedule }) {
  return {
    reply: canPost,
    quote: canPost,
    again: canPost,
    gates: canPost,
    // Replies take no threadgate: only quoting can be changed on one. That
    // holds for a reply in a thread of the account's own too, which
    // isReplyRow files with posts (`replyTo` is then the account itself).
    gatesQuotesOnly: Boolean(row?.replyTo),
    timer: canSchedule,
    template: true,
    delete: canPost,
  };
}

/**
 * Whether only quoting can be changed on the post: true for any reply, its
 * own thread's included. A threadgate belongs at the thread's root (its rkey
 * has to match the root's), so one written at a reply's rkey gates nothing.
 * `record` is the post as it reads now (readPostNow).
 */
export function gatesQuotesOnlyFor(offer, record) {
  return Boolean(offer?.gatesQuotesOnly || record?.reply);
}
