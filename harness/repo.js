// The account's repo as the harness changes it. The fixtures in a world
// (harness/world.js) are the repo as it was when the page opened; writes from
// the fake agent and from the fake cocoon's publisher land here, in memory,
// and every reader (listRecords, getRecord, the author feed, the repo CAR, the
// public post views) goes through these functions, so a post written in the
// composer shows up everywhere a real one would.
//
// Records written here get their real CIDs (the DAG-CBOR hash the PDS would
// assign), because a thread is written with CIDs the client computed and a
// later read has to agree with them. The fixtures keep the placeholder
// 'bafyharness'.

import * as CID from '@atcute/cid';
import { computeRecordCid } from '../src/posting/lib/recordCid.js';
import { postRecord } from './world.js';

const POST = 'app.bsky.feed.post';
const ARRAYS = {
  'app.bsky.graph.follow': 'follows',
  'app.bsky.feed.like': 'likes',
  'app.bsky.feed.repost': 'reposts',
};

export const keyOf = (collection, rkey) => `${collection}/${rkey}`;

/** `at://did/collection/rkey` → `{ did, collection, rkey }`, or null. */
export function parseAtUri(uri) {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(String(uri || ''));
  return m ? { did: m[1], collection: m[2], rkey: m[3] } : null;
}

/** An XRPC-shaped failure: `error` is the lexicon's name, `status` the HTTP one. */
export class XrpcError extends Error {
  constructor(status, error, message) {
    super(message || error);
    this.name = 'XRPCError';
    this.status = status;
    this.error = error;
  }
}

function touch(world) {
  world.revision = (world.revision || 0) + 1;
}

function uriOf(world, collection, rkey) {
  return `at://${world.me.did}/${collection}/${rkey}`;
}

const rkeyOfUri = (uri) => String(uri).split('/').pop();

/** The posts array keeps newest first, by record key, as the fixtures do. */
function insertPost(world, entry) {
  const i = world.posts.findIndex((p) => p.rkey < entry.rkey);
  if (i === -1) world.posts.push(entry);
  else world.posts.splice(i, 0, entry);
}

/**
 * Every record in one collection, newest first (listRecords' default order):
 * `[{ uri, cid, value }]`. Cached until the next write.
 */
export function listCollection(world, collection) {
  if (world._lists?.revision !== world.revision)
    world._lists = { revision: world.revision, byCollection: new Map() };
  const cached = world._lists.byCollection.get(collection);
  if (cached) return cached;

  const byKey = new Map();
  const add = (rkey, value, cid = 'bafyharness') =>
    byKey.set(rkey, { uri: uriOf(world, collection, rkey), cid, value });
  if (collection === POST) {
    for (const p of world.posts) add(p.rkey, postRecord(p), p.cid);
  } else if (ARRAYS[collection]) {
    for (const r of world[ARRAYS[collection]])
      add(rkeyOfUri(r.uri), r.value, r.cid);
  } else if (collection === 'app.bsky.actor.profile') {
    add('self', {
      $type: 'app.bsky.actor.profile',
      displayName: world.profile.displayName,
    });
  }
  for (const r of world.others)
    if (r.collection === collection) add(r.rkey, r.value);
  const prefix = `${collection}/`;
  for (const [key, r] of world.written)
    if (key.startsWith(prefix)) add(key.slice(prefix.length), r.value, r.cid);
  for (const key of world.removed)
    if (key.startsWith(prefix)) byKey.delete(key.slice(prefix.length));

  const out = [...byKey.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([, r]) => r);
  world._lists.byCollection.set(collection, out);
  return out;
}

/** One record, `{ uri, cid, value }`, or null. */
export function readRecord(world, collection, rkey) {
  if (collection === POST) {
    const p = world.posts.find((x) => x.rkey === rkey);
    return p
      ? {
          uri: uriOf(world, collection, rkey),
          cid: p.cid || 'bafyharness',
          value: postRecord(p),
        }
      : null;
  }
  const key = keyOf(collection, rkey);
  if (world.removed.has(key)) return null;
  const written = world.written.get(key);
  if (written)
    return {
      uri: uriOf(world, collection, rkey),
      cid: written.cid,
      value: written.value,
    };
  return (
    listCollection(world, collection).find((r) => rkeyOfUri(r.uri) === rkey) ||
    null
  );
}

