// The composer's host, mounted once above the per-account key in App.jsx, so
// an open composer (and what's written in it) survives switching accounts.
// Anything that wants to start a post calls useComposer().open(intent); the
// intent's shape is DESIGN.md §6.3.
//
// The composer itself is loaded on first use (and fetched quietly once the
// app is idle), so the publishing code stays out of the first page load. Once
// opened it stays mounted, closed, so what was being written is still there
// the next time.

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import '../posting.css';

const loadComposer = () => import('./Composer.jsx');
const Composer = lazy(loadComposer);

const Ctx = createContext(null);

export function ComposerProvider({ children }) {
  const [intent, setIntent] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // A fresh object per open, so opening with the same words twice still
  // counts as a new open.
  const open = useCallback((next = {}) => {
    setIntent({ ...(next && typeof next === 'object' ? next : {}) });
    setIsOpen(true);
    setMounted(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ open, close, isOpen, intent }), [open, close, isOpen, intent]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const idle = window.requestIdleCallback || ((fn) => window.setTimeout(fn, 2500));
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    const handle = idle(() => {
      loadComposer().catch(() => {});
    });
    return () => cancel(handle);
  }, []);

  return (
    <Ctx.Provider value={value}>
      {children}
      {mounted && (
        <Suspense fallback={null}>
          <Composer open={isOpen} intent={intent} onClose={close} />
        </Suspense>
      )}
    </Ctx.Provider>
  );
}

/** `{ open(intent), close(), isOpen, intent }`. */
export function useComposer() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useComposer must be used inside <ComposerProvider>');
  return value;
}
