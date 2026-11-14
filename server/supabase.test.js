import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getSupabaseClient,
  isSupabaseConfigured,
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from './supabase.js';

afterEach(() => {
  resetSupabaseClientForTests();
  vi.restoreAllMocks();
});

const ENV = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' };

describe('getSupabaseClient', () => {
  it('is null, with one warning, when the URL or the key is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getSupabaseClient({})).toBeNull();
    expect(getSupabaseClient({ SUPABASE_URL: ENV.SUPABASE_URL })).toBeNull();
    expect(getSupabaseClient({ SUPABASE_SERVICE_ROLE_KEY: 'k' })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).not.toContain('service-role-key');
  });

  it('builds a client and caches it per URL and key', () => {
    const a = getSupabaseClient(ENV);
    expect(a).toBeTruthy();
    expect(typeof a.from).toBe('function');
    expect(typeof a.rpc).toBe('function');
    expect(getSupabaseClient({ ...ENV })).toBe(a);
    const b = getSupabaseClient({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: 'another-key' });
    expect(b).not.toBe(a);
  });

  it('accepts SUPABASE_SERVICE_KEY as the key', () => {
    expect(getSupabaseClient({ SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_KEY: 'k' })).toBeTruthy();
    expect(isSupabaseConfigured({ SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_KEY: 'k' })).toBe(true);
  });
});

describe('isSupabaseConfigured', () => {
  it('needs both the URL and a key', () => {
    expect(isSupabaseConfigured(ENV)).toBe(true);
    expect(isSupabaseConfigured({ SUPABASE_URL: ENV.SUPABASE_URL })).toBe(false);
    expect(isSupabaseConfigured({})).toBe(false);
  });
});

describe('the test seam', () => {
  it('hands every caller the installed client, whatever the environment', () => {
    const fake = { from() {}, rpc() {} };
    setSupabaseClientForTests(fake);
    expect(getSupabaseClient({})).toBe(fake);
    expect(isSupabaseConfigured({})).toBe(true);
  });

  it('null reads as unconfigured even with credentials set', () => {
    setSupabaseClientForTests(null);
    expect(getSupabaseClient(ENV)).toBeNull();
    expect(isSupabaseConfigured(ENV)).toBe(false);
  });

  it('undefined and reset remove the override', () => {
    setSupabaseClientForTests(null);
    setSupabaseClientForTests(undefined);
    expect(getSupabaseClient(ENV)).toBeTruthy();
    setSupabaseClientForTests(null);
    resetSupabaseClientForTests();
    expect(isSupabaseConfigured(ENV)).toBe(true);
  });
});