/**
 * Write a record, as createRecord (`createOnly`) or putRecord would.
 * Resolves to `{ uri, cid, created }`. A create over an existing key is
 * refused the way a PDS refuses it.
 */
export async function writeRecord(
  world,
  { collection, rkey, record, createOnly = false },
) {
  if (!collection || !rkey)
    throw new XrpcError(
      400,
      'InvalidRequest',
      'A record needs a collection and a key',
    );
  if (!record || typeof record !== 'object')
    throw new XrpcError(400, 'InvalidRequest', 'A record is required');
  const value = record.$type ? record : { $type: collection, ...record };
  const existing = readRecord(world, collection, rkey);
  if (existing && createOnly) {
    throw new XrpcError(
      400,
      'InvalidRequest',
      `Record already exists at ${keyOf(collection, rkey)}`,
    );
  }
  const cid = await computeRecordCid(value);
  const uri = uriOf(world, collection, rkey);
  const key = keyOf(collection, rkey);
  world.removed.delete(key);

  if (collection === POST) {
    const stamp = new Date().toISOString();
    const entry = {
      rkey,
      at: typeof value.createdAt === 'string' ? value.createdAt : stamp,
      text: typeof value.text === 'string' ? value.text : '',
      record: value,
      cid,
      indexedAt: stamp,
      writtenAt: Date.now(),
      likes: 0,
      reposts: 0,
      replies: 0,
      quotes: 0,
    };
    const i = world.posts.findIndex((p) => p.rkey === rkey);
    if (i === -1) insertPost(world, entry);
    else
      world.posts[i] = {
        ...world.posts[i],
        ...entry,
        indexedAt: world.posts[i].indexedAt || stamp,
      };
    world.profile.postsCount = world.posts.length;
  } else if (ARRAYS[collection]) {
    const list = world[ARRAYS[collection]];
    const i = list.findIndex((r) => rkeyOfUri(r.uri) === rkey);
    const row = { uri, cid, value };
    if (i === -1) list.unshift(row);
    else list[i] = row;
  } else {
    world.written.set(key, { value, cid });
  }
  touch(world);
  return { uri, cid, created: !existing };
}

/** Delete a record. True when there was one. Deleting nothing isn't an error, as on a PDS. */
export function removeRecord(world, collection, rkey) {
  const key = keyOf(collection, rkey);
  let found = false;
  if (collection === POST) {
    const i = world.posts.findIndex((p) => p.rkey === rkey);
    if (i !== -1) {
      world.posts.splice(i, 1);
      world.profile.postsCount = world.posts.length;
      found = true;
    }
  } else if (ARRAYS[collection]) {
    const name = ARRAYS[collection];
    const before = world[name].length;
    world[name] = world[name].filter((r) => rkeyOfUri(r.uri) !== rkey);
    found = world[name].length !== before;
  } else {
    found = !!readRecord(world, collection, rkey);
    world.written.delete(key);
    if (
      world.others.some((r) => r.collection === collection && r.rkey === rkey)
    )
      world.removed.add(key);
  }
  if (found) touch(world);
  return found;
}

/** Keep uploaded bytes as one of the account's blobs, with the CID a PDS would give them. */
export async function storeBlob(world, bytes, mimeType) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const cid = CID.toString(await CID.create(CID.CODEC_RAW, data));
  world.blobs.set(cid, { bytes: data, mimeType, size: data.byteLength });
  return {
    $type: 'blob',
    ref: { $link: cid },
    mimeType,
    size: data.byteLength,
  };
}

/** An uploaded blob's bytes, `{ bytes, mimeType, size }`, or null. */
export function readBlob(world, cid) {
  return world.blobs.get(cid) || null;
}

/** A blob as a `data:` URL, for post views (the page shows them with <img>, which no fetch fake can answer). */
export function blobDataUrl(world, cid, { maxBytes = 2_000_000 } = {}) {
  const blob = readBlob(world, cid);
  if (!blob || blob.size > maxBytes) return null;
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < blob.bytes.length; i += chunk)
    binary += String.fromCharCode(...blob.bytes.subarray(i, i + chunk));
  return `data:${blob.mimeType};base64,${btoa(binary)}`;
}
