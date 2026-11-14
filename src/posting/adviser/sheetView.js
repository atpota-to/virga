// The adviser sheet's words and buttons (ui/AdviserSheet.jsx), decided from
// the read the controller hands it (gateController.js `sheet`). Pure.

import { adviserSheetModel, adviserVerdict } from './sheet.js';

export const VERDICT_COPY = Object.freeze({
  ok: 'No issues with your goals',
  caution: 'Worth a second look',
  conflict: 'Goes against a goal you set',
});

/** What a flagged goal's row says after its name. */
export const STATUS_WORDS = Object.freeze({
  conflict: 'goes against it',
  caution: 'worth a look',
});

export const WRITING_TYPE_LABELS = Object.freeze({
  typo: 'Typo',
  grammar: 'Grammar',
  clarity: 'Clarity',
});

/** The sheet's title. */
export function sheetTitle(read) {
  return read?.mode === 'gate' ? 'Before this goes out' : 'Post adviser';
}

/** Whether the read found anything: a goal flagged, or a writing issue left. */
export function readFoundSomething(model, taken = []) {
  if (!model) return false;
  if (model.verdict === 'conflict' || model.verdict === 'caution') return true;
  if (model.writingNoteCount > 0) return true;
  return model.fixes.some((fix) => !taken.includes(fix.key));
}

/**
 * The sheet's footer. Keep editing is always there; Save as draft and
 * Publish when the sheet offers them. The primary button leans to Keep
 * editing when the post goes against a goal, else to publishing. A sheet
 * with nothing read (an empty post, nothing set up, none left this month)
 * has a single Close.
 *
 * @returns {{ closeOnly: boolean, publish: null|{ label: string }, draft: boolean, primary: 'edit'|'publish' }}
 */
export function sheetActions(
  read,
  { canPublish = true, canSaveDraft = true } = {},
) {
  const status = read?.status;
  if (status !== 'ready' && status !== 'error') {
    return { closeOnly: true, publish: null, draft: false, primary: 'edit' };
  }
  const verdict = status === 'ready' ? adviserVerdict(read.result) : null;
  const model =
    status === 'ready'
      ? adviserSheetModel(read.result, read.posts || [])
      : null;
  const found =
    status === 'error' || readFoundSomething(model, read.taken || []);
  return {
    closeOnly: false,
    publish: canPublish
      ? { label: found ? 'Publish anyway' : 'Publish' }
      : null,
    draft: !!canSaveDraft,
    primary: verdict === 'conflict' || !canPublish ? 'edit' : 'publish',
  };
}

/**
 * The line saying what the post was read alongside, or a hint to turn
 * reading the room on for a reply or a quote. '' when neither applies.
 */
export function sheetContextLine(read) {
  if (!read || read.status !== 'ready') return '';
  const kind = read.contextKind;
  const thread = read.context?.thread || [];
  if (kind && thread.length) {
    if (kind === 'quote') return 'Read with the post you’re quoting.';
    if (kind === 'selfReply')
      return thread.length === 1
        ? 'Read with your post above it.'
        : `Read with the ${thread.length} posts of yours above it.`;
    return thread.length === 1
      ? 'Read with the post you’re replying to.'
      : `Read with the conversation: ${thread.length} posts, up to the one you’re replying to.`;
  }
  if (
    !read.readTheRoom &&
    (read.scenario === 'reply' || read.scenario === 'quote')
  )
    return 'Replies and quotes can be read with the posts they answer. Turn on “Read replies with their conversation” in Settings › Posting.';
  return '';
}

/** "1/3" before each post of a thread; '' for a single post. */
export function postIndexLabel(index, total) {
  return total > 1 ? `${index + 1}/${total}` : '';
}

/** The tally's button: "Fix it", or "Fix all 3". */
export function fixAllLabel(remaining) {
  return remaining === 1 ? 'Fix it' : `Fix all ${remaining}`;
}
