// What the composer does to a thread as a whole: splitting one over-long
// post into several, putting a numbered thread's counters right, and the one
// step back from either. Each plan is a reducer action (composerModel.js)
// and what the undo has to remember; posts are named by id throughout, so a
// plan still means the same posts after the thread has moved.

import { emptyPost, MAX_POSTS } from '../lib/composerModel.js';
import {
  renumberThread,
  splitIntoThread,
  stripCounter,
  threadNumbering,
} from '../lib/threadSplit.js';

const textOf = (post) => (typeof post?.text === 'string' ? post.text : '');

/**
 * The texts post `id` would split into, or null when it wouldn't split (it
 * fits, or the thread is full). Counters count the whole thread. In a thread
 * that is already numbered the post's own counter is replaced rather than
 * left at the end of the last piece.
 * @param {object[]} posts - the thread
 * @param {string} id
 * @param {{ numbering?: 'off'|'counter' }} [options]
 * @returns {string[] | null}
 */
export function splitTexts(posts, id, { numbering = 'off' } = {}) {
  const list = Array.isArray(posts) ? posts : [];
  const index = list.findIndex((p) => p.id === id);
  if (index === -1) return null;
  const text = textOf(list[index]);
  const renumbering =
    numbering === 'counter' && threadNumbering(list.map(textOf)) !== 'none';
  const texts = splitIntoThread(renumbering ? stripCounter(text) : text, {
    numbering,
    maxPosts: MAX_POSTS - list.length + 1,
    before: index,
    after: list.length - index - 1,
  });
  return texts.length > 1 ? texts : null;
}

/**
 * Splitting post `id`: `{ action, undo }`, or null when it wouldn't split.
 * The post keeps its id and what it holds, and takes the first text; the
 * rest are new posts after it.
 */
export function planSplit(posts, id, options) {
  const texts = splitTexts(posts, id, options);
  if (!texts) return null;
  const rest = texts.slice(1).map((text) => ({ ...emptyPost(), text }));
  return {
    action: { type: 'splitPost', id, text: texts[0], rest },
    undo: {
      kind: 'split',
      text: textOf(posts.find((p) => p.id === id)),
      made: [
        { id, text: texts[0] },
        ...rest.map((p) => ({ id: p.id, text: p.text })),
      ],
    },
  };
}

/**
 * Setting every post's counter to its place: `{ action, undo }`, or null
 * when nothing would change.
 */
export function planRenumber(posts) {
  const list = Array.isArray(posts) ? posts : [];
  const next = renumberThread(list.map(textOf));
  if (list.every((p, i) => textOf(p) === next[i])) return null;
  return {
    action: {
      type: 'setTexts',
      texts: Object.fromEntries(list.map((p, i) => [p.id, next[i]])),
    },
    undo: {
      kind: 'renumber',
      before: Object.fromEntries(list.map((p) => [p.id, textOf(p)])),
      made: list.map((p, i) => ({ id: p.id, text: next[i] })),
    },
  };
}

/**
 * Whether `undo` can still be taken back in one step: the posts it made are
 * all there, together, in order, with the words it gave them, and (after a
 * split) nothing has been attached to the new ones. Once the writer has
 * changed any of that, going back would throw their change away.
 */
export function undoStands(posts, undo) {
  const list = Array.isArray(posts) ? posts : [];
  if (!undo?.made?.length) return false;
  if (undo.kind === 'renumber' && list.length !== undo.made.length) return false;
  const at = list.findIndex((p) => p.id === undo.made[0].id);
  if (at === -1) return false;
  return undo.made.every((made, i) => {
    const post = list[at + i];
    if (!post || post.id !== made.id || textOf(post) !== made.text) return false;
    const added = undo.kind === 'split' && i > 0;
    return !added || !(post.images?.length || post.video);
  });
}

/** The reducer action that takes `undo` back. */
export function undoAction(undo) {
  if (undo?.kind === 'split') {
    return {
      type: 'unsplitPost',
      id: undo.made[0].id,
      remove: undo.made.slice(1).map((m) => m.id),
      text: undo.text,
    };
  }
  if (undo?.kind === 'renumber') return { type: 'setTexts', texts: undo.before };
  return null;
}

/** What the composer says it just did, beside Undo. */
export function undoLine(undo, fmt = String) {
  const n = fmt(undo?.made?.length || 0);
  return undo?.kind === 'renumber' ? `Renumbered ${n} posts.` : `Split into ${n} posts.`;
}
