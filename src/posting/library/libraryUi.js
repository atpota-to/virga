// The library's browsing decisions, outside React: what a shelf says when
// it's empty, which row the arrow keys land on, whether what was typed in
// the search box is a link to read, and the template context a dialog's
// `context` stands for.

import { libraryContext, openingShelf } from './model.js';

/** What each shelf says when it has nothing, and what to do about it. */
export const SHELF_EMPTY = Object.freeze({
  suggested: 'Nothing here matches the post you’re replying to. Look through the other shelves.',
  templates: 'No templates yet. Make one on the Templates page, then use it here.',
  posts: 'No posts of yours yet. Once you’ve posted, they’re here to quote.',
  replies: 'No replies of yours yet.',
  saved: 'Nothing saved. Posts you save on Bluesky are here to quote.',
  links: 'No links in your recent posts. Paste a link in the search box to attach one.',
  feeds: 'No feeds of your own or saved. Paste a feed’s link in the search box to attach it.',
  lists: 'No lists of your own. Paste a list’s link in the search box to attach it.',
  search: 'Type at least two letters to search Bluesky.',
});

/** What each shelf is, one line. */
export const SHELF_HINT = Object.freeze({
  suggested: 'Picked for the post you’re replying to.',
  templates: 'Posts and replies to start from.',
  posts: 'Your own posts, to quote.',
  replies: 'Your replies, to quote.',
  saved: 'Posts you saved on Bluesky.',
  links: 'Links from your recent posts, as cards.',
  feeds: 'Feeds you made or saved.',
  lists: 'Lists you made.',
  search: 'Posts from all of Bluesky.',
});

/**
 * Whether `text` is a link worth reading as an item (a web address or an
 * at:// URI), rather than words to search for.
 */
export function looksLikeLink(text) {
  const t = String(text || '').trim();
  if (!t || /\s/.test(t)) return false;
  if (/^at:\/\/did:[a-z]+:[^/]+\/[a-z0-9.]+\/[^/]+$/i.test(t)) return true;
  try {
    const u = new URL(t);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

/**
 * The id the arrow keys move to from `activeId` among `ids`: `delta` 1 or
 * -1, wrapping; 'first' and 'last' for Home and End. With nothing active, a
 * step down lands on the first and a step up on the last.
 */
export function moveActive(ids, activeId, delta) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return null;
  if (delta === 'first') return list[0];
  if (delta === 'last') return list[list.length - 1];
  const at = list.indexOf(activeId);
  if (at < 0) return delta < 0 ? list[list.length - 1] : list[0];
  return list[(at + delta + list.length) % list.length];
}

/**
 * The template context (who is replied to, the handle, today) for what a
 * dialog or page was handed: a template context passes through; a
 * LibraryDialog `context` (`{ state, reply? }`) is made into one.
 */
export function templateContextFrom(context, { selfHandle } = {}) {
  if (context && typeof context === 'object' && typeof context.today === 'string') return context;
  return libraryContext({
    state: context?.state,
    reply: context?.reply ?? context?.state?.reply,
    selfHandle,
  });
}

/** The shelf a library opens on: the one asked for, else the default. */
export function initialShelf(context, { replying }) {
  const asked = context?.shelf;
  if (typeof asked === 'string' && asked) {
    if (asked === 'suggested' && !replying) return openingShelf({ replying });
    return asked;
  }
  return openingShelf({ replying });
}

/**
 * Library items grouped for a list with headings: posts and replies by
 * shelf, the rest as given. `sections` (templateSections) takes the
 * template shelf's own grouping.
 */
export function sectionsFor(shelfId, items, { templateSections } = {}) {
  if (shelfId === 'templates' && Array.isArray(templateSections)) return templateSections;
  if (shelfId === 'feeds') {
    const yours = items.filter((i) => i.source?.group !== 'saved' && i.group !== 'saved');
    const saved = items.filter((i) => i.source?.group === 'saved' || i.group === 'saved');
    return [
      yours.length && { id: 'yours', heading: saved.length ? 'Yours' : null, muted: false, items: yours },
      saved.length && { id: 'saved', heading: 'Saved', muted: false, items: saved },
    ].filter(Boolean);
  }
  return items.length ? [{ id: shelfId, heading: null, muted: false, items }] : [];
}
