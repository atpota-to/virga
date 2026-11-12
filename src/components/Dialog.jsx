import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import Button from './Button.jsx';

/**
 * A modal dialog on the native <dialog> element: it traps focus, Escape
 * closes it, and focus goes back where it came from. `actions` sit at the
 * foot, right-aligned. A press on the backdrop closes it too. Each dialog
 * names its own title element, so a dialog opened from inside another (a
 * confirmation over the composer) doesn't share an id with it. `className`
 * goes on the <dialog>, for a dialog that needs its own width. Mark the
 * control that should have focus when it opens with `data-autofocus`.
 */
/** Closes a <dialog> that is still open, which hands focus back to its opener. */
export function closeIfOpen(el) {
  if (el?.open) el.close?.();
}

export default function Dialog({ open, onClose, title, children, actions = null, tone = null, className = '' }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal?.();
      // showModal focuses the first control, which is the Close button; a
      // dialog that's for typing marks its field with data-autofocus.
      el.querySelector('[data-autofocus]')?.focus();
    }
    if (!open && el.open) el.close?.();
  }, [open]);
  // A dialog its parent unmounts while open (`{state && <SomeDialog open />}`)
  // leaves the DOM without close(), so the browser never returns focus to the
  // control that opened it and focus falls to <body>. A layout cleanup runs
  // before React removes the element, while close() can still restore focus.
  useLayoutEffect(() => {
    const el = ref.current;
    return () => closeIfOpen(el);
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`.trim()}
      data-tone={tone || undefined}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose?.();
      }}
    >
      {open && (
        <div className="dialog-in">
          <div className="dialog-head">
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            <Button variant="ghost" size="sm" icon aria-label="Close" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
          <div className="dialog-body">{children}</div>
          {actions && <div className="dialog-actions">{actions}</div>}
        </div>
      )}
    </dialog>
  );
}
