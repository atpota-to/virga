// Talking to Virga's server (cocoon) for an account with a long session.
// Pure apart from `fetch`, which every function takes (or defaults to the
// global), so the tests can stand in for the server.
//
// The server is a confidential OAuth client: it holds the account's atproto
// session, and the browser holds an opaque token (`vg_…`) for it. Signed-in
// calls go to the server, which makes them as the account:
//
//   XRPC     /oauth/proxy         (the Agent's calls, through createBackendFetchHandler)
//   blobs    /oauth/upload-blob
//   cocoon   /api/*               (scheduling, timers, the adviser, through createBackendRequester)
//
// Every request header has to be one the server's CORS preflight allows,
// or the browser never sends the request at all, hence the exact header sets.

const PROXY_TIMEOUT_MS = 60_000;
const LITE_TIMEOUT_MS = 8_000;
const SESSION_TIMEOUT_MS = 20_000;

export const SIGNIN_PENDING_KEY = 'virga:signin-pending';

// Outputs that are bytes, not JSON. The proxy answers in a JSON envelope, so
// these can't go through it; Virga reads repos and blobs from the PDS
// directly, without the session.
const BINARY_OUTPUT = new Set(['com.atproto.sync.getRepo', 'com.atproto.sync.getBlob', 'com.atproto.sync.getRecord']);

/* ---- signals --------------------------------------------------------- */

/**
 * The caller's signal combined with a deadline. The deadline's signal hangs
 * off the combined one: Node 20 can collect a pending AbortSignal.timeout
 * that nothing else refers to (see withTimeout in src/lib/atproto.js).
 */
function withDeadline(signal, ms) {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function' || !ms) return signal;
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any !== 'function') return signal;
  const combined = AbortSignal.any([signal, timeout]);
  combined.timeoutSignal = timeout;
  return combined;
}

function timedOut(signal) {
  return Boolean(signal?.timeoutSignal?.aborted || (signal && signal.reason?.name === 'TimeoutError'));
}

/* ---- sign-in --------------------------------------------------------- */

function randomNonce() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function readSigninPending(storage) {
  try {
    const value = JSON.parse(storage?.getItem(SIGNIN_PENDING_KEY) || 'null');
    return value && typeof value.nonce === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function writeSigninPending(storage, pending) {
  try {
    storage?.setItem(SIGNIN_PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Without it the return is refused, and the person signs in again.
  }
}

export function clearSigninPending(storage) {
  try {
    storage?.removeItem(SIGNIN_PENDING_KEY);
  } catch {
    // Nothing stored.
  }
}

/** The login request: the address the server is asked for, and where it should send the person back. */
export function buildLoginRequest({ backendUrl, handle, origin, returnPath, nonce }) {
  const returnUrl = new URL(returnPath, origin);
  returnUrl.search = new URLSearchParams({ n: nonce }).toString();
  const url = new URL(`${backendUrl}/virga/oauth/login`);
  url.searchParams.set('handle', handle);
  url.searchParams.set('redirect_uri', returnUrl.href);
  return { url: url.href, returnUrl: returnUrl.href };
}

/**
 * Start a sign-in through Virga's server. The login address is fetched as
 * JSON rather than navigated to, so a handle that doesn't resolve (or a
 * server that's down) comes back here as an error to word, not as a raw page
 * on another site. On success the browser is sent to the account's
 * authorization server, and the promise never settles.
 *
 * A nonce goes in sessionStorage and in the return address; the return is
 * accepted only when they match (readBackendReturn), so a link carrying
 * someone else's token can't sign this browser in as them.
 *
 * Errors carry `code` (the server's, such as HANDLE_NOT_FOUND) and `status`.
 */
export async function startBackendSignIn({
  backendUrl,
  handle,
  origin,
  returnPath,
  mode = 'backend',
  intent = 'add',
  did = null,
  fetch = globalThis.fetch,
  sessionStorage,
  assign,
}) {
  const nonce = randomNonce();
  const { url } = buildLoginRequest({ backendUrl, handle, origin, returnPath, nonce });
  let res;
  let body = null;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: withDeadline(null, SESSION_TIMEOUT_MS) });
    body = await res.json().catch(() => null);
  } catch (cause) {
    // A network failure: worded by signInErrorMessage as "couldn't reach".
    throw Object.assign(new TypeError('Failed to fetch'), { cause, code: 'NETWORK_ERROR' });
  }
  if (!res.ok || !body?.success || typeof body.authUrl !== 'string') {
    const message = typeof body?.error === 'string' ? body.error : `Sign-in couldn’t start (HTTP ${res.status})`;
    throw Object.assign(new Error(message), { code: body?.code || null, status: res.status });
  }
  writeSigninPending(sessionStorage, { nonce, mode, intent, did, at: Date.now() });
  assign(body.authUrl);
  return new Promise(() => {});
}

/* ---- the return ------------------------------------------------------ */

