import { describe, it, expect, vi } from 'vitest';
import { TtlCache } from './ttlCache.js';

// TtlCache backs the per-instance auth caches and burst limiters. It is
// best-effort (callers tolerate a miss), so the contract to lock is: hits
// within the TTL, expiry after it, the crude max-size bound, and the predicate
// delete.

describe('TtlCache', () => {
  it('returns set values within the TTL and undefined for misses', () => {
    const c = new TtlCache({ ttlMs: 1000 });
    expect(c.get('missing')).toBeUndefined();
    c.set('a', 42);
    expect(c.get('a')).toBe(42);
  });

  it('expires entries once the TTL has elapsed', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));
      const c = new TtlCache({ ttlMs: 1000 });
      c.set('a', 'v');
      vi.advanceTimersByTime(999);
      expect(c.get('a')).toBe('v');
      vi.advanceTimersByTime(1); // exactly at the TTL counts as expired
      expect(c.get('a')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports delete and clear', () => {
    const c = new TtlCache({ ttlMs: 1000 });
    c.set('a', 1);
    c.set('b', 2);
    c.delete('a');
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    c.clear();
    expect(c.get('b')).toBeUndefined();
  });

  it('deleteWhere removes only matching entries', () => {
    const c = new TtlCache({ ttlMs: 1000 });
    c.set('keep', { did: 'did:plc:a' });
    c.set('drop', { did: 'did:plc:b' });
    c.deleteWhere((k, v) => v.did === 'did:plc:b');
    expect(c.get('keep')).toEqual({ did: 'did:plc:a' });
    expect(c.get('drop')).toBeUndefined();
  });

  it('drops everything when the max size is reached (crude bound)', () => {
    const c = new TtlCache({ ttlMs: 1000, max: 2 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });
});
