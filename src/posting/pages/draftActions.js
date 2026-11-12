// The Drafts page's quick actions, outside React: post a draft now, or
// schedule it, without opening the composer. Each goes through the same
// steps the composer would (DESIGN §6.1a): open the draft with the account's
// posting defaults, refuse when its pictures aren't in this browser, settle
// who can reply, then publish or schedule. The draft is deleted only after
// that has worked, so a failure keeps it.
//
// Everything that touches the network is passed in, so the tests can stand
// in for it.

import { blobCid } from '../lib/blobs.js';
import { countPhrase } from './hubModel.js';

/** The meta line under a draft in a list, as short parts joined with " · ". */
export function draftMeta(row, now = Date.now()) {
  if (!row) return [];
  const parts = [];
  if (row.isThread) parts.push(`Thread of ${row.posts}`);
  if (row.isReply) parts.push('Reply');
  if (row.images) parts.push(countPhrase(row.images, 'image'));
  if (row.video) parts.push('Video');
  if (row.link) parts.push('Link card');
  if (row.record) parts.push(recordWord(row.record));
  if (row.labels?.length) parts.push('Content warning');
  if (row.tags?.length) parts.push(row.tags.map((t) => `#${t}`).join(' '));
  if (row.deviceName && !row.savedHere) parts.push(`Saved in ${row.deviceName}`);
  const edited = editedLabel(row.updatedAt, now);
  if (edited) parts.unshift(edited);
  return parts;
}

function recordWord(record) {
  const kind = record?.kind;
  if (kind === 'feed') return 'Shares a feed';
  if (kind === 'list') return 'Shares a list';
  if (kind === 'starterpack') return 'Shares a starter pack';
  return 'Quotes a post';
}

/** "Edited just now", "Edited 5 min ago", "Edited Nov 3". */
export function editedLabel(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return 'Edited just now';
  if (mins < 60) return `Edited ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Edited ${hrs} hr ago`;
  const d = new Date(t);
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric';
  return `Edited ${d.toLocaleDateString('en-US', opts)}`;
}

/**
 * Why a draft row can't be scheduled from the list, or '' when it can:
 * replies and videos can't be (D19), and media kept on another device has to
 * be attached again first.
 */
export function draftScheduleBlock(row, { canSchedule }) {
  if (!canSchedule) return 'Scheduling needs a long session.';
  if (row?.isReply) return 'Replies can’t be scheduled. Post it now instead.';
  if (row?.video) return 'Posts with video can’t be scheduled. Post it now instead.';
  if (row?.mediaElsewhere) return 'Its images were saved on another device. Open it to attach them again.';
  return '';
}

/** Why a draft row can't be posted from the list, or '' when it can. */
export function draftPostBlock(row, { canPost }) {
  if (!canPost) return 'Virga needs permission to post.';
  if (row?.mediaElsewhere) return 'Its images were saved on another device. Open it to attach them again.';
  if (row && !row.text.trim() && !row.images && !row.video && !row.link && !row.record)
    return 'There’s nothing in it to post yet.';
  return '';
}

export class DraftActionError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * The draft as a ComposerState ready to go out: opened with the account's
 * posting settings as defaults (openDraft fills in the pictures this browser
 * keeps), refused when some are missing, with the reply settings resolved
 * when the draft didn't choose any, and its default timer kept only where it
 * can be set. Resolves to `{ state, notes }`.
 *
 * deps: openDraft, resolveDefaultGates, agent (the account's), settings,
 * timerRoom: async (rule) => '' or the reason it can't be set (null to drop
 * any timer: a browser session, or no long session).
 */
export async function prepareDraft(view, { did, settings, agent, deps }) {
  const { state: opened, missing } = await deps.openDraft(view, {
    asDid: did,
    defaults: settings,
  });
  if (missing?.length) {
    throw new DraftActionError(
      'MEDIA_MISSING',
      'This draft’s images were saved on another device. Open it to attach them again, then post it.',
    );
  }
  const notes = [];
  let state = opened;
  if (!state.gates?.custom && !state.reply) {
    const resolved = await deps.resolveDefaultGates(settings, { agent });
    state = { ...state, gates: resolved.gates };
    if (resolved.notice) notes.push(resolved.notice);
  }
  if (state.lifespan?.enabled) {
    const reason = deps.timerRoom ? await deps.timerRoom(state.lifespan) : null;
    if (reason !== '') {
      state = { ...state, lifespan: { ...state.lifespan, enabled: false } };
      if (reason) notes.push(`It went without your default timer. ${reason}`);
    }
  }
  return { state, notes };
}

