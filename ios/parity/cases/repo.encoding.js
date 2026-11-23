// The encodings under every CID and CAR the web reads or writes, as
// @atcute implements them for src/lib/carRepo.js and
// src/posting/lib/recordCid.js: unsigned varints (CAR length prefixes),
// base32 (CID strings), base64 (the `$bytes` of the JSON form) and CIDs
// themselves. Swift: VirgaRepo/Encoding/{Varint,Multibase}.swift and
// VirgaRepo/CID.swift.

import * as varint from '@atcute/varint';
import {
  fromBase32,
  fromBase64,
  fromBase64Pad,
  toBase32,
  toBase64,
  toBase64Pad,
} from '@atcute/multibase';
import * as CID from '@atcute/cid';
import { each } from './_helpers.js';

export const sources = ['src/lib/carRepo.js', 'src/posting/lib/recordCid.js'];

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const unhex = (text) => new Uint8Array(Buffer.from(text, 'hex'));

const VARINT_VALUES = [
  0,
  1,
  23,
  24,
  127,
  128,
  129,
  255,
  256,
  300,
  16_383,
  16_384,
  2 ** 21 - 1,
  2 ** 21,
  2 ** 28 - 1,
  2 ** 28,
  2 ** 31 - 1,
  2 ** 31,
  2 ** 32 - 1,
  2 ** 32,
  2 ** 35,
  2 ** 42 - 1,
  2 ** 49,
  2 ** 52 + 7,
  2 ** 53 - 1,
  2 ** 53,
  -1,
  1.5,
];

const VARINT_DECODES = [
  { $id: 'zero', hex: '00' },
  { $id: 'max-one-byte', hex: '7f' },
  { $id: 'two-bytes', hex: '8001' },
  { $id: 'three-bytes', hex: 'ffff03' },
  { $id: 'non-minimal-zero', hex: '8000' },
  { $id: 'non-minimal-long', hex: '8080808000' },
  { $id: 'cut-short', hex: '80' },
  { $id: 'empty', hex: '' },
  { $id: 'five-bytes', hex: 'ffffffff0f' },
  { $id: 'seven-bytes', hex: 'ffffffffffff3f' },
  { $id: 'eight-bytes-max-safe', hex: 'ffffffffffffff0f' },
  { $id: 'eight-bytes-past-safe', hex: 'ffffffffffffff7f' },
  { $id: 'nine-bytes-limit-eight', hex: '808080808080808001', length: 8 },
  { $id: 'nine-bytes-no-limit', hex: '808080808080808001' },
  { $id: 'ten-bytes-past-safe', hex: 'ffffffffffffffffff01' },
  { $id: 'offset', hex: 'aabb9601', offset: 2 },
  { $id: 'offset-past-end', hex: 'aabb', offset: 2 },
  { $id: 'limit-cuts', hex: '9601', length: 1 },
  { $id: 'limit-past-end', hex: '9601', offset: 0, length: 9 },
  { $id: 'trailing-ignored', hex: '0501ff' },
  { $id: 'car-header-58', hex: '3aa265726f6f7473' },
];

const BYTES = [
  '',
  '00',
  'ff',
  '0001',
  '000102',
  '00010203',
  '0001020304',
  '000102030405',
  'deadbeef',
  'ffffffffff',
  'fffefdfcfbfaf9f8f7f6',
  '01711220' + '11'.repeat(32),
  '01551220' + 'ab'.repeat(32),
  Buffer.from('hello world').toString('hex'),
];

const BASE32_STRINGS = [
  '',
  'a',
  'ae',
  'aa',
  'aaa',
  'aaaa',
  'aaaaa',
  'aaaaaa',
  'aaaaaaa',
  'aaaaaaaa',
  'my',
  'mz',
  'MY',
  'nbswy3dp',
  'nbswy3dpeb3w64tmmq',
  '1aaaaaaa',
  'aaaaaaa1',
  'aaaaaaa=',
  'aaaaaaaaé',
  'é',
  ' my',
  'afyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'.slice(0, 58),
];

const BASE64_STRINGS = [
  '',
  'AA',
  'AQ',
  'AR',
  'AQI',
  'AQM',
  'AQID',
  'AQIDBA',
  'A',
  'AQIDB',
  'AA==',
  'AQ==',
  'AQI=',
  'AQID',
  'AQ=',
  'AQ===',
  'A===',
  '====',
  'AA=A',
  '+/+/',
  '-_-_',
  'aGVsbG8gd29ybGQ',
  'aGVsbG8gd29ybGQ=',
  ' AQID',
  'AQID ',
  'AQ\nID',
  'AQIé',
];

const CID_STRINGS = [
  'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu',
  'bafkreifvw4djmv7ney453nfyozyvoxvrwrlnpmbfhezarsn6plkrcvrw64',
  'bafyreigov2ns6elnyiksqufzr6ctfg4i4eiodharfupyoc5sq23tvyew4a',
  'BAFYREIG6KGWGAIXXENKFV62GKZ43FGDYOE2DDBGQBFR2EDKQV5YA5KGINU',
  'Bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu',
  'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kgin',
  'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginuu',
  'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kgin1',
  'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginv',
  'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
  'zdj7WhuEjrB52m1BisYCtmjH1hSKa7yZ3jEZ9JcXaFRD51wVz',
  '',
  'b',
  'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginé',
  `b${toBase32(unhex('02711220' + '11'.repeat(32)))}`,
  `b${toBase32(unhex('01701220' + '11'.repeat(32)))}`,
  `b${toBase32(unhex('01711320' + '11'.repeat(32)))}`,
  `b${toBase32(unhex('01711221' + '11'.repeat(32)))}`,
];

