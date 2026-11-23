// Building repo CARs for the repo generators (repo.car.js, repo.carRepo.js):
// blocks with real CIDs, MST nodes in any shape (well-formed or not), and
// whole repos laid out as a real MST lays them out, by key depth. Every CAR
// is made with @atcute's own encoders, as the web's tests and harness make
// theirs.

import { createHash } from 'node:crypto';
import { writeCarStream } from '@atcute/car';
import { encode, toBytes } from '@atcute/cbor';
import { create as createCid, toCidLink, CODEC_RAW } from '@atcute/cid';

const te = new TextEncoder();

export const toB64 = (bytes) => Buffer.from(bytes).toString('base64');
export const fromB64 = (text) => new Uint8Array(Buffer.from(text, 'base64'));

/** A DAG-CBOR block: `{ cid, bytes, link }`. */
export async function dagBlock(value) {
  const bytes = encode(value);
  const cid = await createCid(0x71, bytes);
  return { cid, bytes, link: toCidLink(cid) };
}

/** A block of given bytes under a codec (raw by default). */
export async function rawBlock(bytes, codec = CODEC_RAW) {
  const cid = await createCid(codec, bytes);
  return { cid, bytes, link: toCidLink(cid) };
}

/** A CAR of `blocks` ({ cid, bytes }) under `roots` (CIDs). */
export async function carOf(roots, blocks) {
  const chunks = [];
  for await (const chunk of writeCarStream(
    roots.map((cid) => toCidLink(cid)),
    blocks.map((b) => ({ cid: b.cid.bytes, data: b.bytes })),
  ))
    chunks.push(chunk);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** MST key bytes as the encoder writes them. */
export const keyBytes = (text) => toBytes(te.encode(text));
/** Arbitrary bytes as a CBOR byte string. */
export const rawKey = (bytes) => toBytes(new Uint8Array(bytes));

/**
 * The entries of one MST node for key-sorted `[key, valueLink, treeLink]`
 * triples, prefix-compressed against the key before (in UTF-8 bytes, as a
 * real MST counts).
 */
export function compressedEntries(items) {
  let prev = new Uint8Array(0);
  return items.map(([key, v, t = null]) => {
    const bytes = te.encode(key);
    let p = 0;
    while (p < bytes.length && p < prev.length && bytes[p] === prev[p]) p++;
    prev = bytes;
    return { p, k: toBytes(bytes.subarray(p)), v, t };
  });
}

/** A key's depth in an atproto MST: leading zero bit pairs of its SHA-256. */
export function keyLayer(key) {
  const hash = createHash('sha256').update(key).digest();
  let layer = 0;
  for (const byte of hash) {
    if (byte === 0) {
      layer += 4;
      continue;
    }
    if ((byte & 0xc0) === 0) layer++;
    else break;
    if ((byte & 0x30) === 0) layer++;
    else break;
    if ((byte & 0x0c) === 0) layer++;
    else break;
    if ((byte & 0x03) === 0) layer++;
    break;
  }
  return layer;
}

/**
 * A repo as a real MST lays it out: each key sits in the node of its layer,
 * with the keys between it and the next one in a subtree below. Returns
 * every block (commit first) and the commit's CID.
 *
 * @param {string} did
 * @param {Array<[string, object]>} records key-sorted
 * @param {{ rev?: string, commit?: object }} opts `commit` replaces fields
 */
export async function buildMstRepo(
  did,
  records,
  { rev = '3mparityrev22', commit = {} } = {},
) {
  const recordBlocks = new Map();
  for (const [key, value] of records)
    recordBlocks.set(key, await dagBlock(value));
  const nodeBlocks = [];
  const layers = new Map(records.map(([key]) => [key, keyLayer(key)]));
  const top = Math.max(0, ...layers.values());

  async function build(keys, layer) {
    if (keys.length === 0) return null;
    if (layer < 0) throw new Error('keys below layer 0');
    const here = keys.filter((k) => layers.get(k) === layer);
    if (here.length === 0) return build(keys, layer - 1);
    const left = keys.slice(0, keys.indexOf(here[0]));
    const items = [];
    for (let i = 0; i < here.length; i++) {
      const start = keys.indexOf(here[i]) + 1;
      const end = i + 1 < here.length ? keys.indexOf(here[i + 1]) : keys.length;
      const subtree = await build(keys.slice(start, end), layer - 1);
      items.push([here[i], recordBlocks.get(here[i]).link, subtree]);
    }
    const node = await dagBlock({
      l: await build(left, layer - 1),
      e: compressedEntries(items),
    });
    nodeBlocks.push(node);
    return node.link;
  }

  const data =
    (await build(
      records.map(([key]) => key),
      top,
    )) ?? (await dagBlock({ l: null, e: [] })).link;
  const commitBlock = await dagBlock({
    did,
    version: 3,
    data,
    rev,
    prev: null,
    sig: toBytes(new Uint8Array(64)),
    ...commit,
  });
  return {
    commit: commitBlock,
    nodes: nodeBlocks,
    records: recordBlocks,
    blocks: [commitBlock, ...nodeBlocks, ...recordBlocks.values()],
  };
}
