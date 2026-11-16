import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { buttonClass } from './Button.jsx';

/**
 * A button that opens a short list of actions. A disclosure, not an ARIA
 * menu: the list is ordinary buttons reached with Tab, so nothing has to
 * teach the arrow keys. Escape and a press anywhere else close it, and
 * Escape puts focus back on the button.
 *
 * `items` are `{ key?, label, hint?, icon?, tone?, className?, onSelect }`, where
 * `icon` is a component drawn before the label and `tone: 'danger'` marks an
 * action that can't be taken back; `{ separator: true }` draws a rule. Give
 * `key` when two items could share a label (two accounts with one name).
 * Within one menu, every item has an icon or none does.
 *
 * `label` is the button's words; pass `children` to draw something else in it
 * (an avatar and a handle, or an icon alone) and `label` becomes its
 * accessible name. `icon` makes the button square, for a glyph alone, and
 * then it is a ghost unless `variant` says otherwise. `variant="link"` draws
 * the button as a link action (Export, Insert): `icon` is then the component
 * drawn before its words. `placement` is 'down' or 'up' (for a button at the
 * foot of the screen); the list hangs from the button's right edge, or its
 * left with `align="start"`. It turns to hang from the other edge when it
 * would run off the screen (menuAlign), and slides back onto the screen when
 * neither edge leaves it room (menuPlace). The same goes for up and down: a
 * list with no room under its button (a row's ⋯ near a phone's tab bar)
 * opens upward instead, and one with room on neither side scrolls in the
 * larger.
 *
 * MoreMenu, below, is the ⋯ every row and dashboard uses.
 */
/**
 * Escape closes the open list and nothing else. A menu inside a modal
 * <dialog> (the composer's) would otherwise let the dialog take the same
 * key as a cancel and close too. Returns whether it was Escape.
 */
export function closeOnEscape(event, close) {
  if (event.key !== 'Escape') return false;
  event.preventDefault();
  event.stopPropagation();
  close();
  return true;
}

/**
 * Taking an item: focus goes back to the menu button before the list
 * unmounts and before the item runs. A dialog the item opens remembers
 * whatever had focus when it opened and returns focus there when it closes;
 * if that were the item's own button, already gone, focus would fall to
 * <body>.
 */
export function chooseItem(item, { focusButton, close }) {
  focusButton();
  close();
  item.onSelect?.();
}

// A layout effect runs before the browser paints, so a list that has to
// turn is never seen on the wrong side first. Rendered to a string (the
// tests), there is nothing to measure, and React warns about one there.
const useLayoutEffectInBrowser = typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** How near the screen's edge an open list may come. */
const EDGE = 8;

/**
 * Which edge of its button an open list should hang from, given where it
 * landed (`listRect`, as getBoundingClientRect gives it) hanging from
 * `align`: a list hung from the right edge ('end') whose left edge comes
 * within 8px of the screen's turns to hang from the left ('start'), and the
 * other way round at the right. Otherwise `align` stands. Measured once, as
 * the list opens, so a list too wide for either side doesn't swing between
 * them.
 */
export function menuAlign(listRect, viewportWidth, align) {
  if (!listRect) return align;
  if (align === 'end' && listRect.left < EDGE) return 'start';
  if (align === 'start' && listRect.right > viewportWidth - EDGE) return 'end';
  return align;
}

/** The space between a button and the list it opens (controls.css). */
const DROP = 6;

/**
 * Whether an open list goes down or up from its button, and the most it
 * may be tall (`maxHeight` in px, null for no limit), given the list's box
 * (`listRect`), its button's (`anchorRect`) and the screen's height less
 * what is fixed over its foot (`bottomInset`: a phone's tab bar, which is
 * drawn over the page). The asked-for `placement` stands while the list
 * fits that way. Otherwise it opens the other way if it fits there, and if
 * it fits neither way it opens toward the larger room and is held to it,
 * to scroll inside. Each side keeps 8px from the edge.
 */
export function menuDrop(listRect, anchorRect, { placement = 'down', viewportHeight = Infinity, bottomInset = 0 } = {}) {
  if (!listRect || !anchorRect) return { placement, maxHeight: null };
  const height = listRect.bottom - listRect.top;
  const below = viewportHeight - bottomInset - EDGE - anchorRect.bottom - DROP;
  const above = anchorRect.top - DROP - EDGE;
  const room = { down: below, up: above };
  const other = placement === 'up' ? 'down' : 'up';
  if (height <= room[placement]) return { placement, maxHeight: null };
  if (height <= room[other]) return { placement: other, maxHeight: null };
  const roomier = room[other] > room[placement] ? other : placement;
  return { placement: roomier, maxHeight: Math.max(0, Math.floor(room[roomier])) };
}

/**
 * Where an open list goes: the edge it hangs from (menuAlign), and how far
 * to slide it sideways, `shift` in px, for a list too wide to fit hanging
 * from either edge of its button (a ⋯ near the middle of a phone). It is
 * slid just far enough to come no nearer the screen's edge than 8px. The
 * list was measured hanging from `align`; `anchorRect` is the box it hangs
 * from (the menu's own), which says where it would land on the other side.
 *
 * Given `vertical` ({ placement, viewportHeight, bottomInset }), it also
 * says whether the list goes down or up and how tall it may be (menuDrop).
 */
