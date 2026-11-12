// The composer's split button: which action the primary half runs, and for
// each of post now, schedule, add to queue and save draft whether it can run
// and, when it can't, the sentence that says why. Pure: the composer passes
// what it knows about the post and the account.

import {
  PUBLISH_ACTIONS,
  resolvePrimaryPublishAction,
  publishActionBlockReason,
  scheduleBlockReason,
} from '../schedule/publishActions.js';
import { countComposerGraphemes } from '../lib/inlineLinks.js';
import { MAX_POST_GRAPHEMES, isEmptyComposer } from '../lib/composerModel.js';
import { isScheduleEmpty } from '../schedule/postingQueue.js';
import { POSTING_REGRANT_MESSAGE } from '../../accounts/accountCopy.js';

// Bluesky's drafts keep up to 1000 graphemes a post, so a post over the
// posting limit can still be saved.
export const DRAFT_MAX_GRAPHEMES = 1000;

export const OVER_LIMIT_HINT =
  'A post is over 300 characters. Shorten it, split it into a thread, or save it as a draft.';
export const EMPTY_HINT = 'Write something first.';
export const VIDEO_PENDING_HINT = 'Wait for the video to finish uploading.';
export const MEDIA_MISSING_HINT =
  'Add the missing images again before this goes out.';
export const SIGNED_OUT_HINT =
  'This account is signed out. Sign back in to post as it.';

/** Facts about the post the actions depend on. */
export function postFacts(state) {
  const posts = state?.posts || [];
  const lengths = posts.map((p) =>
    countComposerGraphemes((p.text || '').trim()),
  );
  return {
    hasContent: !isEmptyComposer(state),
    overLimit: lengths.some((n) => n > MAX_POST_GRAPHEMES),
    overDraftLimit: lengths.some((n) => n > DRAFT_MAX_GRAPHEMES),
    hasVideo: posts.some((p) => !!p.video),
    videoPending: posts.some(
      (p) => p.video && ['uploading', 'processing'].includes(p.video.status),
    ),
    reply: !!state?.reply,
    thread: posts.length > 1,
    editingScheduled: state?.source?.kind === 'scheduled',
  };
}

/**
 * `{ primary, draftFallback, actions: { post, schedule, queue, draft } }`,
 * each action `{ disabled, reason }`.
 *
 * @param {object} state - the ComposerState
 * @param {object} options
 * @param {string} options.defaultAction - the account's posting setting
 * @param {object} options.queue - the account's weekly schedule
 * @param {{ canPost: boolean, canSchedule: boolean }} options.caps
 * @param {boolean} [options.signedOut] - the posting account needs a sign-in
 * @param {boolean} [options.missingMedia] - a draft's media isn't in this browser
 */
export function composerActions(
  state,
  {
    defaultAction,
    queue,
    caps = {},
    signedOut = false,
    missingMedia = false,
  } = {},
) {
  const f = postFacts(state);
  const canPost = caps.canPost !== false;
  const common = !f.hasContent
    ? EMPTY_HINT
    : signedOut
      ? SIGNED_OUT_HINT
      : null;

  const post =
    common ||
    (!canPost ? POSTING_REGRANT_MESSAGE : null) ||
    (f.overLimit ? OVER_LIMIT_HINT : null) ||
    (missingMedia ? MEDIA_MISSING_HINT : null) ||
    (f.videoPending ? VIDEO_PENDING_HINT : null);

  const scheduleBlock = scheduleBlockReason({
    canSchedule: !!caps.canSchedule,
    reply: f.reply,
    video: f.hasVideo,
  });
  const queueEmpty = isScheduleEmpty(queue);
  const scheduling = (action) =>
    publishActionBlockReason(action, { queueEmpty, scheduleBlock }) ||
    common ||
    (f.overLimit ? OVER_LIMIT_HINT : null) ||
    (missingMedia ? MEDIA_MISSING_HINT : null);

  const draft =
    common ||
    (f.overDraftLimit
      ? `A post is over ${DRAFT_MAX_GRAPHEMES} characters, too long even for a draft.`
      : null);

  const actions = {
    [PUBLISH_ACTIONS.POST]: { disabled: !!post, reason: post },
    [PUBLISH_ACTIONS.SCHEDULE]: {
      disabled: !!scheduling(PUBLISH_ACTIONS.SCHEDULE),
      reason: scheduling(PUBLISH_ACTIONS.SCHEDULE),
    },
    [PUBLISH_ACTIONS.QUEUE]: {
      disabled: !!scheduling(PUBLISH_ACTIONS.QUEUE),
      reason: scheduling(PUBLISH_ACTIONS.QUEUE),
    },
    [PUBLISH_ACTIONS.DRAFT]: { disabled: !!draft, reason: draft },
  };

  let primary;
  let draftFallback = false;
  if (state?.schedule?.mode === 'queue') primary = PUBLISH_ACTIONS.QUEUE;
  else if (state?.schedule?.mode === 'at') primary = PUBLISH_ACTIONS.SCHEDULE;
  else
    primary = resolvePrimaryPublishAction({
      preferred: defaultAction,
      canSchedule: !scheduleBlock,
      canSaveDraft: true,
    });
  if (
    f.overLimit &&
    f.hasContent &&
    !f.overDraftLimit &&
    primary !== PUBLISH_ACTIONS.DRAFT &&
    !f.editingScheduled
  ) {
    primary = PUBLISH_ACTIONS.DRAFT;
    draftFallback = true;
  }
  return { primary, draftFallback, actions, facts: f };
}

/** The words on the button for an action. */
export function actionLabel(action, state, { short = false } = {}) {
  const f = postFacts(state);
  switch (action) {
    case PUBLISH_ACTIONS.SCHEDULE:
      return f.editingScheduled && state?.schedule?.mode === 'at'
        ? 'Save changes'
        : short
          ? 'Schedule'
          : 'Schedule…';
    case PUBLISH_ACTIONS.QUEUE:
      return f.editingScheduled && state?.schedule?.mode === 'queue'
        ? 'Save changes'
        : 'Add to queue';
    case PUBLISH_ACTIONS.DRAFT:
      return state?.source?.kind === 'draft' ? 'Save draft' : 'Save as draft';
    default:
      if (f.reply) return 'Reply';
      return f.thread ? `Post ${state.posts.length} posts` : 'Post';
  }
}