/**
 * Post a draft now. Resolves to `{ result, notes, timer, deleted }`:
 * `result` publish's, `timer` armAfterPublish's (null when no timer was
 * asked for), `deleted` whether the draft could be removed afterwards (a
 * post that went out is never undone because of it).
 *
 * deps: everything prepareDraft takes, plus publish, targetFor, deleteDraft,
 * emitPostsChanged, resolveMention, armTimer: async (result, state) =>
 * armAfterPublish's answer.
 */
export async function postDraftNow(view, { did, settings, agent, deps }) {
  const { state, notes } = await prepareDraft(view, { did, settings, agent, deps });
  const target = await deps.targetFor(did);
  const result = await deps.publish(state, target, {
    resolveMention: deps.resolveMention,
    requireAltText: settings?.requireAltText === true,
  });
  deps.emitPostsChanged(did, { added: result.written || [] });
  let timer = null;
  if (state.lifespan?.enabled && deps.armTimer) {
    timer = await deps.armTimer(result, state);
    if (timer?.status === 'failed') {
      notes.push(
        `It went out without its timer${timer.error?.message ? `: ${timer.error.message}` : '.'}`,
      );
    }
  }
  const deleted = await deleteQuietly(view, { agent, deps });
  if (!deleted) notes.push('It’s still in your drafts: delete it there when you’re ready.');
  return { result, notes, timer, deleted };
}

/**
 * Schedule a draft for `scheduledFor` (an ISO string), or the next queue
 * slot when `queued`. The caller works the slot out (nextOpenSlot) and
 * passes it as `scheduledFor` too. Resolves to `{ row, notes, deleted }`.
 *
 * deps: everything prepareDraft takes, plus serializeForSchedule,
 * createScheduled, requester (backendFor(did)), deleteDraft,
 * resolveMention, loadImage.
 */
export async function scheduleDraft(
  view,
  { did, settings, agent, scheduledFor, queued = false, now = new Date(), deps },
) {
  if (!deps.requester) {
    throw new DraftActionError('NEEDS_BACKEND', 'Scheduling needs this account signed in for a long session.');
  }
  const { state, notes } = await prepareDraft(view, { did, settings, agent, deps });
  const body = await deps.serializeForSchedule(state, {
    now,
    scheduledFor,
    queued,
    resolveMention: deps.resolveMention,
    loadImage: deps.loadImage,
  });
  const row = await deps.createScheduled(deps.requester, body);
  const deleted = await deleteQuietly(view, { agent, deps });
  if (!deleted) notes.push('It’s still in your drafts: delete it there when you’re ready.');
  return { row, notes, deleted };
}

async function deleteQuietly(view, { agent, deps }) {
  try {
    await deps.deleteDraft(agent, view.id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the bytes of a picture a draft names by blob (one saved by an app that
 * uploads draft images, rather than keeping them on the device), from the
 * account's PDS. Null when it can't be read; the serializer then refuses
 * with IMAGE_MISSING.
 */
export function blobImageLoader({ did, pdsUrl, fetch = globalThis.fetch }) {
  return async (image) => {
    if (image?.file) return image.file;
    const cid = blobCid(image?.blob);
    if (!cid || !pdsUrl || typeof fetch !== 'function') return null;
    try {
      const url = `${pdsUrl.replace(/\/+$/, '')}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  };
}

/** The message for a quick action that failed, in plain words. */
export function draftActionMessage(err, { action }) {
  if (!err) return '';
  if (err.code === 'MEDIA_MISSING' || err.code === 'NEEDS_BACKEND') return err.message;
  if (err.code === 'DRAFT_LIMIT') return err.message;
  if (err.code === 'MISSING_SCOPE') return err.message;
  if (err.problems?.length) return err.problems[0].message;
  const base = action === 'schedule' ? 'The draft couldn’t be scheduled.' : 'The draft couldn’t be posted.';
  return err.message ? `${base} ${err.message}` : `${base} Try again.`;
}
