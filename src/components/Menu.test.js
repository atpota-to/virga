/*
 * The two things the menu does that a reader can feel with a keyboard: Escape
 * closes only the list (not the dialog it sits in), and taking an item hands
 * focus back to the menu button first. And the one thing a phone shows: a
 * list that would run off the screen hangs from the button's other edge,
 * or opens upward when the tab bar leaves it no room underneath.
 * The suite has no DOM, so these drive the handlers Menu wires to the
 * document and to each item, and the rule it measures the list against;
 * the button's look is read from its markup.
 */
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The suite runs without the React plugin, so JSX compiles to
// React.createElement and needs React in scope.
globalThis.React = React;

const { default: Menu, MoreMenu, closeOnEscape, chooseItem, menuAlign, menuPlace, menuDrop } = await import('./Menu.jsx');
const { buttonClass } = await import('./Button.jsx');

// The menu's own button, as markup.
const button = (el) => renderToStaticMarkup(el).match(/<button[^>]*>/)[0];
const ITEMS = [{ label: 'Rename', onSelect: () => {} }];

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

// A list as getBoundingClientRect gives it, from its left edge and width.
function rect(left, width) {
  return { left, right: left + width, width };
}

describe('which edge an open list hangs from', () => {
  it('keeps an end-aligned list that fits', () => {
    expect(menuAlign(rect(120, 220), 360, 'end')).toBe('end');
  });

  it('turns an end-aligned list that would pass the left edge', () => {
    // A ⋯ near the left of a 360px phone: the list hung from its right edge
    // starts off the screen.
    expect(menuAlign(rect(-40, 220), 360, 'end')).toBe('start');
  });

  it('turns an end-aligned list that would come within 8px of the left edge', () => {
    expect(menuAlign(rect(7, 220), 360, 'end')).toBe('start');
    expect(menuAlign(rect(8, 220), 360, 'end')).toBe('end');
  });

  it('keeps a start-aligned list that fits', () => {
    expect(menuAlign(rect(16, 220), 360, 'start')).toBe('start');
  });

  it('turns a start-aligned list that would pass the right edge', () => {
    expect(menuAlign(rect(200, 220), 360, 'start')).toBe('end');
  });

  it('turns a start-aligned list that would come within 8px of the right edge', () => {
    expect(menuAlign(rect(133, 220), 360, 'start')).toBe('end');
    expect(menuAlign(rect(132, 220), 360, 'start')).toBe('start');
  });

  it('leaves the edge it does not hang from to the other rule', () => {
    // An end-aligned list is only turned for its left edge, a start-aligned
    // one only for its right: each turn moves the list away from that edge.
    expect(menuAlign(rect(200, 220), 360, 'end')).toBe('end');
    expect(menuAlign(rect(-40, 220), 360, 'start')).toBe('start');
  });

  it('keeps the asked-for edge when there is nothing to measure', () => {
    expect(menuAlign(null, 360, 'end')).toBe('end');
  });
});

describe('where an open list goes', () => {
  // The ⋯ after a dashboard's title on a 360px phone: its box runs from 112
  // to 156, and its list is 253px wide.
  const anchor = { left: 112, right: 156 };

  it('leaves a list that fits where it is', () => {
    expect(menuPlace(rect(100, 220), { left: 276, right: 320 }, 360, 'end')).toEqual({ align: 'end', shift: 0 });
  });

  it('turns a list that fits on the other side', () => {
    expect(menuPlace(rect(-50, 200), { left: 20, right: 150 }, 360, 'end')).toEqual({ align: 'start', shift: 0 });
  });

  it('turns, then slides back, a list that fits neither side', () => {
    // Hung from the right edge it starts at -97; from the left it would end
    // at 365, past 352. Turned, it is slid 13px left.
    expect(menuPlace(rect(-97, 253), anchor, 360, 'end')).toEqual({ align: 'start', shift: -13 });
    // Asked for the left edge it ends at 365; from the right it would start
    // at -97. Turned, it is slid 105px right, to 8.
    expect(menuPlace(rect(112, 253), anchor, 360, 'start')).toEqual({ align: 'end', shift: 105 });
  });
});

// A box as getBoundingClientRect gives it, from its top edge and height.
function band(top, height) {
  return { top, bottom: top + height, height };
}

