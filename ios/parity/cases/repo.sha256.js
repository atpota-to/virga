// SHA-256: every CID the web computes or checks is the SHA-256 of a block
// (record CIDs in src/posting/lib/recordCid.js, the CAR reader's block check
// behind src/lib/carRepo.js), hashed through @atcute/uint8array: its own
// JavaScript under 192 bytes, Node's crypto above. Swift:
// VirgaCore/Crypto/SHA256.swift, held to both over every length up to 300
// bytes and the block-boundary lengths past it.

import { createHash } from 'node:crypto';
import { toSha256Sync } from '@atcute/uint8array';
import { each } from './_helpers.js';

export const sources = ['src/posting/lib/recordCid.js', 'src/lib/carRepo.js'];

/**
 * Deterministic bytes: a 31-bit linear congruential generator, which the
 * Swift test repeats for the long inputs the fixture describes rather than
 * holds.
 */
export function lcgBytes(length, seed) {
  const out = new Uint8Array(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    out[i] = (x >>> 16) & 0xff;
  }
  return out;
}

function sha256Hex(bytes) {
  const node = createHash('sha256').update(bytes).digest('hex');
  const atcute = Buffer.from(toSha256Sync(bytes)).toString('hex');
  if (node !== atcute) {
    throw new Error(`node and @atcute disagree on ${bytes.length} bytes`);
  }
  return node;
}

// Every length across the first two blocks (and the padding boundaries at
// 55/56 and 119/120 bytes) with the bytes in the fixture; every length to
// 300 and the block boundaries past it generated.
const SHORT = Array.from({ length: 137 }, (_, n) => n);
const LONG = [
  ...Array.from({ length: 164 }, (_, n) => 137 + n),
  447,
  448,
  449,
  511,
  512,
  513,
  1000,
  1023,
  1024,
  1025,
  4095,
  4096,
  4097,
  65_539,
  1_000_003,
];

const TEXTS = [
  '',
  'abc',
  'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
  'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
  'The quick brown fox jumps over the lazy dog',
  'héllo wörld',
  '👍🏽 thumbs, 🇬🇧 flag, 👨‍👩‍👧‍👦 family',
  '日本語のテキスト',
  '\u0000nul\u0000',
];

export default async function cases() {
  return [
    ...(await each(
      'hash',
      SHORT.map((length) => ({
        $id: `bytes-${length}`,
        hex: Buffer.from(lcgBytes(length, length + 1)).toString('hex'),
      })),
      ({ hex }) => sha256Hex(Buffer.from(hex, 'hex')),
    )),
    ...(await each(
      'hashGenerated',
      LONG.map((length) => ({ $id: `lcg-${length}`, length, seed: length })),
      ({ length, seed }) => sha256Hex(lcgBytes(length, seed)),
    )),
    ...(await each(
      'hashText',
      TEXTS.map((text) => ({ text })),
      ({ text }) => sha256Hex(Buffer.from(text, 'utf8')),
    )),
    ...(await each(
      'hashRepeated',
      [
        { $id: 'million-a', char: 'a', count: 1_000_000 },
        { $id: 'block-of-zeros', char: '\u0000', count: 64 },
        { $id: 'two-blocks-of-x', char: 'x', count: 128 },
      ],
      ({ char, count }) => sha256Hex(Buffer.from(char.repeat(count), 'utf8')),
    )),
  ];
}
