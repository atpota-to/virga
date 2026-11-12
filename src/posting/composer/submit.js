// The parts of sending a post that aren't the network calls themselves: the
// two-stage clock on a publish, the line that says what's happening, the
// words for success and failure, which rows hold queue slots, and what to do
// with the draft or scheduled post the composer was opened from once the
// post is out (DESIGN.md §6.1a). Pure, or with every call injected.

import { isMissingScopeError } from '../../session/scopes.js';
import { isReauthRequiredError } from '../../session/accounts.js';
import { bskyUrlFor } from '../lib/postLink.js';

export const SLOW_PUBLISH_MS = 60_000;
export const HARD_PUBLISH_MS = 180_000;

export const SLOW_PUBLISH_NOTE =
  'Still publishing. Please don’t send it again.';
export const HARD_PUBLISH_ERROR =
  'This is taking longer than it should. Your post may still have gone out: check your profile before trying again, so it doesn’t go out twice.';
export const SCHEDULED_COPY_REMAINS =
  'Your post went out, but its scheduled copy is still waiting in your queue. Cancel it in Scheduled posts, or it will go out again.';
export const DRAFT_NOT_DELETED =
  'Your post went out, but its draft couldn’t be deleted. Delete it in Drafts.';

/**
 * Watches one publish: `onSlow` after `slowMs`, `onHard` after `hardMs`,
 * unless `stop()` comes first. The publish itself isn't aborted: a write
 * that's under way may still land, which is why the hard message says to
 * check.
 */
export function createPublishWatch({
  slowMs = SLOW_PUBLISH_MS,
  hardMs = HARD_PUBLISH_MS,
  onSlow,
  onHard,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let done = false;
  const slow = setTimer(() => {
    if (!done) onSlow?.();
  }, slowMs);
  const hard = setTimer(() => {
    if (done) return;
    done = true;
    onHard?.();
  }, hardMs);
  return {
    /** True when the hard limit had already passed. */
    stop() {
      const late = done;
      done = true;
      clearTimer(slow);
      clearTimer(hard);
      return late;
    },
    get expired() {
      return done;
    },
  };
}

/** The line the busy row shows for a publish progress event, or null. */
export function progressLine(event, { posts = 1 } = {}) {
  if (!event || typeof event !== 'object') return null;
  if (event.phase === 'uploading' && event.kind === 'images') {
    const total = event.total || 0;
    if (!total) return null;
    return event.done >= total
      ? `Uploaded ${total === 1 ? 'the image' : `${total} images`}`
      : `Uploading ${total === 1 ? 'the image' : `images, ${event.done} of ${total}`}`;
  }
  if (event.phase === 'uploading' && event.kind === 'card')
    return 'Adding the link card’s image';
  if (event.phase === 'video') {
    if (event.step === 'checking') return 'Checking the video';
    if (event.step === 'uploading') return 'Uploading the video';
    if (event.step === 'processing') {
      const pct = Math.round(
        (event.progress || 0) * (event.progress > 1 ? 1 : 100),
      );
      return pct > 0 ? `Processing the video, ${pct}%` : 'Processing the video';
    }
  }
  if (event.phase === 'writing') {
    const n = event.count || posts;
    return n > 1
      ? `Publishing ${n} posts to your repo`
      : 'Publishing to your repo';
  }
  return null;
}

/**
 * How to show a publish that failed: `{ message, silent, permission, reauth }`.
 * `silent` for a cancel the writer asked for; `permission` when the account
 * was signed in before Virga asked to post; `reauth` when it must sign in.
 */
export function publishErrorView(err) {
  if (!err)
    return { message: '', silent: true, permission: false, reauth: false };
  if (err.code === 'ABORTED' || err.name === 'AbortError' || err.canceled) {
    return { message: '', silent: true, permission: false, reauth: false };
  }
  if (err.code === 'MISSING_SCOPE' || isMissingScopeError(err)) {
    return {
      message: 'Virga needs permission to post. Sign in again to grant it.',
      silent: false,
      permission: true,
      reauth: false,
    };
  }
  if (isReauthRequiredError(err) || err.status === 401) {
    return {
      message: 'This account needs to sign in again before it can post.',
      silent: false,
      permission: false,
      reauth: true,
    };
  }
  const message =
    typeof err.message === 'string' && err.message.trim()
      ? err.message.trim()
      : 'The post didn’t go out. Try again.';
  return { message, silent: false, permission: false, reauth: false };
}

/** The account as the success line names it: "@handle", else its DID. */
export function accountLabel(account, did) {
  if (account?.handle) return `@${account.handle}`;
  return account?.displayName || did || 'this account';
}

/** The toast after a post goes out: `{ text, href }`. */
export function postedToast({ account, did, root }) {
  return {
    text: `Posted as ${accountLabel(account, did)}.`,
    href: root?.uri ? bskyUrlFor(root.uri, account?.handle) : null,
  };
}

function whenWords(iso, { now = new Date(), locale = 'en-US', timeZone } = {}) {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return '';
  const opts = timeZone ? { timeZone } : {};
  const day = (d) => d.toLocaleDateString('en-CA', opts);
  const time = at.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...opts,
  });
  const today = day(new Date(now));
  const tomorrow = day(new Date(new Date(now).getTime() + 86_400_000));
  if (day(at) === today) return `today at ${time}`;
  if (day(at) === tomorrow) return `tomorrow at ${time}`;
  const date = at.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...opts,
  });
  return `${date} at ${time}`;
}

