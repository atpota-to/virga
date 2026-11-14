/*
 * The two things the menu does that a reader can feel with a keyboard: Escape
 * closes only the list (not the dialog it sits in), and taking an item hands
 * focus back to the menu button first. The suite has no DOM, so these drive
 * the handlers Menu wires to the document and to each item.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

// The suite runs without the React plugin, so JSX compiles to
// React.createElement and needs React in scope.
globalThis.React = React;

const { closeOnEscape, chooseItem } = await import('./Menu.jsx');

function keydown(key) {
  return { key, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

describe('Escape in an open menu', () => {
  it('closes the list and keeps the key from the dialog around it', () => {
    const close = vi.fn();
    const event = keydown('Escape');
    expect(closeOnEscape(event, close)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    // A modal <dialog> takes an Escape whose default isn't prevented as a
    // cancel, which closed the composer along with its menu.
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('leaves every other key alone', () => {
    const close = vi.fn();
    const event = keydown('Tab');
    expect(closeOnEscape(event, close)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });
});

describe('taking an item', () => {
  it('focuses the menu button before the list closes and the item runs', () => {
    const order = [];
    chooseItem(
      { label: 'Delete', onSelect: () => order.push('select') },
      { focusButton: () => order.push('focus'), close: () => order.push('close') },
    );
    // A dialog the item opens returns focus to whatever had it at the time;
    // that has to be the button, not the item about to unmount.
    expect(order).toEqual(['focus', 'close', 'select']);
  });

  it('still closes for an item with nothing to run', () => {
    const close = vi.fn();
    chooseItem({ label: 'Nothing' }, { focusButton: () => {}, close });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
