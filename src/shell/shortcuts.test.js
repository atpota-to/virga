import { describe, expect, it } from 'vitest';
import { isMacPlatform, isNewPostShortcut, isPaletteShortcut, isTypingTarget, paletteShortcutAria, paletteShortcutLabel } from './shortcuts.js';

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

describe('the command palette shortcut', () => {
  const mac = { mac: true };
  const pc = { mac: false };

  it('is ⌘K on a Mac and Ctrl K elsewhere', () => {
    expect(isPaletteShortcut(key('k', { metaKey: true }), mac)).toBe(true);
    expect(isPaletteShortcut(key('K', { metaKey: true }), mac)).toBe(true);
    expect(isPaletteShortcut(key('k', { ctrlKey: true }), pc)).toBe(true);
    // Ctrl K on a Mac deletes to the end of the line in a field; ⌘ off a Mac
    // is the Windows key.
    expect(isPaletteShortcut(key('k', { ctrlKey: true }), mac)).toBe(false);
    expect(isPaletteShortcut(key('k', { metaKey: true }), pc)).toBe(false);
  });

  it('works with focus in a field, since a chord isn’t typing', () => {
    expect(isPaletteShortcut(key('k', { ctrlKey: true, target: el('TEXTAREA') }), pc)).toBe(true);
    expect(isPaletteShortcut(key('k', { metaKey: true, target: el('INPUT', { type: 'search' }) }), mac)).toBe(true);
    expect(isPaletteShortcut(key('k', { ctrlKey: true, target: el('DIV', { isContentEditable: true }) }), pc)).toBe(true);
  });

  it('stays out of the way of another dialog', () => {
    expect(isPaletteShortcut(key('k', { ctrlKey: true }), { ...pc, inDialog: true })).toBe(false);
    expect(isPaletteShortcut(key('k', { metaKey: true }), { ...mac, inDialog: true })).toBe(false);
  });

  it('isn’t a plain k, k with another modifier, held down, mid-composition or already handled', () => {
    expect(isPaletteShortcut(key('k'), pc)).toBe(false);
    expect(isPaletteShortcut(key('k'), mac)).toBe(false);
    expect(isPaletteShortcut(key('k', { ctrlKey: true, shiftKey: true }), pc)).toBe(false);
    expect(isPaletteShortcut(key('k', { ctrlKey: true, altKey: true }), pc)).toBe(false);
    expect(isPaletteShortcut(key('k', { ctrlKey: true, metaKey: true }), pc)).toBe(false);
    expect(isPaletteShortcut(key('k', { ctrlKey: true, metaKey: true }), mac)).toBe(false);
    expect(isPaletteShortcut(key('k', { ctrlKey: true, repeat: true }), pc)).toBe(false);
    expect(isPaletteShortcut(key('k', { ctrlKey: true, isComposing: true }), pc)).toBe(false);
    expect(isPaletteShortcut(key('k', { ctrlKey: true, defaultPrevented: true }), pc)).toBe(false);
    expect(isPaletteShortcut(key('j', { ctrlKey: true }), pc)).toBe(false);
    expect(isPaletteShortcut(null, pc)).toBe(false);
  });

  it('is shown as the platform writes it', () => {
    expect(paletteShortcutLabel(true)).toBe('⌘K');
    expect(paletteShortcutLabel(false)).toBe('Ctrl K');
    expect(paletteShortcutAria(true)).toBe('Meta+K');
    expect(paletteShortcutAria(false)).toBe('Control+K');
    expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isMacPlatform({ userAgentData: { platform: 'macOS' } })).toBe(true);
    expect(isMacPlatform({ platform: 'iPad' })).toBe(true);
    expect(isMacPlatform({ platform: 'Win32' })).toBe(false);
    expect(isMacPlatform({ platform: 'Linux x86_64' })).toBe(false);
    expect(isMacPlatform(null)).toBe(false);
  });
});
