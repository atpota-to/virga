// Run async work over a list with at most `limit` in flight at once.
//
// The AppView's batch reads (25 profiles, 30 relationships a call) made one
// after another would make scoring a 2,000-account scan wait on 150 round
// trips in a row. A handful in flight cuts that by several times while staying
// well under what one browser or one account should ask of the AppView.
//
// From bluesky-mod (src/lib/limit.js).

/** How many AppView batch reads may be in flight at once. */
export const APPVIEW_CONCURRENCY = 6;

/**
 * `fn` over every item, at most `limit` at a time, results in input order.
 * The first rejection rejects the whole call, as Promise.all does, and no
 * further items are started after it. Nor after `signal` fires: an item is
 * never started once the caller has given up.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, limit, fn, { signal } = {}) {
  const out = new Array(items.length);
  let next = 0;
  let failed = false;
  const lanes = Math.max(1, Math.min(limit, items.length));
  async function lane() {
    while (!failed && next < items.length) {
      signal?.throwIfAborted();
      const i = next;
      next += 1;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }
  await Promise.all(Array.from({ length: lanes }, lane));
  return out;
}

/** `items` cut into consecutive slices of `size`. */
export function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Resolves after `ms`, or at once when `signal` fires. */
export function pause(ms, signal) {
  return new Promise((resolve) => {
    if (!ms || signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      signal?.removeEventListener('abort', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
