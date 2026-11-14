// Drafts are Bluesky's private drafts (app.bsky.draft.*): kept by Bluesky's
// AppView for the account alone, and shared with every app that reads them.
// Calls always go to Bluesky's AppView (`withProxy`), whatever else the agent
// is pointed at: no other AppView keeps drafts, and the permission names it.
//
// A draft is written in two shapes at once:
//
//   - the lexicon's own fields (`text`, `labels`, `embedImages`,
//     `embedVideos`, `embedExternals`, `embedRecords`, the draft's `langs`,
//     `threadgateAllow` and `postgateEmbeddingRules`), which Bluesky's app
//     reads;
//   - the fields Anisota writes beside them on each post (`facets`, `tags`,
//     `embed`, `reply`), which keep links, tags, the post being replied to and
//     already-uploaded media whole.
//
// Beside them each post may carry one field of Virga's (`virgaCard`), for
// what a link card holds that neither shape keeps: an image not uploaded yet,
// and whether the writer edited the card.
//
// Reading takes both and prefers the fuller one. Media are device-bound: each
// file is kept in this browser (draftMedia.js) and the draft names it by a
// `localRef` path.

import { POSTING_EVENTS, emitPostingEvent } from '../events.js';
import { countGraphemes } from '../lib/graphemes.js';
import { composerTextFromRecord } from '../lib/inlineLinks.js';
import { normalizeTags } from '../lib/tags.js';
import { gatesFromRules, gatesToRules } from '../lib/gates.js';
import { kindForCollection } from '../lib/postLink.js';
import { blobCid, isBlob } from '../lib/blobs.js';
import { toJsonShape } from '../lib/recordCid.js';
import { fetchLinkCard } from '../lib/linkCard.js';
import {
  emptyComposerState,
  emptyPost,
  labelsToSelfLabels,
  resolvePostTexts,
  selfLabelsToLabels,
} from '../lib/composerModel.js';
import {
  openDraftMedia,
  pruneDraftMedia,
  removeDraftMedia,
  stateLocalRefs,
  storeDraftMedia,
  loadDraftMedia,
} from './draftMedia.js';
import { autosaveKey, loadSessionDraft } from '../autosave.js';

const APPVIEW_SERVICE = ['bsky_appview', 'did:web:api.bsky.app'];

const DRAFT = 'app.bsky.draft.defs#draft';
const DRAFT_POST = 'app.bsky.draft.defs#draftPost';
const RECORD = 'app.bsky.embed.record';
const RECORD_WITH_MEDIA = 'app.bsky.embed.recordWithMedia';
const IMAGES = 'app.bsky.embed.images';
const VIDEO = 'app.bsky.embed.video';
const EXTERNAL = 'app.bsky.embed.external';

const BSKY_CDN = 'https://cdn.bsky.app';

/** The lexicon's limits on a draft. */
export const DRAFT_LIMITS = Object.freeze({
  posts: 100,
  textGraphemes: 1000,
  textBytes: 10000,
  images: 4,
  videos: 1,
  langs: 3,
  altGraphemes: 2000,
  pageSize: 100,
});

/** How Virga names itself as the device a draft was saved on. */
export const DRAFT_DEVICE_NAME = 'Virga';

/** Per browser, not per account: which drafts' media this browser holds. */
export const POSTING_DEVICE_KEY = 'virga:posting-device';

export const DRAFT_LIMIT_MESSAGE =
  'You’ve reached Bluesky’s limit on drafts. Delete one you don’t need, then save again.';

const str = (v) => (typeof v === 'string' ? v : '');
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const encoder = new TextEncoder();

function draftsOf(agent) {
  if (!agent) throw new Error('Drafts need a signed-in account.');
  const proxied =
    typeof agent.withProxy === 'function'
      ? agent.withProxy(...APPVIEW_SERVICE)
      : agent;
  return proxied.app.bsky.draft;
}

function ownerOf(agent, state) {
  const did = agent?.did || state?.asDid || null;
  if (!did) throw new Error('A draft belongs to an account.');
  return did;
}

function localStore() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * This browser's device id for drafts (a UUIDv4 under `virga:posting-device`,
 * made the first time). Null when there is nowhere to keep one: a draft then
 * names no device, and its media read as being elsewhere.
 */
