// The monthly allowance counters, against the in-memory Supabase fake: which
// table and column each allowance reads, how a count is written, and that
// every failure leaves the request going (tracked: false) rather than failing
// it. The SQL behind bump_ai_usage is tested on PGlite in ai.pglite.test.js.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../supabase.js';
import { currentMonthKey, getUsage, incrementUsage } from './usage.js';

const DID = 'did:plc:usagefixture';
const NOW = new Date('2026-11-13T12:00:00Z');

let fake;
let warn;

beforeEach(() => {
  fake = createFakeSupabase({ rpcAnswer: () => ({ data: 1, error: null }) });
  setSupabaseClientForTests(fake);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  resetSupabaseClientForTests();
  vi.restoreAllMocks();
});

describe('currentMonthKey', () => {
  it('is the UTC month, whatever the local time', () => {
    expect(currentMonthKey(new Date('2026-11-30T23:59:59Z'))).toBe('2026-11');
    expect(currentMonthKey(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12');
    expect(currentMonthKey(new Date('2027-01-01T00:30:00+01:00'))).toBe(
      '2026-12',
    );
  });
});

describe('getUsage', () => {
  it('reads the adviser count for this month', async () => {
    fake
      .rowsOf('posting_adviser_usage')
      .push(
        { did: DID, month: '2026-11', count: 12, style_count: 2 },
        { did: DID, month: '2026-10', count: 29, style_count: 3 },
      );
    expect(await getUsage('adviser', DID, { env: {}, now: NOW })).toEqual({
      used: 12,
      limit: 30,
      tracked: true,
    });
    expect(await getUsage('style', DID, { env: {}, now: NOW })).toEqual({
      used: 2,
      limit: 3,
      tracked: true,
    });
    const [read] = fake.ops;
    expect(read.table).toBe('posting_adviser_usage');
  });

  it('reads image descriptions from their own table', async () => {
    fake
      .rowsOf('alt_text_usage')
      .push({ did: DID, month: '2026-11', count: 4 });
    expect(await getUsage('altText', DID, { env: {}, now: NOW })).toEqual({
      used: 4,
      limit: 15,
      tracked: true,
    });
    expect(fake.ops.map((o) => o.table)).toEqual(['alt_text_usage']);
  });

  it('reads no row as none used', async () => {
    expect(await getUsage('adviser', DID, { env: {}, now: NOW })).toEqual({
      used: 0,
      limit: 30,
      tracked: true,
    });
  });

  it('takes the limit from the environment, null for unlimited', async () => {
    expect(
      (
        await getUsage('adviser', DID, {
          env: { AI_ADVISER_MONTHLY_LIMIT: '5' },
          now: NOW,
        })
      ).limit,
    ).toBe(5);
    expect(
      (
        await getUsage('adviser', DID, {
          env: { AI_ADVISER_MONTHLY_LIMIT: 'unlimited' },
          now: NOW,
        })
      ).limit,
    ).toBeNull();
  });

  it('is untracked with no Supabase, without a read', async () => {
    setSupabaseClientForTests(null);
    expect(await getUsage('adviser', DID, { env: {} })).toEqual({
      used: 0,
      limit: 30,
      tracked: false,
    });
  });

  it('is untracked with no DID', async () => {
    expect(await getUsage('altText', '', { env: {} })).toEqual({
      used: 0,
      limit: 15,
      tracked: false,
    });
    expect(fake.ops).toHaveLength(0);
  });

  it('is untracked when the read fails, and says so in the log', async () => {
    fake.failNext('posting_adviser_usage', 'select', {
      code: 'XX000',
      message: 'boom',
    });
    expect(await getUsage('adviser', DID, { env: {}, now: NOW })).toEqual({
      used: 0,
      limit: 30,
      tracked: false,
    });
    expect(warn.mock.calls.flat().join(' ')).toContain(
      '[ai-usage] adviser read failed: boom',
    );
  });

  it('is untracked when the client throws', async () => {
    setSupabaseClientForTests({
      from() {
        throw new Error('socket closed');
      },
    });
    expect(await getUsage('style', DID, { env: {} })).toEqual({
      used: 0,
      limit: 3,
      tracked: false,
    });
  });
});

describe('incrementUsage', () => {
  it('counts through bump_ai_usage with the allowance, the DID and the UTC month', async () => {
    fake = createFakeSupabase({ rpcAnswer: () => ({ data: 7, error: null }) });
    setSupabaseClientForTests(fake);
    expect(
      await incrementUsage('style', DID, { env: {}, now: NOW, usedBefore: 6 }),
    ).toBe(7);
    expect(fake.rpcs).toEqual([
      {
        name: 'bump_ai_usage',
        args: { p_allowance: 'style', p_did: DID, p_month: '2026-11' },
      },
    ]);
    expect(fake.ops).toHaveLength(0);
  });

  it('answers the count it meant to write when the write fails', async () => {
    fake = createFakeSupabase({
      rpcAnswer: () => ({
        data: null,
        error: { code: 'XX000', message: 'boom' },
      }),
    });
    setSupabaseClientForTests(fake);
    expect(
      await incrementUsage('adviser', DID, { env: {}, usedBefore: 3 }),
    ).toBe(4);
    expect(await incrementUsage('adviser', DID, { env: {} })).toBe(0);
    expect(warn.mock.calls.flat().join(' ')).toContain(
      '[ai-usage] adviser increment failed: boom',
    );
  });

  it('never throws', async () => {
    setSupabaseClientForTests({
      rpc: async () => {
        throw new Error('socket closed');
      },
    });
    expect(
      await incrementUsage('altText', DID, { env: {}, usedBefore: 1 }),
    ).toBe(2);
  });

  it('writes nothing with no Supabase or no DID', async () => {
    expect(await incrementUsage('altText', '', { env: {} })).toBe(0);
    expect(fake.rpcs).toHaveLength(0);
    setSupabaseClientForTests(null);
    expect(await incrementUsage('altText', DID, { env: {} })).toBe(0);
  });

  it('refuses an allowance it does not know', async () => {
    await expect(
      incrementUsage('reflection', DID, { env: {} }),
    ).rejects.toThrow(/Unknown AI allowance/);
  });
});
