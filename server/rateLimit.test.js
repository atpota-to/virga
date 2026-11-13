import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRateLimiter } from './rateLimit.js';

// Fixed-window counting with an injected clock, per-key isolation, the
// retryAfter arithmetic, and failing open.

function makeStore() {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), _map: m };
}

afterEach(() => vi.restoreAllMocks());

describe('createRateLimiter', () => {
  it('allows up to the limit, then denies within the same window', () => {
    const t = 1_000_000;
    const rl = createRateLimiter({ store: makeStore(), now: () => t, limit: 3, windowMs: 60000 });
    expect(rl.check('did:plc:a')).toEqual({ allowed: true, retryAfterSec: 0, count: 1, limit: 3 });
    expect(rl.check('did:plc:a').allowed).toBe(true);
    expect(rl.check('did:plc:a').allowed).toBe(true);
    const denied = rl.check('did:plc:a');
    expect(denied).toMatchObject({ allowed: false, count: 4, limit: 3 });
    expect(denied.retryAfterSec).toBeGreaterThan(0);
  });

  it('tracks keys independently', () => {
    const rl = createRateLimiter({ store: makeStore(), now: () => 0, limit: 1, windowMs: 1000 });
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('a').allowed).toBe(false);
    expect(rl.check('b').allowed).toBe(true);
  });

  it('resets after the window elapses', () => {
    let t = 0;
    const rl = createRateLimiter({ store: makeStore(), now: () => t, limit: 1, windowMs: 1000 });
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('a').allowed).toBe(false);
    t += 1000;
    expect(rl.check('a').allowed).toBe(true);
  });

  it('computes retryAfterSec from the time left in the window', () => {
    let t = 0;
    const rl = createRateLimiter({ store: makeStore(), now: () => t, limit: 1, windowMs: 60000 });
    rl.check('a');
    t = 5000;
    expect(rl.check('a').retryAfterSec).toBe(55);
    t = 59_900;
    expect(rl.check('a').retryAfterSec).toBe(1);
  });

  it('fails open when the store throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = { get: () => { throw new Error('store down'); }, set: () => {} };
    const rl = createRateLimiter({ store, limit: 1 });
    expect(rl.check('a')).toMatchObject({ allowed: true, retryAfterSec: 0, degraded: true });
  });

  it('works with its default in-memory store and clock', () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 60000 });
    expect(rl.check('k').allowed).toBe(true);
    expect(rl.check('k').allowed).toBe(true);
    expect(rl.check('k').allowed).toBe(false);
  });
});