export function menuPlace(listRect, anchorRect, viewportWidth, align, vertical = null) {
  const turnTo = menuAlign(listRect, viewportWidth, align);
  const drop = vertical ? menuDrop(listRect, anchorRect, vertical) : {};
  if (!listRect) return { align: turnTo, shift: 0, ...drop };
  let { left, right } = listRect;
  if (turnTo !== align && anchorRect) {
    const width = right - left;
    left = turnTo === 'start' ? anchorRect.left : anchorRect.right - width;
    right = left + width;
  }
  let shift = 0;
  if (left < EDGE) shift = EDGE - left;
  else if (right > viewportWidth - EDGE) shift = viewportWidth - EDGE - right;
  return { align: turnTo, shift: Math.round(shift), ...drop };
}

/**
 * How much of the screen's foot is covered by something fixed over the
 * page: a phone's tab bar. Not from inside a modal dialog, which is drawn
 * over the tab bar.
 */
function coveredFoot(root) {
  if (!root || root.closest('dialog')) return 0;
  const bar = document.querySelector('.tabbar');
  if (!bar) return 0;
  const box = bar.getBoundingClientRect();
  if (!box.height) return 0;
  return Math.max(0, window.innerHeight - box.top);
}

/** The open list's inline style for where menuPlace put it, if anywhere. */
function listStyle(place) {
  if (!place) return undefined;
  const style = {};
  if (place.shift) style.transform = `translateX(${place.shift}px)`;
  if (place.maxHeight != null) {
    style.maxHeight = `${place.maxHeight}px`;
    style.overflowY = 'auto';
  }
  return Object.keys(style).length ? style : undefined;
}

/** Whether `icon` is a component to draw, rather than true. */
function isGlyph(icon) {
  return typeof icon === 'function' || (typeof icon === 'object' && icon !== null);
}

export default function Menu({
  label,
  items,
  children = null,
  placement = 'down',
  align = 'end',
  icon = false,
  variant = icon ? 'ghost' : 'quiet',
  size = 'sm',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  // Where the open list went (menuPlace); null hangs it from `align`.
  const [place, setPlace] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) =>
      closeOnEscape(event, () => {
        setOpen(false);
        buttonRef.current?.focus();
      });
    // Captured, so the list hears Escape before anything inside it does.
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Before the list is painted, see where it landed and turn it (or slide
  // it, or open it the other way) if it runs off the screen. Only when it
  // opens: measured again after turning, a list that fits neither way would
  // turn back. A list a stylesheet places against the screen itself (the
  // folded rail's account menu) has already been put where it fits, so it
  // is only checked sideways.
  useLayoutEffectInBrowser(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const list = listRef.current;
    const root = rootRef.current;
    if (!list) return;
    const hung = getComputedStyle(list).position === 'absolute';
    const vertical = hung ? { placement, viewportHeight: window.innerHeight, bottomInset: coveredFoot(root) } : null;
    const next = menuPlace(list.getBoundingClientRect(), root?.getBoundingClientRect(), document.documentElement.clientWidth, align, vertical);
    if (next.align !== align || next.shift || (next.placement && next.placement !== placement) || next.maxHeight != null) setPlace(next);
  }, [open, align, placement]);

  const link = variant === 'link';
  const Glyph = isGlyph(icon) ? icon : null;
  const square = Boolean(icon) && !link;

  return (
    <div
      ref={rootRef}
      className={`menu ${className}`.trim()}
      data-placement={place?.placement || placement}
      data-align={place?.align || align}
      // Tabbing out of the list closes it, so it never hangs open behind
      // whatever has focus.
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={link ? 'link-action menu-button' : buttonClass({ variant, size, icon: square, className: 'menu-button' })}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={children || (Glyph && !link) ? label : undefined}
        title={children || (Glyph && !link) ? label : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {Glyph && <Glyph size={link ? 14 : 16} aria-hidden="true" />}
        {children || (Glyph && !link ? null : label)}
      </button>
      {open && (
        <ul ref={listRef} id={listId} className="menu-list" style={listStyle(place)}>
          {items.filter(Boolean).map((item, index) => {
            if (item.separator) return <li key={`sep-${index}`} className="menu-sep" role="separator" />;
            const Icon = item.icon;
            return (
              <li key={item.key ?? item.label} className={item.className}>
                <button
                  type="button"
                  className="menu-item"
                  data-tone={item.tone}
                  onClick={() =>
                    chooseItem(item, {
                      focusButton: () => buttonRef.current?.focus(),
                      close: () => setOpen(false),
                    })
                  }
                >
                  {Icon && <Icon className="menu-item-icon" size={16} aria-hidden="true" />}
                  <span className="menu-item-text">
                    <span className="menu-item-label">{item.label}</span>
                    {item.hint && <span className="menu-item-hint">{item.hint}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The ⋯ for everything a row or a dashboard can do beyond its one visible
 * action: a ghost icon, small in a row and medium on a title's line.
 * `label` names it for a screen reader ("More for the draft from Tue").
 */
export function MoreMenu({ label, items, size = 'sm', align = 'end', placement = 'down', className = '' }) {
  return (
    <Menu label={label} items={items} icon variant="ghost" size={size} align={align} placement={placement} className={className}>
      <MoreHorizontal size={16} aria-hidden="true" />
    </Menu>
  );
}
