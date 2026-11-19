// Recorded network exchanges for the network ports' case generators, on top
// of withFakeFetch (_helpers.js). The Swift test replays them: MockTransport
// answers each recorded request with its recorded response
// (ios/VirgaKit/Tests/VirgaTestSupport/RecordedFetch.swift), then checks the
// port sent the same requests, waited the same waits and reached the same
// result.
//
// recordFetch(responder, fn) returns
//   { exchanges: [{ request, response }], waits, result }   or $throws for result
// - request: as withFakeFetch records it ({ url, method, headers, body }).
// - response: { status, headers, body } with body { $text } (a JSON answer
//   as the exact text sent), { $bytes: base64 } or null; or { $error } when
//   the responder threw (the network failed).
// - waits: every setTimeout delay, in order. setTimeout runs at once while
//   the case runs, so a retry with a ten-second back-off records 10000
//   without taking ten seconds, and Date.now() reads `now`.

import { FIXED_NOW, toJSON, withFakeFetch } from './_helpers.js';

function describe(answer) {
  const status = answer.status ?? 200;
  let body = { $text: '' };
  let contentType = 'text/plain';
  if (answer.json !== undefined) {
    body = { $text: JSON.stringify(answer.json) };
    contentType = 'application/json';
  } else if (answer.bytes) {
    body = { $bytes: Buffer.from(answer.bytes).toString('base64') };
    contentType = answer.contentType || 'application/octet-stream';
  } else if (answer.text !== undefined) {
    body = { $text: answer.text };
  }
  if (status === 204 || status === 304) body = null;
  const headers = Object.fromEntries(
    new Headers({ 'content-type': contentType, ...(answer.headers || {}) }),
  );
  return { status, headers, body };
}

export async function recordFetch(responder, fn, { now = FIXED_NOW } = {}) {
  const responses = [];
  const waits = [];
  const realSetTimeout = globalThis.setTimeout;
  const realNow = Date.now;
  globalThis.setTimeout = (callback, ms, ...args) => {
    waits.push(Number(ms) || 0);
    return realSetTimeout(callback, 0, ...args);
  };
  Date.now = () => now;
  try {
    const out = await withFakeFetch((request) => {
      const index = responses.length;
      responses.push(null);
      let answer;
      try {
        answer = responder(request, index);
      } catch (error) {
        responses[index] = { $error: String(error?.message || error) };
        throw error;
      }
      responses[index] = describe(answer || {});
      return answer;
    }, fn);
    const { requests, ...rest } = out;
    return {
      exchanges: requests.map((request, i) => ({
        request,
        response: responses[i],
      })),
      waits,
      ...rest,
    };
  } finally {
    globalThis.setTimeout = realSetTimeout;
    Date.now = realNow;
  }
}

// One clock for every generator, eleven minutes on at each call: atproto.js
// keeps DID documents ten minutes in module state shared by every generator
// that imports it, so a case on this clock never sees another case's (or
// another generator's) documents. The clock itself is never in an output.
let tick = 0;

/** recordFetch on a clock past every earlier case's cached documents. */
export function recordFetchFresh(responder, fn) {
  tick += 1;
  return recordFetch(responder, fn, { now: FIXED_NOW + tick * 11 * 60_000 });
}

/** A JSON answer. */
export const json = (body, status = 200, headers) => ({
  status,
  json: body,
  ...(headers ? { headers } : {}),
});

/** A failed network: what `fetch` rejects with when it can't connect. */
export function offline(message = 'fetch failed') {
  throw new TypeError(message);
}

/**
 * Answers in turn: the n-th request gets `answers[n]` (a function of the
 * request, an answer, or 'offline'); past the end, the last one again.
 */
export function inTurn(...answers) {
  return (request, index) => {
    const answer = answers[Math.min(index, answers.length - 1)];
    if (answer === 'offline') return offline();
    return typeof answer === 'function' ? answer(request, index) : answer;
  };
}

/** JSON for a fixture: a value with its Maps, Dates and undefined converted. */
export const plain = (value) => toJSON(value);
