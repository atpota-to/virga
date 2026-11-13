// The monthly allowance counters, against the in-memory Supabase fake: which
// table and column each allowance reads, how a count is written, and that
// every failure leaves the request going rather than failing it. The SQL
// behind reserve_ai_usage and release_ai_usage is tested on PGlite in
// ai.pglite.test.js.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../supabase.js';
import {
  currentMonthKey,
  getUsage,
  releaseUsage,
  reserveUsage,
} from './usage.js';

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

describe('reserveUsage', () => {
  const answering = (answer) => {
    fake = createFakeSupabase({ rpcAnswer: () => answer });
    setSupabaseClientForTests(fake);
  };

  it('takes a use through reserve_ai_usage with the allowance, the DID, the UTC month and the limit', async () => {
    answering({ data: [{ allowed: true, used: 3 }], error: null });
    expect(await reserveUsage('style', DID, { env: {}, now: NOW })).toEqual({
      allowed: true,
      used: 3,
      limit: 3,
      held: true,
      month: '2026-11',
    });
    expect(fake.rpcs).toEqual([
      {
        name: 'reserve_ai_usage',
        args: {
          p_allowance: 'style',
          p_did: DID,
          p_month: '2026-11',
          p_limit: 3,
        },
      },
    ]);
    expect(fake.ops).toHaveLength(0);
  });

  it('passes a refusal on with the count as it stands, holding nothing', async () => {
    answering({ data: [{ allowed: false, used: 15 }], error: null });
    expect(
      await reserveUsage('altText', DID, { env: {}, now: NOW }),
    ).toMatchObject({ allowed: false, used: 15, limit: 15, held: false });
  });

  it('refuses a limit of 0 without asking the store, so it holds while the store is down', async () => {
    setSupabaseClientForTests(null);
    expect(
      await reserveUsage('adviser', DID, {
        env: { AI_ADVISER_MONTHLY_LIMIT: '0' },
        now: NOW,
      }),
    ).toMatchObject({ allowed: false, used: 0, limit: 0, held: false });
  });

  it('takes nothing for an unlimited allowance', async () => {
    expect(
      await reserveUsage('adviser', DID, {
        env: { AI_ADVISER_MONTHLY_LIMIT: 'unlimited' },
      }),
    ).toMatchObject({ allowed: true, limit: null, held: false });
    expect(fake.rpcs).toHaveLength(0);
  });

  it('lets the request through, holding nothing, when the store fails', async () => {
    answering({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect(await reserveUsage('adviser', DID, { env: {} })).toMatchObject({
      allowed: true,
      used: 0,
      limit: 30,
      held: false,
    });
    expect(warn.mock.calls.flat().join(' ')).toContain(
      '[ai-usage] adviser reserve failed: boom',
    );
    answering({ data: [], error: null });
    expect((await reserveUsage('adviser', DID, { env: {} })).allowed).toBe(
      true,
    );
    setSupabaseClientForTests({
      rpc: async () => {
        throw new Error('socket closed');
      },
    });
    expect((await reserveUsage('altText', DID, { env: {} })).held).toBe(false);
    setSupabaseClientForTests(null);
    expect((await reserveUsage('altText', DID, { env: {} })).allowed).toBe(
      true,
    );
  });

  it('holds nothing with no DID', async () => {
    expect((await reserveUsage('altText', '', { env: {} })).held).toBe(false);
    expect(fake.rpcs).toHaveLength(0);
  });

  it('refuses an allowance it does not know', async () => {
    await expect(reserveUsage('reflection', DID, { env: {} })).rejects.toThrow(
      /Unknown AI allowance/,
    );
  });
});

describe('releaseUsage', () => {
  it('gives the use back for the month it was taken in', async () => {
    await releaseUsage('altText', DID, { env: {}, month: '2026-10' });
    expect(fake.rpcs).toEqual([
      {
        name: 'release_ai_usage',
        args: { p_allowance: 'altText', p_did: DID, p_month: '2026-10' },
      },
    ]);
  });

  it('never throws, and says so in the log when it fails', async () => {
    fake = createFakeSupabase({
      rpcAnswer: () => ({ data: null, error: { message: 'boom' } }),
    });
    setSupabaseClientForTests(fake);
    await expect(
      releaseUsage('adviser', DID, { env: {}, month: '2026-11' }),
    ).resolves.toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toContain(
      '[ai-usage] adviser release failed: boom',
    );
    setSupabaseClientForTests({
      rpc: async () => {
        throw new Error('socket closed');
      },
    });
    await expect(
      releaseUsage('adviser', DID, { env: {}, month: '2026-11' }),
    ).resolves.toBeUndefined();
  });

  it('writes nothing with no Supabase, no DID or no month', async () => {
    await releaseUsage('altText', '', { env: {}, month: '2026-11' });
    await releaseUsage('altText', DID, { env: {} });
    expect(fake.rpcs).toHaveLength(0);
    setSupabaseClientForTests(null);
    await releaseUsage('altText', DID, { env: {}, month: '2026-11' });
  });
});
