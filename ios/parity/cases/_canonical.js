// Canonical JSON and digests, for fixtures of values too big to keep whole
// (the demo worlds: a thousand posts, 4,810 followers, 3,400 notifications).
//
// canonical(value) is JSON.stringify's text with every object's keys sorted
// by UTF-16 code unit and no whitespace. A part of a big value is recorded as
// its count, the SHA-256 of its canonical text, and a few whole items, so a
// Swift port is held to every byte without a multi-megabyte fixture, and a
// difference still shows on a readable item. The Swift side is
// ios/VirgaKit/Tests/VirgaTestSupport/CanonicalJSON.swift.

import { createHash } from 'node:crypto';
import { toJSON } from './_helpers.js';

/** The canonical text of a JSON-shaped value (run it through toJSON first). */
export function canonical(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

/** SHA-256 of a value's canonical text, in hex. */
export function sha256(value) {
  return createHash('sha256')
    .update(canonical(toJSON(value) ?? null))
    .digest('hex');
}

/** SHA-256 of bytes, in hex. */
export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Where the samples of a list of `n` come from: the first two, the middle, the last. */
export function sampleIndexes(n) {
  return [...new Set([0, 1, Math.floor(n / 2), n - 1])].filter(
    (i) => i >= 0 && i < n,
  );
}

/** Lists whose canonical text is at most this long are kept whole. */
export const WHOLE_LIMIT = 6000;
/** A sample's own lists longer than this are kept as parts. */
const SAMPLE_LIST_LIMIT = 12;

/**
 * A list as a fixture holds it: its count, the digest of the whole, and
 * either every item (when its canonical text is short) or a few samples
 * with their indexes. A sample's own long lists (a list's subscribers) are
 * parts in turn, as `{ $part: … }`.
 */
export function part(list) {
  const items = toJSON(list) ?? [];
  const text = canonical(items);
  const out = {
    count: items.length,
    sha256: createHash('sha256').update(text).digest('hex'),
  };
  if (text.length <= WHOLE_LIMIT) out.items = items;
  else
    out.samples = sampleIndexes(items.length).map((index) => ({
      index,
      item: shallow(items[index]),
    }));
  return out;
}

function shallow(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const out = {};
  for (const [key, member] of Object.entries(item))
    out[key] =
      Array.isArray(member) && member.length > SAMPLE_LIST_LIMIT
        ? { $part: part(member) }
        : member;
  return out;
}
