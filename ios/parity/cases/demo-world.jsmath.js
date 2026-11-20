// The arithmetic and sorting the demo worlds lean on, as V8 does them:
// `x ** y` (V8's fdlibm pow, which differs from glibc's and Apple's in the
// last bit now and then), `Math.sin` (fdlibm's, for the card images), and
// `array.sort` with comparators that never say "equal" (V8's TimSort, whose
// exact sequence of comparisons decides where ties land). Doubles travel as
// their 64-bit patterns in hex, so nothing is rounded on the way. Swift:
// VirgaDemo/Support/{JSMath,JSSort}.swift; tests in
// ios/VirgaKit/Tests/VirgaDemoTests/JSMathParityTests.swift.

import { mulberry } from '../../../harness/world.js';
import { sha256 } from './_canonical.js';

export const sources = [
  'harness/world.js',
  'harness/crowd.js',
  'harness/png.js',
];

const bits = (d) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, d);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
};

function powCases() {
  const r = mulberry(4242);
  const out = [];
  // The exponents the worlds use, on the generator's own draws.
  for (const y of [2.4, 1.6, 1.3, 0.8, 1.2, 1.4, 2])
    out.push({
      $id: `world-draws-${y}`,
      pairs: Array.from({ length: 150 }, () => [r(), y]),
    });
  out.push({
    $id: 'follower-curve',
    pairs: Array.from({ length: 300 }, (_, i) => [1 - (i * 16) / 4810, 2.2]),
  });
  const specials = [
    0,
    -0,
    1,
    -1,
    2,
    -2,
    0.5,
    -0.5,
    Infinity,
    -Infinity,
    NaN,
    1e-310,
    1e308,
    3,
    -3,
    1.0000001,
    0.9999999,
  ];
  out.push({
    $id: 'specials',
    pairs: specials.flatMap((x) => specials.map((y) => [x, y])),
  });
  out.push({
    $id: 'assorted',
    pairs: Array.from({ length: 600 }, () => {
      const x = (r() < 0.2 ? -1 : 1) * (r() * 10) ** (r() * 8 - 4);
      const y = r() < 0.3 ? Math.round((r() - 0.5) * 40) : (r() - 0.5) * 60;
      return [x, y];
    }),
  });
  out.push({
    $id: 'near-one-huge-exponent',
    pairs: Array.from({ length: 200 }, () => [
      1 + (r() - 0.5) * 1e-7,
      (r() - 0.5) * 3e9,
    ]),
  });
  out.push({
    $id: 'subnormal-and-overflow',
    pairs: [
      [5e-324, 0.5],
      [2.2250738585072014e-308, 1.5],
      [1e-300, 2.5],
      [1e300, 1.5],
      [-8, 1 / 3],
      [-8, 3],
      [-2, 1025],
      [-2, -1075],
      [2, -1074],
      [2, -1075],
      [2, 1023.9999],
      [0.5, 1074.5],
      [10, 308.25],
      [-0, -3],
      [-0, -2],
      [-0, 3],
      [-Infinity, 3],
      [-Infinity, -3],
      [-Infinity, 2],
      [4, 0.5],
      [-4, 0.5],
      [Infinity, 0.5],
    ],
  });
  return out.map(({ $id, pairs }) => ({
    $id,
    pairs: pairs.map(([x, y]) => [bits(x), bits(y)]),
    $out: pairs.map(([x, y]) => bits(x ** y)),
  }));
}

function sinCases() {
  const r = mulberry(99);
  const out = [];
  // The card image's hills: x / 70 + hue and x / 45 + hue / 2.
  const hills = [];
  for (const hue of [0, 1, 59, 179, 180, 263, 359])
    for (let x = 0; x < 600; x += 7) hills.push(x / 70 + hue, x / 45 + hue / 2);
  out.push({ $id: 'card-hills', xs: hills });
  out.push({
    $id: 'assorted-magnitudes',
    xs: Array.from({ length: 600 }, () => {
      const e = Math.floor(r() * 2100) - 1074;
      const x = (1 + r()) * 2 ** Math.min(1023, e);
      return r() < 0.5 ? -x : x;
    }),
  });
  out.push({
    $id: 'medium',
    xs: Array.from({ length: 400 }, () => (r() - 0.5) * 2e6),
  });
  out.push({
    $id: 'specials',
    xs: [
      0,
      -0,
      1e-300,
      5e-324,
      Math.PI,
      Math.PI / 2,
      (3 * Math.PI) / 4,
      -Math.PI / 4,
      0.7853981633974483,
      2.356194490192345,
      1e22,
      2 ** 1023,
      1.7976931348623157e308,
      Infinity,
      -Infinity,
      NaN,
    ],
  });
  return out.map(({ $id, xs }) => ({
    $id,
    xs: xs.map(bits),
    $out: xs.map((x) => bits(Math.sin(x))),
  }));
}

/** A sort's outcome: how many comparisons, a hash of which ones, and the order. */
function sortCases() {
  const out = [];
  for (const n of [
    0, 1, 2, 3, 5, 31, 32, 33, 63, 64, 65, 100, 127, 128, 200, 500, 1000, 3400,
    5200,
  ]) {
    for (const mode of ['random', 'ties', 'consistent']) {
      const rr = mulberry(n * 7 + mode.length);
      const arr = Array.from({ length: n }, (_, i) => ({
        id: i,
        k: mode === 'random' ? 0 : Math.floor(rr() * (n / 4 + 1)),
      }));
      const ans = mulberry(n + 1000);
      let calls = 0;
      let h = 0;
      arr.sort((a, b) => {
        calls += 1;
        h = (Math.imul(h, 31) + a.id * 100000 + b.id) | 0;
        if (mode === 'random') {
          const v = ans();
          return v < 0.45 ? -1 : v < 0.55 ? 0 : 1;
        }
        if (mode === 'ties') return a.k < b.k ? 1 : -1;
        return a.k < b.k ? -1 : a.k > b.k ? 1 : 0;
      });
      const order = arr.map((x) => x.id);
      out.push({
        id: `${mode}-${n}`,
        fn: 'sort',
        input: { n, mode },
        output: {
          calls,
          callHash: h,
          ...(n <= 200 ? { order } : { orderSha256: sha256(order) }),
        },
      });
    }
  }
  return out;
}

export default async function cases() {
  const asCase =
    (fn) =>
    ({ $id, $out, ...input }) => ({
      id: $id,
      fn,
      input,
      output: $out,
    });
  return [
    ...powCases().map(asCase('pow')),
    ...sinCases().map(asCase('sin')),
    ...sortCases(),
  ];
}
