// The accounts this browser has signed in with, which one is open, and what
// each one keeps here. Pure: every function takes its storage, and fails soft
// when storage is missing or throws (as src/lib/sessionHint.js does), so a
// private window or a full disk just means a shorter memory.
//
//   localStorage  virga:accounts               [{ did, handle, displayName, avatar, mode, lastUsed, addedAt, signedOut?, scope? }]
//                 virga:account                the open account's DID
//                 virga:backend-token:<did>    a long session's token, one per account
//
// A row stays after its account signs out (signedOut: true), so it can come
// back without the handle being typed again. "Remove from this browser"
// deletes the row.

export const ACCOUNTS_KEY = 'virga:accounts';
export const ACTIVE_KEY = 'virga:account';
const TOKEN_PREFIX = 'virga:backend-token:';
const DAY_MS = 86_400_000;

export const MODES = ['browser', 'backend'];

/**
 * Dispatched on `window` with `{ did }` when an account's sign-in turns out
 * to have ended (not when someone signs out on purpose), so the open
 * account's reader can be sent to sign in again.
 */
export const SESSION_EXPIRED_EVENT = 'virga:session-expired';

export function isDid(value) {
  return typeof value === 'string' && /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(value);
}

export function backendTokenKey(did) {
  return `${TOKEN_PREFIX}${did}`;
}

