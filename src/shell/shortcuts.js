// The one keyboard shortcut: "n" opens the composer. It must never fire
// while someone is typing, holding a modifier, or inside a dialog (the
// composer is one, and a letter typed into its search fields isn't a
// request for another post).

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week']);

/** Whether `el` takes typed text: a field, a text area, a select, or anything editable. */
export function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false;
  if (el.isContentEditable) return true;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return TEXT_INPUT_TYPES.has(String(el.type || '').toLowerCase());
  return false;
}

/**
 * Whether a keydown is the new-post shortcut. `inDialog` says focus (or an
 * open modal) is in a dialog; the shell works that out from the document.
 */
export function isNewPostShortcut(event, { inDialog = false } = {}) {
  if (!event || event.defaultPrevented || event.repeat || event.isComposing) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key !== 'n' && event.key !== 'N') return false;
  if (event.shiftKey && event.key === 'N') return false;
  if (inDialog) return false;
  return !isTypingTarget(event.target);
}
