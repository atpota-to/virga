/*
 * How often each post template is used lives in the browser, so using one
 * never rewrites its record. The counts are the writer's own history, so a
 * sign-out keeps them; removing the account from the browser can take them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readTemplateUsage,
  recordTemplateUse,
  sortTemplatesForShelf,
  templateUsageKey,
} from './templateUsage.js';
import { templatesCacheKey } from './templateService.js';
import { localDataKeys } from '../../session/accounts.js';

const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';

function memoryStore() {
  const data = new Map();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
  };
}

const t = (rkey, name, group = '') => ({ rkey, name, group });

let store;

beforeEach(() => {
  store = memoryStore();
  vi.stubGlobal('localStorage', store);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readTemplateUsage and recordTemplateUse', () => {
  it('starts empty and counts each use with when it happened', () => {
    expect(readTemplateUsage(ALICE)).toEqual({});
    const first = new Date('2026-10-01T09:00:00.000Z');
    const second = new Date('2026-10-02T10:30:00.000Z');

    expect(recordTemplateUse('3la', ALICE, first)).toEqual({
      count: 1,
      lastUsedAt: first.toISOString(),
    });
    expect(recordTemplateUse('3la', ALICE, second)).toEqual({
      count: 2,
      lastUsedAt: second.toISOString(),
    });
    recordTemplateUse('3lb', ALICE, first);

    expect(readTemplateUsage(ALICE)).toEqual({
      '3la': { count: 2, lastUsedAt: second.toISOString() },
      '3lb': { count: 1, lastUsedAt: first.toISOString() },
    });
  });

  it('keeps each account’s counts under its own key', () => {
    recordTemplateUse('3la', ALICE);
    recordTemplateUse('3la', ALICE);
    recordTemplateUse('3la', BOB);
    expect(readTemplateUsage(ALICE)['3la'].count).toBe(2);
    expect(readTemplateUsage(BOB)['3la'].count).toBe(1);
    expect(templateUsageKey(ALICE)).toBe(`virga:template-usage:${ALICE}`);
    expect(store.getItem(templateUsageKey(ALICE))).not.toBeNull();
  });

  it('reads and writes nothing without an account or a template', () => {
    expect(recordTemplateUse('3la', null)).toBeNull();
    expect(recordTemplateUse('', ALICE)).toBeNull();
    expect(readTemplateUsage(null)).toEqual({});
    expect(store.data.size).toBe(0);
  });

  it('takes a store of its own when given one', () => {
    const other = memoryStore();
    recordTemplateUse('3la', ALICE, new Date(), { store: other });
    expect(readTemplateUsage(ALICE, { store: other })['3la'].count).toBe(1);
    expect(readTemplateUsage(ALICE)).toEqual({});
  });

  it('stamps now when given a date that isn’t one', () => {
    const entry = recordTemplateUse('3la', ALICE, new Date('not a date'));
    expect(Number.isNaN(Date.parse(entry.lastUsedAt))).toBe(false);
  });

  it('reads past a corrupt or odd store', () => {
    store.setItem(templateUsageKey(ALICE), '{broken');
    expect(readTemplateUsage(ALICE)).toEqual({});
    expect(recordTemplateUse('3la', ALICE).count).toBe(1);

    store.setItem(
      templateUsageKey(ALICE),
      JSON.stringify({
        '3la': { count: 3.7, lastUsedAt: 'yesterday-ish' },
        '3lb': { count: -2 },
        '3lc': 'five',
        '3ld': { count: 2, lastUsedAt: '2026-10-01T00:00:00.000Z' },
      }),
    );
    expect(readTemplateUsage(ALICE)).toEqual({
      '3la': { count: 3, lastUsedAt: null },
      '3ld': { count: 2, lastUsedAt: '2026-10-01T00:00:00.000Z' },
    });
  });

  it('drops the least recently used past five hundred entries', () => {
    const many = {};
    for (let i = 0; i < 500; i++) {
      many[`old${i}`] = {
        count: 1,
        lastUsedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      };
    }
    store.setItem(templateUsageKey(ALICE), JSON.stringify(many));
    recordTemplateUse('fresh', ALICE, new Date('2026-10-14T00:00:00.000Z'));
    const usage = readTemplateUsage(ALICE);
    expect(Object.keys(usage)).toHaveLength(500);
    expect(usage.fresh.count).toBe(1);
    expect(usage.old0).toBeUndefined();
    expect(usage.old499).toBeDefined();
  });
});

describe('sortTemplatesForShelf', () => {
  it('groups by name with ungrouped last, most used first within a group, then by name', () => {
    const templates = [
      t('u1', 'zebra'),
      t('u2', 'Apple'),
      t('s1', 'Beta', 'Support'),
      t('s2', 'alpha', 'Support'),
      t('s3', 'Gamma', 'Support'),
      t('f1', 'Notes', 'Field notes'),
    ];
    const usage = { s3: { count: 4 }, s1: { count: 4 }, u1: { count: 1 } };
    expect(sortTemplatesForShelf(templates, usage).map((x) => x.rkey)).toEqual([
      'f1',
      's1',
      's3',
      's2',
      'u1',
      'u2',
    ]);
  });

  it('keeps groups that differ only in case next to each other, and apart', () => {
    const sorted = sortTemplatesForShelf(
      [t('a', 'One', 'help'), t('b', 'Two', 'Help'), t('c', 'Three', 'help')],
      {},
    );
    expect(sorted.map((x) => x.group)).toEqual(['Help', 'help', 'help']);
  });

  it('returns a new array and copes with no usage at all', () => {
    const templates = [t('b', 'B'), t('a', 'A')];
    const sorted = sortTemplatesForShelf(templates, undefined);
    expect(sorted.map((x) => x.rkey)).toEqual(['a', 'b']);
    expect(templates.map((x) => x.rkey)).toEqual(['b', 'a']);
    expect(sortTemplatesForShelf(null, {})).toEqual([]);
  });
});

describe('removing an account from this browser', () => {
  it('finds the counts and the templates cache among the account’s data', () => {
    const keys = localDataKeys(store, ALICE);
    expect(keys).toContain(templateUsageKey(ALICE));
    expect(keys).toContain(templatesCacheKey(ALICE));
    expect(keys).not.toContain(templateUsageKey(BOB));
  });
});
