// DAG-CBOR as @atcute/cbor writes and reads it: what a record's CID is
// computed over (src/posting/lib/recordCid.js) and what every block of a
// repo CAR is decoded from (src/lib/carRepo.js). Canonical encoding (key
// order, shortest integers, tag 42 links, `$link`/`$bytes`), and a decoder
// that refuses non-canonical or non-atproto input with a message of its
// own. Swift: VirgaRepo/DagCbor/*.swift.

import { decode, encode } from '@atcute/cbor';
import { each } from './_helpers.js';

export const sources = ['src/posting/lib/recordCid.js', 'src/lib/carRepo.js'];

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const unhex = (text) => new Uint8Array(Buffer.from(text, 'hex'));

const CID_A = 'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu';
const CID_RAW = 'bafkreifvw4djmv7ney453nfyozyvoxvrwrlnpmbfhezarsn6plkrcvrw64';

const manyKeys = Object.fromEntries(
  Array.from({ length: 40 }, (_, i) => [`k${(i * 7919) % 1000}`, i]),
);
const manyUnicodeKeys = Object.fromEntries(
  Array.from({ length: 36 }, (_, i) => [
    ['é', 'z', 'ü', 'aa', '日', '\u{10000}', '｡', 'b'][i % 8] + i,
    i,
  ]),
);

