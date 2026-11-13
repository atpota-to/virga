// Response and request helpers the OAuth handlers need beyond server/http.js.

/** JSON with a Cache-Control of the handler's choosing (sendJson always says no-store). */
export function sendJsonCached(res, status, body, cacheControl) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  if (typeof res.status === 'function' && typeof res.json === 'function')
    return res.status(status).json(body);
  res.statusCode = status;
  return res.end(JSON.stringify(body));
}

/** A 302 (Vercel's res.redirect defaults to 307). */
export function redirect302(res, url) {
  const location = String(url);
  if (typeof res.redirect === 'function') return res.redirect(302, location);
  res.statusCode = 302;
  res.setHeader('Location', location);
  return res.end();
}

/** The raw query string of the request URL, without the `?`. */
export function rawQuery(req) {
  const url = String(req?.url || '');
  const at = url.indexOf('?');
  return at === -1 ? '' : url.slice(at + 1);
}

/** One query parameter, from Vercel's parsed req.query or else the URL. */
export function queryParam(req, name) {
  const fromQuery = req?.query?.[name];
  if (typeof fromQuery === 'string') return fromQuery;
  if (Array.isArray(fromQuery) && typeof fromQuery[0] === 'string')
    return fromQuery[0];
  const value = new URLSearchParams(rawQuery(req)).get(name);
  return value === null ? undefined : value;
}
