// The composer's split button: post now, schedule, add to the weekly queue,
// or save a draft. The account's `defaultAction` (posting settings) picks the
// primary half; the others sit under the caret. Shared by the composer and
// Settings › Posting.

export const PUBLISH_ACTIONS = Object.freeze({
  POST: 'post',
  SCHEDULE: 'schedule',
  QUEUE: 'queue',
  DRAFT: 'draft',
});

export const DEFAULT_PUBLISH_ACTION = PUBLISH_ACTIONS.POST;

// Order and words for both the caret menu and the settings control.
export const PUBLISH_ACTION_OPTIONS = Object.freeze([
  { value: PUBLISH_ACTIONS.POST, label: 'Post now' },
  { value: PUBLISH_ACTIONS.SCHEDULE, label: 'Schedule' },
  { value: PUBLISH_ACTIONS.QUEUE, label: 'Add to queue' },
  { value: PUBLISH_ACTIONS.DRAFT, label: 'Save draft' },
]);

/** Why "Add to queue" is off when the weekly schedule has no times. */
export const EMPTY_QUEUE_HINT =
  'Add some times to your weekly schedule first, in Posting › Weekly schedule.';

/** Why Schedule and Add to queue are off on an account without a long session. */
export const NEEDS_BACKEND_HINT =
  'Scheduling needs a long session. Reconnect this account through Virga’s server.';

/** The same, in a build that only signs in through the browser: there's nothing to reconnect to. */
export const NO_BACKEND_HINT =
  'Scheduling needs a long session, which this copy of Virga doesn’t offer.';

/**
 * Why scheduling is off for an account without a long session, for the
 * build's sign-in (`authMode`, the session's): only a build that offers
 * Virga's server ('backend') can be told to reconnect through it.
 */
export function needsBackendHint(authMode = 'backend') {
  return authMode === 'backend' ? NEEDS_BACKEND_HINT : NO_BACKEND_HINT;
}

export const REPLY_HINT = 'Replies can’t be scheduled. Post it now instead.';
export const VIDEO_HINT =
  'Posts with video can’t be scheduled. Post it now instead.';

const VALID = new Set(PUBLISH_ACTION_OPTIONS.map((o) => o.value));

/** A stored or unknown value as a real action ('post' for anything else). */
export function normalizePublishAction(value) {
  // Anisota's settings call posting now 'publish'.
  if (value === 'publish') return PUBLISH_ACTIONS.POST;
  return VALID.has(value) ? value : DEFAULT_PUBLISH_ACTION;
}

export function getPublishActionLabel(action) {
  const normalized = normalizePublishAction(action);
  return PUBLISH_ACTION_OPTIONS.find((o) => o.value === normalized).label;
}

/**
 * Why this post can't be scheduled or queued at all, or null when it can:
 * the account has no long session, or the post is a reply (or continues a
 * thread) or carries a video, which the server can't hold. `authMode` is the
 * session's, which picks the long-session wording (needsBackendHint).
 */
export function scheduleBlockReason({
  canSchedule = true,
  reply = false,
  video = false,
  authMode = 'backend',
} = {}) {
  if (!canSchedule) return needsBackendHint(authMode);
  if (reply) return REPLY_HINT;
  if (video) return VIDEO_HINT;
  return null;
}

/**
 * Which action the primary half performs for this post. When the preferred
 * one can't happen here (the post can't be scheduled, or there are no
 * drafts), it falls back to posting now.
 *
 * An empty weekly schedule deliberately doesn't fall back: quietly posting
 * something meant for the queue is the outcome to avoid, so "Add to queue"
 * stays primary and is disabled with EMPTY_QUEUE_HINT.
 *
 * @param {object} params
 * @param {string} params.preferred - the account's defaultAction
 * @param {boolean} params.canSchedule - this post can be scheduled or queued
 * @param {boolean} params.canSaveDraft - this post can be saved as a draft
 * @returns {string} one of PUBLISH_ACTIONS
 */
export function resolvePrimaryPublishAction({
  preferred,
  canSchedule = false,
  canSaveDraft = false,
} = {}) {
  const wanted = normalizePublishAction(preferred);
  if (
    (wanted === PUBLISH_ACTIONS.SCHEDULE || wanted === PUBLISH_ACTIONS.QUEUE) &&
    !canSchedule
  )
    return DEFAULT_PUBLISH_ACTION;
  if (wanted === PUBLISH_ACTIONS.DRAFT && !canSaveDraft)
    return DEFAULT_PUBLISH_ACTION;
  return wanted;
}

/**
 * Why an action can't run right now, or null when it can. `scheduleBlock` is
 * scheduleBlockReason's answer for the post.
 */
export function publishActionBlockReason(
  action,
  { queueEmpty = false, scheduleBlock = null } = {},
) {
  const normalized = normalizePublishAction(action);
  if (
    normalized === PUBLISH_ACTIONS.SCHEDULE ||
    normalized === PUBLISH_ACTIONS.QUEUE
  ) {
    if (scheduleBlock) return scheduleBlock;
    if (normalized === PUBLISH_ACTIONS.QUEUE && queueEmpty)
      return EMPTY_QUEUE_HINT;
  }
  return null;
}
