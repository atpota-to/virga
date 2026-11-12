// Keeping a post that hasn't been sent, in two layers.
//
// In memory, per account: the composer's whole state, files and all, so
// closing and reopening it in the same tab loses nothing.
//
// In localStorage, under `virga:composer-autosave:<did>`: what survives a
// reload. Text, the thread, tags, languages, labels, reply and quote settings,
// the post being replied to, quotes and link cards, and media only when it
// already lives somewhere a reload can't take it from (an uploaded blob, or a
// draft's files in IndexedDB, named by `localRef`). A picked file that is in
// neither is left out and counted, so the composer can say so. Entries expire
// after a day. Writes wait two seconds for typing to stop, and one still
// waiting when the page is hidden is written then; one meant for an account
// that is no longer the composer's is dropped, never filed under the next.

import { toJsonShape } from './lib/recordCid.js';

export const AUTOSAVE_PREFIX = 'virga:composer-autosave:';
export const AUTOSAVE_VERSION = 1;
export const AUTOSAVE_TTL_MS = 24 * 60 * 60 * 1000;
export const AUTOSAVE_DEBOUNCE_MS = 2000;

export function autosaveKey(did) {
  return `${AUTOSAVE_PREFIX}${did}`;
}

function localStore() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const str = (v) => (typeof v === 'string' ? v : '');
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// A preview a reload can still show: an object URL dies with the page.
const lastingUrl = (url) =>
  typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
const jsonBlob = (blob) => (isObject(blob) ? toJsonShape(blob) : null);

/* ---- serializing ------------------------------------------------------ */

function serializeImage(image, count) {
  const blob = jsonBlob(image?.blob);
  const localRef = str(image?.localRef) || null;
  if (!blob && !localRef) {
    if (image) count.left += 1;
    return null;
  }
  const out = {
    id: str(image.id) || null,
    mime: str(image.mime),
    size: Number(image.size) || 0,
    alt: str(image.alt),
  };
  if (isObject(image.aspectRatio))
    out.aspectRatio = {
      width: image.aspectRatio.width,
      height: image.aspectRatio.height,
    };
  if (localRef) out.localRef = localRef;
  if (blob) {
    out.blob = blob;
    out.blobDid = str(image.blobDid) || null;
  }
  const preview = lastingUrl(image.previewUrl);
  if (preview) out.previewUrl = preview;
  return out;
}

function serializeVideo(video, count) {
  if (!video) return null;
  const blob = jsonBlob(video.blob);
  const localRef = str(video.localRef) || null;
  if (!blob && !localRef) {
    count.left += 1;
    return null;
  }
  const out = {
    mime: str(video.mime),
    size: Number(video.size) || 0,
    alt: str(video.alt),
    // An upload in flight can't be resumed after a reload; it starts again.
    status: blob ? 'ready' : 'idle',
  };
  if (isObject(video.aspectRatio))
    out.aspectRatio = {
      width: video.aspectRatio.width,
      height: video.aspectRatio.height,
    };
  if (localRef) out.localRef = localRef;
  if (blob) {
    out.blob = blob;
    out.blobDid = str(video.blobDid) || null;
  }
  return out;
}

function serializeCard(card, count) {
  if (!card?.url) return null;
  const out = {
    url: card.url,
    title: str(card.title),
    description: str(card.description),
    thumb: lastingUrl(card.thumb),
  };
  const thumbBlob = jsonBlob(card.thumbBlob);
  if (thumbBlob) {
    out.thumbBlob = thumbBlob;
    out.thumbBlobDid = str(card.thumbBlobDid) || null;
  } else if (card.thumbFile) {
    count.left += 1;
  }
  if (card.edited) out.edited = true;
  return out;
}

function serializeRecord(record, { views }) {
  if (!record?.uri) return null;
  const out = {
    kind: record.kind || 'post',
    uri: record.uri,
    cid: record.cid || null,
  };
  if (views && isObject(record.view)) out.view = record.view;
  return out;
}

function serializePost(post, count, opts) {
  return {
    id: str(post?.id) || null,
    text: str(post?.text),
    images: (post?.images || [])
      .map((i) => serializeImage(i, count))
      .filter(Boolean),
    video: serializeVideo(post?.video, count),
    record: serializeRecord(post?.record, opts),
    card: serializeCard(post?.card, count),
  };
}

function serializeReply(reply, { views }) {
  if (!reply?.uri) return null;
  const out = {
    uri: reply.uri,
    cid: reply.cid || null,
    root: reply.root || { uri: reply.uri, cid: reply.cid || null },
  };
  if (isObject(reply.author)) out.author = reply.author;
  if (views && typeof reply.text === 'string') out.text = reply.text;
  return out;
}

