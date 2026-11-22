// Shared by the demo-network generators: the worlds they run on, answers
// small enough to keep (a big one by its digest and parts), and the
// randomness the fake server's tokens come from, made repeatable. Swift:
// ios/VirgaKit/Tests/VirgaDemoTests/DemoNetworkSupport.swift.

import { createHarness, readFlags } from '../../../harness/harness.js';
import {
  canonical,
  part,
  sha256,
  sha256Bytes,
  WHOLE_LIMIT,
} from './_canonical.js';
import { toJSON } from './_helpers.js';
import { thrown } from './_demoWorld.js';

/** The harness's worlds for the address flags `search`, built at `now`. */
export function worldsFor(search, now) {
  return createHarness(readFlags(search), { now }).worlds;
}

/**
 * A value as a fixture keeps it: whole when its canonical text is short;
 * else its digest, with each list member as a part and each other member
 * whole (or by its digest when that is long too).
 */
export function shrink(value) {
  const json = toJSON(value) ?? null;
  if (canonical(json).length <= WHOLE_LIMIT) return json;
  if (Array.isArray(json)) return { $part: part(json) };
  if (!json || typeof json !== 'object') return { $sha256: sha256(json) };
  const out = { $sha256: sha256(json) };
  for (const [key, member] of Object.entries(json)) {
    if (Array.isArray(member)) out[key] = { $part: part(member) };
    else if (canonical(member ?? null).length <= WHOLE_LIMIT) out[key] = member;
    else out[key] = { $sha256: sha256(member) };
  }
  return out;
}

/** What a step answered (seen by `look` first), or what it threw. */
export async function outcome(fn, look = (value) => value) {
  try {
    return { result: shrink(look(toJSON(await fn()))) };
  } catch (error) {
    return thrown(error);
  }
}

/**
 * A Response as a fixture keeps it: the status, the content type, and the
 * body (JSON shrunk, bytes by length and digest); null for no answer.
 */
export async function answerOf(res) {
  if (!res) return null;
  const type = res.headers.get('content-type');
  const out = { status: res.status, type };
  if (res.status === 204) return out;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (type && type.includes('json')) {
    out.json = shrink(JSON.parse(new TextDecoder().decode(bytes)));
  } else {
    out.bytes = { length: bytes.length, sha256: sha256Bytes(bytes) };
  }
  const length = res.headers.get('content-length');
  if (length !== null) out.length = length;
  return out;
}

/**
 * Bytes for `crypto.getRandomValues`, the same on both sides: the n-th
 * byte asked for is `(n * 37 + 11) & 255`. Swift: DemoNetworkSupport's
 * `RepeatableBytes`.
 */
export function repeatableRandom() {
  let n = 0;
  return (array) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = (n * 37 + 11) & 255;
      n += 1;
    }
    return array;
  };
}

/** Runs `fn` with `crypto.getRandomValues` repeatable. */
export async function withRepeatableRandom(fn) {
  const real = globalThis.crypto.getRandomValues;
  globalThis.crypto.getRandomValues = repeatableRandom();
  try {
    return await fn();
  } finally {
    globalThis.crypto.getRandomValues = real;
  }
}
