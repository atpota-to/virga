// `Array.prototype.sort` with a numeric comparator, as V8 runs it, for
// VirgaNetwork's JSSort: flattenSources (src/lib/constellation.js) sorts
// with `b.count - a.count` over counts Constellation may send as anything,
// and a comparator that meets NaN (read as 0) is inconsistent, so the order
// depends on V8's algorithm, not just on stability. Each case sorts
// `{ key, i }` rows by `Number(b.key) - Number(a.key)` and records the
// order of `i`.

import { each } from './_helpers.js';

export const sources = ['src/lib/constellation.js'];

/** A deterministic sequence of keys, some of them not numbers. */
function keys(seed, n, nanEvery) {
  const out = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out.push(nanEvery && i % nanEvery === nanEvery - 1 ? 'x' : x % 7);
  }
  return out;
}

export default async function cases() {
  const inputs = [
    { keys: [] },
    { keys: [1] },
    { keys: [1, 'x', 3, 2] },
    { keys: [5, 4, 3, 1, 2] },
    { keys: [1, 2, 3, 4, 5] },
    { keys: [3, 3, 3, 1, 1] },
    { keys: ['x', 'x', 1, 2] },
    { keys: [2, 1, 'x', 3, 'y', 0] },
    { keys: [null, true, '5', [2], [1, 2], {}] },
  ];
  for (const [seed, n, nanEvery] of [
    [1, 10, 0],
    [2, 10, 3],
    [3, 31, 4],
    [4, 32, 5],
    [5, 63, 0],
    [6, 63, 6],
    [7, 64, 0],
    [8, 100, 0],
    [9, 200, 0],
  ]) {
    inputs.push({ keys: keys(seed, n, nanEvery) });
  }
  return each('sort', inputs, ({ keys: k }) =>
    k
      .map((key, i) => ({ key, i }))
      .sort((a, b) => Number(b.key) - Number(a.key))
      .map((row) => row.i),
  );
}
