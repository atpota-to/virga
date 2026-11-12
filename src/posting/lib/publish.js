// Publishing: the composer's state to records in the write account's repo.
//
// Order: the text pipeline starts first (mentions resolve over the network)
// and is parked while media uploads; then the records are built and written
// in one go. A single post is one createRecord, or one applyWrites when it
// carries a threadgate or postgate; a thread is one applyWrites holding every
// post, the root's threadgate and a postgate per post, its replies chained
// through locally computed CIDs. Every write uses a client-chosen key and is
// retried idempotently (publishRecord.js), and nothing is ever rolled back:
// applyWrites is atomic, and blobs no record names are collected by the PDS.
//
// Everything is done as `target` — uploads, video, card thumbnails, the
// writes — and a blob uploaded as another account is uploaded again, because
// a record can only name blobs in its own repo.

import {
  validateComposer,
  resolvePostTexts,
  labelsToSelfLabels,
} from './composerModel.js';
import { buildPostEmbed } from './embeds.js';
import { uploadImage } from './images.js';
import { uploadCardThumb } from './linkCard.js';
import {
  uploadVideo as defaultUploadVideo,
  isUsableVideoBlob,
} from './video.js';
import { blobCid } from './blobs.js';
import { gatesToRules } from './gates.js';
import { normalizeTags } from './tags.js';
import { mapWithConcurrency } from './asyncPool.js';
import { buildThreadWrites } from './threadBatch.js';
import {
  buildGateWrites,
  createPostWithGates,
  publishWithIdempotentRetry,
} from './publishRecord.js';

const POST = 'app.bsky.feed.post';
export const IMAGE_UPLOAD_CONCURRENCY = 4;
export const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

/** A publish that didn't happen, with a code the composer can act on. */
export class PublishError extends Error {
  constructor(code, message, { problems, cause, status } = {}) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
    if (problems) this.problems = problems;
    if (cause) this.cause = cause;
    if (status) this.status = status;
  }
}

// Duplicate guard

const fingerprintFile = (file) =>
  file
    ? `${file.name || ''}:${file.size ?? ''}:${file.lastModified ?? ''}`
    : '';

/**
 * What makes two publishes the same post: the account, the reply target, and
 * each post's text and attachments.
 */
export function publishSignature(state, did) {
  return JSON.stringify({
    did,
    reply: state?.reply?.uri || null,
    posts: (state?.posts || []).map((p) => ({
      text: (p.text || '').trim(),
      images: (p.images || []).map(
        (i) =>
          `${fingerprintFile(i.file) || blobCid(i.blob) || ''}|${i.alt || ''}`,
      ),
      video: p.video
        ? fingerprintFile(p.video.file) || blobCid(p.video.blob) || 'video'
        : null,
      record: p.record?.uri || null,
      card: p.card?.url || null,
    })),
  });
}

/**
 * Refuses the same post twice within a window. Only a publish that went out
 * is remembered, so a failed one can be retried at once.
 * @param {{ windowMs?: number, now?: () => number }} [options]
 */
export function createDuplicateGuard({
  windowMs = DUPLICATE_WINDOW_MS,
  now = () => Date.now(),
} = {}) {
  let last = null;
  return {
    isDuplicate(signature) {
      return (
        !!last && last.signature === signature && now() - last.at < windowMs
      );
    },
    remember(signature) {
      last = { signature, at: now() };
    },
    clear() {
      last = null;
    },
  };
}

/** The page's guard, used when a caller doesn't bring its own. */
export const defaultDuplicateGuard = createDuplicateGuard();

// Records

function replyRefs(reply) {
  if (!reply?.uri || !reply.cid) return null;
  const parent = { uri: reply.uri, cid: reply.cid };
  const root =
    reply.root?.uri && reply.root?.cid
      ? { uri: reply.root.uri, cid: reply.root.cid }
      : parent;
  return { root, parent };
}

/**
 * The post records for `state`, over blobs already uploaded as the write
 * account. Tags and labels go on every post. `createdAt` is `now`, one
 * millisecond later for each post after the first. Only the first post
 * carries `reply` (when the composer replies); a thread's later posts get
 * theirs when the batch is built, since they name CIDs computed there.
 *
 * @param {object} state - a ComposerState
 * @param {{ now?: Date|number, blobs?: Array<{ images?: object[], video?: object|null, cardThumb?: object|null }>, texts: Array<{ text: string, facets: object[] }> }} options
 * @returns {object[]}
 */
export function buildPostRecords(
  state,
  { now = new Date(), blobs = [], texts },
) {
  const start = new Date(now).getTime();
  const tags = normalizeTags(state.tags);
  const labels = labelsToSelfLabels(state.labels);
  const langs = Array.isArray(state.langs) ? state.langs.filter(Boolean) : [];
  const reply = replyRefs(state.reply);

  return state.posts.map((post, i) => {
    const { text, facets } = texts[i] || {
      text: (post.text || '').trim(),
      facets: [],
    };
    const record = { $type: POST, text };
    if (facets?.length) record.facets = facets;
    const embed = buildPostEmbed(post, blobs[i] || {});
    if (embed) record.embed = embed;
    if (langs.length) record.langs = langs;
    if (labels) record.labels = labels;
    if (tags.length) record.tags = tags;
    if (i === 0 && reply) record.reply = reply;
    record.createdAt = new Date(start + i).toISOString();
    return record;
  });
}

