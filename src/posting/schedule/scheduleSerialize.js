// The composer's state as Virga's server's scheduling body, and a scheduled
// row back as composer state. The two are a pair: whatever a row holds must come back
// into the composer so that saving it again writes the same row.
//
// The server stores the body and its worker writes each post later, as the
// account, with no one at the keyboard. So everything the worker can't do is
// refused here: video (it can't upload one), a reply in the weekly queue (a
// reply answers one post at one moment, so it takes a time of its own), and
// a reply or a queued post that repeats. Images travel as base64 and are
// uploaded only when the post goes out, because a PDS drops blobs no record
// points at.
//
// A reply carries the root and parent strong refs (`payload.reply`), which
// the worker writes into the record after checking the parent is still
// there, and a note of who it answers (`payload.replyTo`) for the Scheduled
// page. A repeating post carries its rule (`payload.repeat`, repeat.js).
//
// The text pipeline and the embed rules are the ones publishing uses
// (resolvePostTexts, buildPostEmbed), so a scheduled post comes out as the
// same record a live one would.

import {
  MAX_IMAGES,
  emptyPost,
  labelsToSelfLabels,
  newId,
  normalizeComposerState,
  resolvePostTexts,
  selfLabelsToLabels,
} from '../lib/composerModel.js';
import { buildPostEmbed } from '../lib/embeds.js';
import { gatesFromRules, gatesToRules } from '../lib/gates.js';
import { CARD_THUMB_BUDGET, prepareImage } from '../lib/images.js';
import { composerTextFromRecord } from '../lib/inlineLinks.js';
import { normalizeAssociatedRefs } from '../lib/linkCard.js';
import { parseRecordUri } from '../lib/postLink.js';
import { normalizeTags } from '../lib/tags.js';
import {
  composerTimerFit,
  normalizeTimer,
  readStoredTimer,
  scheduledTimerToSend,
} from '../timers/selfDestruct.js';
import { QUEUE_HORIZON_DAYS } from './postingQueue.js';
import {
  REPEAT_REPLY_HINT,
  normalizeRepeat,
  repeatForServer,
  repeatProblem,
} from './repeat.js';

/**
 * Most base64 characters one body may carry. Vercel refuses a request body
 * over 4.5 MB before the server sees it; base64 is 4/3 of the bytes, and the rest
 * is room for the records.
 */
export const MAX_MEDIA_BASE64_CHARS = 4_000_000;

/** The lexicon's ceiling for one post image. */
export const MAX_IMAGE_BYTES = 2_000_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A refusal from the serializer, coded for scheduleErrorMessage. */
export class ScheduleSerializeError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ScheduleSerializeError';
    this.code = code;
    Object.assign(this, extra);
  }
}

const refuse = (code, message, extra) =>
  new ScheduleSerializeError(code, message, extra);

/* ---- base64 ------------------------------------------------------------- */

/** A Blob's bytes as base64, without a `data:` prefix. */
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // In slices: String.fromCharCode over a whole image overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** base64 back to a File of `type`. */
export function base64ToFile(base64, type, name) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: type || 'application/octet-stream' });
}

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function previewUrlFor(file) {
  try {
    return typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(file)
      : undefined;
  } catch {
    return undefined;
  }
}

const extFor = (type) =>
  (typeof type === 'string' && type.split('/')[1]) || 'jpg';

/* ---- serializing -------------------------------------------------------- */

function scheduledTime(state, scheduledFor, now) {
  const raw = scheduledFor ?? state?.schedule?.at ?? null;
  const ms = raw instanceof Date ? raw.getTime() : raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(ms))
    throw refuse('SCHEDULE_INVALID', 'Choose a time to post it.');
  const nowMs = new Date(now).getTime();
  if (ms <= nowMs)
    throw refuse('SCHEDULE_PAST', 'Choose a time in the future.');
  if (ms > nowMs + QUEUE_HORIZON_DAYS * DAY_MS)
    throw refuse(
      'SCHEDULE_TOO_FAR',
      `Posts can be scheduled up to ${QUEUE_HORIZON_DAYS} days ahead.`,
    );
  return ms;
}

/** An https address the server's worker may fetch a card's image from. */
function fetchableThumbUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname ? url : null;
  } catch {
    return null;
  }
}

async function imageBytes(image, loadImage) {
  if (image?.file) return image.file;
  if (typeof loadImage === 'function') return (await loadImage(image)) || null;
  return null;
}