export function postingDeviceId(store = localStore()) {
  if (!store) return null;
  try {
    const known = store.getItem(POSTING_DEVICE_KEY);
    if (known && UUID_V4.test(known)) return known;
    const c = globalThis.crypto;
    if (!c || typeof c.randomUUID !== 'function') return null;
    const id = c.randomUUID();
    store.setItem(POSTING_DEVICE_KEY, id);
    return id;
  } catch {
    return null;
  }
}

/* ---- errors ----------------------------------------------------------- */

/** Whether Bluesky refused a new draft because the account has its limit. */
export function isDraftLimitError(error) {
  if (!error) return false;
  if (error.error === 'DraftLimitReached' || error.code === 'DraftLimitReached')
    return true;
  if (error.constructor?.name === 'DraftLimitReachedError') return true;
  return /DraftLimitReached/.test(str(error.message));
}

function asDraftError(error) {
  if (!isDraftLimitError(error)) return error;
  const out = new Error(DRAFT_LIMIT_MESSAGE, { cause: error });
  out.code = 'DRAFT_LIMIT';
  return out;
}

const isNotFound = (error) =>
  error?.error === 'NotFound' ||
  error?.status === 404 ||
  /not ?found/i.test(str(error?.message));

/* ---- reading ---------------------------------------------------------- */

/**
 * One page of the account's drafts, newest edit first as Bluesky returns
 * them: `{ drafts: draftView[], cursor }`.
 */
export async function listDrafts(agent, { cursor, limit = 50, signal } = {}) {
  const params = {
    limit: Math.max(1, Math.min(DRAFT_LIMITS.pageSize, Number(limit) || 50)),
  };
  if (cursor) params.cursor = cursor;
  const res = await draftsOf(agent).getDrafts(
    params,
    signal ? { signal } : undefined,
  );
  const drafts = Array.isArray(res?.data?.drafts)
    ? res.data.drafts.filter((d) => d?.id && isObject(d.draft))
    : [];
  return { drafts, cursor: res?.data?.cursor || null };
}

/**
 * Every draft, paged to the end. A cursor handed back twice ends the walk,
 * and so does `maxPages` (the result then has `complete: false`).
 * @returns {Promise<object[] & { complete: boolean }>}
 */
export async function listAllDrafts(agent, { signal, maxPages = 50 } = {}) {
  const out = [];
  const seen = new Set();
  const cursors = new Set();
  let cursor = null;
  let complete = false;
  for (let page = 0; page < maxPages; page++) {
    const res = await listDrafts(agent, {
      cursor,
      limit: DRAFT_LIMITS.pageSize,
      signal,
    });
    for (const d of res.drafts) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push(d);
    }
    cursor = res.cursor;
    if (!cursor || cursors.has(cursor) || !res.drafts.length) {
      complete = !cursor || !res.drafts.length;
      break;
    }
    cursors.add(cursor);
  }
  return Object.assign(out, { complete });
}

/* ---- composer state → draft ------------------------------------------- */

function textProblem(text, index) {
  if (
    countGraphemes(text) > DRAFT_LIMITS.textGraphemes ||
    encoder.encode(text).length > DRAFT_LIMITS.textBytes
  ) {
    const error = new Error(
      `Post ${index + 1} is longer than a draft can hold (${DRAFT_LIMITS.textGraphemes.toLocaleString('en')} characters).`,
    );
    error.code = 'DRAFT_TOO_LONG';
    error.postIndex = index;
    return error;
  }
  return null;
}

const owned = (blob, blobDid, owner) => isBlob(blob) && blobDid === owner;
const aspect = (a) =>
  isObject(a) && a.width > 0 && a.height > 0
    ? { width: Math.round(a.width), height: Math.round(a.height) }
    : undefined;

