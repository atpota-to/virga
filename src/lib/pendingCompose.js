// A compose link (/intent/compose?text=…, or /posting/compose) opened while
// signed out has to survive the sign-in: the redirect leaves the page and
// comes back to Virga's return address, not to the link. The link is kept
// for this tab only (sessionStorage) and for a while, then taken once.

export const PENDING_COMPOSE_KEY = 'virga:pending-compose';

// Long enough to sign in, including a slow authorization server and a
// password manager; short enough that a link from yesterday doesn't open
// the composer on some later sign-in.
export const PENDING_COMPOSE_TTL_MS = 30 * 60 * 1000;

const COMPOSE_PATHS = new Set(['/intent/compose', '/posting/compose']);

/** True for the addresses that open the composer. */
export function isComposePath(path) {
  return COMPOSE_PATHS.has(String(path || '').replace(/\/+$/, ''));
}

function sessionStore() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    // Storage can be blocked outright (some private modes throw on access).
    return null;
  }
}

/** Keep a compose link to reopen after the sign-in. Anything else is ignored. */
export function rememberPendingCompose(path, search = '', { store = sessionStore(), now = Date.now() } = {}) {
  if (!store || !isComposePath(path)) return false;
  const query = typeof search === 'string' && search.startsWith('?') ? search : '';
  try {
    store.setItem(PENDING_COMPOSE_KEY, JSON.stringify({ path: String(path).replace(/\/+$/, ''), search: query, at: now }));
    return true;
  } catch {
    return false;
  }
}

/**
 * The address to reopen, once: the link kept before the sign-in, or null
 * when there is none, it has gone stale or it doesn't read back as one.
 */
export function takePendingCompose({ store = sessionStore(), now = Date.now() } = {}) {
  if (!store) return null;
  let raw = null;
  try {
    raw = store.getItem(PENDING_COMPOSE_KEY);
    store.removeItem(PENDING_COMPOSE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const kept = JSON.parse(raw);
    if (!kept || !isComposePath(kept.path)) return null;
    if (typeof kept.at !== 'number' || now - kept.at > PENDING_COMPOSE_TTL_MS || now < kept.at) return null;
    const search = typeof kept.search === 'string' && kept.search.startsWith('?') ? kept.search : '';
    return `${kept.path}${search}`;
  } catch {
    return null;
  }
}
