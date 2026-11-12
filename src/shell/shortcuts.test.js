import { describe, expect, it } from 'vitest';
import { isNewPostShortcut, isTypingTarget } from './shortcuts.js';

const el = (tagName, extra = {}) => ({ tagName, ...extra });
const key = (k, extra = {}) => ({ key: k, target: el('BODY'), ...extra });

describe('typing targets', () => {
  it('are fields, text areas, selects and editable content', () => {
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
    expect(isTypingTarget(el('INPUT', { type: 'text' }))).toBe(true);
    expect(isTypingTarget(el('INPUT', { type: 'search' }))).toBe(true);
    expect(isTypingTarget(el('INPUT', { type: '' }))).toBe(true);
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true);
  });

  it('aren’t buttons, checkboxes or the page', () => {
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTypingTarget(el('INPUT', { type: 'radio' }))).toBe(false);
    expect(isTypingTarget(el('BODY'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('the new-post shortcut', () => {
  it('is a plain n with focus outside a field', () => {
    expect(isNewPostShortcut(key('n'))).toBe(true);
    expect(isNewPostShortcut(key('N'))).toBe(true);
    expect(isNewPostShortcut(key('n', { target: el('BUTTON') }))).toBe(true);
  });

  it('isn’t n typed into a field, or inside a dialog', () => {
    expect(isNewPostShortcut(key('n', { target: el('TEXTAREA') }))).toBe(false);
    expect(isNewPostShortcut(key('n', { target: el('INPUT', { type: 'text' }) }))).toBe(false);
    expect(isNewPostShortcut(key('n'), { inDialog: true })).toBe(false);
  });

  it('isn’t n with a modifier, held down, mid-composition or already handled', () => {
    expect(isNewPostShortcut(key('n', { metaKey: true }))).toBe(false);
    expect(isNewPostShortcut(key('n', { ctrlKey: true }))).toBe(false);
    expect(isNewPostShortcut(key('n', { altKey: true }))).toBe(false);
    expect(isNewPostShortcut(key('N', { shiftKey: true }))).toBe(false);
    expect(isNewPostShortcut(key('n', { repeat: true }))).toBe(false);
    expect(isNewPostShortcut(key('n', { isComposing: true }))).toBe(false);
    expect(isNewPostShortcut(key('n', { defaultPrevented: true }))).toBe(false);
    expect(isNewPostShortcut(key('m'))).toBe(false);
    expect(isNewPostShortcut(null)).toBe(false);
  });
});
