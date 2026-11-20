// src/posting/lib/asyncPool.js: mapWithConcurrency's results, its pool size
// and its failure. Swift: VirgaNetwork/Posting/Lib/AsyncPool.swift.
//
// `fn` here is `(item, index) => \`${index}:${item}\`` after a tick, or a
// failure for items named "fail…". The pool runs every worker to its first
// await before any finishes, so `peak` is the pool size, which the Swift
// test checks against its own count.

import { mapWithConcurrency } from '../../../src/posting/lib/asyncPool.js';
import { each } from './_helpers.js';

export const sources = ['src/posting/lib/asyncPool.js'];

export default async function cases() {
  return each(
    'mapWithConcurrency',
    [
      { items: ['a', 'b', 'c', 'd'], limit: 2 },
      { items: ['a', 'b', 'c'], limit: 10 },
      { items: ['a', 'b', 'c'], limit: 0 },
      { items: ['a', 'b', 'c'], limit: -3 },
      { items: ['a', 'b', 'c'], limit: 2.9 },
      { items: ['a', 'b', 'c'], limit: 0.5 },
      { items: ['a', 'b', 'c'], limit: null },
      { items: ['a', 'b', 'c'], limit: 'x' },
      { items: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], limit: 3 },
      { items: [], limit: 4 },
      { items: ['a', 'fail-b', 'c', 'fail-d', 'e'], limit: 2 },
      { items: ['fail-a'], limit: 1 },
    ],
    async ({ items, limit }) => {
      let inFlight = 0;
      let peak = 0;
      const called = [];
      try {
        const results = await mapWithConcurrency(
          items,
          limit,
          async (item, index) => {
            called.push(index);
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await Promise.resolve();
            inFlight -= 1;
            if (item.startsWith('fail')) throw new Error(`boom ${item}`);
            return `${index}:${item}`;
          },
        );
        return { results, peak, called: called.sort((x, y) => x - y) };
      } catch (error) {
        // Settle the workers still running before reporting what they called.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { error: error.message, called: called.sort((x, y) => x - y) };
      }
    },
  );
}
