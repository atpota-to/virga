// Helpers for the parity case generators (ios/parity/cases/*.js).
//
// A case generator runs the web app's own functions over a set of inputs and
// returns `{ id, fn, input, output }` cases; parity.test.js writes them to
// ios/parity/fixtures/<name>.json, and the Swift tests read that file and
// check the Swift port computes the same output for the same input
// (ios/VirgaKit/Tests/VirgaTestSupport/Parity.swift).
//
// Rules for a generator (ios/parity/README.md says why):
// - Deterministic: no Date.now(), no Math.random(), no network. Pass `now`
//   and time zones in explicitly. The runner sets TZ=UTC before importing.
// - JSON only: Maps, Sets, Dates and undefined are converted by toJSON()
//   below, so convert anything else yourself.
// - Inputs are objects of named arguments, so the Swift side reads
//   `c["text"]`, not positions.

/**
 * A value as JSON would carry it, deterministically: Map → object (string
 * keys) or entries, Set → array, Date → ISO string, BigInt → string,
 * undefined → dropped, NaN/±Infinity → null, -0 → 0. Functions are dropped.
 *
 * Strings are made well-formed: a lone surrogate (half an emoji, from
 * slicing by UTF-16 index) becomes U+FFFD, which is what it becomes anyway
 * when JavaScript encodes the string to UTF-8 for a request, and the only
 * form a Swift String can hold.
 */
export function toJSON(value) {
  if (value === undefined || typeof value === 'function') return undefined;
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value.toWellFormed();
  if (typeof value === 'boolean') return value;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Map) {
    const allStrings = [...value.keys()].every((k) => typeof k === 'string');
    if (allStrings) {
      const out = {};
      for (const [k, v] of value) {
        const converted = toJSON(v);
        if (converted !== undefined) out[k.toWellFormed()] = converted;
      }
      return out;
    }
    return [...value.entries()].map(([k, v]) => [toJSON(k), toJSON(v) ?? null]);
  }
  if (value instanceof Set) return [...value].map((v) => toJSON(v) ?? null);
  if (ArrayBuffer.isView(value)) return [...value];
  if (Array.isArray(value)) return value.map((v) => toJSON(v) ?? null);
  if (typeof value === 'object') {
    if (typeof value.toJSON === 'function') return toJSON(value.toJSON());
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const converted = toJSON(v);
      if (converted !== undefined) out[k.toWellFormed()] = converted;
    }
    return out;
  }
  return undefined;
}

/**
 * Cases for one function: `compute(input)` is called for each input (an
 * object of named arguments, which may be async) and its result recorded.
 * An input may carry `$id` to name its case; otherwise cases are numbered.
 * A compute that throws records `{ $throws: message }`, so the Swift port is
 * held to failing on the same inputs.
 */
export async function each(fn, inputs, compute) {
  const out = [];
  let n = 0;
  for (const raw of inputs) {
    n += 1;
    const { $id, ...input } = raw;
    let output;
    try {
      output = toJSON(await compute(input));
    } catch (error) {
      output = { $throws: String(error?.message || error) };
    }
    out.push({
      id: $id || `${fn}#${n}`,
      fn,
      input: toJSON(input) ?? {},
      output: output === undefined ? null : output,
    });
  }
  return out;
}

/** A single case whose output is a value (a constant, a table). */
export function value(fn, output, id = fn) {
  return { id, fn, input: {}, output: toJSON(output) ?? null };
}

/** Every combination of the given arrays, as named arguments. */
export function grid(spec) {
  const keys = Object.keys(spec);
  let rows = [{}];
  for (const key of keys) {
    const next = [];
    for (const row of rows)
      for (const v of spec[key]) next.push({ ...row, [key]: v });
    rows = next;
  }
  return rows;
}

/** A fixed instant for generators: 2026-03-15T12:00:00Z, a Sunday. */
export const FIXED_NOW = Date.UTC(2026, 2, 15, 12, 0, 0);

/** Days in milliseconds. */
export const DAY = 24 * 60 * 60 * 1000;

/**
 * Runs `fn` with `globalThis.fetch` replaced by a fake that answers each
 * request from `responder(request)` and records it. Returns
 * `{ requests, result }` (or `$throws` instead of `result`), so a Swift test
 * can stand the same answers up in MockTransport and check the port makes
 * the same requests and reaches the same result.
 *
 * A request is `{ url, method, headers, body }`: header names lower-cased;
 * body as `{ $json }`, `{ $text }`, `{ $bytes: base64 }` or null.
 * `responder` returns `{ status = 200, json } | { status, text } | { status,
 * bytes: Uint8Array, contentType }`, optionally with `headers`.
 */
export async function withFakeFetch(responder, fn) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const method = String(init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(
      [...new Headers(init.headers || {}).entries()].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
    let body = init.body ?? null;
    if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
      body = { $bytes: Buffer.from(body).toString('base64') };
    } else if (typeof body === 'string') {
      try {
        body = { $json: JSON.parse(body) };
      } catch {
        body = { $text: body };
      }
    } else if (body !== null) {
      body = { $other: Object.prototype.toString.call(body) };
    }
    const request = { url, method, headers, body };
    requests.push(request);
    const answer = (await responder(request)) || {};
    const status = answer.status ?? 200;
    let payload = '';
    let contentType = 'text/plain';
    if (answer.json !== undefined) {
      payload = JSON.stringify(answer.json);
      contentType = 'application/json';
    } else if (answer.bytes) {
      payload = answer.bytes;
      contentType = answer.contentType || 'application/octet-stream';
    } else if (answer.text !== undefined) {
      payload = answer.text;
    }
    const nullBody = status === 204 || status === 304;
    return new Response(nullBody ? null : payload, {
      status,
      headers: { 'content-type': contentType, ...(answer.headers || {}) },
    });
  };
  try {
    try {
      const result = await fn();
      return { requests: toJSON(requests), result: toJSON(result) ?? null };
    } catch (error) {
      return {
        requests: toJSON(requests),
        $throws: String(error?.message || error),
      };
    }
  } finally {
    globalThis.fetch = original;
  }
}

/**
 * Runs `fn` with the process in time zone `tz` (Node honours a change to
 * process.env.TZ at once, for Date and Intl alike), then puts UTC back. For
 * code that works in local time, like the analytics' buckets: record cases
 * in a few zones, across a DST change, and the Swift port takes the zone as
 * a parameter. Synchronous or async.
 */
export async function withTimeZone(tz, fn) {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await fn();
  } finally {
    process.env.TZ = previous;
  }
}

/** Zones worth recording local-time cases in: no DST, both hemispheres' DST, a half-hour offset. */
export const ZONES = [
  'UTC',
  'America/New_York',
  'Europe/London',
  'Australia/Sydney',
  'Asia/Kolkata',
];
