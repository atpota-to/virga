// Batches and how many run at once. Swift: VirgaDefense/Limit.swift. The
// pure half (chunks, the constant); mapLimit and pause, which run work and
// wait, are held to limit.js by behaviour tests (LimitTests.swift).

import { APPVIEW_CONCURRENCY, chunks } from '../../../src/defense/limit.js';
import { each, value } from './_helpers.js';

export const sources = ['src/defense/limit.js'];

const range = (n) => Array.from({ length: n }, (_, i) => i);

export default async function cases() {
  return [
    value('constants', { APPVIEW_CONCURRENCY }),
    ...(await each(
      'chunks',
      [
        { items: [], size: 25 },
        { items: range(1), size: 25 },
        { items: range(24), size: 24 },
        { items: range(25), size: 24 },
        { items: range(60), size: 24 },
        { items: range(60), size: 25 },
        { items: range(61), size: 30 },
        { items: range(7), size: 1 },
        { items: range(7), size: 100 },
        { items: ['a', 'b', 'c', 'd', 'e'], size: 2 },
      ],
      ({ items, size }) => chunks(items, size),
    )),
  ];
}
