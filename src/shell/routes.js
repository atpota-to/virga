// Which page an address names, without anything React needs: Shell.jsx
// renders from it and routes.test.js pins it. The table of addresses is at
// the top of src/lib/router.jsx.

import { pathParts } from '../lib/router.jsx';
import { POSTING_PAGE_BY_KEY, parsePostingRoute } from '../posting/routes.js';

export function parseRoute(path) {
  const parts = pathParts(path);
  const [section, page] = parts;
  if (!section) return { section: 'dashboard', dashboard: null };
  if (section === 'dashboard') return { section, dashboard: page || null };
  if (section === 'reports' || section === 'tools') return { section, page: page || null };
  if (section === 'settings') return { section, page: page || null };
  if (section === 'posting') {
    const posting = parsePostingRoute(parts);
    return posting ? { section, page: posting.key, id: posting.id } : { section: 'missing' };
  }
  if (section === 'intent' && page === 'compose' && parts.length === 2) return { section: 'intent', page: 'compose' };
  return { section: 'missing' };
}

export const SECTION_TITLE = Object.freeze({
  dashboard: 'Dashboards',
  reports: 'Reports',
  tools: 'Tools',
  settings: 'Settings',
  posting: 'Posting',
  intent: 'Posting',
  missing: 'Not found',
});

/**
 * Whether a route's page needs a built archive (until there is one, it shows
 * the first run). Posting never does: it opens before the archive does, and
 * the Posted page waits for the archive by itself.
 */
export function needsArchive(route) {
  return route.section === 'dashboard' || route.section === 'reports' || (route.section === 'tools' && Boolean(route.page));
}

/**
 * Whether a route renders before the archive has opened. Posting and compose
 * links don't read the archive, so they don't wait on IndexedDB.
 */
export function opensBeforeArchive(route) {
  return route.section === 'posting' || route.section === 'intent';
}

/** The title of a posting route, for the tab and the phone's app bar. */
export function postingTitle(route) {
  if (route.section !== 'posting') return null;
  if (route.page === 'compose' || route.page === 'hub') return 'Posting';
  return POSTING_PAGE_BY_KEY[route.page]?.title || 'Posting';
}