function returnError(code, description) {
  const text = description || code;
  return Object.assign(new Error(text), {
    code,
    params: new URLSearchParams({ error: code, ...(description ? { error_description: description } : {}) }),
  });
}

const DID = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;
const TOKEN = /^vg_[0-9a-f]{64}$/;

/**
 * Read a return from Virga's server off the address. `{ pathname, search,
 * hash }` is a Location (or URL); `pending` is what startBackendSignIn put in
 * sessionStorage, or null.
 *
 *   null                                  not a return
 *   { kind: 'session', did, token, intent, pending }
 *   { kind: 'error', error }              error.params.get('error') is the code
 *
 * A token is taken only from the fragment and only when the nonce in the
 * address is the one this tab sent. An error return carries no token, so it
 * is shown even when the nonce is missing (an expired sign-in comes back
 * without one).
 */
export function readBackendReturn({ pathname, search, hash }, pending, returnPath) {
  if (pathname !== returnPath && pathname !== `${returnPath}/`) return null;
  const query = new URLSearchParams(search || '');
  const fragment = new URLSearchParams(String(hash || '').replace(/^#/, ''));

  const code = query.get('error') || fragment.get('error');
  if (code) {
    const description = query.get('error_description') || fragment.get('error_description') || null;
    return { kind: 'error', error: returnError(code, description) };
  }

  const token = fragment.get('session');
  const did = fragment.get('did');
  if (!token && !did) return null;
  const nonce = query.get('n');
  if (!pending || !nonce || pending.nonce !== nonce) {
    return { kind: 'error', error: returnError('unexpected_return', 'This sign-in wasn’t started from this tab, so it was ignored.') };
  }
  if (!TOKEN.test(token || '') || !DID.test(did || '')) {
    return { kind: 'error', error: returnError('callback_failed', 'The sign-in came back without a usable session.') };
  }
  return { kind: 'session', did, token, intent: pending.intent || 'add', pending };
}

/** The return's address with the token and nonce taken out: the path alone. */
export function strippedReturnAddress({ pathname }) {
  return pathname;
}

/**
 * Take the token out of the address bar and history, keeping the path (the
 * app reads it to know a sign-in is being finished). Called once, at module
 * scope: under StrictMode an effect runs twice, and the second run would find
 * a clean address.
 */
export function stripReturnFromAddress(win = globalThis.window) {
  try {
    win.history.replaceState(win.history.state, '', strippedReturnAddress(win.location));
  } catch {
    // An address that can't be rewritten still had its token read once.
  }
}

/* ---- the Agent's transport ------------------------------------------- */

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/** The proxy's envelope, as an XRPC response the Agent can read. */
async function unwrapEnvelope(res, { did, onUnauthorized, pick = (data) => data }) {
  const env = await res.json().catch(() => null);
  if (res.ok && env?.success) return jsonResponse(pick(env.data) ?? {}, 200);
  if (res.status === 401) {
    try {
      onUnauthorized?.(did, env?.code || null);
    } catch {
      // Recovery is the provider's business; the caller still gets its error.
    }
  }
  const headers = {};
  for (const [k, v] of Object.entries(env?.ratelimit || {})) if (v != null) headers[k] = String(v);
  const status = res.ok ? 502 : res.status || 502;
  return jsonResponse(
    { error: env?.code || (status === 401 ? 'AuthenticationRequired' : 'BackendError'), message: env?.error || res.statusText || 'The request failed' },
    status,
    headers,
  );
}

/**
 * A fetch handler for `new Agent({ did, fetchHandler })` that sends the
 * Agent's XRPC calls through Virga's server. The Agent hands over
 * `/xrpc/<nsid>?<query>` and an init; the answer is an ordinary XRPC
 * response, so every SDK method (and every error's `.error` name) works as
 * it does against a PDS.
 */
export function createBackendFetchHandler({ backendUrl, token, did = null, fetch = globalThis.fetch, onUnauthorized = null, timeoutMs = PROXY_TIMEOUT_MS }) {
  return async function backendFetchHandler(url, init = {}) {
    const u = new URL(url, 'https://xrpc.invalid');
    const nsid = u.pathname.replace(/^\/xrpc\//, '');
    const inHeaders = new Headers(init.headers || undefined);
    const signal = withDeadline(init.signal || null, timeoutMs);

    if (BINARY_OUTPUT.has(nsid)) {
      throw new TypeError(`${nsid} answers in bytes and can't go through Virga’s server; read it from the PDS directly.`);
    }

    if (nsid === 'com.atproto.repo.uploadBlob') {
      const mime = (inHeaders.get('content-type') || '').split(';')[0].trim();
      // The server stores whatever type it is told; octet-stream would put an
      // untyped blob in the repo, which no post can use.
      if (!mime || mime === 'application/octet-stream') {
        throw new TypeError('uploadBlob needs the blob’s real type (pass an encoding such as image/jpeg)');
      }
      const res = await fetch(`${backendUrl}/oauth/upload-blob?encoding=${encodeURIComponent(mime)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body: init.body,
        signal,
      });
      return unwrapEnvelope(res, { did, onUnauthorized, pick: (data) => (data?.blob ? { blob: data.blob } : data) });
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'X-XRPC-Method': nsid,
      'Content-Type': 'application/json',
    };
    const proxy = inHeaders.get('atproto-proxy');
    if (proxy) headers['X-Atproto-Proxy'] = proxy;
    const labelers = inHeaders.get('atproto-accept-labelers');
    if (labelers && labelers.trim()) headers['Atproto-Accept-Labelers'] = labelers;

    const method = (init.method || 'GET').toUpperCase();
    const res = await fetch(`${backendUrl}/oauth/proxy${u.search}`, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : init.body,
      signal,
    });
    return unwrapEnvelope(res, { did, onUnauthorized });
  };
}

/* ---- cocoon's own API ------------------------------------------------ */

function appendQuery(url, query) {
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null) continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, String(item));
    else url.searchParams.set(k, String(v));
  }
}

/**
 * The error a failed cocoon call throws. cocoon's endpoints don't share one
 * shape: some put a code in `code`, the AI ones put it in `error`
 * (`monthly_limit`), most put a sentence in `error`.
 */
export function requestError(status, body) {
  const detail = typeof body?.error === 'string' ? body.error : null;
  const code = body?.code ?? (typeof body?.error === 'string' && /^[a-z_]+$/.test(body.error) ? body.error : null);
  const message = detail || (typeof body?.message === 'string' ? body.message : null) || `Virga’s server answered ${status || 'nothing'}`;
  return Object.assign(new Error(message), { status, code, detail, payload: body ?? null });
}

/**
 * A requester for cocoon's `/api/*` endpoints, as one account (the token's).
 * `request` resolves to the whole parsed body: the services read `.data`,
 * `.moved` or `.unavailable` themselves, and the AI endpoints answer bare.
 * A non-2xx answer, or `success: false`, throws `requestError(...)`. A 401
 * hands the account to `onUnauthorized`, which decides (after confirming)
 * whether it really has to sign in again.
 */
export function createBackendRequester({ backendUrl, token, did, fetch = globalThis.fetch, onUnauthorized = null }) {
  return {
    did,
    async request(path, { method = 'GET', query, body, signal, timeoutMs = 30_000 } = {}) {
      const url = new URL(`${backendUrl}${path.startsWith('/') ? '' : '/'}${path}`);
      appendQuery(url, query);
      const headers = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const combined = withDeadline(signal || null, timeoutMs);
      let res;
      try {
        res = await fetch(url.href, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: combined,
        });
      } catch (cause) {
        if (signal?.aborted) throw cause;
        if (timedOut(combined)) {
          throw Object.assign(new Error('Virga’s server didn’t answer in time.'), { status: 0, code: 'TIMEOUT', detail: null, payload: null, cause });
        }
        throw Object.assign(new Error('Couldn’t reach Virga’s server.'), { status: 0, code: 'NETWORK_ERROR', detail: null, payload: null, cause });
      }
      const parsed = await res.json().catch(() => null);
      if (!res.ok || parsed?.success === false) {
        if (res.status === 401) {
          try {
            onUnauthorized?.(did, parsed?.code || null);
          } catch {
            // As above.
          }
        }
        throw requestError(res.status, parsed);
      }
      return parsed;
    },
  };
}

/* ---- session checks and sign-out -------------------------------------- */

async function sessionRead({ backendUrl, token, fetch, signal, lite, timeoutMs }) {
  const url = `${backendUrl}/oauth/session${lite ? '?lite=1' : ''}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: withDeadline(signal || null, timeoutMs),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch {
    // Unreachable or timed out: nothing is known (sessionHealth reads it as unknown).
    return { ok: false, status: 0, data: null };
  }
}

/**
 * The side-effect-free check: one row read on the server, no refresh. The
 * raw `{ ok, status, data }`, for interpretLiteSessionResponse.
 */
export function checkBackendSession({ backendUrl, token, fetch = globalThis.fetch, signal, timeoutMs = LITE_TIMEOUT_MS }) {
  return sessionRead({ backendUrl, token, fetch, signal, lite: true, timeoutMs });
}

/**
 * The full check, which restores the session on the server and answers with
 * the granted `scope` and the account's `pds`. Slower; used once after a
 * sign-in and in the background at startup.
 */
export function fetchBackendSession({ backendUrl, token, fetch = globalThis.fetch, signal, timeoutMs = SESSION_TIMEOUT_MS }) {
  return sessionRead({ backendUrl, token, fetch, signal, lite: false, timeoutMs });
}

/**
 * Sign this browser's token out. Per device: other browsers, and Anisota,
 * stay signed in; the server ends the account's grant only when no token is
 * left. Never throws; true when the server confirmed.
 */
export async function backendSignOut({ backendUrl, token, fetch = globalThis.fetch }) {
  if (!token) return false;
  try {
    const res = await fetch(`${backendUrl}/oauth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: withDeadline(null, SESSION_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