// What Anisota reads: the post's embed as it would be published, with blobs
// only where this account already holds them.
function extensionEmbed(post, owner) {
  let media = null;
  const video = post.video;
  const images = post.images || [];
  if (video && owned(video.blob, video.blobDid, owner)) {
    media = { $type: VIDEO, video: toJsonShape(video.blob) };
    if (video.alt) media.alt = video.alt;
    const ar = aspect(video.aspectRatio);
    if (ar) media.aspectRatio = ar;
  } else if (
    !video &&
    images.length &&
    images.every((i) => owned(i.blob, i.blobDid, owner))
  ) {
    media = {
      $type: IMAGES,
      images: images.slice(0, DRAFT_LIMITS.images).map((i) => {
        const out = { image: toJsonShape(i.blob), alt: str(i.alt) };
        const ar = aspect(i.aspectRatio);
        if (ar) out.aspectRatio = ar;
        return out;
      }),
    };
  } else if (!video && !images.length && post.card?.url) {
    const external = {
      uri: post.card.url,
      title: str(post.card.title),
      description: str(post.card.description),
    };
    if (owned(post.card.thumbBlob, post.card.thumbBlobDid, owner))
      external.thumb = toJsonShape(post.card.thumbBlob);
    media = { $type: EXTERNAL, external };
  }
  const record =
    post.record?.uri && post.record?.cid
      ? {
          $type: RECORD,
          record: { uri: post.record.uri, cid: post.record.cid },
        }
      : null;
  if (record && media) return { $type: RECORD_WITH_MEDIA, record, media };
  return record || media;
}

function draftPost(post, text, { index, tags, selfLabels, reply, owner }) {
  const out = { $type: DRAFT_POST, text: str(text?.text) };
  const problem = textProblem(out.text, index);
  if (problem) throw problem;
  if (selfLabels) out.labels = selfLabels;

  const images = (post.images || [])
    .filter((i) => i?.localRef)
    .slice(0, DRAFT_LIMITS.images);
  if (images.length) {
    out.embedImages = images.map((i) => {
      const image = {
        $type: 'app.bsky.draft.defs#draftEmbedImage',
        localRef: { path: i.localRef },
      };
      if (i.alt) image.alt = i.alt;
      return image;
    });
  }
  if (post.video?.localRef) {
    const video = {
      $type: 'app.bsky.draft.defs#draftEmbedVideo',
      localRef: { path: post.video.localRef },
    };
    if (post.video.alt) video.alt = post.video.alt;
    out.embedVideos = [video];
  }
  if (post.card?.url) {
    out.embedExternals = [
      { $type: 'app.bsky.draft.defs#draftEmbedExternal', uri: post.card.url },
    ];
    // A card image that isn't uploaded yet is only an address (the card
    // service's), and whether the writer edited the card isn't a field of
    // either shape. Both ride on the post, beside `embed` rather than in it,
    // so nothing that publishes an `embed` as it stands carries them out.
    const extra = {};
    const thumbUrl = owned(post.card.thumbBlob, post.card.thumbBlobDid, owner)
      ? null
      : httpsUrl(post.card.thumb);
    if (thumbUrl) extra.thumb = thumbUrl;
    if (post.card.edited) extra.edited = true;
    if (Object.keys(extra).length) out[CARD_EXTRA] = extra;
  }
  if (post.record?.uri && post.record?.cid) {
    out.embedRecords = [
      {
        $type: 'app.bsky.draft.defs#draftEmbedRecord',
        record: { uri: post.record.uri, cid: post.record.cid },
      },
    ];
  }

  if (Array.isArray(text?.facets) && text.facets.length)
    out.facets = toJsonShape(text.facets);
  if (tags.length) out.tags = tags;
  const embed = extensionEmbed(post, owner);
  if (embed) out.embed = embed;
  if (reply) out.reply = reply;
  return out;
}

/**
 * The draft a ComposerState saves as. `texts` are resolvePostTexts' output,
 * one `{ text, facets }` per post (so mentions, inline links and shortened
 * links are written as a post would carry them). Media must already have
 * `localRef`s (storeDraftMedia) or this account's blobs; anything else is
 * left out. Tags and labels go on every post, as a published thread carries
 * them. Reply and quote settings are kept only when chosen for this post
 * (`gates.custom`, which always writes `postgateEmbeddingRules`); otherwise
 * the draft follows the account's defaults when it's opened again. Throws
 * `DRAFT_TOO_LONG` for a post over 1,000 characters.
 */
