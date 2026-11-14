import { describe, it, expect, vi, afterEach } from 'vitest';
import { timingSafeEqual } from 'node:crypto';
import { isCronAuthorized, requireCron } from './cron.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});
import { createReq, createRes } from './test/http.js';

afterEach(() => vi.restoreAllMocks());


const withAuth = (value) => createReq({ headers: value === undefined ? {} : { authorization: value } });

describe('isCronAuthorized with CRON_SECRET set', () => {
  const env = { CRON_SECRET: 's3cret-value', VERCEL_ENV: 'production' };

  it('accepts exactly Bearer <CRON_SECRET>', () => {
    expect(isCronAuthorized(withAuth('Bearer s3cret-value'), env)).toBe(true);
  });

  it('refuses a missing, wrong, longer, shorter or differently-cased header', () => {
    for (const value of [undefined, '', 'Bearer wrong', 'Bearer s3cret-value!', 'Bearer s3cret', 'bearer s3cret-value', 's3cret-value']) {
      expect(isCronAuthorized(withAuth(value), env)).toBe(false);
    }
  });

  it('applies outside production too', () => {
    expect(isCronAuthorized(withAuth('Bearer wrong'), { CRON_SECRET: 'x' })).toBe(false);
  });

  it('compares in constant time, whatever the lengths', () => {
    timingSafeEqual.mockClear();
    for (const value of ['B', 'Bearer s3cret-value', `Bearer ${'x'.repeat(10_000)}`]) {
      isCronAuthorized(withAuth(value), env);
    }
    expect(timingSafeEqual).toHaveBeenCalledTimes(3);
    for (const [a, b] of timingSafeEqual.mock.calls) {
      expect(a.byteLength).toBe(32);
      expect(b.byteLength).toBe(32);
    }
  });
});

describe('isCronAuthorized without CRON_SECRET', () => {
  it('refuses in production', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(isCronAuthorized(withAuth(), { VERCEL_ENV: 'production' })).toBe(false);
    expect(isCronAuthorized(withAuth('Bearer anything'), { NODE_ENV: 'production' })).toBe(false);
  });

  it('allows elsewhere, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isCronAuthorized(withAuth(), {})).toBe(true);
    expect(isCronAuthorized(withAuth(), { VERCEL_ENV: 'preview' })).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});

describe('requireCron', () => {
  it('answers 401 Unauthorized itself', () => {
    const res = createRes();
    expect(requireCron(withAuth('Bearer wrong'), res, { CRON_SECRET: 'x' })).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('lets an authorised run through untouched', () => {
    const res = createRes();
    expect(requireCron(withAuth('Bearer x'), res, { CRON_SECRET: 'x' })).toBe(true);
    expect(res.ended).toBe(false);
  });
});
