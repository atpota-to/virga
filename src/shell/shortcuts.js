// The keyboard shortcuts. "n" opens the composer: it must never fire while
// someone is typing, holding a modifier, or inside a dialog (the composer is
// one, and a letter typed into its search fields isn't a request for
// another post). ⌘K, or Ctrl K off a Mac, opens the command palette: a chord
// is never typing, so it works from inside a field, but not while another
// dialog is open.

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

/** Whether this is a Mac (or an iPad with a keyboard), where ⌘ is the chord key. */
export function isMacPlatform(nav = typeof navigator === 'undefined' ? null : navigator) {
  return /mac|iphone|ipad|ipod/i.test(String(nav?.userAgentData?.platform || nav?.platform || ''));
}

/** The palette's shortcut as it is shown: "⌘K" on a Mac, "Ctrl K" elsewhere. */
export function paletteShortcutLabel(mac = isMacPlatform()) {
  return mac ? '⌘K' : 'Ctrl K';
}

/** The same for `aria-keyshortcuts`. */
export function paletteShortcutAria(mac = isMacPlatform()) {
  return mac ? 'Meta+K' : 'Control+K';
}

/**
 * Whether a keydown is the command palette's shortcut: K with ⌘ on a Mac,
 * with Ctrl elsewhere, and no other modifier. On a Mac, Ctrl K is left
 * alone: in a text field it deletes to the end of the line. Focus in a field
 * doesn't matter. `inDialog` says a dialog other than the palette is open
 * (the composer, a confirmation): the palette stays out of its way, and its
 * fields keep whatever the chord does in the browser.
 */
export function isPaletteShortcut(event, { inDialog = false, mac = isMacPlatform() } = {}) {
  if (!event || event.defaultPrevented || event.repeat || event.isComposing) return false;
  if (event.key !== 'k' && event.key !== 'K') return false;
  if (event.altKey || event.shiftKey) return false;
  const chord = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!chord) return false;
  return !inDialog;
}