export function composerStateToDraft(
  state,
  { texts = [], deviceId, deviceName = DRAFT_DEVICE_NAME, owner } = {},
) {
  const ownerDid = owner || state?.asDid || null;
  const posts = (state?.posts || []).slice(0, DRAFT_LIMITS.posts);
  if (!posts.length) throw new Error('A draft needs a post.');
  const tags = normalizeTags(state?.tags || []);
  const selfLabels = labelsToSelfLabels(state?.labels || []) || null;
  const reply =
    state?.reply?.uri && state.reply.cid
      ? {
          root: state.reply.root?.uri
            ? { uri: state.reply.root.uri, cid: state.reply.root.cid }
            : { uri: state.reply.uri, cid: state.reply.cid },
          parent: { uri: state.reply.uri, cid: state.reply.cid },
        }
      : null;

  const draft = {
    $type: DRAFT,
    deviceName: str(deviceName).slice(0, 100) || DRAFT_DEVICE_NAME,
    posts: posts.map((post, index) =>
      draftPost(post, texts[index] || { text: post?.text || '', facets: [] }, {
        index,
        tags,
        selfLabels,
        reply: index === 0 ? reply : null,
        owner: ownerDid,
      }),
    ),
  };
  if (deviceId && UUID_V4.test(deviceId)) draft.deviceId = deviceId;
  const langs = (state?.langs || [])
    .filter((l) => typeof l === 'string' && l)
    .slice(0, DRAFT_LIMITS.langs);
  if (langs.length) draft.langs = langs;
  // A reply carries no gates: they belong to the thread's root.
  if (state?.gates?.custom && !reply) {
    const { threadgateAllow, postgateEmbeddingRules } = gatesToRules(
      state.gates,
    );
    if (threadgateAllow !== null) draft.threadgateAllow = threadgateAllow;
    // Always written for a choice made for this post, empty when quoting is
    // allowed: with neither field, "anyone can reply and quote" would read
    // back as "use my defaults".
    draft.postgateEmbeddingRules = postgateEmbeddingRules || [];
  }
  return draft;
}

/* ---- draft → composer state ------------------------------------------- */

// The post's field for what a draft's card can't otherwise keep:
// `{ thumb?: https URL, edited?: true }`.
const CARD_EXTRA = 'virgaCard';

function httpsUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const cdnImage = (did, cid, size = 'feed_thumbnail') =>
  did && cid ? `${BSKY_CDN}/img/${size}/plain/${did}/${cid}@jpeg` : null;

function plainBlob(blob) {
  return isBlob(blob) ? toJsonShape(blob) : null;
}

