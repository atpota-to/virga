// Shared by the publish generators (publish.*.js): the write account's agent,
// a PDS behind Virga's server that keeps what is written, the clock's
// timeouts, and TIDs that are the same on every run.
//
// The agent. The app writes as `targetFor(did)`: an @atproto/api Agent whose
// fetch handler is src/session/backendClient.js's createBackendFetchHandler,
// so every call goes through Virga's server (/api/oauth/proxy and
// /api/oauth/upload-blob) and the fixture records exactly what reached it.
// The handler takes `globalThis.fetch` when it is made, so make agents inside
// the recorded function. Swift: XRPCAgent over BackendFetchHandler.
//
// The PDS. `pds(script)` answers createRecord, applyWrites, getRecord and
// uploadBlob as a PDS would (records kept, real record CIDs), with each
// write or check doing what the script says first: 'ok', 'fail:<status>[:
// <message>[:<code>]]', 'land-fail:<status>' (kept, then failed), 'hang' (no
// answer ever) or 'offline' (the network failed). A hung request's recorded
// answer is `{ $hang: true }` (`hangs(out, pds)`), and the Swift replay never
// answers it.
//
// Timeouts. publishRecord.js races every write (30 s) and every landed-check
// (15 s) against setTimeout, and recordFetch fires every timer at once,
// which would make each race a coin toss. `withTimers(fire, fn)` keeps the
// waits recorded but lets only the timers `fire` names go off at once
// (`[[ms, n]]`: the n-th timer of `ms`, counting from 0); the others wait for
// real and are cleared when their race is decided. Upload deadlines
// (blobs.js) are left out of the waits: VirgaNetwork's uploadBlob keeps its
// own, off the clock.
//
// TIDs. nextTid (tid.js) mixes a random clock id and performance.now's
// sub-millisecond digits into every key. `loadFresh(paths)` imports the web
// modules afresh with tid.js's nextTid replaced by `tidClock()`: the same
// algorithm, clock id TID_CLOCK_ID, whole milliseconds, a fresh clock for
// every case (`resetTids()`). Swift passes the same minter.

import { vi } from 'vitest';
import { Agent } from '@atproto/api';
import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';
import { json } from './_fetch.js';

// Captured before any generator replaces it.
const REAL_SET_TIMEOUT = globalThis.setTimeout;

export const SERVER = 'https://server.example';
export const TOKEN = `vg_${'0f'.repeat(32)}`;
export const ME = 'did:plc:writer';
export const OTHER = 'did:plc:other';
export const NOW = Date.parse('2026-11-12T15:00:00.000Z');

/* ---- TIDs ------------------------------------------------------------- */

const ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';
export const TID_CLOCK_ID = 7;

