/**
 * Minimal per-instance TTL cache.
 *
 * Scope is a single serverless instance: entries are best-effort and bounded by
 * a short TTL, so they speed up warm instances and request bursts without a
 * shared store. This is NOT a correctness layer: every caller must tolerate a
 * miss (which just means doing the original work) and a brief cross-instance
 * staleness window (bounded by ttlMs).
 */
export class TtlCache {
  constructor({ ttlMs, max = 5000 } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.map = new Map(); // key -> { value, at }
  }

  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key, value) {
    // Crude bound: at the cap, drop everything. Entries are cheap to
    // recompute, so this keeps memory flat without the overhead of an LRU.
    if (this.map.size >= this.max) this.map.clear();
    this.map.set(key, { value, at: Date.now() });
  }

  delete(key) {
    this.map.delete(key);
  }

  /** Delete every entry whose (key, value) matches the predicate. */
  deleteWhere(pred) {
    for (const [k, e] of this.map) {
      if (pred(k, e.value)) this.map.delete(k);
    }
  }

  clear() {
    this.map.clear();
  }
}
