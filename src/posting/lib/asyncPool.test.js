import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './asyncPool.js';

// mapWithConcurrency (e.g. the composer's image uploads) must return results
// in INPUT order and run no more than `limit` at once.

const deferBy = (ms, value) =>
  new Promise((resolve) => {
    globalThis.setTimeout(() => resolve(value), ms);
  });

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    // Earlier items resolve LATER, so a naive push-as-they-finish would reorder.
    const out = await mapWithConcurrency([40, 10, 30, 5], 2, (ms, i) =>
      deferBy(ms, `#${i}`),
    );
    expect(out).toEqual(['#0', '#1', '#2', '#3']);
  });

  it('maps values with their index', async () => {
    const out = await mapWithConcurrency(
      ['a', 'b', 'c'],
      2,
      (v, i) => `${i}:${v}`,
    );
    expect(out).toEqual(['0:a', '1:b', '2:c']);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const task = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await deferBy(5);
      inFlight--;
    };
    await mapWithConcurrency(Array.from({ length: 10 }), 3, task);
    expect(peak).toBe(3);
  });

  it('processes every item even when there are more items than the limit', async () => {
    const seen = [];
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 2, (v) => {
      seen.push(v);
      return v;
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('returns an empty array for no items (and never calls fn)', async () => {
    let calls = 0;
    const out = await mapWithConcurrency([], 4, () => {
      calls++;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it('coerces a bad limit to at least 1 instead of stalling', async () => {
    const out = await mapWithConcurrency([1, 2, 3], 0, (v) => v * 2);
    expect(out).toEqual([2, 4, 6]);
  });

  it('rejects on the first fn rejection (Promise.all semantics)', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (v) => {
        if (v === 2) throw new Error('boom');
        return v;
      }),
    ).rejects.toThrow('boom');
  });
});
