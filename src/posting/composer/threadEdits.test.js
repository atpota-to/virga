import { describe, expect, it } from 'vitest';
import { composerReducer, emptyComposerState, MAX_POSTS } from '../lib/composerModel.js';
import { countComposerGraphemes } from '../lib/inlineLinks.js';
import { planRenumber, planSplit, splitTexts, undoAction, undoLine, undoStands } from './threadEdits.js';

const sentence = 'The river ran high after the storm and the herons came back. ';
const long = sentence.repeat(12).trim();

function thread(...texts) {
  let state = emptyComposerState({ asDid: 'did:plc:me' });
  texts.forEach((text, index) => {
    if (index > 0) state = composerReducer(state, { type: 'addPost' });
    state = composerReducer(state, { type: 'setText', index, text });
  });
  return state;
}
const texts = (state) => state.posts.map((p) => p.text);

describe('splitting a post in the composer', () => {
  it('replaces the post in place and can be taken back in one step', () => {
    let state = thread('Before.', long, 'After.');
    state = composerReducer(state, { type: 'addImages', index: 1, images: [{ id: 'i', file: {}, alt: '' }] });
    const before = state;
    const plan = planSplit(state.posts, state.posts[1].id);
    state = composerReducer(state, plan.action);

    expect(state.posts.length).toBeGreaterThan(3);
    expect(texts(state)[0]).toBe('Before.');
    expect(texts(state).at(-1)).toBe('After.');
    expect(texts(state).slice(1, -1).join(' ')).toBe(long);
    for (const text of texts(state)) expect(countComposerGraphemes(text)).toBeLessThanOrEqual(300);
    // What the post held stays with the first of them.
    expect(state.posts[1].id).toBe(before.posts[1].id);
    expect(state.posts[1].images).toHaveLength(1);
    expect(state.posts[2].images).toEqual([]);

    expect(undoStands(state.posts, plan.undo)).toBe(true);
    expect(undoLine(plan.undo)).toBe(`Split into ${state.posts.length - 2} posts.`);
    state = composerReducer(state, undoAction(plan.undo));
    expect(texts(state)).toEqual(texts(before));
    expect(state.posts[1].images).toHaveLength(1);
  });

  it('has nothing to do for a post that fits, or a thread that is full', () => {
    const state = thread('Short.', long);
    expect(planSplit(state.posts, state.posts[0].id)).toBe(null);
    expect(planSplit(state.posts, 'nope')).toBe(null);
    const full = thread(...Array(MAX_POSTS - 1).fill('x'), long);
    expect(splitTexts(full.posts, full.posts.at(-1).id)).toBe(null);
  });

  it('fills the room there is and leaves the rest in the last post', () => {
    const state = thread(...Array(MAX_POSTS - 3).fill('x'), sentence.repeat(20).trim());
    const parts = splitTexts(state.posts, state.posts.at(-1).id);
    expect(parts).toHaveLength(3);
    expect(countComposerGraphemes(parts[2])).toBeGreaterThan(300);
  });

  it('numbers the new posts by their place in the whole thread', () => {
    const state = thread('Before.', long);
    const parts = splitTexts(state.posts, state.posts[1].id, { numbering: 'counter' });
    const total = parts.length + 1;
    expect(parts[0].endsWith(`\n\n2/${total}`)).toBe(true);
    expect(parts.at(-1).endsWith(`\n\n${total}/${total}`)).toBe(true);
  });

  it('replaces the counter of a post in a numbered thread, and only there', () => {
    const numbered = thread('One.\n\n1/3', `${long}\n\n2/3`, 'Three.\n\n3/3');
    const parts = splitTexts(numbered.posts, numbered.posts[1].id, { numbering: 'counter' });
    expect(parts.join('\n')).not.toContain('2/3');
    // A last line of digits in a post that isn't numbered is the writer's.
    const plain = thread(`${long}\n\n11/14`);
    const kept = splitTexts(plain.posts, plain.posts[0].id, { numbering: 'counter' });
    expect(kept.at(-1)).toContain('\n\n11/14\n\n');
  });

  it('stops offering the way back once the writer has changed what it made', () => {
    const start = thread(long);
    const plan = planSplit(start.posts, start.posts[0].id);
    const split = composerReducer(start, plan.action);
    expect(undoStands(split.posts, plan.undo)).toBe(true);
    // Typing in one of them.
    expect(undoStands(composerReducer(split, { type: 'setText', index: 1, text: 'changed' }).posts, plan.undo)).toBe(false);
    // Removing or moving one.
    expect(undoStands(composerReducer(split, { type: 'removePost', index: 1 }).posts, plan.undo)).toBe(false);
    expect(undoStands(composerReducer(split, { type: 'movePost', from: 0, to: 1 }).posts, plan.undo)).toBe(false);
    // A picture on a new post would go with it.
    const pictured = composerReducer(split, { type: 'addImages', index: 1, images: [{ id: 'i', file: {}, alt: '' }] });
    expect(undoStands(pictured.posts, plan.undo)).toBe(false);
    // One on the first post, or a new post elsewhere, is no reason.
    const onFirst = composerReducer(split, { type: 'addImages', index: 0, images: [{ id: 'i', file: {}, alt: '' }] });
    expect(undoStands(onFirst.posts, plan.undo)).toBe(true);
    expect(undoStands(composerReducer(split, { type: 'addPost' }).posts, plan.undo)).toBe(true);
    expect(undoStands(split.posts, null)).toBe(false);
  });
});

describe('renumbering a thread', () => {
  it('sets every counter and can be taken back', () => {
    const start = thread('One.\n\n1/3', 'Three.\n\n3/3', 'By hand.');
    const plan = planRenumber(start.posts);
    const state = composerReducer(start, plan.action);
    expect(texts(state)).toEqual(['One.\n\n1/3', 'Three.\n\n2/3', 'By hand.\n\n3/3']);
    expect(undoLine(plan.undo, (n) => `<${n}>`)).toBe('Renumbered <3> posts.');
    expect(undoStands(state.posts, plan.undo)).toBe(true);
    expect(undoStands(composerReducer(state, { type: 'addPost' }).posts, plan.undo)).toBe(false);
    expect(texts(composerReducer(state, undoAction(plan.undo)))).toEqual(texts(start));
    expect(planRenumber(state.posts)).toBe(null);
    expect(undoAction(null)).toBe(null);
  });
});