/** "Scheduled for tomorrow at 9:00 AM as @x." and the queue's version. */
export function scheduledMessage({
  at,
  queued = false,
  editing = false,
  account,
  did,
  now,
  locale,
  timeZone,
} = {}) {
  const when = whenWords(at, { now, locale, timeZone });
  const who = accountLabel(account, did);
  if (queued)
    return `${editing ? 'Moved in' : 'Added to'} the queue, going out ${when} as ${who}.`;
  return `${editing ? 'Rescheduled' : 'Scheduled'} for ${when} as ${who}.`;
}

export { whenWords };

/**
 * The rows that hold queue slots for this post's slot search: every queued
 * row (any app's), leaving out the row being edited, so saving it again
 * doesn't send it to the back.
 */
export function queueSlotRows(rows, { excludeId = null } = {}) {
  return (rows || []).filter(
    (r) =>
      r &&
      r.queued &&
      r.id !== excludeId &&
      (r.status === 'pending' ||
        r.status === 'publishing' ||
        r.status === 'failed'),
  );
}

/**
 * After a post went out from a draft or a scheduled post: delete the draft
 * (as its owner), or cancel the scheduled row so it doesn't go out again
 * (one retry). Resolves to `{ status: 'none' | 'done' | 'failed', warning,
 * keepSource }`; `keepSource` means the composer should hold on to the
 * source so the writer can try again. Never rejects.
 *
 * @param {object|null} source - ComposerState.source
 * @param {object} deps - `{ asDid, agentFor, backendFor, deleteDraft, cancelScheduled, wait }`
 */
export async function finishSource(source, deps) {
  const {
    asDid,
    agentFor,
    backendFor,
    deleteDraft,
    cancelScheduled,
    wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = deps || {};
  if (!source?.id) return { status: 'none', warning: '', keepSource: false };
  if (source.kind === 'draft') {
    try {
      const agent = await agentFor(source.ownerDid || asDid);
      await deleteDraft(agent, source.id);
      return { status: 'done', warning: '', keepSource: false };
    } catch {
      return {
        status: 'failed',
        warning: DRAFT_NOT_DELETED,
        keepSource: false,
      };
    }
  }
  if (source.kind === 'scheduled') {
    const req = backendFor?.(asDid);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!req) throw new Error('No server session');
        await cancelScheduled(req, source.id);
        return { status: 'done', warning: '', keepSource: false };
      } catch (err) {
        // Already gone or going out counts: the worker won't send it twice.
        if (err?.status === 404)
          return { status: 'done', warning: '', keepSource: false };
        if (attempt === 0) await wait(1500);
      }
    }
    return {
      status: 'failed',
      warning: SCHEDULED_COPY_REMAINS,
      keepSource: true,
    };
  }
  return { status: 'none', warning: '', keepSource: false };
}
