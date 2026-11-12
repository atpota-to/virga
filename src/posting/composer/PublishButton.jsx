import { useEffect, useId, useRef, useState } from 'react';
import { CalendarClock, ChevronDown, ListPlus, Save, Send } from 'lucide-react';
import { actionLabel } from './actions.js';

const ICONS = { post: Send, schedule: CalendarClock, queue: ListPlus, draft: Save };
const ORDER = ['post', 'schedule', 'queue', 'draft'];
const MENU_LABEL = { post: 'Post now', schedule: 'Schedule…', queue: 'Add to queue', draft: 'Save as draft' };

/**
 * The split button: the primary half runs the account's usual action (or
 * Save as draft for a post that's over the limit), and the caret lists all
 * four with the reason under any that can't run here. The reason for a
 * disabled primary is spoken with it and shown under the bar.
 */
export default function PublishButton({ state, model, busy = false, onAction, placement = 'up', footnote = '' }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const caretRef = useRef(null);
  const primary = model.primary;
  const p = model.actions[primary];
  const Icon = ICONS[primary] || Send;

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      caretRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div
      className="publish-split"
      ref={rootRef}
      data-placement={placement}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="btn btn--primary publish-main"
        disabled={busy || p.disabled}
        aria-disabled={busy || p.disabled || undefined}
        aria-describedby={p.disabled && p.reason ? `${id}-why` : undefined}
        aria-busy={busy || undefined}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        title={p.disabled ? p.reason || undefined : undefined}
        onClick={() => onAction?.(primary)}
      >
        <Icon size={16} aria-hidden="true" />
        {busy ? 'Working…' : actionLabel(primary, state, { short: true })}
      </button>
      <button
        ref={caretRef}
        type="button"
        className="btn btn--primary publish-caret"
        aria-label="More ways to send it"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {p.disabled && p.reason && (
        <span id={`${id}-why`} className="visually-hidden">
          {p.reason}
        </span>
      )}
      {open && (
        <ul id={`${id}-menu`} className="menu-list publish-menu">
          {ORDER.map((action) => {
            const a = model.actions[action];
            const ItemIcon = ICONS[action];
            return (
              <li key={action}>
                <button
                  type="button"
                  className="menu-item"
                  aria-disabled={a.disabled || undefined}
                  data-disabled={a.disabled || undefined}
                  aria-current={action === primary ? 'true' : undefined}
                  onClick={() => {
                    if (a.disabled) return;
                    setOpen(false);
                    onAction?.(action);
                  }}
                >
                  <ItemIcon className="menu-item-icon" size={16} aria-hidden="true" />
                  <span className="menu-item-text">
                    <span className="menu-item-label">{MENU_LABEL[action]}</span>
                    {a.disabled && a.reason && <span className="menu-item-hint">{a.reason}</span>}
                  </span>
                </button>
              </li>
            );
          })}
          {footnote && <li className="publish-foot">{footnote}</li>}
        </ul>
      )}
    </div>
  );
}
