// Whether view counts are on screen for an account: the archive's view rows
// and their sync note, and whether this browser has them turned off
// (Settings › Data and sync). Every list, card and report that shows a view
// count asks here first, so turning them off takes them off everywhere.

import { useMemo } from 'react';
import { usePreferences } from '../lib/preferences.jsx';
import { viewsStatus } from '../lib/views.js';
import { viewRows } from './models.js';

/** lib/views.js viewsStatus for the open account, on this browser. */
export function useViewsStatus(archive) {
  const { viewCounts } = usePreferences();
  return useMemo(
    () => viewsStatus(archive.meta.views, archive.views, { enabled: viewCounts !== 'off' }),
    [archive.meta.views, archive.views, viewCounts],
  );
}

/**
 * A post's view count to show beside its other counts, or null: none kept,
 * or view counts not on screen. `(post) => number|null`.
 */
export function useViewsFor(archive) {
  const ready = useViewsStatus(archive) === 'ready';
  return useMemo(() => {
    if (!ready) return () => null;
    const rows = viewRows(archive);
    return (post) => rows.get(post?.uri)?.count ?? null;
  }, [ready, archive]);
}
