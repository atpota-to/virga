// The posting section's pages and how an address names one. Shell.jsx asks
// parsePostingRoute which page a /posting address is; PostingPage.jsx renders
// it; the sidebar, the tab bar and the overview list the pages from here.
//
// `needsBackend` marks the pages whose work happens on Virga's server
// (scheduled posts, the weekly queue, timers). A browser-session account sees
// NeedsBackend there instead of the page. `access` is what each page can
// touch, as the badges in its header say (ui/AccessBadge.jsx). `pinned` puts
// a page in the sidebar; the rest are reached from the overview.

import { CalendarClock, CalendarRange, FileText, LayoutTemplate, Library, Send, SquarePen, Timer } from 'lucide-react';
import { pathParts } from '../lib/router.jsx';

export const POSTING_BASE = '/posting';

export const POSTING_PAGES = Object.freeze([
  {
    key: 'hub',
    path: '/posting',
    label: 'Overview',
    title: 'Posting',
    icon: SquarePen,
    needsBackend: false,
    pinned: false,
    access: ['post'],
    desc: 'Write a post or a thread, pick up a draft, and see what’s going out.',
  },
  {
    key: 'drafts',
    path: '/posting/drafts',
    label: 'Drafts',
    title: 'Drafts',
    icon: FileText,
    needsBackend: false,
    pinned: true,
    access: ['post'],
    desc: 'Posts you’ve started, kept as private drafts on your Bluesky account.',
  },
  {
    key: 'scheduled',
    path: '/posting/scheduled',
    label: 'Scheduled',
    title: 'Scheduled posts',
    icon: CalendarClock,
    needsBackend: true,
    pinned: true,
    access: ['post', 'server'],
    desc: 'Posts waiting to go out, and the queue they go out from.',
  },
  {
    key: 'schedule',
    path: '/posting/schedule',
    label: 'Weekly schedule',
    title: 'Weekly schedule',
    icon: CalendarRange,
    needsBackend: true,
    pinned: false,
    access: ['server'],
    desc: 'The times each week that a post added to the queue goes out.',
  },
  {
    key: 'timers',
    path: '/posting/timers',
    label: 'Timers',
    title: 'Post timers',
    icon: Timer,
    needsBackend: true,
    pinned: true,
    access: ['post', 'server'],
    desc: 'Posts set to delete themselves after a while, or when something happens.',
  },
  {
    key: 'posted',
    path: '/posting/posted',
    label: 'Posted',
    title: 'Posted',
    icon: Send,
    needsBackend: false,
    pinned: true,
    access: ['post'],
    desc: 'What you’ve posted: reply to it, quote it, change who can reply, or delete it.',
  },
  {
    key: 'templates',
    path: '/posting/templates',
    label: 'Templates',
    title: 'Templates',
    icon: LayoutTemplate,
    needsBackend: false,
    pinned: true,
    access: ['post'],
    desc: 'Posts and replies to start from, saved in your repo where anyone can read them.',
  },
  {
    key: 'library',
    path: '/posting/library',
    label: 'Library',
    title: 'Library',
    icon: Library,
    needsBackend: false,
    pinned: true,
    access: ['post'],
    desc: 'Your posts, saved posts, links, feeds and lists, ready to quote or attach.',
  },
]);

export const POSTING_PAGE_BY_KEY = Object.freeze(Object.fromEntries(POSTING_PAGES.map((p) => [p.key, p])));

/** The address of a posting page by its key ('hub' is /posting). */
export function postingPath(key) {
  return POSTING_PAGE_BY_KEY[key]?.path || POSTING_BASE;
}

/**
 * Which posting page `path` names: `{ key, id }` for a page (`id` is the
 * part after it, as in /posting/drafts/<id>, else null), `{ key: 'compose' }`
 * for /posting/compose, or null when the address isn't in the posting
 * section or names no page. Takes a path or its parts.
 */
export function parsePostingRoute(path) {
  const parts = Array.isArray(path) ? path : pathParts(path);
  if (parts[0] !== 'posting') return null;
  const [, page = null, id = null] = parts;
  if (!page) return { key: 'hub', id: null };
  if (page === 'compose') return parts.length === 2 ? { key: 'compose', id: null } : null;
  if (page === 'hub' || !POSTING_PAGE_BY_KEY[page]) return null;
  if (parts.length > 3) return null;
  return { key: page, id };
}
