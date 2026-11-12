import { describe, expect, it } from 'vitest';
import {
  FREE_MONTHLY_LIMITS,
  adviserUsageKey,
  adviserUsageLine,
  adviserUsesLeft,
  clearAdviserUsage,
  currentMonthKey,
  isAdviserAtLimit,
  markAdviserLimitReached,
  readAdviserUsage,
  recordAdviserUsage,
  usageResetsAt,
} from './usage.js';

const DID = 'did:plc:writer';
const NOW = new Date('2026-11-12T10:00:00Z');

function memoryStore() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe('months', () => {
  it('counts in UTC months, as cocoon does', () => {
    expect(currentMonthKey(NOW)).toBe('2026-11');
    // Late on the last evening in New York is already December in UTC.
    expect(currentMonthKey(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12');
  });

  it('starts again on the first of next month', () => {
    expect(usageResetsAt(NOW).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(usageResetsAt(new Date('2026-12-20T00:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('recording and reading', () => {
  it('stores adviser reads as { month, used, limit } under the account', () => {
    const store = memoryStore();
    recordAdviserUsage(DID, { used: 4, limit: 30 }, { now: NOW, store });
    expect(JSON.parse(store.getItem(adviserUsageKey(DID)))).toEqual({
      month: '2026-11',
      used: 4,
      limit: 30,
    });
    expect(adviserUsageKey(DID)).toBe('virga:adviser-usage:did:plc:writer');
    expect(readAdviserUsage(DID, { now: NOW, store })).toEqual({
      month: '2026-11',
      used: 4,
      limit: 30,
    });
  });

  it('keeps the other allowances beside it without disturbing it', () => {
    const store = memoryStore();
    recordAdviserUsage(DID, { used: 4, limit: 30 }, { now: NOW, store });
    recordAdviserUsage(
      DID,
      { used: 2, limit: 15 },
      { feature: 'altText', now: NOW, store },
    );
    recordAdviserUsage(
      DID,
      { used: 1, limit: 3 },
      { feature: 'style', now: NOW, store },
    );
    const stored = JSON.parse(store.getItem(adviserUsageKey(DID)));
    expect(stored).toMatchObject({ month: '2026-11', used: 4, limit: 30 });
    expect(stored.altText).toEqual({ month: '2026-11', used: 2, limit: 15 });
    expect(
      readAdviserUsage(DID, { feature: 'style', now: NOW, store }).used,
    ).toBe(1);
  });

  it('forgets last month’s count', () => {
    const store = memoryStore();
    recordAdviserUsage(
      DID,
      { used: 30, limit: 30 },
      { now: new Date('2026-10-31T23:00:00Z'), store },
    );
    expect(readAdviserUsage(DID, { now: NOW, store })).toBeNull();
    expect(isAdviserAtLimit(DID, { now: NOW, store })).toBe(false);
  });

  it('records nothing from an answer without usage (an unlimited account)', () => {
    const store = memoryStore();
    expect(recordAdviserUsage(DID, undefined, { now: NOW, store })).toBeNull();
    expect(
      recordAdviserUsage(DID, { used: 'x', limit: 30 }, { now: NOW, store }),
    ).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it('clears one allowance and leaves the others', () => {
    const store = memoryStore();
    markAdviserLimitReached(DID, 30, { now: NOW, store });
    recordAdviserUsage(
      DID,
      { used: 2, limit: 15 },
      { feature: 'altText', now: NOW, store },
    );
    clearAdviserUsage(DID, { store });
    expect(isAdviserAtLimit(DID, { now: NOW, store })).toBe(false);
    expect(readAdviserUsage(DID, { now: NOW, store })).toBeNull();
    expect(
      readAdviserUsage(DID, { feature: 'altText', now: NOW, store }),
    ).toMatchObject({ used: 2, limit: 15 });
    clearAdviserUsage(DID, { feature: 'altText', store });
    expect(store.map.size).toBe(0);
  });

  it('keeps accounts apart', () => {
    const store = memoryStore();
    recordAdviserUsage(DID, { used: 30, limit: 30 }, { now: NOW, store });
    expect(isAdviserAtLimit('did:plc:other', { now: NOW, store })).toBe(false);
  });

  it('survives unreadable storage', () => {
    const store = memoryStore();
    store.setItem(adviserUsageKey(DID), '{not json');
    expect(readAdviserUsage(DID, { now: NOW, store })).toBeNull();
    expect(readAdviserUsage(DID, { now: NOW, store: null })).toBeNull();
  });

  it('refuses an allowance it doesn’t know', () => {
    expect(() =>
      readAdviserUsage(DID, { feature: 'harvest', store: memoryStore() }),
    ).toThrow(TypeError);
  });
});

describe('the limit', () => {
  it('is reached when cocoon says so', () => {
    const store = memoryStore();
    markAdviserLimitReached(DID, 30, { now: NOW, store });
    expect(isAdviserAtLimit(DID, { now: NOW, store })).toBe(true);
    expect(adviserUsesLeft(DID, { now: NOW, store })).toBe(0);
  });

  it('falls back to the last limit seen, then the free one', () => {
    const store = memoryStore();
    recordAdviserUsage(DID, { used: 3, limit: 50 }, { now: NOW, store });
    expect(
      markAdviserLimitReached(DID, undefined, { now: NOW, store }),
    ).toEqual({
      month: '2026-11',
      used: 50,
      limit: 50,
    });
    const fresh = memoryStore();
    expect(
      markAdviserLimitReached(DID, null, {
        feature: 'altText',
        now: NOW,
        store: fresh,
      }).limit,
    ).toBe(FREE_MONTHLY_LIMITS.altText);
  });

  it('counts what is left', () => {
    const store = memoryStore();
    recordAdviserUsage(DID, { used: 12, limit: 30 }, { now: NOW, store });
    expect(adviserUsesLeft(DID, { now: NOW, store })).toBe(18);
    expect(adviserUsesLeft('did:plc:none', { now: NOW, store })).toBeNull();
  });
});

describe('adviserUsageLine', () => {
  it('says what is left and that it is shared', () => {
    expect(adviserUsageLine({ used: 12, limit: 30 }, { now: NOW })).toBe(
      '18 of 30 free checks left this month. Shared with Anisota.',
    );
    expect(
      adviserUsageLine(
        { used: 1, limit: 15 },
        { feature: 'altText', now: NOW },
      ),
    ).toBe('14 of 15 free descriptions left this month. Shared with Anisota.');
  });

  it('says when they start again once used up', () => {
    expect(
      adviserUsageLine({ used: 3, limit: 3 }, { feature: 'style', now: NOW }),
    ).toBe(
      'No free style readings left this month. They start again on December 1.',
    );
  });

  it('says nothing when nothing is known', () => {
    expect(adviserUsageLine(null)).toBe('');
    expect(adviserUsageLine({ used: 1 })).toBe('');
  });
});
