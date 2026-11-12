/**
 * Run `fn` over `items` with at most `limit` calls in flight, returning results
 * in input order. Like Promise.all, rejects on the first rejection; running
 * tasks are not cancelled (thread an AbortSignal into `fn` for that). `limit` is
 * coerced to a positive integer (falsy/NaN/<1 → 1). Bounded so e.g. a 10-image
 * upload doesn't hit the backend proxy with 10 simultaneous requests.
 *
 * @template T, R
 * @param {ArrayLike<T>|Iterable<T>} items
 * @param {number} limit          max concurrent `fn` calls
 * @param {(item: T, index: number) => Promise<R>|R} fn
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.isArray(items) ? items : Array.from(items ?? []);
  const results = new Array(list.length);
  if (list.length === 0) return results;

  const poolSize = Math.max(1, Math.min(Math.floor(limit) || 1, list.length));
  let cursor = 0;
  const worker = async () => {
    // Writing to results[index] (not push) preserves input order.
    while (cursor < list.length) {
      const index = cursor++;
      results[index] = await fn(list[index], index);
    }
  };

  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}
