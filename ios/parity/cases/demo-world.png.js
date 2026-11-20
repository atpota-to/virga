// The harness's PNGs (harness/png.js): small images whole, as base64, from
// pixel functions the Swift test has too (values a Uint8Array wraps, NaN,
// missing channels), images whose data crosses a stored deflate block, and
// link-card images for seeds of every kind, small whole and full size by
// digest. Swift: VirgaDemo/Harness/PNG.swift; tests in
// ios/VirgaKit/Tests/VirgaDemoTests/PNGParityTests.swift.

import { cardImage, encodePng } from '../../../harness/png.js';
import { hashOf } from '../../../harness/world.js';
import { each } from './_helpers.js';
import { sha256Bytes } from './_canonical.js';

export const sources = ['harness/png.js'];

/** Pixel functions by name; PNGParityTests.swift has the same ones. */
const PIXELS = {
  gradient: (x, y) => [x * 40, y * 60, (x + y) * 7],
  wrapping: (x, y) => [x * 100 - 50, 300 + y, y - 1.5],
  odd: () => [NaN, Infinity, -0.4],
  short: (x) => [x + 1],
  constant: () => [12, 34, 56],
};

const shown = (bytes, whole) => ({
  length: bytes.length,
  sha256: sha256Bytes(bytes),
  ...(whole ? { base64: Buffer.from(bytes).toString('base64') } : {}),
});

export default async function cases() {
  return [
    ...(await each(
      'encodePng',
      [
        { width: 0, height: 0, pixel: 'gradient' },
        { width: 1, height: 1, pixel: 'gradient' },
        { width: 3, height: 2, pixel: 'gradient' },
        { width: 7, height: 5, pixel: 'wrapping' },
        { width: 4, height: 3, pixel: 'odd' },
        { width: 4, height: 3, pixel: 'short' },
        { width: 2, height: 9, pixel: 'constant' },
        { width: 21844, height: 1, pixel: 'gradient' },
        { width: 21845, height: 1, pixel: 'gradient' },
        { width: 200, height: 120, pixel: 'wrapping' },
      ],
      ({ width, height, pixel }) =>
        shown(encodePng(width, height, PIXELS[pixel]), width * height < 100),
    )),
    ...(await each(
      'cardImage',
      [
        0,
        1,
        29.5,
        359,
        360,
        721,
        -30,
        -390.25,
        4294967295,
        hashOf('https://library.example/x'),
        hashOf('https://a.example/'),
      ].flatMap((seed) => [
        { seed, width: 20, height: 12 },
        { seed, width: 3, height: 40 },
      ]),
      ({ seed, width, height }) =>
        shown(cardImage(seed, { width, height }), true),
    )),
    ...(await each(
      'cardImage-full',
      [
        { seed: 0 },
        { seed: hashOf('https://library.example/events/repair-cafe') },
        { seed: 123.75 },
      ],
      ({ seed }) => shown(cardImage(seed), false),
    )),
  ];
}