const CID_BYTES = [
  { $id: 'dag-cbor', hex: '01711220' + '11'.repeat(32) },
  { $id: 'raw', hex: '01551220' + 'ab'.repeat(32) },
  { $id: 'too-short', hex: '01711220' + '11'.repeat(31) },
  { $id: 'remainder', hex: '01711220' + '11'.repeat(32) + '00' },
  { $id: 'version-0', hex: '00711220' + '11'.repeat(32) },
  { $id: 'version-18', hex: '12201220' + '11'.repeat(32) },
  { $id: 'codec-dag-pb', hex: '01701220' + '11'.repeat(32) },
  { $id: 'codec-json', hex: '01801220' + '11'.repeat(32) },
  { $id: 'hash-blake', hex: '0171e420' + '11'.repeat(32) },
  { $id: 'digest-size-31', hex: '0171121f' + '11'.repeat(32) },
  { $id: 'empty', hex: '' },
];

const BINARY_CIDS = [
  { $id: 'ok', hex: '0001711220' + '22'.repeat(32) },
  { $id: 'no-prefix', hex: '01711220' + '22'.repeat(32) + '00' },
  { $id: 'prefix-01', hex: '0101711220' + '22'.repeat(32) },
  { $id: 'short', hex: '0001711220' + '22'.repeat(31) },
  { $id: 'long', hex: '0001711220' + '22'.repeat(33) },
  { $id: 'bad-codec', hex: '0001721220' + '22'.repeat(32) },
];

const CREATE = [
  { $id: 'raw-empty', codec: 0x55, hex: '' },
  { $id: 'dcbor-empty-map', codec: 0x71, hex: 'a0' },
  { $id: 'dcbor-null', codec: 0x71, hex: 'f6' },
  { $id: 'raw-hello', codec: 0x55, hex: Buffer.from('hello').toString('hex') },
  { $id: 'raw-1k', codec: 0x55, hex: 'ab'.repeat(1024) },
];

const cidOut = (cid) => ({
  string: CID.toString(cid),
  codec: cid.codec,
  version: cid.version,
  digest: hex(cid.digest.contents),
  bytes: hex(cid.bytes),
});

export default async function cases() {
  return [
    ...(await each(
      'varint.encode',
      VARINT_VALUES.map((num) => ({ num })),
      ({ num }) => {
        const buf = [];
        const n = varint.encode(num, buf, 0);
        return {
          hex: hex(buf.slice(0, n)),
          length: varint.encodingLength(num),
        };
      },
    )),
    ...(await each(
      'varint.decode',
      VARINT_DECODES,
      ({ hex: h, offset, length }) => varint.decode(unhex(h), offset, length),
    )),
    ...(await each(
      'toBase32',
      BYTES.map((h) => ({ hex: h })),
      ({ hex: h }) => toBase32(unhex(h)),
    )),
    ...(await each(
      'fromBase32',
      BASE32_STRINGS.map((text) => ({ text })),
      ({ text }) => hex(fromBase32(text)),
    )),
    ...(await each(
      'toBase64',
      BYTES.map((h) => ({ hex: h })),
      ({ hex: h }) => ({
        unpadded: toBase64(unhex(h)),
        padded: toBase64Pad(unhex(h)),
      }),
    )),
    ...(await each(
      'fromBase64',
      BASE64_STRINGS.map((text) => ({ text })),
      ({ text }) => hex(fromBase64(text)),
    )),
    ...(await each(
      'fromBase64Pad',
      BASE64_STRINGS.map((text) => ({ text })),
      ({ text }) => hex(fromBase64Pad(text)),
    )),
    ...(await each(
      'CID.fromString',
      CID_STRINGS.map((text) => ({ text })),
      ({ text }) => cidOut(CID.fromString(text)),
    )),
    ...(await each('CID.decode', CID_BYTES, ({ hex: h }) =>
      cidOut(CID.decode(unhex(h))),
    )),
    ...(await each('CID.fromBinary', BINARY_CIDS, ({ hex: h }) =>
      cidOut(CID.fromBinary(unhex(h))),
    )),
    ...(await each('CID.create', CREATE, async ({ codec, hex: h }) =>
      cidOut(await CID.create(codec, unhex(h))),
    )),
    ...(await each(
      'CID.fromDigest',
      [
        { $id: 'ok', codec: 0x71, hex: '33'.repeat(32) },
        { $id: 'short', codec: 0x71, hex: '33'.repeat(31) },
        { $id: 'long', codec: 0x55, hex: '33'.repeat(33) },
      ],
      ({ codec, hex: h }) => cidOut(CID.fromDigest(codec, unhex(h))),
    )),
    ...(await each(
      'CID.toBinary',
      [
        {
          string: 'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu',
        },
      ],
      ({ string }) => hex(CID.toBinary(CID.fromString(string))),
    )),
  ];
}
