// Local record CIDs, so the posts of a thread written in one applyWrites can
// name their parent's { uri, cid } before anything is written. A record's CID
// is deterministic: CIDv1 (base32) of its DAG-CBOR encoding hashed with
// SHA-256, as the PDS computes it.
//
// @atcute/cbor encodes the JSON form of the data model ({ $link }, { $bytes })
// directly, but throws on class instances. @atproto/api's browser OAuth path
// returns blobs as BlobRef objects whose `ref` is a CID instance, so every
// value is brought to that JSON form first; undefined fields are dropped
// (DAG-CBOR has no undefined).

import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const isPlainObject = (v) => {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

// A CID instance from multiformats: `asCID` points back at itself.
const isCidInstance = (v) =>
  v !== null &&
  typeof v === 'object' &&
  v.asCID === v &&
  typeof v.toString === 'function';

/**
 * A record (or any data-model value) in the JSON shape: CIDs as `{ $link }`,
 * BlobRefs as `{ $type: 'blob', ref: { $link }, mimeType, size }`, bytes as
 * `{ $bytes }`, undefined fields gone.
 * @param {unknown} v
 */
export function toJsonShape(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(toJsonShape);
  if (v instanceof Uint8Array) {
    let binary = '';
    for (const byte of v) binary += String.fromCharCode(byte);
    return { $bytes: btoa(binary).replace(/=+$/, '') };
  }
  if (isCidInstance(v)) return { $link: v.toString() };
  // BlobRef: its own IPLD form names the CID.
  if (typeof v.ipld === 'function') return toJsonShape(v.ipld());
  if (isPlainObject(v)) {
    const out = {};
    for (const key of Object.keys(v)) {
      const value = v[key];
      if (value === undefined) continue;
      out[key] = toJsonShape(value);
    }
    return out;
  }
  // Anything else (a Date, say) as JSON would carry it.
  return JSON.parse(JSON.stringify(v));
}

/**
 * The CID string the PDS will assign to `record`. The record must include its
 * `$type`, or the CID won't match.
 * @param {object} record
 * @returns {Promise<string>}
 */
export async function computeRecordCid(record) {
  const cid = await CID.create(CID.CODEC_DCBOR, encode(toJsonShape(record)));
  return CID.toString(cid);
}
