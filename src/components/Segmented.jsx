import { useEffect, useLayoutEffect, useRef } from 'react';

// Rendered to a string (the tests) there is no row to measure, and React
// warns about a layout effect there.
const useLayoutEffectInBrowser = typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** How much of the row the fade at an edge covers, so a key brought into
    view clears it. */
const SPARE = 24;

/**
 * For a row that scrolls sideways rather than wrap (a Segmented, or any
 * .scroll-row): keeps `data-overflow` on it saying which edges have more
 * behind them, 'start', 'end' or 'both' (none when it all fits), so the
 * stylesheet can fade those edges. Kept up as the row scrolls and as it or
 * its keys change size. With `axis` 'y' it does the same for a column that
 * scrolls up and down (the sidebar's list of parts on a short screen):
 * 'start' is then the top and 'end' the foot.
 *
 * When it mounts it also brings the pressed key ([aria-pressed='true'], or
 * [aria-current='page'] in a row of links) into view, clear of the fade, by
 * scrolling the row alone. scrollIntoView would scroll the page as well, to
 * a row that may be below the fold.
 */
export function useOverflowEdge(ref, axis = 'x') {
  useLayoutEffectInBrowser(() => {
    const row = ref.current;
    if (!row) return undefined;
    const down = axis === 'y';
    const shown = () => (down ? row.clientHeight : row.clientWidth);
    const whole = () => (down ? row.scrollHeight : row.scrollWidth);
    const at = () => (down ? row.scrollTop : row.scrollLeft);
    const scrollTo = (to) => {
      if (down) row.scrollTop = to;
      else row.scrollLeft = to;
    };

    const pressed = row.querySelector("[aria-pressed='true'], [aria-current='page']");
    if (pressed && whole() > shown()) {
      const box = row.getBoundingClientRect();
      const key = pressed.getBoundingClientRect();
      // Where the key is along the row's scrolled content, from its edge.
      const start = (down ? key.top - box.top - row.clientTop : key.left - box.left - row.clientLeft) + at();
      const end = start + (down ? key.height : key.width);
      if (end > at() + shown() - SPARE) scrollTo(end - shown() + SPARE);
      else if (start < at() + SPARE) scrollTo(Math.max(0, start - SPARE));
    }

    const update = () => {
      const max = whole() - shown();
      if (max <= 1) {
        row.removeAttribute('data-overflow');
        return;
      }
      const atStart = at() <= 1;
      const atEnd = at() >= max - 1;
      row.setAttribute('data-overflow', atStart ? 'end' : atEnd ? 'start' : 'both');
    };
    update();
    row.addEventListener('scroll', update, { passive: true });
    // The row's own width, and its keys' (a label that changes, a font that
    // arrives late), both change what fits.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (observer) {
      observer.observe(row);
      for (const child of row.children) observer.observe(child);
    }
    return () => {
      row.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [ref, axis]);
}

/**
 * A segmented control (styles/controls.css .segmented): a row of mutually
 * exclusive keys, one of them always pressed, drawn as words with a line
 * under the pressed one. A group of toggle buttons with
 * aria-pressed rather than a radio group, because each key acts the moment
 * it's pressed and the arrow keys are left to the page. It never wraps:
 * when it doesn't fit it scrolls sideways (useOverflowEdge).
 *
 * `options` are `{ value, label, icon?, title?, ariaLabel? }`; `value` is the
 * pressed one. `icon` is a component (a lucide icon) drawn before the label.
 * The label is always in the markup, so a stylesheet that shows a key as its
 * icon alone (the kinds of engagement, on a phone) leaves it its name.
 * Pressing the pressed key calls `onChange` with it again, which a caller is
 * free to ignore.
 */
export default function Segmented({ options, value, onChange, label, size = 'md', className = '' }) {
  const ref = useRef(null);
  useOverflowEdge(ref);
  return (
    <div ref={ref} className={`segmented${size === 'sm' ? ' segmented--sm' : ''} ${className}`.trim()} role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={String(o.value)}
            type="button"
            className={`segmented-key${on ? ' is-on' : ''}${Icon ? ' has-icon' : ''}`}
            aria-pressed={on}
            aria-label={o.ariaLabel}
            title={o.title}
            onClick={() => onChange(o.value)}
          >
            {Icon && <Icon className="segmented-icon" size={15} aria-hidden="true" />}
            {/* data-label lets the stylesheet hold the key at the width of its
                word in bold, so pressing one doesn't shift the others. */}
            <span className="segmented-label" data-label={typeof o.label === 'string' ? o.label : undefined}>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
