// What the "needs a long session" panel offers an account. Scheduling,
// the weekly queue, timers and the adviser run on Virga's server, so they
// need the account signed in through it (DESIGN.md §0).

/**
 * `{ ready, action }` for `account`:
 *   ready: true                 the account can use the server's features
 *   action: 'reconnect'         a browser session, and this copy of Virga
 *                               offers long sessions: sign in again through it
 *   action: 'signBackIn'        a long session that has ended
 *   action: 'unavailable'       a browser session, and long sessions aren't
 *                               offered here (a preview, local development)
 *   action: 'none'              no such account
 */
export function backendAccess(account, { authMode, canSchedule } = {}) {
  if (!account) return { ready: false, action: 'none' };
  if (canSchedule) return { ready: true, action: null };
  if (account.mode === 'backend') return { ready: false, action: 'signBackIn' };
  return { ready: false, action: authMode === 'backend' ? 'reconnect' : 'unavailable' };
}
