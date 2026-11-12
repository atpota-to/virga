import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import Button from './Button.jsx';

/**
 * A modal dialog on the native <dialog> element: it traps focus, Escape
 * closes it, and focus goes back where it came from. `actions` sit at the
 * foot, right-aligned. A press on the backdrop closes it too.
 */
export default function Dialog({ open, onClose, title, children, actions = null, tone = null }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal?.();
    if (!open && el.open) el.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      data-tone={tone || undefined}
      aria-labelledby="dialog-title"
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
            <h2 id="dialog-title" className="dialog-title">
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