const ENCODE = [
  // Integers at every argument boundary.
  ...[
    0,
    1,
    23,
    24,
    255,
    256,
    65_535,
    65_536,
    2 ** 32 - 1,
    2 ** 32,
    2 ** 53 - 1,
    -1,
    -24,
    -25,
    -256,
    -257,
    -65_536,
    -65_537,
    -(2 ** 32),
    -(2 ** 32) - 1,
    -(2 ** 53 - 1),
  ].map((value) => ({ $id: `int ${value}`, value })),
  // Numbers that aren't integers, or are out of range.
  ...[
    0.5,
    -1.5,
    1e-7,
    3.141592653589793,
    1e15 + 0.5,
    2 ** 53,
    -(2 ** 53),
    1e300,
  ].map((value) => ({ $id: `num ${value}`, value })),
  { $id: 'negative zero', value: -0 },
  { $id: 'true', value: true },
  { $id: 'false', value: false },
  { $id: 'null', value: null },
  // Strings: lengths at argument boundaries, unicode, the long-string path.
  ...[0, 1, 23, 24, 255, 256, 1023, 1024, 1025].map((n) => ({
    $id: `ascii ${n}`,
    value: 'x'.repeat(n),
  })),
  { $id: 'unicode', value: 'héllo wörld' },
  { $id: 'emoji', value: '👍🏽 thumbs, 🇬🇧, 👨‍👩‍👧‍👦' },
  { $id: 'cjk', value: '日本語のテキスト' },
  { $id: 'nul', value: 'a\u0000b' },
  { $id: 'bom', value: '﻿bom' },
  { $id: 'long unicode', value: 'é'.repeat(700) },
  { $id: 'long emoji', value: '👍'.repeat(300) },
  { $id: 'unicode 12', value: 'ééééééééééé' },
  // Arrays and maps.
  { $id: 'empty array', value: [] },
  { $id: 'empty map', value: {} },
  { $id: 'nested', value: [1, [2, [3, [4, []]]], { a: [{ b: {} }] }] },
  { $id: 'array 24', value: Array.from({ length: 24 }, (_, i) => i) },
  { $id: 'array 300', value: Array.from({ length: 300 }, (_, i) => i % 7) },
  {
    $id: 'key order',
    value: { bb: 1, a: 2, aaa: 3, b: 4, ab: 5, '': 6, B: 7, Z: 8, z: 9 },
  },
  {
    $id: 'unicode key order',
    value: { é: 1, z: 2, ü: 3, aa: 4, 日: 5, '\u{10000}': 6, '｡': 7 },
  },
  { $id: 'many keys', value: manyKeys },
  { $id: 'many unicode keys', value: manyUnicodeKeys },
  // The JSON form's special objects.
  { $id: 'link', value: { $link: CID_A } },
  { $id: 'raw link', value: { $link: CID_RAW } },
  { $id: 'bytes', value: { $bytes: 'AQID' } },
  { $id: 'bytes padded', value: { $bytes: 'AQI=' } },
  { $id: 'bytes empty', value: { $bytes: '' } },
  {
    $id: 'bytes long',
    value: { $bytes: Buffer.alloc(300, 7).toString('base64') },
  },
  { $id: 'link with company', value: { $link: CID_A, x: 1 } },
  { $id: 'bytes with company', value: { $bytes: 'AQID', x: 1 } },
  { $id: 'link not a string', value: { $link: 5 } },
  { $id: 'link null', value: { $link: null } },
  { $id: 'link object', value: { $link: { $link: CID_A } } },
  { $id: 'link invalid', value: { $link: 'bafynope' } },
  {
    $id: 'link v0',
    value: { $link: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
  },
  { $id: 'bytes not a string', value: { $bytes: 1 } },
  { $id: 'bytes invalid', value: { $bytes: '!!' } },
  { $id: 'bytes bad padding', value: { $bytes: 'AQ=' } },
  { $id: 'bytes non-canonical', value: { $bytes: 'AR' } },
  {
    $id: 'record',
    value: {
      $type: 'app.bsky.feed.post',
      text: 'hello',
      createdAt: '2026-03-15T12:00:00.000Z',
      langs: ['en'],
      embed: {
        $type: 'app.bsky.embed.images',
        images: [
          {
            alt: '',
            image: {
              $type: 'blob',
              ref: { $link: CID_RAW },
              mimeType: 'image/jpeg',
              size: 1234,
            },
            aspectRatio: { width: 4, height: 3 },
          },
        ],
      },
    },
  },
  { $id: 'deep float', value: { a: { b: [0.25] } } },
  // An own `constructor` member makes an object not plain to the encoder,
  // which then only takes it as a link or bytes.
  { $id: 'constructor key', value: { constructor: 2, a: 1 } },
  { $id: 'constructor key with link', value: { constructor: 2, $link: CID_A } },
  { $id: 'constructor key with bad link', value: { constructor: 2, $link: 3 } },
  {
    $id: 'constructor key with bytes',
    value: { constructor: 'x', $bytes: 'AQID' },
  },
  {
    $id: 'constructor key with both',
    value: { constructor: 'x', $bytes: 'AQID', $link: CID_A },
  },
  {
    $id: 'constructor and toString keys',
    value: { constructor: 1, toString: 2 },
  },
  { $id: 'toString key', value: { toString: 2 } },
  { $id: 'nested constructor key', value: { a: [{ constructor: null }] } },
];

// Bytes to decode: valid values, then everything the decoder must refuse.
const DECODE = [
  ...ENCODE.filter((c) => {
    try {
      encode(c.value);
      return true;
    } catch {
      return false;
    }
  }).map((c) => ({ $id: `round trip: ${c.$id}`, hex: hex(encode(c.value)) })),
  { $id: 'empty', hex: '' },
  { $id: 'remainder', hex: '0000' },
  { $id: 'non-canonical uint8', hex: '1805' },
  { $id: 'non-canonical uint16', hex: '1900ff' },
  { $id: 'non-canonical uint32', hex: '1a0000ffff' },
  { $id: 'non-canonical uint64', hex: '1b00000000ffffffff' },
  { $id: 'uint64 past safe', hex: '1b0020000000000000' },
  { $id: 'uint64 max safe', hex: '1b001fffffffffffff' },
  { $id: 'negative max safe', hex: '3b001ffffffffffffe' },
  { $id: 'negative 2^53', hex: '3b001fffffffffffff' },
  { $id: 'indefinite array', hex: '9f01ff' },
  { $id: 'indefinite map', hex: 'bf6161' + '01ff' },
  { $id: 'indefinite string', hex: '7f6161ff' },
  { $id: 'argument 28', hex: '1c' },
  { $id: 'half float', hex: 'f93c00' },
  { $id: 'single float', hex: 'fa3fc00000' },
  { $id: 'double float', hex: 'fb3ff8000000000000' },
  { $id: 'double negative zero', hex: 'fb8000000000000000' },
  { $id: 'double subnormal', hex: 'fb0000000000000001' },
  { $id: 'double NaN', hex: 'fb7ff8000000000000' },
  { $id: 'double Infinity', hex: 'fb7ff0000000000000' },
  { $id: 'double -Infinity', hex: 'fbfff0000000000000' },
  { $id: 'double cut short', hex: 'fb3ff8' },
  { $id: 'undefined', hex: 'f7' },
  { $id: 'simple 16', hex: 'f0' },
  { $id: 'simple one byte', hex: 'f820' },
  { $id: 'break', hex: 'ff' },
  { $id: 'tag 0', hex: 'c074323031332d30332d32315432303a30343a30305a' },
  { $id: 'tag 1', hex: 'c11a514b67b0' },
  { $id: 'tag 42 of a string', hex: 'd82a6161' },
  { $id: 'tag 42 cut short', hex: 'd82a' },
  {
    $id: 'tag 42 ok',
    hex: 'd82a582500' + '01711220' + '11'.repeat(32),
  },
  {
    $id: 'tag 42 raw',
    hex: 'd82a582500' + '01551220' + '11'.repeat(32),
  },
  {
    $id: 'tag 42 no prefix',
    hex: 'd82a5825' + '01711220' + '11'.repeat(32) + '00',
  },
  { $id: 'tag 42 version 2', hex: 'd82a582500' + '02711220' + '11'.repeat(32) },
  { $id: 'tag 42 dag-pb', hex: 'd82a582500' + '01701220' + '11'.repeat(32) },
  { $id: 'tag 42 blake', hex: 'd82a582500' + '0171e420' + '11'.repeat(32) },
  { $id: 'tag 42 size 31', hex: 'd82a582400' + '0171121f' + '11'.repeat(31) },
  { $id: 'tag 42 long', hex: 'd82a582600' + '01711220' + '11'.repeat(33) },
  { $id: 'tag 42 short', hex: 'd82a581500' + '01711220' + '11'.repeat(16) },
  { $id: 'tag 42 length cut', hex: 'd82a5825000171' },
  {
    $id: 'tag 42 non-canonical length',
    hex: 'd82a5900' + '25' + '00' + '01711220' + '11'.repeat(32),
  },
  { $id: 'map int key', hex: 'a10102' },
  { $id: 'map bytes key', hex: 'a1410102' },
  { $id: 'map keys out of order', hex: 'a2616201616101' },
  { $id: 'map keys by length', hex: 'a26261610161620' + '1' },
  { $id: 'map keys longer first', hex: 'a2626161016162' + '01' },
  { $id: 'map duplicate keys', hex: 'a2616101616102' },
  { $id: 'map ordered', hex: 'a2616101616202' },
  { $id: 'map key cut', hex: 'a16261' },
  { $id: 'map value missing', hex: 'a16161' },
  { $id: 'map length too big', hex: 'a3616101616202' },
  { $id: 'map key non-canonical length', hex: 'a1780161' + '01' },
  { $id: 'map unicode key order', hex: hex(encode({ z: 1, é: 2 })) },
  { $id: 'map unicode same length', hex: 'a262c3a90162c3bc02' },
  { $id: 'map unicode same length reversed', hex: 'a262c3bc0162c3a902' },
  { $id: 'array cut', hex: '83010203'.slice(0, 6) },
  { $id: 'array length beyond input', hex: '9a0000ffff01' },
  { $id: 'array uint64 length', hex: '9b0000000100000000' },
  { $id: 'bytes cut', hex: '4401020' + '3' },
  { $id: 'string cut', hex: '6461626' + '3' },
  { $id: 'string invalid utf-8', hex: '62c328' },
  { $id: 'string lone continuation', hex: '6180' },
  { $id: 'string overlong', hex: '62c0af' },
  { $id: 'string surrogate', hex: '63eda080' },
  { $id: 'string past max', hex: '64f4908080' },
  { $id: 'string truncated sequence', hex: '62e282' },
  { $id: 'string replacement char', hex: '63efbfbd' },
  { $id: 'string bom', hex: '63efbbbf' },
  { $id: 'string long invalid', hex: '7819' + '61'.repeat(24) + 'ff' },
  { $id: 'key invalid utf-8', hex: 'a162c32801' },
  // Nesting to 128 levels: VirgaRepo refuses deeper values, which no record
  // comes near and which would exhaust a thread's stack in Swift (its
  // tests check that on their own).
  { $id: 'deep nesting', hex: '81'.repeat(128) + '00' },
  { $id: 'deep nesting cut', hex: '81'.repeat(128) },
  { $id: 'deep maps', hex: 'a16161'.repeat(127) + '80' },
];

// (A "__proto__" key decodes as a key like any other, but the fixtures'
// toJSON can't carry one, so VirgaRepoTests checks it on its own.)

// Every prefix of a record's encoding fails.
const RECORD_BYTES = encode({
  $type: 'app.bsky.feed.post',
  text: 'hi',
  facets: [{ index: { byteStart: 0, byteEnd: 2 }, features: [] }],
  ref: { $link: CID_A },
  sig: { $bytes: 'AQID' },
});
for (let n = 0; n < RECORD_BYTES.length; n += 3) {
  DECODE.push({
    $id: `record prefix ${n}`,
    hex: hex(RECORD_BYTES.subarray(0, n)),
  });
}

export default async function cases() {
  return [
    ...(await each('encode', ENCODE, ({ value }) => hex(encode(value)))),
    ...(await each('decode', DECODE, ({ hex: h }) => decode(unhex(h)))),
  ];
}
