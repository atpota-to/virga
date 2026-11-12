// The pictures and videos in saved drafts, kept in this browser. A Bluesky
// draft can't hold media: it names each file by a `localRef` path that only
// means something on the device that saved it. Virga keeps those files in
// IndexedDB, one database per account (`virga-posting:<did>`, store `media`,
// keyed by the path), so a draft reopened here gets its media back and one
// opened anywhere else says its media is on another device.
//
// Without IndexedDB (private windows, tests) the same API is served from
// memory: the files last for the session, and nothing throws.

export const POSTING_DB_PREFIX = 'virga-posting:';
const DB_VERSION = 1;
const STORE = 'media';

// Paths Virga mints, so a localRef written by another app (a phone's file
// path) is never looked up here as if it might be ours.
export const LOCAL_REF_PREFIX = 'virga-media:';

export function postingDbName(did) {
  return `${POSTING_DB_PREFIX}${did}`;
}

export function isVirgaLocalRef(path) {
  return typeof path === 'string' && path.startsWith(LOCAL_REF_PREFIX);
}

function randomId() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** A fresh localRef path for a file about to be kept. */
export function newLocalRef() {
  return `${LOCAL_REF_PREFIX}${randomId()}`;
}

/* ---- the store -------------------------------------------------------- */

const handles = new Map();