// Uploads

const isAbort = (err, signal) =>
  signal?.aborted || err?.name === 'AbortError' || err?.canceled;

function uploadFailure(err, what) {
  return new PublishError(
    'UPLOAD_FAILED',
    err?.message ? `${what}: ${err.message}` : what,
    { cause: err },
  );
}

async function uploadMedia(state, target, options) {
  const { signal, onProgress, fetch, compress, decode, uploadVideo } = options;
  const report = (event) => {
    try {
      onProgress?.(event);
    } catch {
      // A progress listener never stops a publish.
    }
  };
  const blobs = state.posts.map(() => ({
    images: [],
    video: null,
    cardThumb: null,
  }));
  const warnings = [];

  const images = state.posts.flatMap((post, postIndex) =>
    post.images.map((image, imageIndex) => ({
      post,
      postIndex,
      image,
      imageIndex,
    })),
  );
  let done = 0;
  if (images.length)
    report({ phase: 'uploading', kind: 'images', done, total: images.length });
  await mapWithConcurrency(
    images,
    IMAGE_UPLOAD_CONCURRENCY,
    async ({ postIndex, image, imageIndex }) => {
      let blob;
      if (image.blob && image.blobDid === target.did) {
        blob = image.blob;
      } else if (image.file) {
        try {
          blob = await uploadImage(
            target,
            { file: image.file, mime: image.mime },
            { signal },
          );
        } catch (err) {
          if (isAbort(err, signal)) throw err;
          throw uploadFailure(err, 'An image couldn’t be uploaded');
        }
        report({
          phase: 'uploaded',
          kind: 'image',
          postIndex,
          id: image.id,
          blob,
          blobDid: target.did,
        });
      } else {
        throw new PublishError(
          'MEDIA_MISSING',
          'An image needs to be added again before this can be posted.',
        );
      }
      blobs[postIndex].images[imageIndex] = blob;
      done += 1;
      report({
        phase: 'uploading',
        kind: 'images',
        done,
        total: images.length,
      });
    },
  );

  for (const [postIndex, post] of state.posts.entries()) {
    const { video, card } = post;
    if (video) {
      if (
        video.blob &&
        video.blobDid === target.did &&
        isUsableVideoBlob(video.blob)
      ) {
        blobs[postIndex].video = video.blob;
      } else if (video.file) {
        try {
          const result = await uploadVideo(target, video.file, {
            fetch,
            signal,
            onProgress: (p) =>
              report({ ...p, phase: 'video', step: p.phase, postIndex }),
          });
          blobs[postIndex].video = result.blob;
          report({
            phase: 'uploaded',
            kind: 'video',
            postIndex,
            blob: result.blob,
            blobDid: target.did,
            jobId: result.jobId,
          });
        } catch (err) {
          if (isAbort(err, signal)) throw err;
          throw new PublishError(
            err?.code || 'VIDEO_FAILED',
            err?.message || 'The video couldn’t be uploaded.',
            { cause: err },
          );
        }
      } else {
        throw new PublishError(
          'MEDIA_MISSING',
          'The video needs to be added again before this can be posted.',
        );
      }
    } else if (
      card &&
      post.images.length === 0 &&
      (card.thumb || card.thumbFile || card.thumbBlob)
    ) {
      report({ phase: 'uploading', kind: 'card', postIndex });
      const thumb = await uploadCardThumb(target, card, {
        fetch,
        signal,
        compress,
        decode,
      });
      if (thumb) {
        blobs[postIndex].cardThumb = thumb;
        if (thumb !== card.thumbBlob) {
          report({
            phase: 'uploaded',
            kind: 'cardThumb',
            postIndex,
            blob: thumb,
            blobDid: target.did,
          });
        }
      } else {
        warnings.push({
          postIndex,
          code: 'CARD_THUMB_FAILED',
          message: 'The link card went out without its image.',
        });
      }
    }
  }
  return { blobs, warnings };
}

function writeFailure(err) {
  const message = String(err?.message || '');
  if (
    /missing required scope/i.test(message) ||
    err?.error === 'ScopeMissingError'
  ) {
    return new PublishError(
      'MISSING_SCOPE',
      'Virga needs permission to post. Sign in again to grant it.',
      { cause: err, status: err?.status },
    );
  }
  return new PublishError(
    'WRITE_FAILED',
    message || 'The post couldn’t be published. Try again.',
    {
      cause: err,
      status: err?.status,
    },
  );
}

