// CAR v1 files as @atcute/car reads and writes them, for src/lib/carRepo.js:
// the header and its roots, each block's CID and bytes, the block-by-block
// SHA-256 check, and every malformed file refused with the reader's own
// message. Writing is held to the web too (the demo world builds CARs as
// the harness does). Swift: VirgaRepo/Car/{CarReader,CarWriter}.swift.

import { fromUint8Array } from '@atcute/car';
import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';
import * as varint from '@atcute/varint';
import { buildRepoCar } from '../../../harness/buildCar.js';
import { carOf, dagBlock, fromB64, rawBlock, toB64 } from './_repoCars.js';
import { each } from './_helpers.js';

export const sources = ['src/lib/carRepo.js'];

function readAll(bytes) {
  const reader = fromUint8Array(bytes);
  return {
    roots: reader.roots.map((root) => root.$link),
    blocks: [...reader].map((b) => ({
      cid: CID.toString(b.cid),
      bytesStart: b.bytesStart,
      bytesEnd: b.bytesEnd,
      entryStart: b.entryStart,
      entryEnd: b.entryEnd,
      cidStart: b.cidStart,
      cidEnd: b.cidEnd,
    })),
  };
}

/** A header from a hand-written value, then raw block bytes. */
function withHeader(headerValue, ...rest) {
  const header = encode(headerValue);
  const prefix = [];
  const n = varint.encode(header.length, prefix, 0);
  return Uint8Array.from([
    ...prefix.slice(0, n),
    ...header,
    ...rest.flatMap((r) => [...r]),
  ]);
}

/** One block entry: varint length, CID bytes, data. */
function entry(cidBytes, data) {
  const prefix = [];
  const n = varint.encode(cidBytes.length + data.length, prefix, 0);
  return Uint8Array.from([...prefix.slice(0, n), ...cidBytes, ...data]);
}

