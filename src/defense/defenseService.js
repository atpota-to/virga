// Defense's lists, plans and history, through Virga's server (/api/defense/*).
//
// Every call takes the account's Requester (`backendFor(did)`): the server
// takes the owner from the token, and every read and write is that owner's.
// A browser session has none, so lists need a long session (the run route
// writes them while the browser is closed).

const BASE = '/api/defense';

function needsBackend() {
  return Object.assign(new Error('Defense’s lists need this account signed in through Virga’s server.'), { code: 'NEEDS_BACKEND', status: 0 });
}

function check(req) {
  if (!req || typeof req.request !== 'function') throw needsBackend();
}

const data = (body) => body?.data ?? body;

/** `{ lists, kept, writes }` for the account. */
export async function fetchLists(req, { signal } = {}) {
  check(req);
  return data(await req.request(`${BASE}/lists`, { signal }));
}

/** Make a moderation list in the account's own repo: the new list. */
export async function createList(req, { name, purpose, description }) {
  check(req);
  return data(await req.request(`${BASE}/list-create`, { method: 'POST', body: { name, purpose, ...(description ? { description } : {}) } })).list;
}

export async function keepAccount(req, did, reason) {
  check(req);
  return data(await req.request(`${BASE}/keep`, { method: 'POST', body: { did, ...(reason ? { reason } : {}) } }));
}

export async function unkeepAccount(req, did) {
  check(req);
  return data(await req.request(`${BASE}/unkeep`, { method: 'POST', body: { did } }));
}

/**
 * Store a scan's plan for a list, then approve bands of it: `{ planId,
 * queued, kept, already }`. Two calls, so a plan is kept even if approving it
 * fails, and can be approved again.
 */
export async function planAndApprove(req, { listId, postUri, rows, totals, bands, note }) {
  check(req);
  const plan = data(await req.request(`${BASE}/plan`, { method: 'POST', body: { listId, postUri, rows, totals } }));
  const approved = data(await req.request(`${BASE}/approve`, { method: 'POST', body: { planId: plan.planId, bands, note } }));
  return { planId: plan.planId, ...approved };
}

/** `{ decisions, plans }`, newest first. */
export async function fetchHistory(req, { before = null, list = null, signal } = {}) {
  check(req);
  const query = {};
  if (before) query.before = String(before);
  if (list) query.list = list;
  return data(await req.request(`${BASE}/history`, { query, signal }));
}

/** Take back a plan's adds, or some decisions: `{ jobId, cancelled, queued }`. */
export async function undoAdds(req, { planId = null, ids = null, note = null }) {
  check(req);
  return data(await req.request(`${BASE}/undo`, { method: 'POST', body: { ...(planId ? { planId } : {}), ...(ids ? { ids } : {}), ...(note ? { note } : {}) } }));
}

/** A sentence for a failed call, from the server's code where it gave one. */
export function defenseErrorMessage(err) {
  switch (err?.code) {
    case 'NEEDS_BACKEND':
      return 'Defense’s lists need a long session through Virga’s server. Reconnect this account from the account menu.';
    case 'WRITES_OFF':
      return 'Defense’s lists aren’t turned on on Virga’s server yet.';
    case 'NO_SCOPE':
      return 'This sign-in doesn’t let Virga make lists. Let Defense make lists, below, and try again.';
    case 'SIGNED_OUT':
    case 'FRONTEND_SESSION_INVALID':
      return 'This account’s session on Virga’s server has ended. Sign in again.';
    case 'UNAVAILABLE':
      return 'Defense isn’t set up on Virga’s server yet.';
    default:
      return err?.message || 'Something went wrong on Virga’s server. Try again in a moment.';
  }
}
