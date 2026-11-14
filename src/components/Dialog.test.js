/*
 * What Dialog does when its parent unmounts it while it is open: it closes
 * the element first, because only close() hands focus back to the control
 * that opened it. The suite has no DOM, so this drives the helper the
 * unmount cleanup calls with a stand-in element.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

// The suite runs without the React plugin, so JSX compiles to
// React.createElement and needs React in scope.
globalThis.React = React;

const { closeIfOpen } = await import('./Dialog.jsx');

describe('a dialog going away', () => {
  it('is closed if it was still open', () => {
    const el = { open: true, close: vi.fn() };
    closeIfOpen(el);
    expect(el.close).toHaveBeenCalledTimes(1);
  });

  it('is left alone if it was already closed, or never drawn', () => {
    const el = { open: false, close: vi.fn() };
    closeIfOpen(el);
    expect(el.close).not.toHaveBeenCalled();
    expect(() => closeIfOpen(null)).not.toThrow();
  });
});
