// The archive, shared: one useAnalyticsArchive per signed-in account, made
// available to every page under the shell, along with "now" (one per change
// of data, so every chart on a screen agrees about where the window ends)
// and the account's profile.

import { createContext, useContext, useMemo } from 'react';
import { useAnalyticsArchive } from './useAnalyticsArchive.js';

const Ctx = createContext(null);

export function ArchiveProvider({ agent, did, profile, children }) {
  const archive = useAnalyticsArchive(agent, did, profile?.handle || null);
  // One "now" per data change: a per-render Date.now() would quietly
  // re-bucket between two cards on the same screen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nowMs = useMemo(() => Date.now(), [archive.rev]);
  const value = useMemo(() => ({ ...archive, nowMs, profile }), [archive, nowMs, profile]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useArchive() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useArchive must be used inside <ArchiveProvider>');
  return value;
}

/** Whether the archive has anything to chart yet. */
export function isBuilt(archive) {
  return Boolean(archive.loaded && archive.meta.posts);
}