/**
 * The part of a ComposerState a reload can bring back, and how many pieces
 * of media had to be left out (`mediaLeftOut`). `views: false` leaves the
 * hydrated quote and reply text out too, for a smaller entry.
 */
export function serializeComposerState(state, { views = true } = {}) {
  const count = { left: 0 };
  const opts = { views };
  const out = {
    posts: (state?.posts || []).map((p) => serializePost(p, count, opts)),
    reply: serializeReply(state?.reply, opts),
    tags: Array.isArray(state?.tags)
      ? state.tags.filter((t) => typeof t === 'string')
      : [],
    langs: Array.isArray(state?.langs)
      ? state.langs.filter((t) => typeof t === 'string')
      : [],
    labels: Array.isArray(state?.labels)
      ? state.labels.filter((t) => typeof t === 'string')
      : [],
    gates: isObject(state?.gates) ? toJsonShape(state.gates) : null,
    asDid: str(state?.asDid) || null,
    schedule: isObject(state?.schedule) ? toJsonShape(state.schedule) : null,
    lifespan: isObject(state?.lifespan) ? toJsonShape(state.lifespan) : null,
    source: isObject(state?.source) ? toJsonShape(state.source) : null,
  };
  return { state: out, mediaLeftOut: count.left };
}

const postHasContent = (p) =>
  !!(
    str(p?.text).trim() ||
    p?.images?.length ||
    p?.video ||
    p?.record ||
    p?.card
  );

/** Whether a (serialized or live) state holds anything worth keeping. */
export function hasAutosaveContent(state) {
  if (!state) return false;
  return (
    (state.posts || []).some(postHasContent) ||
    !!state.reply ||
    (state.tags || []).length > 0
  );
}

/* ---- restoring -------------------------------------------------------- */

let restoredIds = 0;
const restoredId = () =>
  `restored-${Date.now().toString(36)}-${(restoredIds += 1)}`;

function restorePost(p) {
  return {
    id: str(p?.id) || restoredId(),
    text: str(p?.text),
    images: (p?.images || []).map((i) => ({
      ...i,
      id: str(i?.id) || restoredId(),
    })),
    video: p?.video ? { ...p.video } : null,
    record: p?.record ? { ...p.record } : null,
    card: p?.card ? { ...p.card } : null,
  };
}

/**
 * A serialized state as a ComposerState: laid over `base` (normally
 * `emptyComposerState({ asDid, defaults })`), so whatever the entry lacks
 * comes from the account's defaults. Fields it holds as null (no reply, no
 * schedule) stay null; a missing `gates` or `lifespan` keeps the base's.
 */
export function deserializeComposerState(stored, base = {}) {
  const s = isObject(stored) ? stored : {};
  const posts = (s.posts || []).map(restorePost);
  const out = {
    ...base,
    posts: posts.length ? posts : base.posts || [restorePost({})],
  };
  for (const key of [
    'reply',
    'tags',
    'langs',
    'labels',
    'asDid',
    'schedule',
    'source',
  ]) {
    if (Object.hasOwn(s, key) && s[key] !== undefined) out[key] = s[key];
  }
  // Never null in a ComposerState: without a stored one, the base's stands.
  if (isObject(s.gates)) out.gates = s.gates;
  if (isObject(s.lifespan)) out.lifespan = s.lifespan;
  if (!out.asDid && base.asDid) out.asDid = base.asDid;
  return out;
}

/* ---- localStorage ----------------------------------------------------- */

function remove(store, did) {
  try {
    store?.removeItem(autosaveKey(did));
  } catch {
    // Nothing else can be done; the TTL clears it in a day.
  }
}

/** Forget `did`'s saved post. */
export function clearAutosave(did, { store = localStore() } = {}) {
  if (did) remove(store, did);
}

/**
 * Write `state` for `did` now. An empty state clears the entry. Returns the
 * entry written, or null. When storage is full, tries again without the
 * hydrated views before giving up.
 */
export function writeAutosave(
  did,
  state,
  { store = localStore(), now = Date.now() } = {},
) {
  if (!did || !store) return null;
  if (!hasAutosaveContent(state)) {
    remove(store, did);
    return null;
  }
  for (const views of [true, false]) {
    const { state: saved, mediaLeftOut } = serializeComposerState(state, {
      views,
    });
    const entry = {
      version: AUTOSAVE_VERSION,
      savedAt: now,
      did,
      mediaLeftOut,
      state: saved,
    };
    try {
      store.setItem(autosaveKey(did), JSON.stringify(entry));
      return entry;
    } catch {
      // Over quota: the second pass is smaller.
    }
  }
  return null;
}