function parse(raw, fallback) {
  try {
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function read(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    storage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/** Keeps the fields a row may carry, dropping anything malformed. */
function cleanRow(row) {
  if (!row || !isDid(row.did)) return null;
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const out = {
    did: row.did,
    handle: text(row.handle),
    displayName: text(row.displayName),
    avatar: text(row.avatar),
    mode: MODES.includes(row.mode) ? row.mode : 'browser',
    lastUsed: Number.isFinite(row.lastUsed) ? row.lastUsed : 0,
    addedAt: Number.isFinite(row.addedAt) ? row.addedAt : Number.isFinite(row.lastUsed) ? row.lastUsed : 0,
  };
  if (row.signedOut === true) out.signedOut = true;
  if (typeof row.scope === 'string') out.scope = row.scope;
  return out;
}

function byRecent(a, b) {
  return (b.lastUsed || 0) - (a.lastUsed || 0);
}

/** Every remembered account, most recently used first. Never throws. */
export function readAccounts(storage) {
  const list = parse(read(storage, ACCOUNTS_KEY), []);
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const row of list) {
    const clean = cleanRow(row);
    if (!clean || seen.has(clean.did)) continue;
    seen.add(clean.did);
    out.push(clean);
  }
  return out.sort(byRecent);
}

export function writeAccounts(storage, list) {
  const rows = (list || []).map(cleanRow).filter(Boolean).sort(byRecent);
  write(storage, ACCOUNTS_KEY, JSON.stringify(rows));
  return rows;
}

export function findAccount(list, did) {
  return (list || []).find((a) => a.did === did) || null;
}

/**
 * Record a sign-in: a new row, or the existing one brought back. A fresh
 * sign-in always clears `signedOut` and moves the row to the top. Display
 * fields that come back empty keep what was known.
 */
export function recordSignIn(storage, { did, mode, handle, displayName, avatar, scope }, now = Date.now()) {
  const list = readAccounts(storage);
  const old = findAccount(list, did);
  const row = {
    ...(old || {}),
    did,
    mode,
    handle: handle || old?.handle || null,
    displayName: displayName || old?.displayName || null,
    avatar: avatar || old?.avatar || null,
    lastUsed: now,
    addedAt: old?.addedAt || now,
  };
  delete row.signedOut;
  if (scope !== undefined) row.scope = scope;
  else if (old && old.mode !== mode) delete row.scope;
  return writeAccounts(storage, [row, ...list.filter((a) => a.did !== did)]);
}

/** Merge fields into one row, keeping the rest. A row that isn't there stays absent. */
export function updateAccount(storage, did, fields) {
  const list = readAccounts(storage);
  if (!findAccount(list, did)) return list;
  return writeAccounts(
    storage,
    list.map((a) => (a.did === did ? { ...a, ...fields, did } : a)),
  );
}

/** Mark an account as opened now. */
export function touchAccount(storage, did, now = Date.now()) {
  return updateAccount(storage, did, { lastUsed: now });
}

export function markSignedOut(storage, did) {
  return updateAccount(storage, did, { signedOut: true });
}

/** Forget an account: its row, its token, and the open pointer if it named it. */
export function forgetAccount(storage, did) {
  const list = readAccounts(storage).filter((a) => a.did !== did);
  writeAccounts(storage, list);
  remove(storage, backendTokenKey(did));
  if (readActiveDid(storage) === did) remove(storage, ACTIVE_KEY);
  return list;
}

export function readActiveDid(storage) {
  const did = read(storage, ACTIVE_KEY);
  return isDid(did) ? did : null;
}

export function writeActiveDid(storage, did) {
  if (isDid(did)) write(storage, ACTIVE_KEY, did);
  else remove(storage, ACTIVE_KEY);
}

/*
 * The account a tab had open when it left to sign one in again, kept in that
 * tab's sessionStorage. Signing a different account back in (from the
 * composer's list of accounts to post as, or from Settings) brings this one
 * back open rather than switching to the one that signed in. Kept here, not
 * in the sign-in's state, which would tell one account's server the DID of
 * the other.
 */
export const OPEN_AT_SIGNIN_KEY = 'virga:signin-open';

export function writeOpenAtSignIn(tabStorage, did) {
  if (isDid(did)) write(tabStorage, OPEN_AT_SIGNIN_KEY, did);
  else remove(tabStorage, OPEN_AT_SIGNIN_KEY);
}

/** The account recorded by writeOpenAtSignIn, once. */
export function takeOpenAtSignIn(tabStorage) {
  const did = read(tabStorage, OPEN_AT_SIGNIN_KEY);
  remove(tabStorage, OPEN_AT_SIGNIN_KEY);
  return isDid(did) ? did : null;
}

// A long session's token is `vg_` and 64 hex digits, as Virga's server mints it.
const TOKEN = /^vg_[0-9a-f]{64}$/;

export function isBackendToken(token) {
  return typeof token === 'string' && TOKEN.test(token);
}

export function readBackendToken(storage, did) {
  const token = read(storage, backendTokenKey(did));
  return isBackendToken(token) ? token : null;
}

export function writeBackendToken(storage, did, token) {
  return isBackendToken(token) && isDid(did) ? write(storage, backendTokenKey(did), token) : false;
}

export function removeBackendToken(storage, did) {
  remove(storage, backendTokenKey(did));
}

/** Accounts that are signed in here (not signed out). */
export function signedInAccounts(list) {
  return (list || []).filter((a) => !a.signedOut);
}

/**
 * Which account to open: the remembered one if it's still signed in, else the
 * most recently used account that is.
 */
export function pickActiveAccount(list, activeDid) {
  const live = signedInAccounts(list);
  return findAccount(live, activeDid) || live[0] || null;
}

/**
 * Where to go after `did` stops being usable: the most recently used other
 * account that is signed in and not known to need a sign-in.
 *
 * @param {Array} list
 * @param {string} did the account being left
 * @param {(did: string) => string} [statusOf] the runtime status, 'needsSignIn' rules a row out
 */
export function nextReadyAccount(list, did, statusOf = () => 'ready') {
  return signedInAccounts(list).find((a) => a.did !== did && statusOf(a.did) !== 'needsSignIn') || null;
}

/* ---- naming ---------------------------------------------------------- */

/** The name to show: display name, else @handle, else a shortened DID. */
export function accountName(account) {
  if (account?.displayName && !isDid(account.displayName)) return account.displayName;
  if (account?.handle && !isDid(account.handle)) return `@${account.handle}`;
  return shortDid(account?.did);
}

/** "@handle", or null when only a DID is known. */
export function accountHandle(account) {
  return account?.handle && !isDid(account.handle) ? `@${account.handle}` : null;
}

/** What to sign in with: the handle when known, else the DID. */
export function accountSignInId(account) {
  return account?.handle && !isDid(account.handle) ? account.handle : account?.did || '';
}

/** Whether a row's label is worth refreshing from the public profile. */
export function needsRefresh(account) {
  return !account?.handle || isDid(account.handle) || !account.avatar;
}

export function shortDid(did) {
  if (!did) return '';
  return did.length <= 24 ? did : `${did.slice(0, 12)}…${did.slice(-6)}`;
}

/** The label for the "signing you in again" notice: @handle, else the name, else the DID. */
export function reauthNoticeLabel(account) {
  if (!account) return 'This account';
  if (account.handle && !isDid(account.handle)) return `@${account.handle}`;
  if (account.displayName && !isDid(account.displayName)) return account.displayName;
  return account.did || 'This account';
}

/**
 * When this browser last opened the account, for the front page:
 * "Last opened today", "Last opened 3 days ago", … By calendar day, so late
 * last night reads as yesterday.
 */
export function lastOpenedLabel(lastUsed, now = Date.now()) {
  if (!lastUsed || !Number.isFinite(lastUsed)) return null;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.ceil((startOfToday.getTime() - lastUsed) / DAY_MS));
  let when;
  if (days === 0) when = 'today';
  else if (days === 1) when = 'yesterday';
  else if (days < 7) when = `${days} days ago`;
  else if (days < 30) {
    const weeks = Math.round(days / 7);
    when = weeks === 1 ? 'a week ago' : `${weeks} weeks ago`;
  } else if (days < 365) {
    const months = Math.max(1, Math.round(days / 30));
    when = months === 1 ? 'a month ago' : `${months} months ago`;
  } else when = 'over a year ago';
  return `Last opened ${when}`;
}

/* ---- re-authorization ------------------------------------------------ */

export const REAUTH_REQUIRED_CODE = 'REAUTH_REQUIRED';

/** Thrown when an account can only be used again after a fresh sign-in. */
export function makeReauthRequiredError(did = null) {
  const error = new Error('This account needs to sign in again.');
  error.code = REAUTH_REQUIRED_CODE;
  if (did) error.did = did;
  return error;
}

export function isReauthRequiredError(error) {
  return error?.code === REAUTH_REQUIRED_CODE;
}

/* ---- what an account keeps here --------------------------------------- */

// Per-account localStorage keys, by the module that owns each.
const LOCAL_KEYS = [
  (did) => `virga:dashboards:${did}`, // src/dashboards/DashboardsContext.jsx
  (did) => `virga:posting:${did}`, // src/posting/settings.js
  (did) => `virga:composer-autosave:${did}`, // src/posting/autosave.js
  (did) => `virga:templates:${did}`, // src/posting/templates
  (did) => `virga:template-usage:${did}`,
  (did) => `virga:adviser-usage:${did}`, // src/posting/adviser/usage.js
];

/**
 * Every localStorage key holding `did`'s data in this browser: the fixed
 * ones above, plus each `virga:keep:<name>:<did>` list (src/tools/keep.js),
 * found by scanning, since tools add names freely. Never the token (that is
 * removed by every sign-out) and never per-browser keys such as
 * `virga:preferences` or `virga:posting-device`.
 */
export function localDataKeys(storage, did) {
  if (!isDid(did)) return [];
  const keys = new Set(LOCAL_KEYS.map((k) => k(did)));
  try {
    const n = storage?.length || 0;
    for (let i = 0; i < n; i++) {
      const key = storage.key(i);
      if (typeof key === 'string' && key.startsWith('virga:keep:') && key.endsWith(`:${did}`)) keys.add(key);
    }
  } catch {
    // A storage that can't be listed still has the fixed keys removed.
  }
  return [...keys];
}

/** The IndexedDB databases holding `did`'s data. */
export function localDatabases(did) {
  return isDid(did) ? [`virga-analytics:${did}`, `virga-posting:${did}`] : [];
}

/** Remove every localStorage key `localDataKeys` names. */
export function removeLocalData(storage, did) {
  const keys = localDataKeys(storage, did);
  for (const key of keys) remove(storage, key);
  return keys;
}
