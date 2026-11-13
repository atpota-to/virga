// What a long session has waiting on Virga's server: scheduled posts not yet
// out and post timers still counting down. Both run on the grant Virga's
// server holds for the account, and the server ends that grant when the last
// browser signed in to Virga with the account signs out. Virga can't see the
// other browsers, so a sign-out with work waiting asks first and says what
// stops if this one was the last.

import { useEffect, useMemo, useState } from 'react';

// Long enough for a cold start on Virga's server; a sign-out that waits any
// longer than this reads as stuck, and the dialog then says it couldn't check.
const CHECK_TIMEOUT_MS = 8_000;

/** How many of `scheduled` (listScheduled's rows) and `timers` (listTimers's rows) Virga's grant carries. */
export function countPendingWork({ scheduled = [], timers = [] } = {}, { isActiveScheduledRow, isLiveTimer }) {
  return {
    posts: (scheduled || []).filter((row) => isActiveScheduledRow(row)).length,
    timers: (timers || []).filter((row) => isLiveTimer(row)).length,
  };
}

/** Whether `work` (countPendingWork's answer, or null for one that couldn't be read) needs saying. */
export function hasPendingWork(work) {
  return work === null || (work && work.posts + work.timers > 0);
}

/**
 * Read one account's waiting work through its requester (backendFor).
 * Resolves `{ posts, timers }`; rejects when either list can't be read.
 */
export async function readPendingWork(requester, { signal, timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  // The posting services stay out of the bundle that draws the account menu.
  const [schedule, timers] = await Promise.all([import('../posting/schedule/scheduleService.js'), import('../posting/timers/timerService.js')]);
  const deadline = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  const combined = signal && deadline && AbortSignal.any ? AbortSignal.any([signal, deadline]) : signal || deadline;
  const [queue, live] = await Promise.all([schedule.listScheduled(requester, { signal: combined }), timers.listTimers(requester, { signal: combined })]);
  return countPendingWork(
    { scheduled: queue.rows, timers: live.rows },
    { isActiveScheduledRow: schedule.isActiveScheduledRow, isLiveTimer: timers.isLiveTimer },
  );
}

/**
 * The waiting work of each long-session account in `accounts` (signed-in
 * rows from the session), read while `enabled`. `{ checking, byDid }`:
 * `byDid[did]` is `{ posts, timers }`, or null when it couldn't be read. A
 * browser session holds nothing on Virga's server and isn't asked.
 */
export function usePendingWork(accounts, backendFor, enabled) {
  const dids = useMemo(
    () => (enabled ? (accounts || []).filter((a) => a?.mode === 'backend' && a.status !== 'needsSignIn').map((a) => a.did) : []),
    [accounts, enabled],
  );
  const key = dids.join(' ');
  const [state, setState] = useState({ key: '', checking: false, byDid: {} });

  useEffect(() => {
    if (!key) {
      setState({ key: '', checking: false, byDid: {} });
      return undefined;
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let cancelled = false;
    setState({ key, checking: true, byDid: {} });
    Promise.all(
      key.split(' ').map(async (did) => {
        const requester = backendFor(did);
        if (!requester) return [did, { posts: 0, timers: 0 }];
        try {
          return [did, await readPendingWork(requester, { signal: controller?.signal })];
        } catch {
          return [did, null];
        }
      }),
    ).then((entries) => {
      if (!cancelled) setState({ key, checking: false, byDid: Object.fromEntries(entries) });
    });
    return () => {
      cancelled = true;
      controller?.abort();
    };
    // backendFor changes identity with the account list; the DIDs are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state.key === key ? state : { key, checking: Boolean(key), byDid: {} };
}