let readIds = 0;
const readId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${(readIds += 1)}`;

// Splits a stored embed into its record and media halves.
function embedParts(embed) {
  if (!isObject(embed)) return { record: null, media: null };
  if (embed.$type === RECORD) return { record: embed.record, media: null };
  if (embed.$type === RECORD_WITH_MEDIA)
    return { record: embed.record?.record || null, media: embed.media || null };
  return { record: null, media: embed };
}

function recordAttachment(ref) {
  if (!ref?.uri) return null;
  const collection = /^at:\/\/[^/]+\/([^/]+)\//.exec(ref.uri)?.[1];
  const kind = kindForCollection(collection);
  return kind ? { kind, uri: ref.uri, cid: ref.cid || null } : null;
}

function readImages(post, media, owner) {
  const stored =
    media?.$type === IMAGES && Array.isArray(media.images) ? media.images : [];
  const local = Array.isArray(post.embedImages) ? post.embedImages : [];
  const count = Math.min(
    DRAFT_LIMITS.images,
    Math.max(local.length, stored.length),
  );
  const out = [];
  for (let i = 0; i < count; i++) {
    const ref = local[i];
    // Blob halves line up with local ones only when both lists are whole.
    const fromEmbed =
      !local.length || local.length === stored.length ? stored[i] : null;
    const blob = plainBlob(fromEmbed?.image);
    if (!ref?.localRef?.path && !blob) continue;
    const image = {
      id: readId('image'),
      mime: blob?.mimeType || '',
      size: blob?.size || 0,
      alt: str(ref?.alt) || str(fromEmbed?.alt),
    };
    if (ref?.localRef?.path) image.localRef = ref.localRef.path;
    if (blob) {
      image.blob = blob;
      image.blobDid = owner;
      image.previewUrl = cdnImage(owner, blobCid(blob));
    }
    if (aspect(fromEmbed?.aspectRatio))
      image.aspectRatio = aspect(fromEmbed.aspectRatio);
    out.push(image);
  }
  return out;
}

function readVideo(post, media, owner) {
  const stored = media?.$type === VIDEO ? media : null;
  const local = Array.isArray(post.embedVideos) ? post.embedVideos[0] : null;
  const blob = plainBlob(stored?.video);
  if (!local?.localRef?.path && !blob) return null;
  const video = {
    mime: blob?.mimeType || '',
    size: blob?.size || 0,
    alt: str(local?.alt) || str(stored?.alt),
    status: blob ? 'ready' : 'idle',
  };
  if (local?.localRef?.path) video.localRef = local.localRef.path;
  if (blob) {
    video.blob = blob;
    video.blobDid = owner;
  }
  if (aspect(stored?.aspectRatio))
    video.aspectRatio = aspect(stored.aspectRatio);
  return video;
}

function readCard(post, media, owner) {
  const extra = isObject(post[CARD_EXTRA]) ? post[CARD_EXTRA] : {};
  const thumbUrl = httpsUrl(extra.thumb);
  const card = readCardFields(post, media, owner, thumbUrl);
  if (card && extra.edited === true) card.edited = true;
  return card;
}

function readCardFields(post, media, owner, thumbUrl) {
  if (media?.$type === EXTERNAL && media.external?.uri) {
    const thumbBlob = plainBlob(media.external.thumb);
    const card = {
      url: media.external.uri,
      title: str(media.external.title),
      description: str(media.external.description),
      thumb: thumbBlob ? cdnImage(owner, blobCid(thumbBlob)) : thumbUrl,
    };
    if (thumbBlob) {
      card.thumbBlob = thumbBlob;
      card.thumbBlobDid = owner;
    }
    return card;
  }
  const uri = Array.isArray(post.embedExternals)
    ? post.embedExternals[0]?.uri
    : null;
  // Only the address survives in the lexicon's field (a draft from Bluesky's
  // app): openDraft reads the rest of the card again from it.
  return typeof uri === 'string' && uri
    ? { url: uri, title: '', description: '', thumb: thumbUrl }
    : null;
}

function readPost(post, owner) {
  const { record, media } = embedParts(post?.embed);
  const fromRecords = Array.isArray(post?.embedRecords)
    ? post.embedRecords[0]?.record
    : null;
  const facets = Array.isArray(post?.facets) ? post.facets : [];
  return {
    ...emptyPost(),
    text: facets.length
      ? composerTextFromRecord(str(post?.text), facets)
      : str(post?.text),
    images: readImages(post || {}, media, owner),
    video: readVideo(post || {}, media, owner),
    record: recordAttachment(record) || recordAttachment(fromRecords),
    card: readCard(post || {}, media, owner),
  };
}

/**
 * A draft as the composer holds it, for `asDid` (the account whose draft it
 * is). Starts from `emptyComposerState({ asDid, defaults })`, so what the
 * draft doesn't say (no languages, no reply settings) comes from the
 * account's defaults. Media come back as `localRef`s (and blobs, where the
 * draft carries them); loadDraftMedia fills in the files this browser holds.
 * A post being replied to comes back as `{ uri, cid, root }`, for the
 * composer to read again.
 */
export function draftToComposerState(draftView, { asDid, defaults } = {}) {
  const base = emptyComposerState({ asDid, defaults });
  const draft = isObject(draftView?.draft) ? draftView.draft : {};
  const posts = (Array.isArray(draft.posts) ? draft.posts : []).slice(
    0,
    DRAFT_LIMITS.posts,
  );
  const first = posts[0] || {};
  const parent = first.reply?.parent;
  const state = {
    ...base,
    posts: posts.length ? posts.map((p) => readPost(p, asDid)) : base.posts,
    reply: parent?.uri
      ? {
          uri: parent.uri,
          cid: parent.cid || null,
          root: first.reply.root?.uri
            ? { uri: first.reply.root.uri, cid: first.reply.root.cid || null }
            : { uri: parent.uri, cid: parent.cid || null },
        }
      : null,
    tags: normalizeTags(Array.isArray(first.tags) ? first.tags : []),
    labels: selfLabelsToLabels(first.labels),
    source: {
      kind: 'draft',
      id: draftView?.id || null,
      ownerDid: asDid || null,
    },
  };
  const langs = Array.isArray(draft.langs)
    ? draft.langs
        .filter((l) => typeof l === 'string' && l)
        .slice(0, DRAFT_LIMITS.langs)
    : [];
  if (langs.length) state.langs = langs;
  if (
    Array.isArray(draft.threadgateAllow) ||
    Array.isArray(draft.postgateEmbeddingRules)
  ) {
    state.gates = { custom: true, ...gatesFromRules(draft) };
  }
  return state;
}

/* ---- list rows ------------------------------------------------------- */

/** Every localRef path a draft names. */
export function draftLocalRefs(draftView) {
  const refs = [];
  for (const post of draftView?.draft?.posts || []) {
    for (const i of post?.embedImages || [])
      if (i?.localRef?.path) refs.push(i.localRef.path);
    for (const v of post?.embedVideos || [])
      if (v?.localRef?.path) refs.push(v.localRef.path);
  }
  return refs;
}

/**
 * What a drafts list shows for one draft, without opening it:
 * `{ id, text, posts, isThread, isReply, tags, langs, images, video, link,
 *   record, labels, createdAt, updatedAt, deviceName, savedHere,
 *   mediaElsewhere, view }`. `savedHere` is true when this browser saved it
 * (its `deviceId` is `deviceId`); `mediaElsewhere` when it names media this
 * browser didn't keep, so opening it here will ask for them again.
 */
export function summarizeDraft(draftView, { deviceId } = {}) {
  const draft = isObject(draftView?.draft) ? draftView.draft : {};
  const posts = Array.isArray(draft.posts) ? draft.posts : [];
  const first = posts[0] || {};
  const { record, media } = embedParts(first.embed);
  const localImages = (first.embedImages || []).length;
  const storedImages =
    media?.$type === IMAGES ? (media.images || []).length : 0;
  const savedHere = !!deviceId && draft.deviceId === deviceId;
  const refs = draftLocalRefs(draftView);
  return {
    id: draftView?.id || null,
    text: str(first.text),
    posts: posts.length,
    isThread: posts.length > 1,
    isReply: !!first.reply?.parent?.uri,
    tags: normalizeTags(Array.isArray(first.tags) ? first.tags : []),
    langs: Array.isArray(draft.langs) ? draft.langs : [],
    labels: selfLabelsToLabels(first.labels),
    images: Math.max(localImages, storedImages),
    video: !!((first.embedVideos || []).length || media?.$type === VIDEO),
    link:
      (media?.$type === EXTERNAL
        ? media.external?.uri
        : first.embedExternals?.[0]?.uri) || null,
    record:
      recordAttachment(record) ||
      recordAttachment(first.embedRecords?.[0]?.record),
    createdAt: draftView?.createdAt || null,
    updatedAt: draftView?.updatedAt || draftView?.createdAt || null,
    deviceName: str(draft.deviceName) || null,
    savedHere,
    mediaElsewhere: refs.length > 0 && !savedHere,
    view: draftView,
  };
}

/* ---- writing ---------------------------------------------------------- */

async function prepare(agent, state, opts) {
  const owner = ownerOf(agent, state);
  const media = opts.media || (await openDraftMedia(owner));
  const before = new Set(stateLocalRefs(state));
  const { state: withRefs } = await storeDraftMedia(owner, state, { media });
  // Files kept for this write alone: forgotten again if it fails.
  const minted = stateLocalRefs(withRefs).filter((r) => !before.has(r));
  const forgetMinted = () => removeDraftMedia(owner, minted, { media });
  try {
    const texts =
      opts.texts ||
      (await resolvePostTexts(withRefs, {
        resolveMention: opts.resolveMention,
        signal: opts.signal,
      }));
    const draft = composerStateToDraft(withRefs, {
      texts,
      owner,
      deviceId: opts.deviceId === undefined ? postingDeviceId() : opts.deviceId,
      deviceName: opts.deviceName,
    });
    return { owner, media, state: withRefs, draft, forgetMinted };
  } catch (error) {
    await forgetMinted();
    throw error;
  }
}

/**
 * Save `state` as a new draft of the agent's account. Media files are kept
 * in this browser first. Resolves to `{ id, state, draft }`, the state now
 * naming the draft as its source and its media by path. Bluesky's limit on
 * drafts comes back as an error with `code: 'DRAFT_LIMIT'` and a sentence to
 * show. Options: `texts` (already resolved) or `resolveMention`, `deviceId`,
 * `deviceName`, `signal`, `media` (a draftMedia store).
 */
export async function createDraft(agent, state, opts = {}) {
  const {
    owner,
    state: saved,
    draft,
    forgetMinted,
  } = await prepare(agent, state, opts);
  let res;
  try {
    res = await draftsOf(agent).createDraft(
      { draft },
      opts.signal ? { signal: opts.signal } : undefined,
    );
  } catch (error) {
    await forgetMinted();
    throw asDraftError(error);
  }
  const id = res?.data?.id;
  if (!id)
    throw new Error(
      'The draft was sent, but Bluesky didn’t say where it was saved.',
    );
  emitPostingEvent(
    POSTING_EVENTS.drafts,
    { did: owner, id, action: 'created' },
    opts.target,
  );
  return {
    id,
    state: { ...saved, source: { kind: 'draft', id, ownerDid: owner } },
    draft,
  };
}

// The draft `id` from the account's whole list, with every path the other
// drafts name (two drafts can share a file, and it stays while either does).
async function findDraft(agent, id, signal) {
  const all = await listAllDrafts(agent, { signal });
  const found = all.find((d) => d.id === id) || null;
  const others = new Set(
    all.filter((d) => d.id !== id).flatMap(draftLocalRefs),
  );
  return { found, complete: all.complete, others };
}

/**
 * Save `state` over the draft `id`. Bluesky ignores an update to a draft that
 * no longer exists (deleted, or posted from another app) and reports
 * success, so the draft is looked for first: when the complete list hasn't
 * got it, the state is saved as a new draft instead (`recreated: true`, with
 * its new id). When the list can't be read, the update is sent regardless.
 * Media the old draft named and neither the new one nor another draft does
 * are forgotten. Resolves to `{ id, state, draft, recreated }`.
 */
export async function updateDraft(agent, id, state, opts = {}) {
  if (!id) throw new Error('Which draft?');
  let looked = null;
  try {
    looked = await findDraft(agent, id, opts.signal);
  } catch {
    // Unverified: the update below is the best that can be done.
  }
  if (looked && !looked.found && looked.complete) {
    const made = await createDraft(agent, state, opts);
    return { ...made, recreated: true };
  }
  const previous = looked?.found || null;
  const others = looked?.others || new Set();
  const {
    owner,
    media,
    state: saved,
    draft,
    forgetMinted,
  } = await prepare(agent, state, opts);
  try {
    await draftsOf(agent).updateDraft(
      { draft: { id, draft } },
      opts.signal ? { signal: opts.signal } : undefined,
    );
  } catch (error) {
    await forgetMinted();
    throw asDraftError(error);
  }
  if (previous) {
    const kept = new Set([...stateLocalRefs(saved), ...others]);
    await removeDraftMedia(
      owner,
      draftLocalRefs(previous).filter((r) => !kept.has(r)),
      { media },
    );
  }
  emitPostingEvent(
    POSTING_EVENTS.drafts,
    { did: owner, id, action: 'updated' },
    opts.target,
  );
  return {
    id,
    state: { ...saved, source: { kind: 'draft', id, ownerDid: owner } },
    draft,
    recreated: false,
  };
}

/**
 * Delete the draft `id`. One already gone counts as deleted. Its media are
 * then forgotten from this browser, except files another draft still names:
 * the account's list is read first to learn both. When that list can't be
 * read, only `localRefs` (draftLocalRefs of the draft, when the caller has
 * it) are forgotten.
 */
export async function deleteDraft(
  agent,
  id,
  { localRefs, media, signal, target } = {},
) {
  if (!id) throw new Error('Which draft?');
  const owner = ownerOf(agent, null);
  let refs = Array.isArray(localRefs) ? localRefs : [];
  let others = new Set();
  try {
    const looked = await findDraft(agent, id, signal);
    if (looked.found)
      refs = [...new Set([...refs, ...draftLocalRefs(looked.found)])];
    others = looked.others;
  } catch {
    // The delete still goes ahead; what the caller named is forgotten after.
  }
  try {
    await draftsOf(agent).deleteDraft({ id }, signal ? { signal } : undefined);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  await removeDraftMedia(
    owner,
    refs.filter((r) => !others.has(r)),
    { media },
  );
  emitPostingEvent(
    POSTING_EVENTS.drafts,
    { did: owner, id, action: 'deleted' },
    target,
  );
}

/**
 * Open a draft for the composer: draftToComposerState, then the media files
 * this browser keeps. Resolves to `{ state, missing }`; `missing` lists the
 * localRefs that have to be attached again before it can be posted.
 */
export async function openDraft(
  draftView,
  { asDid, defaults, media, makePreviewUrl, fetchCard = fetchLinkCard } = {},
) {
  const state = draftToComposerState(draftView, { asDid, defaults });
  const opts = { media };
  if (makePreviewUrl !== undefined) opts.makePreviewUrl = makePreviewUrl;
  const [loaded, cards] = await Promise.all([
    loadDraftMedia(asDid, state, opts),
    fetchCard ? completeDraftCards(state, { fetchCard }) : null,
  ]);
  if (!cards) return loaded;
  return {
    ...loaded,
    state: {
      ...loaded.state,
      posts: loaded.state.posts.map((p, i) =>
        cards[i] ? { ...p, card: cards[i] } : p,
      ),
    },
  };
}

// The composer only reads a card for a link it hasn't got one for, and a
// draft opened here may be posted straight from the Drafts page: a card
// without its title or image has to be completed before either.
const CARD_WAIT_MS = 5_000;

/**
 * The cards in `state` with what the draft lost filled in from the card
 * service: the title, description and image a draft from Bluesky's app never
 * kept, or an image only an older draft lacks. What the draft does say (an
 * edited title, an uploaded image) is kept. One card per post, or null where
 * nothing changed; null when nothing changed at all.
 */
export async function completeDraftCards(
  state,
  { fetchCard = fetchLinkCard, timeoutMs = CARD_WAIT_MS } = {},
) {
  const signal =
    typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  let changed = false;
  const cards = await Promise.all(
    (state?.posts || []).map(async (p) => {
      const card = p?.card;
      // A card the writer edited says what they chose, a removed image too.
      if (!card?.url || card.edited) return null;
      const lacksThumb = !card.thumb && !card.thumbBlob && !card.thumbFile;
      if (str(card.title) && !lacksThumb) return null;
      const fresh = await Promise.resolve(fetchCard(card.url, { signal })).catch(
        () => null,
      );
      if (!fresh) return null;
      const next = {
        ...card,
        title: str(card.title) || str(fresh.title),
        description: str(card.description) || str(fresh.description),
        thumb: lacksThumb ? fresh.thumb || null : card.thumb,
      };
      if (!card.associatedRefs && fresh.associatedRefs)
        next.associatedRefs = fresh.associatedRefs;
      changed = true;
      return next;
    }),
  );
  return changed ? cards : null;
}

/* ---- files no draft names any more ------------------------------------ */

// A file is only forgotten once it's this old: a draft saved while the list
// was read, or a post in the composer that names it, has had the day the
// composer keeps a post for (autosave.js's AUTOSAVE_TTL_MS) and a day more.
export const ORPHAN_MEDIA_MIN_AGE_MS = 2 * 24 * 60 * 60 * 1000;

// Every localRef in the account's stored composer entry (the post being
// written and the ones set aside), read as raw JSON: whatever names a file
// keeps it, valid entry or not, and reading never clears anything.
function autosavedLocalRefs(did, store) {
  let entry = null;
  try {
    entry = JSON.parse(store?.getItem(autosaveKey(did)) || 'null');
  } catch {
    return [];
  }
  const refs = [];
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (isObject(value)) {
      if (typeof value.localRef === 'string' && value.localRef)
        refs.push(value.localRef);
      Object.values(value).forEach(walk);
    }
  };
  walk(entry);
  return refs;
}

/**
 * Forget the files in this browser that no draft of the account names any
 * more: ones whose draft was posted or deleted in another app, or that a
 * failed removal left behind. Reads every draft first and does nothing
 * unless that read is complete. Files the composer's stored or in-memory
 * post names, and files newer than `minAgeMs`, stay. Returns the paths
 * forgotten.
 */
export async function pruneOrphanedDraftMedia(
  agent,
  did,
  {
    media,
    now = Date.now(),
    minAgeMs = ORPHAN_MEDIA_MIN_AGE_MS,
    store = localStore(),
    signal,
  } = {},
) {
  if (!agent || !did) return [];
  const all = await listAllDrafts(agent, { signal });
  if (all.complete !== true) return [];
  const keep = [
    ...all.flatMap(draftLocalRefs),
    ...autosavedLocalRefs(did, store),
    ...stateLocalRefs(loadSessionDraft(did)?.state),
  ];
  return pruneDraftMedia(did, keep, { media, savedBefore: now - minAgeMs });
}
