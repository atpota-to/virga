// A mock request/response pair shaped like what Vercel's Node runtime hands a
// function: req.method / query / headers / body (already parsed, as Vercel
// does), and res with status() / json() / send() / redirect() / setHeader() /
// end(). Header names are lower-cased on both sides, as Node does.

import { Readable } from 'node:stream';

const lower = (headers = {}) =>
  Object.fromEntries(Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v]));

/**
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.query]
 * @param {object} [options.headers]
 * @param {any} [options.body]  what Vercel would put on req.body (an object, a string or a Buffer)
 * @param {string} [options.url]
 * @param {boolean} [options.stream]  leave req.body unset and serve `body` as the request stream instead
 */
export function createReq({ method = 'GET', query = {}, headers = {}, body, url, stream = false } = {}) {
  const base = {
    method,
    query: { ...query },
    headers: lower(headers),
    url: url || buildUrl(query),
  };
  if (!stream) return Object.assign(base, body === undefined ? {} : { body });
  const bytes = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  return Object.assign(Readable.from(bytes), base);
}

function buildUrl(query) {
  const { action, ...rest } = query || {};
  const search = new URLSearchParams(
    Object.entries(rest).flatMap(([k, v]) => [].concat(v).map((x) => [k, String(x)])),
  ).toString();
  return `/${action ? encodeURIComponent(action) : ''}${search ? `?${search}` : ''}`;
}

export function createRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    redirectedTo: null,
    ended: false,
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      res.headers[String(name).toLowerCase()] = value;
      return res;
    },
    getHeader(name) {
      return res.headers[String(name).toLowerCase()];
    },
    removeHeader(name) {
      delete res.headers[String(name).toLowerCase()];
    },
    hasHeader(name) {
      return String(name).toLowerCase() in res.headers;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      if (!res.hasHeader('content-type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.body = body;
      return finish();
    },
    send(payload) {
      res.body = payload;
      return finish();
    },
    redirect(statusOrUrl, maybeUrl) {
      const [status, location] = typeof statusOrUrl === 'number' ? [statusOrUrl, maybeUrl] : [302, statusOrUrl];
      res.statusCode = status;
      res.redirectedTo = location;
      res.setHeader('Location', location);
      return finish();
    },
    writeHead(status, headers = {}) {
      res.statusCode = status;
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.headersSent = true;
      return res;
    },
    end(chunk) {
      if (chunk !== undefined && res.body === undefined) res.body = chunk;
      return finish();
    },
    /** The body as JSON: a json() body as is, a send()/end() string parsed. */
    jsonBody() {
      if (typeof res.body === 'string') return JSON.parse(res.body);
      if (Buffer.isBuffer(res.body)) return JSON.parse(res.body.toString('utf8'));
      return res.body;
    },
  };
  function finish() {
    res.ended = true;
    res.headersSent = true;
    res.writableEnded = true;
    return res;
  }
  return res;
}
