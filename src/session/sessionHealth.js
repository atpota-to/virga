// Is an account's sign-in still good? The answer drives the account menu
// ("Sign back in"), the composer's "post as" list, and the hand-off that
// sends someone to sign in again. The rule throughout: a false "signed out"
// is worse than a stale session, so only an answer that can't be anything
// else counts as dead.
//
// For a long session, the check is the server's side-effect-free probe
// (`/oauth/session?lite=1`: one row read, no refresh). Only
// FRONTEND_SESSION_INVALID ("this token's row is gone") is definitive, and
// only once it has been seen three times, 2.5 s apart: a cold server can
// miss a row it has. Everything else (OAUTH_SESSION_MISSING, a 5xx, a 503
// VALIDATION_TRANSIENT_ERROR, no network) is unknown and never marks an
// account as needing a sign-in.

/** Check an account at most this often. */
export const LITE_CHECK_TTL_MS = 60_000;

/** Per-probe deadline. The answer is best-effort, so it fails fast. */
export const LITE_CHECK_TIMEOUT_MS = 8_000;

/** How many definitive answers in a row make an account dead, and how far apart. */
export const CONFIRM_ROUNDS = 3;
export const CONFIRM_GAP_MS = 2_500;

/** At most this many automatic sign-in redirects per window, per tab. */
export const REAUTH_LOOP_MAX = 3;
export const REAUTH_LOOP_WINDOW_MS = 5 * 60_000;
export const REAUTH_ATTEMPTS_KEY = 'virga:reauth-attempts';

export const SESSION_CHECK_STATUS = {
  VALID: 'valid',
  EXPIRED: 'expired',
  UNKNOWN: 'unknown',
};

/**
 * Read one lite check. `definitive` is only ever true alongside 'expired'.
 * `oauthSessionMissing` reads as expired but not definitive: the server's
 * row read can come back empty on a transient database error.
 *
 * @param {{ ok: boolean, status: number, data: object|null }} response
 * @returns {{ status: 'valid'|'expired'|'unknown', definitive: boolean }}
 */
export function interpretLiteSessionResponse({ ok, status, data }) {
  if (status === 401 || status === 403) {
    return { status: SESSION_CHECK_STATUS.EXPIRED, definitive: data?.code === 'FRONTEND_SESSION_INVALID' };
  }
  if (!ok) return { status: SESSION_CHECK_STATUS.UNKNOWN, definitive: false };
  if (data?.success && data?.authenticated) {
    if (data.oauthSessionMissing) return { status: SESSION_CHECK_STATUS.EXPIRED, definitive: false };
    return { status: SESSION_CHECK_STATUS.VALID, definitive: false };
  }
  return { status: SESSION_CHECK_STATUS.UNKNOWN, definitive: false };
}

/**
 * The runtime status an account is shown with, from a check:
 * 'needsSignIn' only for a confirmed death, 'ready' for a live one, and
 * 'unknown' when the check couldn't tell (which an account keeps using).
 */
export function statusFromCheck({ status, definitive }) {
  if (status === SESSION_CHECK_STATUS.VALID) return 'ready';
  if (status === SESSION_CHECK_STATUS.EXPIRED && definitive) return 'needsSignIn';
  return 'unknown';
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Confirm that an account is dead before acting on it. `probe()` resolves to
 * `{ status, definitive }` (interpretLiteSessionResponse's shape). Returns:
 *
 *   'dead'     every round was definitive: the account has to sign in again
 *   'alive'    a round came back valid
 *   'unknown'  anything else; nothing should change
 *
 * Rounds run one after another, so they never add to a burst.
 */
export async function confirmSessionDead(probe, { rounds = CONFIRM_ROUNDS, gapMs = CONFIRM_GAP_MS, sleep = defaultSleep } = {}) {
  for (let round = 0; round < rounds; round++) {
    if (round > 0) await sleep(gapMs);
    let result;
    try {
      result = await probe();
    } catch {
      return 'unknown';
    }
    if (result?.status === SESSION_CHECK_STATUS.VALID) return 'alive';
    if (!(result?.status === SESSION_CHECK_STATUS.EXPIRED && result.definitive)) return 'unknown';
  }
  return 'dead';
}

/**
 * A per-account checker with a time-to-live: `check(did)` probes at most
 * once per `ttlMs` per account and shares a probe that's under way. A
 * definitive answer is confirmed (confirmSessionDead) before it is reported
 * as such. `onResult(did, result)` hears every settled answer.
 *
 * @param {{ probe: (did: string) => Promise<{status, definitive}>, now?, ttlMs?, sleep?, onResult? }} opts
 */
export function createSessionChecker({
  probe,
  now = () => Date.now(),
  ttlMs = LITE_CHECK_TTL_MS,
  rounds = CONFIRM_ROUNDS,
  gapMs = CONFIRM_GAP_MS,
  sleep = defaultSleep,
  onResult = null,
}) {
  const cache = new Map(); // did -> { at, result }
  const inflight = new Map(); // did -> Promise<result>

  async function run(did) {
    let first;
    try {
      first = await probe(did);
    } catch {
      first = { status: SESSION_CHECK_STATUS.UNKNOWN, definitive: false };
    }
    let result = first;
    if (first.status === SESSION_CHECK_STATUS.EXPIRED && first.definitive) {
      // The first round counts; the rest are spaced the same way.
      await sleep(gapMs);
      const verdict = await confirmSessionDead(() => probe(did), { rounds: rounds - 1, gapMs, sleep });
      if (verdict === 'alive') result = { status: SESSION_CHECK_STATUS.VALID, definitive: false };
      else if (verdict !== 'dead') result = { status: SESSION_CHECK_STATUS.EXPIRED, definitive: false };
    }
    cache.set(did, { at: now(), result });
    onResult?.(did, result);
    return result;
  }

  return {
    check(did, { force = false } = {}) {
      const held = cache.get(did);
      if (!force && held && now() - held.at < ttlMs) return Promise.resolve(held.result);
      if (inflight.has(did)) return inflight.get(did);
      const p = run(did).finally(() => inflight.delete(did));
      inflight.set(did, p);
      return p;
    },
    forget(did) {
      cache.delete(did);
    },
    peek(did) {
      return cache.get(did)?.result || null;
    },
  };
}

/* ---- the automatic sign-in loop breaker -------------------------------- */

function recentAttempts(storage, now) {
  try {
    const data = JSON.parse(storage?.getItem(REAUTH_ATTEMPTS_KEY) || 'null');
    const list = Array.isArray(data?.attempts) ? data.attempts : [];
    return list.filter((ts) => Number.isFinite(ts) && now - ts < REAUTH_LOOP_WINDOW_MS);
  } catch {
    return [];
  }
}

/**
 * Whether automatic sign-in redirects have run too often lately. Kept in
 * sessionStorage, so it survives the redirects and resets with the tab. When
 * it trips, the app stops redirecting on its own and offers a button.
 */
export function reauthLooping(storage, now = Date.now()) {
  return recentAttempts(storage, now).length >= REAUTH_LOOP_MAX;
}

export function recordReauthAttempt(storage, now = Date.now()) {
  const recent = recentAttempts(storage, now);
  recent.push(now);
  try {
    storage?.setItem(REAUTH_ATTEMPTS_KEY, JSON.stringify({ attempts: recent }));
  } catch {
    // Best-effort: without it, the breaker simply doesn't count this one.
  }
}

export function clearReauthAttempts(storage) {
  try {
    storage?.removeItem(REAUTH_ATTEMPTS_KEY);
  } catch {
    // Nothing stored.
  }
}