/**
 * Publish the composer's posts as `target`.
 *
 * @param {object} state - a ComposerState; `state.gates` is used as given
 *   (the composer resolves the account's defaults into it beforehand)
 * @param {{ did: string, agent: object, pdsUrl?: string }} target - from targetFor(did)
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - cancels uploads; once the write
 *   starts it runs to the end
 * @param {(event: object) => void} [options.onProgress] - `{ phase: 'uploading'|'uploaded'|'video'|'writing', … }`;
 *   'uploaded' events carry the blob and its DID so the composer can keep it
 * @param {(handle: string) => Promise<string|null>} [options.resolveMention]
 * @param {() => Date|number} [options.now]
 * @param {boolean} [options.requireAltText]
 * @param {{ isDuplicate: Function, remember: Function } | null} [options.duplicateGuard]
 * @param {typeof fetch} [options.fetch] - for cardyb and the video service
 * @returns {Promise<{ posts: Array<{ uri: string, cid: string }>, root: { uri: string, cid: string }, written: Array<{ uri: string, cid: string, record: object }>, warnings: object[] }>}
 * @throws {PublishError}
 */
export async function publish(state, target, options = {}) {
  const {
    signal,
    onProgress,
    resolveMention,
    now = () => new Date(),
    requireAltText = false,
    duplicateGuard = defaultDuplicateGuard,
    fetch,
    compress,
    decode,
    uploadVideo = defaultUploadVideo,
  } = options;

  if (!target?.did || !target.agent) {
    throw new PublishError('NO_TARGET', 'Choose an account to post as.');
  }
  if (state?.asDid && state.asDid !== target.did) {
    // Never fall back to another account than the one the writer chose.
    throw new PublishError(
      'WRONG_ACCOUNT',
      'This post is set to go out from a different account.',
    );
  }
  const problems = validateComposer(state, { now: now(), requireAltText });
  if (problems.length) {
    throw new PublishError('INVALID', problems[0].message, { problems });
  }
  const signature = publishSignature(state, target.did);
  if (duplicateGuard?.isDuplicate(signature)) {
    throw new PublishError(
      'DUPLICATE',
      'This was just posted. Change something to post it again.',
    );
  }

  // Started first and parked, so a failure while media uploads can't surface
  // as an unhandled rejection.
  const textsPromise = resolvePostTexts(state, { resolveMention });
  textsPromise.catch(() => {});

  let uploaded;
  try {
    uploaded = await uploadMedia(state, target, {
      signal,
      onProgress,
      fetch,
      compress,
      decode,
      uploadVideo,
    });
  } catch (err) {
    if (isAbort(err, signal))
      throw new PublishError('ABORTED', 'Cancelled.', { cause: err });
    throw err;
  }
  if (signal?.aborted) throw new PublishError('ABORTED', 'Cancelled.');

  const texts = await textsPromise;
  const records = buildPostRecords(state, {
    now: now(),
    blobs: uploaded.blobs,
    texts,
  });
  const { threadgateAllow, postgateEmbeddingRules } = state.reply
    ? { threadgateAllow: null, postgateEmbeddingRules: null }
    : gatesToRules(state.gates);

  try {
    onProgress?.({ phase: 'writing', count: records.length });
  } catch {
    // Ignored, as above.
  }

  const repo = target.did;
  let written;
  try {
    if (records.length === 1) {
      const res = await createPostWithGates(target.agent, {
        repo,
        collection: POST,
        record: records[0],
        threadgateRules: threadgateAllow,
        postgateRules: postgateEmbeddingRules,
      });
      written = [{ uri: res.uri, cid: res.cid, record: records[0] }];
    } else {
      const { writes, created } = await buildThreadWrites({
        did: repo,
        collection: POST,
        records,
        replyTo: replyRefs(state.reply),
        now: records[0].createdAt,
      });
      const rkey = created[0].rkey;
      // A threadgate covers the whole thread from its root, but a postgate
      // guards only the post it names, so every post of a new thread gets its
      // own or the rest of the thread stays quotable.
      const gateWrites = state.reply
        ? []
        : created.flatMap((post, i) =>
            buildGateWrites({
              did: repo,
              rkey: post.rkey,
              threadgateRules: i === 0 ? threadgateAllow : null,
              postgateRules: postgateEmbeddingRules,
              createdAt: post.record.createdAt,
            }),
          );
      await publishWithIdempotentRetry(
        target.agent,
        async () => {
          const res = await target.agent.com.atproto.repo.applyWrites({
            repo,
            validate: true,
            writes: [...writes, ...gateWrites],
          });
          return res?.data;
        },
        { repo, collection: POST, rkey },
      );
      written = created.map(({ uri, cid, record }) => ({ uri, cid, record }));
    }
  } catch (err) {
    throw writeFailure(err);
  }

  duplicateGuard?.remember(signature);
  const posts = written.map(({ uri, cid }) => ({ uri, cid }));
  return { posts, root: posts[0], written, warnings: uploaded.warnings };
}