/**
 * One post's attachments as the server's media: each image's bytes, and the
 * card's own image when the writer chose one. `mediaBytes` is filled in.
 */
async function postMedia(post, index, mediaBytes, options) {
  const markers = { images: [], video: null, cardThumb: null };
  if (post.images.length > MAX_IMAGES) {
    throw refuse('TOO_MANY_IMAGES', 'A post can have up to 4 images.', {
      postIndex: index,
    });
  }
  for (let n = 0; n < post.images.length; n++) {
    const image = post.images[n];
    const file = await imageBytes(image, options.loadImage);
    if (!file) {
      throw refuse(
        'IMAGE_MISSING',
        'An image needs to be added again before this can be scheduled.',
        { postIndex: index, imageId: image.id },
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw refuse(
        'IMAGE_TOO_LARGE',
        'One of the images is over Bluesky’s size limit. Add it again so it can be shrunk.',
        { postIndex: index, imageId: image.id },
      );
    }
    const mediaId = `p${index}-img${n}`;
    mediaBytes[mediaId] = {
      base64: await blobToBase64(file),
      encoding: file.type || image.mime || 'image/jpeg',
    };
    markers.images.push({ mediaId });
  }

  // Only a card with no images reaches the embed (buildPostEmbed), so only
  // then is its image worth sending.
  if (post.card?.url && post.images.length === 0) {
    if (post.card.thumbFile) {
      try {
        const prepared = await prepareImage(post.card.thumbFile, {
          budget: CARD_THUMB_BUDGET,
          ...(options.compress ? { compress: options.compress } : {}),
          ...(options.decode ? { decode: options.decode } : {}),
        });
        const mediaId = `p${index}-thumb`;
        mediaBytes[mediaId] = {
          base64: await blobToBase64(prepared.file),
          encoding: prepared.mime || prepared.file.type || 'image/jpeg',
        };
        markers.cardThumb = { mediaId };
      } catch {
        // The card goes without its image rather than the post not going.
        options.warnings.push({ code: 'CARD_THUMB_FAILED', postIndex: index });
      }
    } else {
      const url = fetchableThumbUrl(post.card.thumb);
      if (url) markers.cardThumb = { url };
    }
  }
  return markers;
}

/** buildPostEmbed's lexicon embed, over media markers, as the server's EmbedSpec. */
function toEmbedSpec(embed) {
  if (!embed) return undefined;
  switch (embed.$type) {
    case 'app.bsky.embed.images':
      return {
        type: 'images',
        images: embed.images.map((im) => {
          const spec = { mediaId: im.image.mediaId, alt: im.alt || '' };
          if (im.aspectRatio) spec.aspectRatio = im.aspectRatio;
          return spec;
        }),
      };
    case 'app.bsky.embed.external': {
      const { uri, title, description, thumb, associatedRefs } = embed.external;
      const spec = {
        type: 'external',
        uri,
        title: title || '',
        description: description || '',
      };
      if (thumb?.mediaId) spec.thumbMediaId = thumb.mediaId;
      else if (thumb?.url) spec.thumbUrl = thumb.url;
      if (associatedRefs)
        spec.associatedRefs = associatedRefs.map(({ uri: u, cid }) => ({
          uri: u,
          cid,
        }));
      return spec;
    }
    case 'app.bsky.embed.record':
      return { type: 'record', uri: embed.record.uri, cid: embed.record.cid };
    case 'app.bsky.embed.recordWithMedia':
      return {
        type: 'recordWithMedia',
        uri: embed.record.record.uri,
        cid: embed.record.record.cid,
        media: toEmbedSpec(embed.media),
      };
    default:
      return undefined;
  }
}

/**
 * The composer's state as the body of `POST /api/schedule/create` (and of a
 * content `update`): `{ scheduledFor, target, queued, payload }`.
 *
 * The composer resolves what isn't the post's own first: a queue slot
 * (`scheduledFor`), and the account's default gates when `state.gates` isn't
 * custom. The timer is the writer's rule fitted to this post and measured
 * from `scheduledFor`, since a scheduled post's lifespan runs from when it
 * goes out.
 *
 * Throws a ScheduleSerializeError, before any network, with code
 * QUEUE_REPLY, REPLY_UNRESOLVED, REPEAT_REPLY, REPEAT_INVALID (its message
 * is the sentence), SCHEDULE_VIDEO, SCHEDULE_INVALID, SCHEDULE_PAST,
 * SCHEDULE_TOO_FAR, EMPTY, IMAGE_MISSING, IMAGE_TOO_LARGE, TOO_MANY_IMAGES,
 * RECORD_UNRESOLVED, LIFESPAN (its message is the sentence) or
 * MEDIA_TOO_LARGE.
 *
 * @param {object} state - a ComposerState
 * @param {object} [options]
 * @param {Date|number|string} [options.now]
 * @param {string|Date} [options.scheduledFor] - default `state.schedule.at`
 * @param {boolean} [options.queued] - default `state.schedule.mode === 'queue'`
 * @param {string} [options.tz] - default the device's zone
 * @param {object|null} [options.repeat] - default `state.schedule.repeat`;
 *   a queued post never repeats
 * @param {string} [options.repeatTz] - the zone the time was picked in,
 *   which a repeating post keeps its wall clock in; default `tz`
 * @param {number} [options.occurrence] - the number, in its series, of the
 *   row being saved over (1 for a new post)
 * @param {(handle: string) => Promise<string|null>} [options.resolveMention]
 * @param {object} [options.fit] - composerTimerFit's; default for this post
 * @param {(image: object) => Promise<Blob|null>} [options.loadImage] - bytes
 *   for an image that has no `file` (one restored from a draft)
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ scheduledFor: string, target: 'bluesky', queued: boolean, payload: object }>}
 *   with a non-enumerable `warnings` (CARD_THUMB_FAILED: the card goes
 *   without its image)
 */
export async function serializeForSchedule(state, options = {}) {
  const {
    now = new Date(),
    scheduledFor,
    queued,
    tz,
    resolveMention,
    fit,
    signal,
  } = options;
  const s = normalizeComposerState(state);
  const isQueued = queued ?? s.schedule?.mode === 'queue';

  if (s.reply && isQueued) {
    throw refuse(
      'QUEUE_REPLY',
      'A reply can’t wait in the queue. Schedule it for a set time instead.',
    );
  }
  if (s.reply && !s.reply.cid) {
    throw refuse(
      'REPLY_UNRESOLVED',
      'The post you’re replying to couldn’t be read. Try again, or take the reply off.',
    );
  }
  if (s.posts.some((post) => post.video)) {
    throw refuse(
      'SCHEDULE_VIDEO',
      'Posts with video can’t be scheduled. Post it now instead.',
    );
  }
  const whenMs = scheduledTime(s, scheduledFor, now);
  for (const [i, post] of s.posts.entries()) {
    if (post.record && !post.record.cid) {
      throw refuse(
        'RECORD_UNRESOLVED',
        'The attached post or feed couldn’t be found. Remove it or try again.',
        { postIndex: i },
      );
    }
  }

  const zone = tz || deviceTimeZone();
  const repeatZone = options.repeatTz || zone;
  const asked = isQueued
    ? null
    : (options.repeat !== undefined ? options.repeat : s.schedule?.repeat) ||
      null;
  if (asked && s.reply) throw refuse('REPEAT_REPLY', REPEAT_REPLY_HINT);
  if (asked) {
    // Judged as the picker left it: an end that is half filled in is asked
    // for, never read as "no end".
    const wrong = repeatProblem(asked, new Date(whenMs).toISOString(), repeatZone, {
      occurrence: options.occurrence || 1,
    });
    if (wrong) throw refuse('REPEAT_INVALID', wrong);
  }
  const rule = normalizeRepeat(asked);

  const { problem, spec: selfDestruct } = scheduledTimerToSend(
    s.lifespan,
    { fit: fit || composerTimerFit({ reply: !!s.reply }) },
    whenMs,
  );
  if (problem) throw refuse('LIFESPAN', problem);

  const texts = await resolvePostTexts(s, { resolveMention, signal });

  const warnings = [];
  const mediaBytes = {};
  const markers = [];
  for (const [i, post] of s.posts.entries()) {
    markers.push(
      await postMedia(post, i, mediaBytes, { ...options, warnings }),
    );
  }
  let total = 0;
  for (const m of Object.values(mediaBytes)) total += m.base64.length;
  if (total > MAX_MEDIA_BASE64_CHARS) {
    throw refuse(
      'MEDIA_TOO_LARGE',
      'That’s more image than can be sent ahead. Use fewer or smaller images, or post it now.',
      { size: total, limit: MAX_MEDIA_BASE64_CHARS },
    );
  }

  const tags = normalizeTags(s.tags);
  const labels = labelsToSelfLabels(s.labels);
  const langs = s.langs.filter(Boolean);

  const posts = s.posts.map((post, i) => {
    const { text, facets } = texts[i];
    const embed = toEmbedSpec(buildPostEmbed(post, markers[i]));
    if (!text && !embed) {
      throw refuse('EMPTY', 'Write something first.', { postIndex: i });
    }
    const record = { text };
    if (facets?.length) record.facets = facets;
    // As a live thread does: every post carries the langs, labels and tags.
    if (langs.length) record.langs = langs;
    if (labels) record.labels = labels;
    if (tags.length) record.tags = tags;
    const out = { record };
    if (embed) out.embed = embed;
    return out;
  });

  // A reply takes no gates, as when it is posted live: the thread isn't the
  // account's to gate.
  const { threadgateAllow, postgateEmbeddingRules } = s.reply
    ? { threadgateAllow: null, postgateEmbeddingRules: null }
    : gatesToRules(s.gates);

  const body = {
    scheduledFor: new Date(whenMs).toISOString(),
    target: 'bluesky',
    queued: isQueued,
    payload: {
      posts,
      gates: { threadgate: threadgateAllow, postgate: postgateEmbeddingRules },
      mediaBytes,
      tz: zone,
      selfDestruct,
    },
  };
  if (s.reply) {
    const parent = { uri: s.reply.uri, cid: s.reply.cid };
    const root =
      s.reply.root?.uri && s.reply.root?.cid
        ? { uri: s.reply.root.uri, cid: s.reply.root.cid }
        : parent;
    body.payload.reply = { root, parent };
    const replyTo = replyHint(s.reply);
    if (replyTo) body.payload.replyTo = replyTo;
  }
  if (rule) body.payload.repeat = repeatForServer(rule, repeatZone);
  // For the composer, not for the server: not enumerable, so neither JSON nor a
  // spread carries it into the request.
  Object.defineProperty(body, 'warnings', { value: warnings });
  return body;
}

/**
 * Who a reply answers and the start of what they said, as the Scheduled
 * page shows it. Null when the composer knows neither.
 */
function replyHint(reply) {
  const hint = {
    handle: typeof reply?.author?.handle === 'string' ? reply.author.handle : '',
    displayName:
      typeof reply?.author?.displayName === 'string'
        ? reply.author.displayName
        : '',
    text: typeof reply?.text === 'string' ? reply.text.trim().slice(0, 300) : '',
  };
  return hint.handle || hint.displayName || hint.text ? hint : null;
}

/* ---- reconstructing ----------------------------------------------------- */

/**
 * A row's reply as ComposerState.reply: the refs it goes out with, and who
 * it answers as far as the row remembers (the composer reads the post again
 * to show it whole).
 */
function replyFromRow(payload) {
  const parent = payload?.reply?.parent;
  if (!parent?.uri || !parent.cid) return null;
  const root = payload.reply.root;
  const reply = {
    uri: parent.uri,
    cid: parent.cid,
    root:
      root?.uri && root?.cid
        ? { uri: root.uri, cid: root.cid }
        : { uri: parent.uri, cid: parent.cid },
  };
  const hint = payload.replyTo;
  if (hint && typeof hint === 'object') {
    if (typeof hint.text === 'string') reply.text = hint.text;
    if (hint.handle || hint.displayName) {
      reply.author = {
        did: parseRecordUri(parent.uri)?.did || '',
        handle: hint.handle || '',
        displayName: hint.displayName || '',
        avatar: null,
      };
    }
  }
  return reply;
}

function imageFromSpec(spec, media, n) {
  const stored = media?.[spec?.mediaId];
  const base = {
    id: newId('i'),
    alt: typeof spec?.alt === 'string' ? spec.alt : '',
  };
  if (spec?.aspectRatio?.width > 0 && spec?.aspectRatio?.height > 0) {
    base.aspectRatio = {
      width: spec.aspectRatio.width,
      height: spec.aspectRatio.height,
    };
  }
  if (!stored?.base64) {
    // Kept in place without bytes, so the composer asks for the image again
    // (validateComposer: IMAGE_MISSING) instead of the next save dropping it.
    return { ...base, mime: stored?.encoding || 'image/jpeg', size: 0 };
  }
  const file = base64ToFile(
    stored.base64,
    stored.encoding,
    `scheduled-image-${n}.${extFor(stored.encoding)}`,
  );
  const image = { ...base, file, mime: file.type, size: file.size };
  const previewUrl = previewUrlFor(file);
  if (previewUrl) image.previewUrl = previewUrl;
  return image;
}

function cardFromSpec(spec, media) {
  if (!spec?.uri) return null;
  const card = {
    url: spec.uri,
    title: spec.title || '',
    description: spec.description || '',
    thumb: null,
  };
  const refs = normalizeAssociatedRefs(spec.associatedRefs);
  if (refs) card.associatedRefs = refs;
  const stored = spec.thumbMediaId ? media?.[spec.thumbMediaId] : null;
  if (stored?.base64) {
    card.thumbFile = base64ToFile(
      stored.base64,
      stored.encoding,
      `scheduled-thumb.${extFor(stored.encoding)}`,
    );
    // What the writer saw: their own image, not one the page offers.
    card.edited = true;
  } else if (spec.thumbUrl) {
    card.thumb = spec.thumbUrl;
  }
  return card;
}

function recordFromSpec(spec) {
  if (!spec?.uri || !spec?.cid) return null;
  return {
    kind: parseRecordUri(spec.uri)?.kind || 'post',
    uri: spec.uri,
    cid: spec.cid,
  };
}

function applyEmbed(embed, media, post) {
  if (!embed) return post;
  switch (embed.type) {
    case 'images':
      return {
        ...post,
        images: (embed.images || []).map((im, n) =>
          imageFromSpec(im, media, n),
        ),
      };
    case 'external':
      return { ...post, card: cardFromSpec(embed, media) };
    case 'record':
      return { ...post, record: recordFromSpec(embed) };
    case 'recordWithMedia':
      return applyEmbed(embed.media, media, {
        ...post,
        record: recordFromSpec(embed),
      });
    default:
      return post;
  }
}

function postFromSpec(spec, media) {
  const record = spec?.record || {};
  // The stored text has links shortened, with the address in the facet, and
  // inline links as bare labels; both go back to what the writer typed, or
  // the next save schedules a shortened or missing link.
  const text = composerTextFromRecord(record.text || '', record.facets);
  return applyEmbed(spec?.embed, media, { ...emptyPost(), text });
}

/**
 * A scheduled row (and its media from getScheduledMedia) as composer state,
 * to edit and save back over the row. Every post of a thread comes back;
 * langs, labels and tags are read off the root, where every post carries
 * them. The row's gates are kept as its own choice, and its timer as the
 * writer's rule; a row with no timer has none, whatever the default. A
 * scheduled reply keeps what it answers, and a repeating post its rule.
 *
 * @param {object} row - as listScheduled / getScheduled return it
 * @param {Record<string, { base64: string, encoding: string }>} [media]
 * @param {{ asDid: string }} options - the account the row is scheduled as
 */
export function reconstructFromScheduled(row, media = {}, { asDid } = {}) {
  const payload = row?.payload || {};
  const specs =
    Array.isArray(payload.posts) && payload.posts.length ? payload.posts : [{}];
  const root = specs[0]?.record || {};
  const gates = payload.gates || {};
  const scheduledFor = row?.scheduledFor ?? row?.scheduled_for ?? null;
  const at = scheduledFor ? new Date(scheduledFor) : null;

  const repeat = row?.queued ? null : normalizeRepeat(payload.repeat);

  return normalizeComposerState({
    posts: specs.map((spec) => postFromSpec(spec, media)),
    reply: replyFromRow(payload),
    tags: normalizeTags(root.tags),
    langs: Array.isArray(root.langs) ? root.langs : [],
    labels: selfLabelsToLabels(root.labels),
    gates: {
      ...gatesFromRules({
        threadgateAllow: gates.threadgate ?? null,
        postgateEmbeddingRules: gates.postgate ?? null,
      }),
      custom: true,
    },
    asDid: asDid || '',
    schedule: row?.queued
      ? { mode: 'queue' }
      : at && Number.isFinite(at.getTime())
        ? { mode: 'at', at: at.toISOString(), ...(repeat ? { repeat } : {}) }
        : null,
    lifespan: payload.selfDestruct
      ? readStoredTimer({ ...payload.selfDestruct, enabled: true }).timer
      : normalizeTimer({ enabled: false }),
    source: {
      kind: 'scheduled',
      id: row?.id ?? null,
      clientKey: typeof row?.clientKey === 'string' && row.clientKey ? row.clientKey : 'virga',
    },
  });
}
