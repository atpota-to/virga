// The app's addresses, without a router library: the path is the state, the
// History API moves it, and every page reads it through usePath(). Real
// paths rather than a hash, so a report or a tool can be bookmarked and
// shared (vercel.json sends every path to index.html).
//
//   /                         → the first dashboard
//   /dashboard/:id            a dashboard
//   /reports                  the reports, as a list
//   /reports/:report          one report
//   /tools                    the tools, as a list
//   /tools/:tool              one tool
//   /settings/:section        settings
//
// The query string is carried along on every move. The real app never has
// one; the harness keeps its flags (?latency=0) there.

import { useSyncExternalStore } from 'react';

const listeners = new Set();

function notify() {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', notify);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function currentPath() {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}

/** The current path, re-rendering whoever reads it when it changes. */
export function usePath() {
  return useSyncExternalStore(subscribe, currentPath, () => '/');
}

/**
 * Go to `to`. A new history entry unless `replace`. The page starts at its
 * top, as a new page does, unless `keepScroll`.
 */
export function navigate(to, { replace = false, keepScroll = false } = {}) {
  if (typeof window === 'undefined') return;
  const search = to.includes('?') ? '' : window.location.search;
  const href = `${to}${search}`;
  if (href === `${window.location.pathname}${window.location.search}`) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', href);
  notify();
  if (!keepScroll) window.scrollTo(0, 0);
}

/**
 * Split a path into its parts: `/reports/followers` → `['reports',
 * 'followers']`. Trailing slashes and empty parts are dropped.
 */
export function pathParts(path) {
  return String(path || '/')
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

/**
 * An in-app link: a real <a href>, so it can be opened in a new tab or
 * copied, that moves within the app on a plain click.
 */
export function Link({ to, onClick, replace = false, children, ...rest }) {
  return (
    <a
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (rest.target && rest.target !== '_self') return;
        event.preventDefault();
        navigate(to, { replace });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
