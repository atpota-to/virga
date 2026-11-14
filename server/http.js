// Request and response helpers every handler shares. Bodies follow one shape:
// `{ success: true, ...fields }` or `{ success: false, error, code? }`; the
// client throws on `success === false` and branches on `code`.

import { isAllowedFrontendOrigin } from './origins.js';

export const CORS_METHODS = 'GET, POST, OPTIONS';
// Exactly the headers the client sends; a cross-origin preflight must allow each.
export const CORS_HEADERS = 'Authorization, Content-Type, X-XRPC-Method, X-Atproto-Proxy, Atproto-Accept-Labelers';

/** Send `body` as JSON with `status`. Every server answer is per-request, so none is cached. */
export function sendJson(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(body);
  }
  res.statusCode = status;
  return res.end(JSON.stringify(body));
}

/**
 * Let a request through only with one of `methods`. OPTIONS is answered 204
 * (a stray preflight is harmless, and a cross-origin one has had its CORS
 * headers from the router already); anything else not listed is 405. Returns
 * true when the handler may go on.
 */
export function methodGuard(req, res, methods) {
  const allowed = [].concat(methods).map((m) => String(m).toUpperCase());
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.setHeader('Allow', [...allowed, 'OPTIONS'].join(', '));
    if (typeof res.status === 'function') res.status(204);
    else res.statusCode = 204;
    res.end();
    return false;
  }
  if (!allowed.includes(method)) {
    res.setHeader('Allow', allowed.join(', '));
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return false;
  }
  return true;
}

function header(req, name) {
  const value = req?.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The origin this request was sent to, from its own Host; only used to recognise same-origin calls. */
function ownOrigin(req) {
  const host = String(header(req, 'x-forwarded-host') || header(req, 'host') || '').split(',')[0].trim();
  if (!host) return null;
  const proto = String(header(req, 'x-forwarded-proto') || 'https').split(',')[0].trim();
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * Add CORS headers when the request comes from one of the frontend origins
 * other than this server's own (a frontend built with VITE_BACKEND_URL
 * pointing here). Same-origin requests, and every other origin, get none.
 * Returns true when it added them.
 */
export function applyCors(req, res, env = process.env) {
  const origin = header(req, 'origin');
  if (!origin || origin === 'null') return false;
  if (origin === ownOrigin(req)) return false;
  if (!isAllowedFrontendOrigin(origin, env)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
  res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
  res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

/** The bearer token in the Authorization header, or null. */
export function bearerToken(req) {
  const value = header(req, 'authorization');
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value);
  return match ? match[1] : null;
}

// Vercel's Node runtime parses req.body lazily, through a getter that throws
// on malformed JSON; outside Vercel there is no body property at all.
function presetBody(req) {
  try {
    return { body: req.body, failed: false };
  } catch {
    return { body: undefined, failed: true };
  }
}

const isStream = (req) => req && typeof req[Symbol.asyncIterator] === 'function';

async function readStream(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (maxBytes && total > maxBytes) throw tooLarge(maxBytes);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function tooLarge(maxBytes) {
  const err = new Error(`Request body is larger than ${maxBytes} bytes`);
  err.code = 'BODY_TOO_LARGE';
  err.status = 413;
  return err;
}

function parseObject(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The JSON body as an object, or {} when there is none or it isn't a JSON
 * object. Accepts Vercel's pre-parsed body, a string, a Buffer, or an unread
 * request stream.
 */
export async function readJson(req) {
  const { body, failed } = presetBody(req);
  if (failed) return {};
  if (body === undefined || body === null) {
    if (body === undefined && isStream(req)) {
      try {
        const raw = await readStream(req);
        return raw.byteLength ? parseObject(raw.toString('utf8')) : {};
      } catch {
        return {};
      }
    }
    return {};
  }
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return parseObject(Buffer.from(body).toString('utf8'));
  if (typeof body === 'string') return body.trim() ? parseObject(body) : {};
  if (typeof body === 'object' && !Array.isArray(body)) return body;
  return {};
}

/**
 * The raw body as a Buffer (an empty one when there is none). Vercel hands an
 * application/octet-stream body over as a Buffer already; a string is taken as
 * UTF-8 and a pre-parsed JSON object is serialised back. With `maxBytes`, a
 * larger body throws an error with `code: 'BODY_TOO_LARGE'` and `status: 413`.
 */
export async function readRaw(req, { maxBytes } = {}) {
  const { body } = presetBody(req);
  let buf;
  if (body === undefined && isStream(req)) buf = await readStream(req, maxBytes);
  else if (body === undefined || body === null) buf = Buffer.alloc(0);
  else if (Buffer.isBuffer(body)) buf = body;
  else if (body instanceof Uint8Array || body instanceof ArrayBuffer) buf = Buffer.from(body);
  else if (typeof body === 'string') buf = Buffer.from(body, 'utf8');
  else buf = Buffer.from(JSON.stringify(body), 'utf8');
  if (maxBytes && buf.byteLength > maxBytes) throw tooLarge(maxBytes);
  return buf;
}
