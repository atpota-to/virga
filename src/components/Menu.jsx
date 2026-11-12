import { useEffect, useId, useRef, useState } from 'react';
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
 * `label` is the button's words; pass `children` to draw something else in it
 * (an avatar and a handle, or an icon alone) and `label` becomes its
 * accessible name. `placement` is 'down' or
 * 'up' (for a button at the foot of the screen); the list hangs from the
 * button's right edge, or its left with `align="start"`.
 */
export default function Menu({
  label,
  items,
  children = null,
  placement = 'down',
  align = 'end',
  variant = 'quiet',
  icon = false,
  size = 'sm',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`menu ${className}`.trim()}
      data-placement={placement}
      data-align={align}
      // Tabbing out of the list closes it, so it never hangs open behind
      // whatever has focus.
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={buttonClass({ variant, size, icon, className: 'menu-button' })}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={children ? label : undefined}
        title={children ? label : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {children || label}
      </button>
      {open && (
        <ul id={listId} className="menu-list">
          {items.filter(Boolean).map((item, index) => {
            if (item.separator) return <li key={`sep-${index}`} className="menu-sep" role="separator" />;
            const Icon = item.icon;
            return (
              <li key={item.key ?? item.label} className={item.className}>
                <button
                  type="button"
                  className="menu-item"
                  data-tone={item.tone}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect?.();
                  }}
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
