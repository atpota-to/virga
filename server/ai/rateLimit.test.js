// The AI rate limit: a per-instance burst window and a daily ceiling kept in
// Supabase. Both fail open; the daily answer comes from consume_ai_daily,
// whose SQL is tested on PGlite in ai.pglite.test.js.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../supabase.js';
import { dayKey, enforce, resetBurstForTests } from './rateLimit.js';

const DID = 'did:plc:ratefixture';

let fake;
let daily;

beforeEach(() => {
  daily = vi.fn(() => ({ data: [{ allowed: true, used: 1 }], error: null }));
  fake = createFakeSupabase({ rpcAnswer: (name, args) => daily(name, args) });
  setSupabaseClientForTests(fake);
  resetBurstForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  resetSupabaseClientForTests();
  resetBurstForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('dayKey', () => {
  it('is the UTC day', () => {
    expect(dayKey(new Date('2026-11-13T23:59:59Z'))).toBe('2026-11-13');
    expect(dayKey(new Date('2026-11-14T00:30:00+01:00'))).toBe('2026-11-13');
    expect(dayKey(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01-01');
  });
});

describe('enforce', () => {
  it('lets a call with no DID through without counting it', async () => {
    expect(await enforce('', { env: {} })).toEqual({ allowed: true });
    expect(fake.rpcs).toHaveLength(0);
  });

  it('takes a daily slot through consume_ai_daily with the day and the limit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T08:00:00Z'));
    expect(await enforce(DID, { env: { AI_DAILY_LIMIT: '50' } })).toEqual({
      allowed: true,
    });
    expect(fake.rpcs).toEqual([
      {
        name: 'consume_ai_daily',
        args: { p_did: DID, p_day: '2026-11-13', p_limit: 50 },
      },
    ]);
  });

  it('refuses once the day is used up, with the limit', async () => {
    daily.mockReturnValue({
      data: [{ allowed: false, used: 200 }],
      error: null,
    });
    expect(await enforce(DID, { env: {} })).toEqual({
      allowed: false,
      status: 429,
      body: { error: 'rate_limited', scope: 'daily', limit: 200 },
    });
  });

  it('reads a single-row answer as well as a set', async () => {
    daily.mockReturnValue({ data: { allowed: false, used: 3 }, error: null });
    expect((await enforce(DID, { env: { AI_DAILY_LIMIT: '3' } })).body).toEqual(
      { error: 'rate_limited', scope: 'daily', limit: 3 },
    );
  });

  it('allows the burst, then refuses with how long to wait, then resets after a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T08:00:00Z'));
    const env = { AI_BURST_PER_MIN: '3' };
    for (let i = 0; i < 3; i++)
      expect((await enforce(DID, { env })).allowed).toBe(true);

    vi.setSystemTime(new Date('2026-11-13T08:00:20Z'));
    const refused = await enforce(DID, { env });
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({
      error: 'rate_limited',
      scope: 'burst',
      retryAfterSec: 40,
    });
    // A burst refusal spends no daily slot.
    expect(fake.rpcs).toHaveLength(3);

    vi.setSystemTime(new Date('2026-11-13T08:00:59.500Z'));
    const late = await enforce(DID, { env });
    expect(late.body.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(late.body.retryAfterSec).toBeLessThanOrEqual(60);

    vi.setSystemTime(new Date('2026-11-13T08:01:00Z'));
    expect((await enforce(DID, { env })).allowed).toBe(true);
  });

  it('keeps each account’s burst its own, at the default of 40', async () => {
    for (let i = 0; i < 40; i++)
      expect((await enforce(DID, { env: {} })).allowed).toBe(true);
    expect((await enforce(DID, { env: {} })).body?.scope).toBe('burst');
    expect((await enforce('did:plc:someoneelse', { env: {} })).allowed).toBe(
      true,
    );
  });

  it('fails open when the daily count errors, gives no answer, or the client throws', async () => {
    daily.mockReturnValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });
    expect(await enforce(DID, { env: {} })).toEqual({ allowed: true });
    daily.mockReturnValue({ data: [], error: null });
    expect(await enforce(DID, { env: {} })).toEqual({ allowed: true });
    setSupabaseClientForTests({
      rpc: async () => {
        throw new Error('socket closed');
      },
    });
    expect(await enforce(DID, { env: {} })).toEqual({ allowed: true });
  });

  it('fails open with no Supabase', async () => {
    setSupabaseClientForTests(null);
    expect(await enforce(DID, { env: {} })).toEqual({ allowed: true });
  });
});
