import { describe, it, expect } from 'vitest';
import { createTidClock, isTid, nextTid, tidTimestamp } from './tid.js';
import { tidToTimestamp } from '../../lib/atproto.js';

describe('createTidClock', () => {
  it('mints 13-character TIDs that encode the time given', () => {
    const nextTid = createTidClock();
    const ms = Date.UTC(2026, 10, 12, 15, 0, 0);
    const tid = nextTid(ms);
    expect(tid).toHaveLength(13);
    expect(isTid(tid)).toBe(true);
    expect(tidTimestamp(tid)).toBe(ms);
    // The archive's own decoder reads it the same way.
    expect(tidToTimestamp(tid)).toBe(new Date(ms).toISOString());
  });

  it('always increases, even for the same or an earlier time', () => {
    const nextTid = createTidClock();
    const ms = Date.UTC(2030, 0, 1);
    const keys = [nextTid(ms), nextTid(ms), nextTid(ms - 5000), nextTid(ms)];
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sorts in time order across milliseconds', () => {
    const nextTid = createTidClock();
    const later = Date.UTC(2031, 0, 1);
    const a = nextTid(later);
    const b = nextTid(later + 1000);
    expect(a < b).toBe(true);
  });

  it('the shared clock defaults to now', () => {
    const before = Date.now();
    const tid = nextTid();
    // Never earlier than now: the clock only moves forward.
    expect(tidTimestamp(tid)).toBeGreaterThanOrEqual(before - 1);
  });
});

describe('isTid and tidTimestamp', () => {
  it('refuse keys that are not TIDs', () => {
    for (const key of [
      'self',
      '3abc',
      'zzzzzzzzzzzzz',
      'ABCDEFGHIJKLM',
      null,
      42,
    ]) {
      expect(isTid(key)).toBe(false);
      expect(tidTimestamp(key)).toBeNull();
    }
  });

  it('read a real Bluesky post key', () => {
    // 3mqcp425edfgx: a post from 2026-07-10 (recordCid.test.js's first vector).
    expect(isTid('3mqcp425edfgx')).toBe(true);
    expect(new Date(tidTimestamp('3mqcp425edfgx')).getUTCFullYear()).toBe(2026);
  });
});