function encodeTid(micros, clockId) {
  let n = (micros << 10n) | clockId;
  let out = '';
  for (let i = 0; i < 13; i++) {
    out = ALPHABET[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

/** createTidClock with a fixed clock id and no sub-millisecond digits. */
export function tidClock(clockId = TID_CLOCK_ID) {
  let lastMicros = 0n;
  return function next(ms = Date.now()) {
    let micros = BigInt(Math.floor(ms)) * 1000n;
    if (micros <= lastMicros) micros = lastMicros + 1n;
    lastMicros = micros;
    return encodeTid(micros, BigInt(clockId));
  };
}

let mint = tidClock();

/** A fresh TID clock, for the next case. */
export function resetTids() {
  mint = tidClock();
}

/**
 * The web modules at `paths` (relative to this file), imported afresh with
 * nextTid replaced by the scripted clock. Module state (draftMedia's open
 * stores, drafts.js's read ids) starts over too.
 */
export async function loadFresh(paths) {
  vi.resetModules();
  vi.doMock('../../../src/posting/lib/tid.js', async (importOriginal) => {
    const real = await importOriginal();
    return { ...real, nextTid: (ms) => mint(ms) };
  });
  try {
    const out = [];
    for (const path of paths) out.push(await import(/* @vite-ignore */ path));
    return out;
  } finally {
    vi.doUnmock('../../../src/posting/lib/tid.js');
  }
}

/* ---- the clock ---------------------------------------------------------- */

/**
 * `new Date()` reads the machine's clock, not Date.now: while `fn` runs it
 * reads `ms`, as recordFetch's Date.now does.
 */
export async function withFixedDate(ms, fn) {
  const Real = globalThis.Date;
  class Fixed extends Real {
    constructor(...args) {
      super(...(args.length ? args : [ms]));
    }
    static now() {
      return ms;
    }
  }
  globalThis.Date = Fixed;
  try {
    return await fn();
  } finally {
    globalThis.Date = Real;
  }
}

/** Inside recordFetch: only the timers `fire` names go off at once. */
export async function withTimers(fire, fn) {
  const recorded = globalThis.setTimeout;
  const seen = new Map();
  globalThis.setTimeout = (callback, ms, ...args) => {
    const delay = Number(ms) || 0;
    if (/[\\/]blobs\.js/.test(new Error().stack || '')) {
      return REAL_SET_TIMEOUT(callback, ms, ...args);
    }
    const n = seen.get(delay) ?? 0;
    seen.set(delay, n + 1);
    if ((fire || []).some(([at, nth]) => at === delay && nth === n)) {
      return recorded(callback, ms, ...args);
    }
    recorded(() => {}, ms);
    return REAL_SET_TIMEOUT(callback, ms, ...args);
  };
  try {
    return await fn();
  } finally {
    globalThis.setTimeout = recorded;
  }
}

/* ---- the agent ---------------------------------------------------------- */

/** The write account's agent, through Virga's server (make it inside the recorded function). */
export async function agentFor(did = ME) {
  const { createBackendFetchHandler } =
    await import('../../../src/session/backendClient.js');
  return new Agent({
    did,
    fetchHandler: createBackendFetchHandler({
      backendUrl: SERVER,
      token: () => TOKEN,
      did,
    }),
  });
}

/** Virga's server's envelope. */
export const ok = (data) => json({ success: true, data });
export const fail = (status, error, code) =>
  json({ success: false, error, ...(code ? { code } : {}) }, status);

/** The XRPC method a request through Virga's server calls. */
export function methodOf(request) {
  if (request.url.startsWith(`${SERVER}/api/oauth/upload-blob`))
    return 'com.atproto.repo.uploadBlob';
  return request.headers['x-xrpc-method'] || null;
}

/** A procedure's input, for a request through the proxy (the Agent sends it as bytes). */
export function inputOf(request) {
  if (request.body?.$json !== undefined) return request.body.$json;
  if (request.body?.$bytes)
    return JSON.parse(Buffer.from(request.body.$bytes, 'base64').toString());
  return undefined;
}

/** A query's parameters, for a request through the proxy. */
export function paramsOf(request) {
  return Object.fromEntries(new URL(request.url).searchParams);
}

/* ---- the PDS ------------------------------------------------------------- */

/** The CID the PDS gives `record` (DAG-CBOR, SHA-256), as recordCid.js computes it. */
export function recordCid(record) {
  const clean = JSON.parse(JSON.stringify(record));
  return CID.toString(CID.createSync(CID.CODEC_DCBOR, encode(clean)));
}

/** A raw-bytes CID for `name`, for a blob. */
export function rawCid(name) {
  return CID.toString(CID.createSync(0x55, new TextEncoder().encode(name)));
}

function fault(step) {
  if (!step || step === 'ok') return null;
  if (step === 'hang' || step === 'offline') return { kind: step };
  const [kind, status, message, code] = step.split(':');
  return { kind, status: Number(status), message, code };
}

/**
 * A PDS behind Virga's server. `script.writes` is what each createRecord or
 * applyWrites does in turn, `script.checks` each getRecord, `script.uploads`
 * each uploadBlob (past the end of a list, 'ok'). `script.noResults` makes
 * applyWrites leave out `results`. `script.records` are records it already
 * holds (`{ uri: value }`).
 */
export function pds(script = {}) {
  const records = new Map();
  for (const [uri, value] of Object.entries(script.records || {}))
    records.set(uri, { uri, cid: recordCid(value), value });
  const turns = { writes: 0, checks: 0, uploads: 0 };
  const hung = new Set();
  let blobs = 0;

  const next = (list) => fault((script[list] || [])[turns[list]++]);
  const failWith = (f) =>
    fail(f.status, f.message || `failed with ${f.status}`, f.code);

  function keep(repo, collection, rkey, value) {
    const uri = `at://${repo}/${collection}/${rkey}`;
    const cid = recordCid(value);
    records.set(uri, { uri, cid, value });
    return { uri, cid };
  }

  function write(request, index, apply) {
    const f = next('writes');
    if (f?.kind === 'hang') {
      hung.add(index);
      return new Promise(() => {});
    }
    if (f?.kind === 'offline') throw new TypeError('fetch failed');
    if (f?.kind === 'fail') return failWith(f);
    const out = apply();
    if (f?.kind === 'land-fail') return failWith(f);
    return ok(out);
  }

  function responder(request, index) {
    const method = methodOf(request);
    const input =
      method === 'com.atproto.repo.uploadBlob' ? undefined : inputOf(request);
    switch (method) {
      case 'com.atproto.repo.createRecord':
        return write(request, index, () => ({
          ...keep(input.repo, input.collection, input.rkey, input.record),
          commit: { cid: rawCid('commit'), rev: '3lcommitrev22' },
          validationStatus: 'valid',
        }));
      case 'com.atproto.repo.applyWrites':
        return write(request, index, () => {
          const results = input.writes.map((w) => ({
            $type: 'com.atproto.repo.applyWrites#createResult',
            ...keep(input.repo, w.collection, w.rkey, w.value),
            validationStatus: 'valid',
          }));
          const commit = { cid: rawCid('commit'), rev: '3lcommitrev22' };
          return script.noResults ? { commit } : { commit, results };
        });
      case 'com.atproto.repo.getRecord': {
        const f = next('checks');
        if (f?.kind === 'hang') {
          hung.add(index);
          return new Promise(() => {});
        }
        if (f?.kind === 'offline') throw new TypeError('fetch failed');
        if (f?.kind === 'fail') return failWith(f);
        const p = paramsOf(request);
        const hit = records.get(`at://${p.repo}/${p.collection}/${p.rkey}`);
        if (!hit || f?.kind === 'missing')
          return fail(400, 'Could not locate record', 'RecordNotFound');
        return ok(hit);
      }
      case 'com.atproto.repo.uploadBlob': {
        const f = next('uploads');
        if (f?.kind === 'hang') {
          hung.add(index);
          return new Promise(() => {});
        }
        if (f?.kind === 'offline') throw new TypeError('fetch failed');
        if (f?.kind === 'fail') return failWith(f);
        blobs += 1;
        const encoding = paramsOf(request).encoding;
        const size = request.body?.$bytes
          ? Buffer.from(request.body.$bytes, 'base64').length
          : 0;
        return ok({
          blob: {
            $type: 'blob',
            ref: { $link: rawCid(`upload-${blobs}`) },
            mimeType: encoding,
            size,
          },
        });
      }
      default:
        throw new Error(`the PDS has no answer for ${request.url}`);
    }
  }

  return { responder, records, hung };
}

/** The recorded exchanges with each hung request's answer marked. */
export function hangs(out, server) {
  for (const [i, exchange] of (out.exchanges || []).entries())
    if (server.hung.has(i)) exchange.response = { $hang: true };
  return out;
}
