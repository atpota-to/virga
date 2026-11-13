// The AI counters on a real Postgres (PGlite) with the migrations applied:
// the tables and functions of 20261113000400_ai_usage.sql, driven through the
// same usage.js / rateLimit.js code the handlers use.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { createTestDatabase, readMigration } from '../test/pglite.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../supabase.js';
import { getUsage, incrementUsage } from './usage.js';
import { enforce, resetBurstForTests } from './rateLimit.js';

const MIGRATION = '20261113000400_ai_usage.sql';
const DID = 'did:plc:pglitefixture';
const NOW = new Date('2026-11-13T12:00:00Z');

let t;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  await t.exec('TRUNCATE posting_adviser_usage, alt_text_usage, ai_rate_limit');
  setSupabaseClientForTests(t.supabase);
  resetBurstForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  resetSupabaseClientForTests();
  vi.restoreAllMocks();
});

describe('the AI usage migration', () => {
  it('applies a second time unchanged', async () => {
    await expect(t.exec(readMigration(MIGRATION))).resolves.toBeDefined();
  });

  it('keeps the tables and functions to the service role', async () => {
    const tables = await t.query(
      `SELECT c.relname AS name, c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'SELECT') AS anon,
              has_table_privilege('authenticated', c.oid, 'SELECT') AS authed,
              has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE') AS service
         FROM pg_class c
        WHERE c.relname IN ('posting_adviser_usage', 'alt_text_usage', 'ai_rate_limit')
        ORDER BY 1`,
    );
    expect(tables.rows).toEqual([
      {
        name: 'ai_rate_limit',
        rls: true,
        anon: false,
        authed: false,
        service: true,
      },
      {
        name: 'alt_text_usage',
        rls: true,
        anon: false,
        authed: false,
        service: true,
      },
      {
        name: 'posting_adviser_usage',
        rls: true,
        anon: false,
        authed: false,
        service: true,
      },
    ]);
    const fns = await t.query(
      `SELECT p.proname AS name,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
         FROM pg_proc p WHERE p.proname IN ('bump_ai_usage', 'consume_ai_daily') ORDER BY 1`,
    );
    expect(fns.rows).toEqual([
      { name: 'bump_ai_usage', anon: false, service: true },
      { name: 'consume_ai_daily', anon: false, service: true },
    ]);
  });
});

describe('monthly allowances on Postgres', () => {
  it('counts from one, and reads back what it counted', async () => {
    expect(await getUsage('adviser', DID, { env: {}, now: NOW })).toEqual({
      used: 0,
      limit: 30,
      tracked: true,
    });
    expect(
      await incrementUsage('adviser', DID, {
        env: {},
        now: NOW,
        usedBefore: 0,
      }),
    ).toBe(1);
    expect(
      await incrementUsage('adviser', DID, {
        env: {},
        now: NOW,
        usedBefore: 1,
      }),
    ).toBe(2);
    expect(await getUsage('adviser', DID, { env: {}, now: NOW })).toEqual({
      used: 2,
      limit: 30,
      tracked: true,
    });
  });

  it('keeps style readings apart from adviser reads on the same row', async () => {
    await incrementUsage('adviser', DID, { env: {}, now: NOW });
    await incrementUsage('adviser', DID, { env: {}, now: NOW });
    expect(await incrementUsage('style', DID, { env: {}, now: NOW })).toBe(1);
    const { rows } = await t.query(
      'SELECT month, count, style_count FROM posting_adviser_usage WHERE did = $1',
      [DID],
    );
    expect(rows).toEqual([{ month: '2026-11', count: 2, style_count: 1 }]);
    expect((await getUsage('style', DID, { env: {}, now: NOW })).used).toBe(1);
  });

  it('counts image descriptions in their own table, per month', async () => {
    await incrementUsage('altText', DID, { env: {}, now: NOW });
    await incrementUsage('altText', DID, {
      env: {},
      now: new Date('2026-12-01T00:00:00Z'),
    });
    const { rows } = await t.query(
      'SELECT month, count FROM alt_text_usage WHERE did = $1 ORDER BY month',
      [DID],
    );
    expect(rows).toEqual([
      { month: '2026-11', count: 1 },
      { month: '2026-12', count: 1 },
    ]);
    expect((await getUsage('adviser', DID, { env: {}, now: NOW })).used).toBe(
      0,
    );
  });

  it('loses no count when requests arrive together', async () => {
    const counts = await Promise.all(
      Array.from({ length: 20 }, () =>
        incrementUsage('adviser', DID, { env: {}, now: NOW }),
      ),
    );
    expect(counts.slice().sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect((await getUsage('adviser', DID, { env: {}, now: NOW })).used).toBe(
      20,
    );
  });

  it('refuses an allowance the function does not know', async () => {
    const { error } = await t.supabase.rpc('bump_ai_usage', {
      p_allowance: 'reflection',
      p_did: DID,
      p_month: '2026-11',
    });
    expect(error?.message).toMatch(/unknown AI allowance/);
  });
});

describe('the daily ceiling on Postgres', () => {
  it('takes slots up to the limit, then refuses without counting further', async () => {
    const take = () =>
      t.supabase.rpc('consume_ai_daily', {
        p_did: DID,
        p_day: '2026-11-13',
        p_limit: 2,
      });
    expect((await take()).data).toEqual([{ allowed: true, used: 1 }]);
    expect((await take()).data).toEqual([{ allowed: true, used: 2 }]);
    expect((await take()).data).toEqual([{ allowed: false, used: 2 }]);
    const { rows } = await t.query(
      'SELECT count FROM ai_rate_limit WHERE did = $1',
      [DID],
    );
    expect(rows).toEqual([{ count: 2 }]);
  });

  it('refuses everything for a limit below one', async () => {
    const { data } = await t.supabase.rpc('consume_ai_daily', {
      p_did: DID,
      p_day: '2026-11-13',
      p_limit: 0,
    });
    expect(data).toEqual([{ allowed: false, used: 0 }]);
  });

  it('never lets requests arriving together past the limit', async () => {
    const answers = await Promise.all(
      Array.from({ length: 10 }, () =>
        t.supabase.rpc('consume_ai_daily', {
          p_did: DID,
          p_day: '2026-11-13',
          p_limit: 4,
        }),
      ),
    );
    expect(answers.filter((a) => a.data[0].allowed)).toHaveLength(4);
    const { rows } = await t.query(
      'SELECT count FROM ai_rate_limit WHERE did = $1',
      [DID],
    );
    expect(rows).toEqual([{ count: 4 }]);
  });

  it('is what enforce() reads', async () => {
    const env = { AI_DAILY_LIMIT: '2' };
    expect((await enforce(DID, { env })).allowed).toBe(true);
    expect((await enforce(DID, { env })).allowed).toBe(true);
    expect(await enforce(DID, { env })).toEqual({
      allowed: false,
      status: 429,
      body: { error: 'rate_limited', scope: 'daily', limit: 2 },
    });
  });
});