function openIdb(idb, name) {
  return new Promise((resolve, reject) => {
    if (!idb) {
      reject(new Error('no indexedDB'));
      return;
    }
    let req;
    try {
      req = idb.open(name, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: 'ref' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    // Another tab holds an older version; this one makes do with memory.
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

function request(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function idbHandle(db, forget) {
  db.onversionchange = () => {
    db.close();
    forget();
  };
  const store = (mode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    persistent: true,
    async put(entries) {
      if (!entries.length) return;
      const os = store('readwrite');
      for (const entry of entries) os.put(entry);
      await done(os.transaction);
    },
    async get(ref) {
      return (await request(store('readonly').get(ref))) || null;
    },
    async remove(refs) {
      if (!refs.length) return;
      const os = store('readwrite');
      for (const ref of refs) os.delete(ref);
      await done(os.transaction);
    },
    async refs() {
      return (await request(store('readonly').getAllKeys())) || [];
    },
  };
}

function memoryHandle() {
  const rows = new Map();
  return {
    persistent: false,
    async put(entries) {
      for (const entry of entries) rows.set(entry.ref, entry);
    },
    async get(ref) {
      return rows.get(ref) || null;
    },
    async remove(refs) {
      for (const ref of refs) rows.delete(ref);
    },
    async refs() {
      return [...rows.keys()];
    },
  };
}

// A call that fails after the open (eviction, quota) is that call's failure
// only: reads come back empty, and writes report it to their caller.
function guarded(handle) {
  return {
    persistent: handle.persistent,
    put: (entries) => handle.put(entries),
    async get(ref) {
      try {
        return await handle.get(ref);
      } catch {
        return null;
      }
    },
    async remove(refs) {
      try {
        await handle.remove(refs);
      } catch {
        // Left behind; pruneDraftMedia catches it next time.
      }
    },
    async refs() {
      try {
        return await handle.refs();
      } catch {
        return [];
      }
    },
  };
}

function defaultIdb() {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

/**
 * `did`'s media store, opened once and shared:
 *
 *   put([{ ref, file, name, type, size, savedAt }])   one transaction
 *   get(ref)         → the entry, or null
 *   remove(refs)
 *   refs()           → every path held
 *   persistent       false when only memory is holding them
 */
export function openDraftMedia(did, { indexedDB: idb = defaultIdb() } = {}) {
  if (!did) return Promise.resolve(guarded(memoryHandle()));
  if (!handles.has(did)) {
    const forget = () => {
      if (handles.get(did) === opening) handles.delete(did);
    };
    const opening = openIdb(idb, postingDbName(did))
      .then((db) => guarded(idbHandle(db, forget)))
      .catch(() => guarded(memoryHandle()));
    handles.set(did, opening);
  }
  return handles.get(did);
}

/** Test seam, and for Remove from this browser: forget the open handles. */
export function resetDraftMedia() {
  handles.clear();
}

/* ---- media in a ComposerState ----------------------------------------- */

const isFileLike = (v) =>
  !!v &&
  typeof v === 'object' &&
  typeof v.size === 'number' &&
  typeof v.type === 'string';

function mediaOf(state) {
  const out = [];
  (state?.posts || []).forEach((post, postIndex) => {
    (post?.images || []).forEach((image, imageIndex) =>
      out.push({ kind: 'image', postIndex, imageIndex, item: image }),
    );
    if (post?.video) out.push({ kind: 'video', postIndex, item: post.video });
  });
  return out;
}

function withItem(state, at, patch) {
  const posts = state.posts.map((post, i) => {
    if (i !== at.postIndex) return post;
    if (at.kind === 'video')
      return { ...post, video: { ...post.video, ...patch } };
    return {
      ...post,
      images: post.images.map((img, j) =>
        j === at.imageIndex ? { ...img, ...patch } : img,
      ),
    };
  });
  return { ...state, posts };
}

/** Every localRef path a state's media carries. */
export function stateLocalRefs(state) {
  return mediaOf(state)
    .map((m) => m.item?.localRef)
    .filter((ref) => typeof ref === 'string' && ref);
}

/**
 * Keep every picked file in `state` that `did`'s store doesn't hold yet, and
 * give it a `localRef`. Returns `{ state, refs }`: the state with the paths
 * set, and every path it now uses. A file that already has one of Virga's
 * paths keeps it, and is copied into this store when it isn't there (a draft
 * opened from one account and saved as another). Media without a file are
 * left as they are. Throws when the files couldn't be written,
 * so a draft never names media this browser doesn't hold.
 */
export async function storeDraftMedia(
  did,
  state,
  { media, now = Date.now() } = {},
) {
  const store = media || (await openDraftMedia(did));
  let next = state;
  const entries = [];
  for (const at of mediaOf(state)) {
    const { item } = at;
    if (!isFileLike(item?.file)) continue;
    let ref = isVirgaLocalRef(item.localRef) ? item.localRef : null;
    if (ref && (await store.get(ref))) continue;
    // A new file, or one attached again over another app's path, which this
    // browser could never look up.
    if (!ref) {
      ref = newLocalRef();
      next = withItem(next, at, { localRef: ref });
    }
    entries.push({
      ref,
      file: item.file,
      name: typeof item.file.name === 'string' ? item.file.name : '',
      type: item.file.type || item.mime || '',
      size: item.file.size,
      savedAt: now,
    });
  }
  await store.put(entries);
  return { state: next, refs: stateLocalRefs(next) };
}

/**
 * Give back the files a state's localRefs name, where this browser holds
 * them. Returns `{ state, missing }`: `missing` lists the paths it couldn't
 * find (media saved on another device, or cleared since). A missing item
 * keeps its path and alt text so the composer can ask for it again.
 * `makePreviewUrl(file)` gives each found image its preview
 * (URL.createObjectURL by default, where there is one).
 */
export async function loadDraftMedia(
  did,
  state,
  { media, makePreviewUrl = defaultPreviewUrl } = {},
) {
  const store = media || (await openDraftMedia(did));
  let next = state;
  const missing = [];
  for (const at of mediaOf(state)) {
    const { item } = at;
    const ref = item?.localRef;
    if (!ref || isFileLike(item.file)) continue;
    const entry = isVirgaLocalRef(ref) ? await store.get(ref) : null;
    if (!entry?.file) {
      if (!item.blob) missing.push(ref);
      continue;
    }
    const patch = {
      file: entry.file,
      mime: entry.type || item.mime || '',
      size: entry.size ?? entry.file.size,
    };
    if (at.kind === 'image' && !item.previewUrl && makePreviewUrl) {
      try {
        patch.previewUrl = makePreviewUrl(entry.file);
      } catch {
        // No preview; the composer shows the file's name.
      }
    }
    next = withItem(next, at, patch);
  }
  return { state: next, missing };
}

function defaultPreviewUrl(file) {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(file)
    : null;
}

/**
 * The media a state names that it has neither a file nor an uploaded blob
 * for: what has to be attached again before the post can go out.
 */
export function missingDraftMedia(state) {
  return mediaOf(state)
    .filter(
      ({ item }) => item?.localRef && !isFileLike(item.file) && !item.blob,
    )
    .map(({ kind, postIndex, imageIndex, item }) => ({
      kind,
      postIndex,
      imageIndex,
      localRef: item.localRef,
      alt: item.alt || '',
    }));
}

/** Forget the files at `refs`. */
export async function removeDraftMedia(did, refs, { media } = {}) {
  const list = (refs || []).filter(isVirgaLocalRef);
  if (!list.length) return;
  const store = media || (await openDraftMedia(did));
  await store.remove(list);
}

/**
 * Forget every file no draft in `keep` (paths, or anything with them) still
 * names. Only safe with the complete list of the account's drafts, plus any
 * path the open composer holds. With `savedBefore` (a time in ms), a file
 * kept at or after it stays whatever `keep` says: it may belong to a draft
 * being saved while the list was read.
 */
export async function pruneDraftMedia(did, keep, { media, savedBefore } = {}) {
  const store = media || (await openDraftMedia(did));
  const kept = new Set(keep || []);
  let drop = (await store.refs()).filter((ref) => !kept.has(ref));
  if (typeof savedBefore === 'number') {
    const old = await Promise.all(
      drop.map(async (ref) => {
        const entry = await store.get(ref);
        // Every entry this module writes has a savedAt; one without can't
        // be from a save in progress.
        return !entry || !(entry.savedAt >= savedBefore);
      }),
    );
    drop = drop.filter((_, i) => old[i]);
  }
  await store.remove(drop);
  return drop;
}