export default async function cases() {
  const a = await dagBlock({ $type: 'x.y.z', text: 'first' });
  const b = await dagBlock({ $type: 'x.y.z', text: 'second', n: 2 });
  const empty = await rawBlock(new Uint8Array(0));
  const nul = await dagBlock(null);
  const harness = await buildRepoCar('did:plc:carparity', [
    [
      'app.bsky.feed.post/3kaaaaaaaaaa2',
      { $type: 'app.bsky.feed.post', text: 'one' },
    ],
    [
      'app.bsky.feed.post/3kaaaaaaaaab2',
      { $type: 'app.bsky.feed.post', text: 'two' },
    ],
  ]);
  const good = await carOf([a.cid], [a, b]);

  const tamperedData = Uint8Array.from(a.bytes);
  tamperedData[tamperedData.length - 1] ^= 1;
  const cidA = a.cid.bytes;
  const withCid = (bytes) => Uint8Array.from(bytes);
  const badCid = (index, value) => {
    const out = withCid(cidA);
    out[index] = value;
    return out;
  };
  const header = { version: 1, roots: [a.link] };

  const READS = [
    { $id: 'harness repo', car: toB64(harness) },
    { $id: 'two blocks', car: toB64(good) },
    { $id: 'no roots', car: toB64(await carOf([], [a])) },
    { $id: 'two roots', car: toB64(await carOf([a.cid, b.cid], [b, a])) },
    { $id: 'header only', car: toB64(await carOf([a.cid], [])) },
    {
      $id: 'empty block',
      car: toB64(await carOf([empty.cid], [empty, empty])),
    },
    { $id: 'null block', car: toB64(await carOf([nul.cid], [nul])) },
    { $id: 'duplicate blocks', car: toB64(await carOf([a.cid], [a, a, b, a])) },
    { $id: 'empty input', car: '' },
    { $id: 'not a car', car: toB64(Uint8Array.from([1, 2, 3, 4])) },
    { $id: 'header length zero', car: toB64(Uint8Array.from([0])) },
    { $id: 'header cut short', car: toB64(good.subarray(0, 20)) },
    { $id: 'header varint cut', car: toB64(Uint8Array.from([0x80])) },
    {
      $id: 'header varint nine bytes',
      car: toB64(
        Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]),
      ),
    },
    { $id: 'header not cbor', car: toB64(Uint8Array.from([2, 0xff, 0xff])) },
    { $id: 'header remainder', car: toB64(Uint8Array.from([2, 0xa0, 0x00])) },
    { $id: 'header an array', car: toB64(withHeader([1, []])) },
    {
      $id: 'header version 2',
      car: toB64(withHeader({ version: 2, roots: [a.link] })),
    },
    {
      $id: 'header version string',
      car: toB64(withHeader({ version: '1', roots: [a.link] })),
    },
    {
      $id: 'header version float',
      car: toB64(withHeader({ version: 1.5, roots: [a.link] })),
    },
    { $id: 'header no roots key', car: toB64(withHeader({ version: 1 })) },
    {
      $id: 'header roots not array',
      car: toB64(withHeader({ version: 1, roots: a.link })),
    },
    {
      $id: 'header root a map',
      car: toB64(
        withHeader({
          version: 1,
          roots: [{ $link: CID.toString(a.cid), x: 1 }],
        }),
      ),
    },
    {
      $id: 'header root a string',
      car: toB64(withHeader({ version: 1, roots: [CID.toString(a.cid)] })),
    },
    {
      $id: 'header extra keys',
      car: toB64(
        withHeader(
          { version: 1, roots: [a.link], note: 'hi' },
          entry(cidA, a.bytes),
        ),
      ),
    },
    {
      $id: 'block length 35',
      car: toB64(withHeader(header, Uint8Array.from([35]))),
    },
    {
      $id: 'block length 5',
      car: toB64(withHeader(header, entry(cidA, a.bytes), [5])),
    },
    {
      $id: 'block data cut',
      car: toB64(withHeader(header, entry(cidA, a.bytes).subarray(0, 50))),
    },
    {
      $id: 'block cid cut',
      car: toB64(
        withHeader(header, Uint8Array.from([60, ...cidA.subarray(0, 20)])),
      ),
    },
    {
      $id: 'block length varint long',
      car: toB64(
        withHeader(
          header,
          [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01],
        ),
      ),
    },
    {
      $id: 'block cid v0',
      car: toB64(withHeader(header, entry(badCid(0, 0x12), a.bytes))),
    },
    {
      $id: 'block cid codec',
      car: toB64(withHeader(header, entry(badCid(1, 0x70), a.bytes))),
    },
    {
      $id: 'block cid hash',
      car: toB64(withHeader(header, entry(badCid(2, 0x13), a.bytes))),
    },
    {
      $id: 'block cid size',
      car: toB64(withHeader(header, entry(badCid(3, 0x20 - 1), a.bytes))),
    },
    {
      $id: 'block tampered',
      car: toB64(withHeader(header, entry(cidA, tamperedData))),
    },
    {
      $id: 'block raw codec mismatch',
      car: toB64(
        withHeader(header, entry(badCid(1, 0x55), Uint8Array.from([1, 2, 3]))),
      ),
    },
    {
      $id: 'second block tampered',
      car: toB64(
        withHeader(
          header,
          entry(cidA, a.bytes),
          entry(b.cid.bytes, tamperedData),
        ),
      ),
    },
  ];

  const WRITES = [
    {
      $id: 'one root two blocks',
      roots: [CID.toString(a.cid)],
      blocks: [a, b],
    },
    { $id: 'no roots', roots: [], blocks: [a] },
    {
      $id: 'two roots no blocks',
      roots: [CID.toString(a.cid), CID.toString(b.cid)],
      blocks: [],
    },
    { $id: 'empty block', roots: [CID.toString(empty.cid)], blocks: [empty] },
    {
      $id: 'big block',
      roots: [],
      blocks: [await rawBlock(new Uint8Array(300).fill(9))],
    },
  ].map(({ $id, roots, blocks }) => ({
    $id,
    roots,
    blocks: blocks.map((blk) => ({
      cid: CID.toString(blk.cid),
      data: toB64(blk.bytes),
    })),
  }));

  return [
    ...(await each('fromUint8Array', READS, ({ car }) =>
      readAll(fromB64(car)),
    )),
    ...(await each('writeCarStream', WRITES, async ({ roots, blocks }) =>
      toB64(
        await carOf(
          roots.map((r) => CID.fromString(r)),
          blocks.map((blk) => ({
            cid: CID.fromString(blk.cid),
            bytes: fromB64(blk.data),
          })),
        ),
      ),
    )),
  ];
}
