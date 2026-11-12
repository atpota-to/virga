// A real repo CAR from a list of records: the same @atcute encoders the
// atproto ecosystem uses, with real content-addressed CIDs, so the dashboard's
// reader (src/lib/carRepo.js) is given the actual wire format and not a
// stand-in for it. One tree node holds every key, which a real repo would
// spread over many; the reader walks either.

import { writeCarStream } from '@atcute/car';
import { encode, toBytes } from '@atcute/cbor';
import { create as createCid, toCidLink } from '@atcute/cid';

const te = new TextEncoder();

async function block(value) {
  const bytes = encode(value);
  const cid = await createCid(113, bytes);
  return { cid, bytes };
}

/**
 * @param {string} did
 * @param {Array<[key: string, record: object]>} records  MUST be key-sorted.
 * @param {{rev?: string}} opts
 * @returns {Promise<Uint8Array>}
 */
export async function buildRepoCar(did, records, { rev = '3mharnessrev22' } = {}) {
  const recordBlocks = [];
  for (const [, value] of records) recordBlocks.push(await block(value));

  // Keys are prefix-compressed: each entry stores how many bytes it shares
  // with the key before it, then the rest.
  let prevKey = '';
  const entries = records.map(([key], i) => {
    let p = 0;
    while (p < key.length && p < prevKey.length && key[p] === prevKey[p]) p++;
    prevKey = key;
    return { p, k: toBytes(te.encode(key.slice(p))), v: toCidLink(recordBlocks[i].cid), t: null };
  });
  const mst = await block({ l: null, e: entries });
  const commit = await block({
    did,
    version: 3,
    data: toCidLink(mst.cid),
    rev,
    prev: null,
    sig: toBytes(new Uint8Array(64)),
  });

  const blocks = [
    { cid: commit.cid.bytes, data: commit.bytes },
    { cid: mst.cid.bytes, data: mst.bytes },
    ...recordBlocks.map((b) => ({ cid: b.cid.bytes, data: b.bytes })),
  ];
  const chunks = [];
  for await (const chunk of writeCarStream([toCidLink(commit.cid)], blocks)) chunks.push(chunk);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