/**
 * `did`'s saved post: `{ state, savedAt, mediaLeftOut }` with the state laid
 * over `base`, or null. An entry that is from another version, older than a
 * day, filed for another account, or empty is cleared on the way.
 */
export function readAutosave(
  did,
  { store = localStore(), now = Date.now(), base } = {},
) {
  if (!did || !store) return null;
  let entry = null;
  try {
    entry = JSON.parse(store.getItem(autosaveKey(did)) || 'null');
  } catch {
    entry = null;
  }
  if (!entry) {
    remove(store, did);
    return null;
  }
  const stale =
    entry.version !== AUTOSAVE_VERSION ||
    typeof entry.savedAt !== 'number' ||
    now - entry.savedAt > AUTOSAVE_TTL_MS ||
    (entry.did && entry.did !== did) ||
    !hasAutosaveContent(entry.state);
  if (stale) {
    remove(store, did);
    return null;
  }
  return {
    state: deserializeComposerState(entry.state, base),
    savedAt: entry.savedAt,
    mediaLeftOut: Number(entry.mediaLeftOut) || 0,
  };
}

/**
 * The debounced writer the composer holds:
 *
 *   const autosave = createAutosaver({ currentDid: () => composerDid })
 *   autosave.save(did, state)   // written two seconds after the last call
 *   autosave.flush()            // write what's waiting now
 *   autosave.cancel()           // drop what's waiting (after a publish)
 *   autosave.dispose()          // cancel and stop listening for page hide
 *
 * A write waiting when the page is hidden (`pagehide`, or the document going
 * hidden) is written then. `currentDid`, when given, is asked at write time:
 * a write for any other account is dropped.
 */
export function createAutosaver({
  store = localStore(),
  now = () => Date.now(),
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
  currentDid,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  target = typeof window === 'undefined' ? null : window,
  doc = typeof document === 'undefined' ? null : document,
} = {}) {
  let timer = null;
  let pending = null;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    pending = null;
  };

  const flush = () => {
    const job = pending;
    cancel();
    if (!job) return null;
    if (typeof currentDid === 'function' && currentDid() !== job.did)
      return null;
    return writeAutosave(job.did, job.state, { store, now: now() });
  };

  const save = (did, state) => {
    if (timer !== null) clearTimer(timer);
    pending = did ? { did, state } : null;
    timer = pending ? setTimer(flush, debounceMs) : null;
  };

  const onHidden = () => {
    if (!doc || doc.visibilityState === 'hidden') flush();
  };
  target?.addEventListener?.('pagehide', flush);
  doc?.addEventListener?.('visibilitychange', onHidden);

  return {
    save,
    flush,
    cancel,
    pending: () => (pending ? pending.did : null),
    dispose() {
      cancel();
      target?.removeEventListener?.('pagehide', flush);
      doc?.removeEventListener?.('visibilitychange', onHidden);
    },
  };
}

/* ---- in memory, for the tab --------------------------------------------- */

const sessionDrafts = new Map();

/** Keep `state` (files and all) for `did` until the tab closes. */
export function saveSessionDraft(did, state, now = Date.now()) {
  if (!did) return;
  if (!hasAutosaveContent(state)) sessionDrafts.delete(did);
  else sessionDrafts.set(did, { state, savedAt: now });
}

/** `{ state, savedAt }` kept for `did`, or null. */
export function loadSessionDraft(did) {
  return (did && sessionDrafts.get(did)) || null;
}

export function clearSessionDraft(did) {
  if (did) sessionDrafts.delete(did);
}

export function clearAllSessionDrafts() {
  sessionDrafts.clear();
}

/** Every object URL a state shows (image previews, a card's picked thumbnail). */
export function collectPreviewUrls(state) {
  const urls = new Set();
  const add = (url) => {
    if (typeof url === 'string' && url.startsWith('blob:')) urls.add(url);
  };
  for (const post of state?.posts || []) {
    for (const image of post?.images || []) add(image?.previewUrl);
    add(post?.video?.previewUrl);
    add(post?.card?.thumb);
  }
  return urls;
}

/**
 * Whether an object URL may be revoked: only when neither `state` (the
 * composer as it now is) nor any account's kept draft still shows it.
 */
export function previewUrlIsHeld(url, state) {
  if (collectPreviewUrls(state).has(url)) return true;
  for (const { state: kept } of sessionDrafts.values()) {
    if (collectPreviewUrls(kept).has(url)) return true;
  }
  return false;
}
