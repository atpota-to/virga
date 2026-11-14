// What the composer brings back, and what it moves out of the way, when it
// opens, when an intent brings its own words, and when the post changes
// account. The rule all of it keeps: a post the writer wrote is never written
// over. It is either still the one on screen, or set aside (autosave.js) and
// offered back. Pure over autosave.js's two layers, so it can be tested
// without the composer.

import {
  clearAutosave,
  clearSessionDraft,
  countSetAside,
  hasAutosaveContent,
  loadSessionDraft,
  readAutosave,
  setAside,
} from '../autosave.js';
import { normalizeComposerState } from '../lib/composerModel.js';

/**
 * Whether the writer chose the timer on a kept post themselves. Entries saved
 * before that was recorded fall back to "a timer that's on was chosen".
 */
export function restoredTouched(kept) {
  return typeof kept?.lifespanTouched === 'boolean' ? kept.lifespanTouched : !!kept?.state?.lifespan?.enabled;
}

/**
 * The post kept for `did`: this tab's copy first (it still has its files),
 * else the one saved in localStorage, laid over `base`.
 * `{ from: 'session' | 'autosave', state, touched, mediaLeftOut }`, or null.
 */
export function keptPostFor(did, { base, store, now } = {}) {
  if (!did) return null;
  const session = loadSessionDraft(did);
  if (session && hasAutosaveContent(session.state)) {
    return { from: 'session', state: session.state, touched: restoredTouched(session), mediaLeftOut: 0 };
  }
  const saved = readAutosave(did, { base, ...(store ? { store } : {}), ...(now ? { now } : {}) });
  if (saved) {
    return { from: 'autosave', state: normalizeComposerState(saved.state), touched: restoredTouched(saved), mediaLeftOut: saved.mediaLeftOut };
  }
  return null;
}

/** Forget the post being written for `did`, in both layers. */
export function clearKept(did, { store, now } = {}) {
  clearSessionDraft(did);
  clearAutosave(did, { ...(store ? { store } : {}), ...(now ? { now } : {}) });
}

/**
 * Set `state` aside for `did` and forget it as the post being written there.
 * Returns the set-aside id, or null when it held nothing.
 */
export function setAsideState(did, state, { touched, store, now } = {}) {
  const id = setAside(did, state, { lifespanTouched: touched, ...(store ? { store } : {}), ...(now ? { now } : {}) });
  if (id) clearKept(did, { store, now });
  return id;
}

/** Move whatever is kept for `did` into its set-aside list. The id, or null. */
export function setAsideKept(did, { base, store, now } = {}) {
  const kept = keptPostFor(did, { base, store, now });
  return kept ? setAsideState(did, kept.state, { touched: kept.touched, store, now }) : null;
}

const postTexts = (state) => (state?.posts || []).map((p) => p?.text || '');

/**
 * Whether `state` is still exactly what an intent seeded it with (`seed` is
 * `{ texts }`), so nothing in it is the writer's own. A quote, reply or link
 * card the intent asked for doesn't count as the writer's; text or media
 * they added does.
 */
export function isUntouchedSeed(state, seed) {
  if (!seed || !Array.isArray(seed.texts)) return false;
  const texts = postTexts(state);
  const seedTexts = seed.texts.length ? seed.texts : [''];
  if (texts.length !== seedTexts.length || texts.some((t, i) => t !== seedTexts[i])) return false;
  return !(state?.posts || []).some((p) => p?.images?.length || p?.video);
}

/** Whether `state` holds something of the writer's worth setting aside. */
export function worthSettingAside(state, seed = null) {
  return hasAutosaveContent(state) && !isUntouchedSeed(state, seed);
}

const isFile = (v) => !!v && typeof v === 'object' && typeof v.size === 'number' && typeof v.type === 'string';

/**
 * The composer actions that put the files `filled` found (loadDraftMedia's
 * result) into `current`, the composer's state now: only into media that
 * are still there, by id, and still have no file. What the writer changed
 * while the files were read stays as they left it.
 */
export function mediaPatches(current, filled) {
  const out = [];
  const byId = new Map((filled?.posts || []).map((p) => [p.id, p]));
  (current?.posts || []).forEach((post, index) => {
    const found = byId.get(post.id);
    if (!found) return;
    for (const image of post.images || []) {
      if (isFile(image.file) || !image.localRef) continue;
      const got = (found.images || []).find((i) => i.id === image.id && i.localRef === image.localRef);
      if (!isFile(got?.file)) continue;
      const patch = { file: got.file, mime: got.mime || image.mime || '', size: got.size ?? got.file.size };
      if (got.previewUrl && !image.previewUrl) patch.previewUrl = got.previewUrl;
      out.push({ type: 'updateImage', index, id: image.id, patch });
    }
    const v = post.video;
    if (v?.localRef && !isFile(v.file) && found.video?.localRef === v.localRef && isFile(found.video.file)) {
      out.push({ type: 'setVideo', index, video: { ...v, file: found.video.file, mime: found.video.mime || v.mime || '', size: found.video.size ?? found.video.file.size } });
    }
  });
  return out;
}

/**
 * The first of `accounts`, other than `did`, with a post kept or set aside
 * for it, as `{ did, account }`, or null: so a composer that opens empty can
 * say where the writer's unsent post went.
 */
export function otherKeptAccount(accounts, did, { store, now } = {}) {
  const opts = { ...(store ? { store } : {}), ...(now ? { now } : {}) };
  for (const account of accounts || []) {
    if (!account?.did || account.did === did) continue;
    if (keptPostFor(account.did, opts) || countSetAside(account.did, opts)) return { did: account.did, account };
  }
  return null;
}