describe('whether an open list goes down or up', () => {
  // A 360×740 phone, its tab bar over the last 64px.
  const phone = { viewportHeight: 740, bottomInset: 64 };

  it('opens down when the list fits under its button', () => {
    // The Scheduled ⋯ at y 361: its list runs to 513, well clear of the bar.
    expect(menuDrop(band(411, 102), band(361, 44), { placement: 'down', ...phone })).toEqual({ placement: 'down', maxHeight: null });
  });

  it('turns up when the tab bar leaves no room under the button', () => {
    // A Weekly schedule day's ⋯ at y 611: two items would sit under the bar.
    expect(menuDrop(band(661, 58), band(611, 44), { placement: 'down', ...phone })).toEqual({ placement: 'up', maxHeight: null });
    // Posted's first ⋯ at y 524 with a 353px list: 94px below, 510 above,
    // so it fits above.
    expect(menuDrop(band(574, 353), band(524, 44), { placement: 'down', ...phone })).toEqual({ placement: 'up', maxHeight: null });
  });

  it('keeps 8px clear of the bar', () => {
    // 740 − 64 − 8 = 668 is the lowest the list may reach; hung 6px under
    // a button ending at 562, it has 100px.
    expect(menuDrop(band(0, 100), band(518, 44), { placement: 'down', ...phone }).placement).toBe('down');
    expect(menuDrop(band(0, 101), band(518, 44), { placement: 'down', ...phone }).placement).toBe('up');
  });

  it('turns down a list asked to open up that has no room above', () => {
    expect(menuDrop(band(0, 200), band(60, 44), { placement: 'up', ...phone })).toEqual({ placement: 'down', maxHeight: null });
  });

  it('opens toward the larger room, held to it, when it fits neither way', () => {
    // On a short screen with no tab bar: 186px below, 136px above.
    expect(menuDrop(band(0, 300), band(150, 40), { placement: 'down', viewportHeight: 390 })).toEqual({ placement: 'down', maxHeight: 186 });
    expect(menuDrop(band(0, 300), band(200, 40), { placement: 'down', viewportHeight: 390 })).toEqual({ placement: 'up', maxHeight: 186 });
  });

  it('leaves the placement alone with nothing to measure', () => {
    expect(menuDrop(null, band(0, 44), { placement: 'up' })).toEqual({ placement: 'up', maxHeight: null });
  });

  it('comes with the sideways answer when menuPlace is asked for it', () => {
    expect(menuPlace({ ...rect(100, 220), ...band(661, 58) }, { left: 276, right: 320, ...band(611, 44) }, 360, 'end', { placement: 'down', ...phone })).toEqual({
      align: 'end',
      shift: 0,
      placement: 'up',
      maxHeight: null,
    });
  });
});

describe('the menu button', () => {
  it('is a ghost when it holds an icon alone', () => {
    const b = button(createElement(Menu, { label: 'More for this post', icon: true, items: ITEMS }, 'x'));
    expect(b).toContain('btn--ghost');
    expect(b).toContain('btn--icon');
    expect(b).toContain('aria-label="More for this post"');
  });

  it('keeps the outline for words, and whatever variant it is given', () => {
    expect(button(createElement(Menu, { label: 'Export', items: ITEMS }))).toMatch(/class="btn btn--sm menu-button"/);
    expect(button(createElement(Menu, { label: 'More', icon: true, variant: 'quiet', items: ITEMS }, 'x'))).not.toContain('btn--ghost');
  });

  it('draws variant="link" as a link action with its icon and words', () => {
    const Glyph = (props) => createElement('svg', { 'data-glyph': props.size });
    const markup = renderToStaticMarkup(createElement(Menu, { label: 'Export', variant: 'link', icon: Glyph, items: ITEMS }));
    expect(button(createElement(Menu, { label: 'Export', variant: 'link', icon: Glyph, items: ITEMS }))).toContain('class="link-action menu-button"');
    expect(markup).toContain('data-glyph="14"');
    expect(markup).toContain('Export</button>');
    expect(markup).toContain('aria-expanded="false"');
    // Its words are its name, so it needs no aria-label.
    expect(button(createElement(Menu, { label: 'Export', variant: 'link', icon: Glyph, items: ITEMS }))).not.toContain('aria-label');
  });

  it('draws MoreMenu as a small ghost ⋯ named by its label', () => {
    const b = button(createElement(MoreMenu, { label: 'More for the draft from Tue', items: ITEMS }));
    expect(b).toContain('btn btn--ghost btn--sm btn--icon menu-button');
    expect(b).toContain('aria-label="More for the draft from Tue"');
    expect(button(createElement(MoreMenu, { label: 'Dashboard options', size: 'md', items: ITEMS }))).not.toContain('btn--sm');
  });
});

describe('a button variant the kit doesn’t know', () => {
  it('draws the outline, with no class of its own', () => {
    // 'text' was a variant once; a caller still passing it gets the outline.
    expect(buttonClass({ variant: 'text' })).toBe('btn');
    expect(buttonClass({ variant: 'ghost', size: 'sm' })).toBe('btn btn--ghost btn--sm');
  });
});
